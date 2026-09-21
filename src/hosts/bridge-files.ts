import { toDataRelative } from './paths.js';
import { FilePlaneError, type FileEntry, type FilePlane, type PageCaller } from './types.js';

/**
 * The bridge file plane — every host's plane, with no configuration: Foundry's own FilePicker,
 * driven from inside the joined page (src/page/files.ts) by the bridge user. Browse, stat,
 * read, write and mkdir work on any host that can be joined; what FilePicker does not have —
 * delete and move — this plane refuses by name, pointing at the direct planes that do.
 *
 * It keeps the FilePlane contract the direct planes set: one directory per `mkdir`, parents via
 * `ensureParents`, the same FilePlaneError statuses (404 / 409 / 415 / 501). Bytes travel through
 * the bridge as base64, so a direct plane (WebDAV — `FOUNDRY_WEBDAV_*`, or the `Data/` directory
 * of an install on this machine — `FOUNDRY_DATA_DIR`) stays the fast path for bulk; the host
 * composes the two (`filePlaneFor`).
 */
export class BridgeFilePlane implements FilePlane {
  readonly label = 'bridge (FilePicker)';

  constructor(private readonly page: PageCaller) {}

  async list(dir: string): Promise<FileEntry[] | null> {
    const clean = toDataRelative(dir);
    const r = await this.page.call('browseFiles', { dir: clean });
    if (!r) return null;
    return [
      ...r.dirs.map(d => ({ path: d.path, name: d.name, isDirectory: true })),
      ...r.files.map(f => ({ ...f, isDirectory: false })),
    ];
  }

  async stat(path: string): Promise<FileEntry | null> {
    const clean = toDataRelative(path);
    const r = await this.page.call('statFile', { path: clean });
    if (!r) return null;
    return { path: clean, name: clean.split('/').pop() ?? clean, ...r };
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async read(path: string): Promise<Uint8Array> {
    const clean = toDataRelative(path);
    const r = await this.page.call('readFileBase64', { path: clean });
    if (!r) throw new FilePlaneError(`Not found: "Data/${clean}" is not served by Foundry.`, 404);
    return new Uint8Array(Buffer.from(r.base64, 'base64'));
  }

  async write(path: string, body: Uint8Array, contentType?: string): Promise<void> {
    const clean = toDataRelative(path);
    const r = await this.page.call('uploadFile', {
      path: clean,
      base64: Buffer.from(body).toString('base64'),
      ...(contentType ? { contentType } : {}),
    });
    if (r.ok) return;
    if (r.reason === 'extension') {
      throw new FilePlaneError(
        `"Data/${clean}" cannot be uploaded through the bridge plane: ${r.detail}. ` +
          'A direct plane (FOUNDRY_DATA_DIR or FOUNDRY_WEBDAV_*) takes any file.',
        415
      );
    }
    if (r.reason === 'no-directory') {
      throw new FilePlaneError(`Cannot write "Data/${clean}": ${r.detail}.`, 409);
    }
    throw new FilePlaneError(`Cannot write "Data/${clean}": ${r.detail}.`, 500);
  }

  async mkdir(path: string): Promise<void> {
    const clean = toDataRelative(path);
    const r = await this.page.call('createDirectory', { path: clean });
    if (r.ok) return;
    throw new FilePlaneError(
      `Cannot create "Data/${clean}": ${r.detail}.`,
      r.reason === 'no-parent' ? 409 : 500
    );
  }

  /** FilePicker creates one level at a time — walk down from the root, existing = fine. */
  async ensureParents(path: string): Promise<void> {
    const segments = toDataRelative(path).split('/').filter(Boolean);
    segments.pop(); // the entry itself
    let prefix = '';
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      await this.mkdir(prefix);
    }
  }

  async remove(path: string, _isDirectory?: boolean): Promise<void> {
    throw this.unsupported('delete', toDataRelative(path));
  }

  async move(
    from: string,
    _to: string,
    _overwrite: boolean,
    _isDirectory?: boolean
  ): Promise<void> {
    throw this.unsupported('move', toDataRelative(from));
  }

  /** A file copy is a read + an upload; a directory copy is not (no recursive read here). */
  async copy(from: string, to: string, _overwrite: boolean, isDirectory?: boolean): Promise<void> {
    const cleanFrom = toDataRelative(from);
    if (isDirectory) throw this.unsupported('copy a directory', cleanFrom);
    const bytes = await this.read(cleanFrom);
    await this.write(to, bytes);
  }

  private unsupported(what: string, path: string): FilePlaneError {
    return new FilePlaneError(
      `cannot ${what} "Data/${path}" through the bridge plane — Foundry's own FilePicker has no ` +
        "delete or move. Configure a direct plane for that: FOUNDRY_DATA_DIR (the install's " +
        'Data directory, when it is on this machine) or FOUNDRY_WEBDAV_URL / _USER / _PASSWORD.',
      501
    );
  }
}
