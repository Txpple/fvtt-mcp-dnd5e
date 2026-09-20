// The host seam (design.md §2.6).
//
// A Host is WHERE a Foundry instance runs — Molten Hosting, this machine, a bare URL — and it is
// the only thing in the codebase allowed to know. It gives the bridge (src/foundry.ts) the one
// host-specific step of connecting (waking a sleeping box) and gives the tools the one
// host-specific channel they may have (a DIRECT file plane into `Data/`). Everything else —
// /join, /setup, the page-side library, every tool, and the bridge file plane (Foundry's own
// FilePicker through the page) — is Foundry's own client and works on every host unchanged.
//
// Nothing here imports Playwright, node:fs or fetch: the interfaces are plain so the tools can be
// unit-tested against a stub plane and the bridge against a stub host.

export type HostKind = 'molten' | 'local' | 'generic';

/** One entry under `Data/`, in the Data-relative vocabulary the whole codebase speaks. */
export interface FileEntry {
  /** Data-relative path, e.g. `assets/maps/x.webp` (no leading slash, no `Data/` prefix). */
  path: string;
  /** Basename of the path. */
  name: string;
  isDirectory: boolean;
  /** Bytes (files only). */
  size?: number;
  contentType?: string;
  /** RFC-1123 string (what WebDAV reports; the local plane formats mtime the same way). */
  lastModified?: string;
}

/**
 * Error from a file-plane operation, carrying an HTTP-style status so the tools can give the
 * same friendly message whichever plane raised it (404 not found, 409/412 conflict, 400 bad path,
 * 415 a format the plane cannot take, 501 an operation the plane does not have, 0 unreachable,
 * 500 anything else). The local plane maps errno codes onto the same numbers.
 */
export class FilePlaneError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'FilePlaneError';
  }
}

/**
 * The file channel into a host's `Data/` directory. Every path is Data-relative and is
 * canonicalised by the plane (`toDataRelative` — `..` is refused). Directories are created one
 * level at a time (`mkdir`) plus `ensureParents`, exactly the contract Apache mod_dav imposes, so
 * the tools behave identically on a plane that could do more.
 */
export interface FilePlane {
  /** For messages: 'WebDAV', 'local filesystem'. */
  readonly label: string;
  /** Children of a directory (not the directory itself); `null` when it does not exist. */
  list(dir: string): Promise<FileEntry[] | null>;
  /** One entry, or `null` when it does not exist. */
  stat(path: string): Promise<FileEntry | null>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  /** Write bytes to a file path; the caller creates parents first (`ensureParents`). */
  write(path: string, body: Uint8Array, contentType?: string): Promise<void>;
  /** Create ONE directory; already-a-directory is success. */
  mkdir(path: string): Promise<void>;
  /** Create every missing parent directory of a file/dir path. */
  ensureParents(path: string): Promise<void>;
  remove(path: string, isDirectory?: boolean): Promise<void>;
  move(from: string, to: string, overwrite: boolean, isDirectory?: boolean): Promise<void>;
  copy(from: string, to: string, overwrite: boolean, isDirectory?: boolean): Promise<void>;
}

/**
 * The bridge as the bridge file plane sees it: the tool seam, minus Playwright and minus the
 * page-name typing (a structural subset of `FoundryBridge`).
 */
export interface PageCaller {
  call<T = any>(name: string, args?: unknown): Promise<T>;
}

/** What the bridge lends a host to wake an instance: the real browser page, minus Playwright. */
export interface WakeContext {
  /** Navigate the bridge's page to a URL (best-effort; the wake GET rides the real client). */
  goto(url: string): Promise<void>;
  log: { debug(msg: string): void; warn(msg: string): void };
}

export interface Host {
  readonly kind: HostKind;
  /** Human label for logs and get-world-info: 'Molten Hosting', 'local install', 'generic'. */
  readonly label: string;
  /**
   * Bring a sleeping / stopped instance up before the bridge probes /join (a GET of
   * FOUNDRY_WAKE_URL). Undefined = this host never sleeps.
   */
  readonly wake: ((ctx: WakeContext) => Promise<void>) | undefined;
  /** Appended to the bridge's "never became joinable" error — names this host's own knobs. */
  readonly unreachableHint: string;
  /** Strip this host's secrets (the wake token) out of a message before it reaches a log. */
  redact(msg: string): string;
  /**
   * The host's DIRECT file plane (WebDAV, or the `Data/` directory of an install on this
   * machine) — the fast path — or `null` when none is configured. Every host also has the bridge
   * plane (Foundry's own FilePicker through the page); `filePlaneFor` composes the two, and that
   * is what the tools use.
   */
  readonly files: FilePlane | null;
  /** Public URL for a Data-relative path (every Foundry serves `Data/` at the server root). */
  publicUrl(dataRelativePath: string): string;
}
