import { Logger } from '../logger.js';
import { FilePlaneError, type FileEntry, type FilePlane } from './types.js';
import { toDataRelative } from './paths.js';

/**
 * Minimal, dependency-free WebDAV client — the WebDAV plane (FOUNDRY_WEBDAV_*; Molten's default).
 *
 * Molten's WebDAV endpoint is standard Apache 2.4 `mod_dav` (DAV class 1,2) behind HTTP Basic auth
 * (user `foundry-ftp`, password = the File-Manager token). The endpoint is rooted at the Foundry
 * CONTAINER root, so the Foundry data dir lives under `/Data/...`. Everything in this codebase speaks
 * "Data-relative" paths (no leading slash, no `Data/` prefix, e.g. `assets/maps/x.webp`); this client
 * maps them to `<webdavUrl>/Data/<path>`. (Verified live 2026-06-21.)
 *
 * Node 22's global `fetch` (undici) accepts the non-standard WebDAV verbs (PROPFIND/MKCOL/COPY/MOVE),
 * so no third-party WebDAV/XML dependency is pulled in. PROPFIND multistatus XML is parsed with a
 * small namespace-prefix-agnostic regex pass (Apache emits `D:`/`lp1:`/`lp2:` prefixes).
 */

export interface WebDavClientOptions {
  /** WebDAV host root, e.g. `https://your-server.webdav.moltenhosting.com`. */
  webdavUrl: string;
  user: string;
  password: string;
  logger: Logger;
  /** Per-request timeout in ms (default 30000). Guards against a half-awake box that never replies. */
  timeoutMs?: number;
}

/**
 * Per-request timeout. A Molten box that accepts the TCP socket but never responds (a half-awake
 * VM) would otherwise hang a tool indefinitely — the same cold-start failure mode the Playwright
 * bridge is explicitly budgeted against. 30s comfortably covers a real PROPFIND/PUT.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Encode each path segment but preserve the `/` separators. */
