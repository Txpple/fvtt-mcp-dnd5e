import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { guessContentType, toDataRelative } from './paths.js';
import { FilePlaneError, type FileEntry, type FilePlane } from './types.js';

/**
 * The local host's FilePlane: `node:fs` over the Foundry `Data/` directory of an install on THIS
 * machine (LOCAL_FOUNDRY_DATA — the same directory scripts/local-foundry.mjs serves).
 *
 * It keeps the WebDAV plane's contract to the letter — one directory per mkdir, parents via
 * ensureParents, the same FilePlaneError statuses (404 / 409 / 412) — so the asset tools behave
 * identically on both and are tested once against a stub. The Data-relative canonicalisation
 * (`toDataRelative`, which refuses `..`) plus a resolved-path containment check keep every
 * operation inside `Data/`; the live world-DB guard is the tools' job, exactly as on WebDAV.
 */
export class LocalFilePlane implements FilePlane {
  readonly label = 'local filesystem';
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = resolve(dataDir);
  }

  /** Absolute filesystem path for a Data-relative path; refuses anything that escapes the root. */
  private abs(dataRelPath: string): string {
    const clean = toDataRelative(dataRelPath);
    const full = resolve(this.root, clean);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new FilePlaneError(
        `Refused: "${dataRelPath}" resolves outside the Data/ directory.`,
        400
      );
    }
    return full;
  }

  private async entry(clean: string, full: string): Promise<FileEntry | null> {
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw this.wrap('stat', clean, err);
    }
    const name = clean.split('/').filter(Boolean).pop() ?? '';
    const e: FileEntry = { path: clean, name, isDirectory: s.isDirectory() };
    e.lastModified = s.mtime.toUTCString();
    if (!e.isDirectory) {
      e.size = s.size;
      e.contentType = guessContentType(name);
    }
    return e;
  }

  private wrap(op: string, path: string, err: unknown): FilePlaneError {
    const code = (err as NodeJS.ErrnoException).code;
    const status =
      code === 'ENOENT'
        ? 404
        : code === 'EEXIST' || code === 'ENOTEMPTY'
          ? 409
          : code === 'EACCES' || code === 'EPERM'
            ? 403
            : 500;
    return new FilePlaneError(
      `local ${op} ${path || '(root)'} failed: ${(err as Error).message}`,
      status
    );
  }

  async list(dir: string): Promise<FileEntry[] | null> {
    const clean = toDataRelative(dir);
    const full = this.abs(clean);
    let names: string[];
    try {
      names = await readdir(full);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw this.wrap('list', clean, err);
    }
    const out: FileEntry[] = [];
    for (const name of names) {
      const childClean = clean ? `${clean}/${name}` : name;
      const e = await this.entry(childClean, join(full, name));
      if (e) out.push(e);
    }
    return out;
  }

  async stat(path: string): Promise<FileEntry | null> {
    const clean = toDataRelative(path);
    return this.entry(clean, this.abs(clean));
  }

  async exists(path: string): Promise<boolean> {
    const full = this.abs(path); // a bad path throws (400) — never reads as "absent"
    try {
      await access(full, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Uint8Array> {
    const full = this.abs(path);
    try {
      return new Uint8Array(await readFile(full));
    } catch (err) {
      throw this.wrap('read', path, err);
    }
  }

  async write(path: string, body: Uint8Array): Promise<void> {
    const full = this.abs(path);
    try {
      await writeFile(full, body);
    } catch (err) {
      throw this.wrap('write', path, err);
    }
  }

  /** One directory; already-a-directory is success (the mod_dav MKCOL 405 rule). */
  async mkdir(path: string): Promise<void> {
    const full = this.abs(path);
    try {
      await mkdir(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        const s = await stat(full).catch(() => null);
        if (s?.isDirectory()) return;
      }
      throw this.wrap('mkdir', path, err);
    }
  }

  async ensureParents(path: string): Promise<void> {
    const full = this.abs(path);
    try {
      await mkdir(dirname(full), { recursive: true });
    } catch (err) {
      throw this.wrap('mkdir', path, err);
    }
  }

  async remove(path: string, isDirectory = false): Promise<void> {
    const full = this.abs(path);
    if (!(await this.exists(path))) {
      throw new FilePlaneError(`local remove ${path}: does not exist`, 404);
    }
    try {
      await rm(full, { recursive: isDirectory, force: false });
    } catch (err) {
      throw this.wrap('remove', path, err);
    }
  }

  async move(from: string, to: string, overwrite: boolean): Promise<void> {
    const src = this.abs(from);
    const dst = this.abs(to);
    if (!overwrite && (await this.exists(to))) {
      throw new FilePlaneError(`local move ${from} → ${to}: destination exists`, 412);
    }
    try {
      if (overwrite) await rm(dst, { recursive: true, force: true });
      await rename(src, dst);
    } catch (err) {
      throw this.wrap('move', from, err);
    }
  }

  async copy(from: string, to: string, overwrite: boolean, isDirectory = false): Promise<void> {
    const src = this.abs(from);
    const dst = this.abs(to);
    if (!overwrite && (await this.exists(to))) {
      throw new FilePlaneError(`local copy ${from} → ${to}: destination exists`, 412);
    }
    try {
      if (isDirectory) {
        await cp(src, dst, { recursive: true, force: overwrite, errorOnExist: !overwrite });
      } else {
        await copyFile(src, dst, overwrite ? 0 : fsConstants.COPYFILE_EXCL);
      }
    } catch (err) {
      throw this.wrap('copy', from, err);
    }
  }
}
