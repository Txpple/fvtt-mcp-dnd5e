// Page-side: the bridge file plane — Foundry's own FilePicker, driven from inside the page.
//
// Every Foundry serves `Data/` at the server root and lets a Gamemaster / Assistant user browse
// it, create directories in it and upload MEDIA into it through `FilePicker` (the socket
// `manageFiles` route + `POST /upload`). That makes a file plane that exists on every host with
// no configuration at all — the Node side (src/hosts/bridge-files.ts) is a thin FilePlane over
// these five calls. What FilePicker cannot do is delete or move; the plane says so by name.
//
// Probed live on 14.368 as a role-3 Assistant (2026-09-20): `browse` returns Data-relative paths
// with each segment URL-encoded and throws on a missing directory; `createDirectory` has no
// parents (ENOENT) and reports EEXIST on repeat; `upload` overwrites silently and returns `false`
// with no reason for a non-uploadable extension or a missing directory — so both are checked
// here first. Same-origin HEAD / GET of the public path give size, type and last-modified.
//
// Bytes cross the bridge as base64 — `page.evaluate` arguments are JSON. Fine for a map or a
// track; a direct plane (WebDAV, the local filesystem) is the fast path for bulk.

import { unsupported } from './errors.js';

interface BrowseResult {
  target: string;
  dirs: string[];
  files: string[];
}

/** Foundry 14 moved FilePicker under `foundry.applications.apps`; the global is the ≤13 spelling. */
function filePicker(): any {
  const fp =
    foundry?.applications?.apps?.FilePicker?.implementation ?? (globalThis as any).FilePicker;
  if (!fp) throw unsupported('FilePicker is not available in this Foundry build');
  return fp;
}