function encodePath(p: string): string {
  return p
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

export class WebDavClient implements FilePlane {
  readonly label = 'WebDAV';
  private base: string;
  private auth: string;
  private logger: Logger;
  private timeoutMs: number;

  constructor(opts: WebDavClientOptions) {
    this.base = opts.webdavUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${opts.user}:${opts.password}`).toString('base64')}`;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Absolute WebDAV URL for a Data-relative path (collections get a trailing slash). */
  private url(dataRelPath: string, isDirectory = false): string {
    const clean = toDataRelative(dataRelPath);
    const suffix = clean.length ? `/${encodePath(clean)}` : '';
    return `${this.base}/Data${suffix}${isDirectory ? '/' : ''}`;
  }

  private async request(
    method: string,
    url: string,
    init: RequestInit = {},
    hop = 0
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', this.auth);
    let res: Response;
    try {
      // Follow redirects MANUALLY: Molten's Apache is behind a TLS-terminating proxy and emits
      // self-referential 301s with an http:// scheme (e.g. a directory without a trailing slash →
      // `http://.../dir/`). The built-in follower would downgrade https→http and STRIP the
      // Authorization header → 401. We re-issue against the Location, forced back to https, with
      // auth re-attached and the method/body preserved. AbortSignal.timeout bounds each hop so a
      // half-awake box can't hang the call indefinitely.
      res = await fetch(url, {
        ...init,
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new FilePlaneError(
          `WebDAV ${method} timed out after ${this.timeoutMs}ms ` +
            '(the Molten box may be asleep or only half-awake; file management needs the VM live).',
          0
        );
      }
      throw new FilePlaneError(
        `WebDAV ${method} ${url} failed to connect: ${e.message} ` +
          '(is the Molten server awake? file management needs the VM live).',
        0
      );
    }
    if ([301, 302, 307, 308].includes(res.status) && hop < 3) {
      const loc = res.headers.get('location');
      if (loc) {
        const next = new URL(loc, url);
        next.protocol = 'https:';
        return this.request(method, next.toString(), init, hop + 1);
      }
    }
    return res;
  }

  /** PROPFIND a path; returns the entries (depth 1 includes the collection itself + its children). */
  async propfind(dataRelPath: string, depth: '0' | '1'): Promise<FileEntry[]> {
    const isCol = depth === '1';
    const res = await this.request('PROPFIND', this.url(dataRelPath, isCol), {
      headers: { Depth: depth },
    });
    if (res.status === 404) return [];
    if (res.status !== 207) {
      throw new FilePlaneError(
        `WebDAV PROPFIND ${dataRelPath || '(root)'} → HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
    return parseMultistatus(await res.text());
  }

  /** Children of a directory (the depth-1 PROPFIND minus the collection itself); null if absent. */
  async list(dir: string): Promise<FileEntry[] | null> {
    const clean = toDataRelative(dir);
    const entries = await this.propfind(clean, '1');
    if (entries.length === 0) return null;
    return entries.filter(e => e.path !== clean);
  }

  /** PROPFIND depth 0 of a single path; null if it does not exist. */
  async stat(dataRelPath: string): Promise<FileEntry | null> {
    const entries = await this.propfind(dataRelPath, '0');
    return entries[0] ?? null;
  }

  /** Does the path exist? (cheap PROPFIND depth 0). */
  async exists(dataRelPath: string): Promise<boolean> {
    return (await this.stat(dataRelPath)) !== null;
  }

  /** PUT bytes to a file path. Caller is responsible for parent dirs (see ensureParents). */
  async write(dataRelPath: string, body: Uint8Array, contentType?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await this.request('PUT', this.url(dataRelPath), {
      body: body as BodyInit,
      headers,
    });
    // 201 Created (new) / 204 No Content (overwrite) / 200 OK are all success.
    if (![200, 201, 204].includes(res.status)) {
      throw new FilePlaneError(
        `WebDAV PUT ${dataRelPath} → HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
  }

  /** Create a single collection (directory). Treats "already exists" (405) as success. */
  async mkdir(dataRelPath: string): Promise<void> {
    const res = await this.request('MKCOL', this.url(dataRelPath, true));
    if (res.status === 201 || res.status === 405) return; // 405 = already a collection
    throw new FilePlaneError(
      `WebDAV MKCOL ${dataRelPath} → HTTP ${res.status} ${res.statusText}`,
      res.status
    );
  }

  /** MKCOL every missing parent collection of a file/dir path (Apache has no recursive MKCOL). */
  async ensureParents(dataRelPath: string): Promise<void> {
    const clean = toDataRelative(dataRelPath);
    const parts = clean.split('/').slice(0, -1); // drop the leaf (the file/dir being created)
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!(await this.exists(prefix))) {
        await this.mkdir(prefix);
      }
    }
  }

  /** DELETE a file or (with isDirectory) a directory. 404 → throws FilePlaneError(404). */
  async remove(dataRelPath: string, isDirectory = false): Promise<void> {
    const res = await this.request('DELETE', this.url(dataRelPath, isDirectory));
    if (![200, 204, 207].includes(res.status)) {
      throw new FilePlaneError(
        `WebDAV DELETE ${dataRelPath} → HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
  }

  /** MOVE (rename) a file/dir to a new Data-relative path. */
  async move(
    fromRel: string,
    toRel: string,
    overwrite: boolean,
    isDirectory = false
  ): Promise<void> {
    const res = await this.request('MOVE', this.url(fromRel, isDirectory), {
      headers: { Destination: this.url(toRel, isDirectory), Overwrite: overwrite ? 'T' : 'F' },
    });
    if (![201, 204].includes(res.status)) {
      throw new FilePlaneError(
        `WebDAV MOVE ${fromRel} → ${toRel}: HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
  }

  /** COPY a file/dir to a new Data-relative path. */
  async copy(
    fromRel: string,
    toRel: string,
    overwrite: boolean,
    isDirectory = false
  ): Promise<void> {
    const res = await this.request('COPY', this.url(fromRel, isDirectory), {
      headers: { Destination: this.url(toRel, isDirectory), Overwrite: overwrite ? 'T' : 'F' },
    });
    if (![201, 204].includes(res.status)) {
      throw new FilePlaneError(
        `WebDAV COPY ${fromRel} → ${toRel}: HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
  }

  /** GET a file's bytes. */
  async read(dataRelPath: string): Promise<Uint8Array> {
    const res = await this.request('GET', this.url(dataRelPath));
    if (res.status !== 200) {
      throw new FilePlaneError(
        `WebDAV GET ${dataRelPath} → HTTP ${res.status} ${res.statusText}`,
        res.status
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Parse a WebDAV multistatus body into FileEntry[] (prefix-agnostic). */
function parseMultistatus(xml: string): FileEntry[] {
  const out: FileEntry[] = [];
  const responses = xml.match(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi) ?? [];
  for (const block of responses) {
    const hrefMatch = block.match(/<(?:\w+:)?href>\s*([^<]*?)\s*<\/(?:\w+:)?href>/i);
    if (!hrefMatch) continue;
    let href: string;
    try {
      href = decodeURIComponent(hrefMatch[1]);
    } catch {
      href = hrefMatch[1];
    }
    const isDirectory = /<(?:\w+:)?resourcetype>[\s\S]*?<(?:\w+:)?collection\s*\/?>/i.test(block);
    let path: string;
    try {
      path = toDataRelative(href);
    } catch {
      continue; // a server href with a `..` segment is pathological — skip it rather than fail the listing
    }
    const name = path.split('/').filter(Boolean).pop() ?? '';

    const sizeMatch = block.match(/<(?:\w+:)?getcontentlength>\s*(\d+)\s*</i);
    const typeMatch = block.match(/<(?:\w+:)?getcontenttype>\s*([^<]+?)\s*</i);
    const mtimeMatch = block.match(/<(?:\w+:)?getlastmodified>\s*([^<]+?)\s*</i);

    const entry: FileEntry = { path, name, isDirectory };
    if (sizeMatch) entry.size = parseInt(sizeMatch[1], 10);
    if (typeMatch) entry.contentType = typeMatch[1];
    if (mtimeMatch) entry.lastModified = mtimeMatch[1];
    out.push(entry);
  }
  return out;
}