/** `browse` encodes each path segment (`probe%20file.txt`); the plane speaks literal paths. */
function decodePath(p: string): string {
  return p
    .split('/')
    .map(seg => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

/** Encode each segment for a fetch of the public path (the inverse of decodePath). */
function encodePath(p: string): string {
  return p
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

/** One HEAD of a Data-relative file: size / type / last-modified, or null when it is not served. */
async function headFile(path: string): Promise<{
  size?: number | undefined;
  contentType?: string | undefined;
  lastModified?: string | undefined;
} | null> {
  const res = await fetch(`/${encodePath(path)}`, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) return null;
  const len = res.headers.get('content-length');
  const type = res.headers.get('content-type');
  const lm = res.headers.get('last-modified');
  return {
    ...(len !== null && Number.isFinite(Number(len)) ? { size: Number(len) } : {}),
    ...(type ? { contentType: type.split(';')[0]?.trim() ?? type } : {}),
    ...(lm ? { lastModified: lm } : {}),
  };
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface BrowseFilesResult {
  dirs: Array<{ path: string; name: string }>;
  files: Array<{
    path: string;
    name: string;
    size?: number | undefined;
    contentType?: string | undefined;
    lastModified?: string | undefined;
  }>;
}

/**
 * The children of a Data-relative directory (`''` = the Data/ root), or `null` when it does not
 * exist. Files carry size / type / last-modified from a HEAD each (bounded parallelism; skipped
 * above 200 files so a huge tile folder stays a cheap listing).
 */
export async function browseFiles(args: { dir: string }): Promise<BrowseFilesResult | null> {
  const dir = String(args?.dir ?? '');
  let raw: BrowseResult;
  try {
    raw = await filePicker().browse('data', dir);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/does not exist|not accessible|ENOENT/i.test(msg)) return null;
    throw new Error(`FilePicker.browse("${dir}") failed: ${msg}`);
  }
  const dirs = (raw.dirs ?? []).map(decodePath).map(path => ({ path, name: basename(path) }));
  const filePaths = (raw.files ?? []).map(decodePath);
  const withMeta = filePaths.length <= 200;
  const files = await mapLimited(filePaths, 8, async path => {
    const meta = withMeta ? await headFile(path).catch(() => null) : null;
    return { path, name: basename(path), ...(meta ?? {}) };
  });
  return { dirs, files };
}

export interface StatFileResult {
  isDirectory: boolean;
  size?: number | undefined;
  contentType?: string | undefined;
  lastModified?: string | undefined;
}

/** One entry — by browsing its parent (a directory is only knowable that way) — or `null`. */
export async function statFile(args: { path: string }): Promise<StatFileResult | null> {
  const path = String(args?.path ?? '');
  if (path === '') return { isDirectory: true };
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  let raw: BrowseResult;
  try {
    raw = await filePicker().browse('data', parent);
  } catch {
    return null; // the parent is missing → so is the entry
  }
  if ((raw.dirs ?? []).map(decodePath).includes(path)) return { isDirectory: true };
  if (!(raw.files ?? []).map(decodePath).includes(path)) return null;
  const meta = await headFile(path).catch(() => null);
  return { isDirectory: false, ...(meta ?? {}) };
}

/** The bytes of a Data-relative file as base64 (a same-origin GET), or `null` when not served. */
export async function readFileBase64(args: { path: string }): Promise<{ base64: string } | null> {
  const path = String(args?.path ?? '');
  const res = await fetch(`/${encodePath(path)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin) };
}

/** The extensions Foundry's upload route accepts (images, audio, video, fonts, 3D, text formats). */
function uploadableExtensions(): string[] {
  const table = (globalThis as any).CONST?.UPLOADABLE_FILE_EXTENSIONS ?? {};
  return Object.keys(table).map(e => e.toLowerCase());
}

export type UploadFileResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'extension' | 'no-directory' | 'refused'; detail: string };

/**
 * Upload `base64` bytes to a Data-relative file path through FilePicker (overwrites; the plane's
 * callers check `exists` first). The two silent `false` causes are reported by name.
 */
export async function uploadFile(args: {
  path: string;
  base64: string;
  contentType?: string | undefined;
}): Promise<UploadFileResult> {
  const path = String(args?.path ?? '');
  const name = basename(path);
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  const allowed = uploadableExtensions();
  if (!ext || !allowed.includes(ext)) {
    return {
      ok: false,
      reason: 'extension',
      detail: `Foundry's upload route accepts only ${allowed.length ? allowed.join(', ') : 'its media and text formats'} — not ".${ext || '(none)'}"`,
    };
  }
  const bin = atob(String(args?.base64 ?? ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, args?.contentType ? { type: args.contentType } : {});
  const result = await filePicker().upload('data', dir, file, {}, { notify: false });
  if (result?.status !== 'success') {
    // FilePicker.upload answers `false` for a missing target directory too — tell them apart.
    let dirExists = true;
    try {
      await filePicker().browse('data', dir);
    } catch {
      dirExists = false;
    }
    if (!dirExists) {
      return {
        ok: false,
        reason: 'no-directory',
        detail: `directory "Data/${dir}" does not exist`,
      };
    }
    return {
      ok: false,
      reason: 'refused',
      detail: `Foundry refused the upload of "${name}"${result?.message ? `: ${result.message}` : ''}`,
    };
  }
  return { ok: true, path: decodePath(String(result.path ?? path)) };
}

export type CreateDirectoryResult =
  | { ok: true; existed: boolean }
  | { ok: false; reason: 'no-parent' | 'refused'; detail: string };

/** Create ONE Data-relative directory (no parents — FilePicker's contract); existing = success. */
export async function createDirectory(args: { path: string }): Promise<CreateDirectoryResult> {
  const path = String(args?.path ?? '');
  try {
    await filePicker().createDirectory('data', path);
    return { ok: true, existed: false };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/EEXIST|already exists/i.test(msg)) return { ok: true, existed: true };
    if (/ENOENT|no such file/i.test(msg)) {
      return {
        ok: false,
        reason: 'no-parent',
        detail: `the parent of "Data/${path}" does not exist`,
      };
    }
    return { ok: false, reason: 'refused', detail: msg };
  }
}
