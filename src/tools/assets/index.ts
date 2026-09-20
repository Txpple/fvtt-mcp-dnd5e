import { z } from 'zod';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Logger } from '../../logger.js';
import type { FoundryBridge } from '../../foundry.js';
import type { FileEntry, FilePlane, Host } from '../../hosts/types.js';
import { filePlaneFor } from '../../hosts/index.js';
import {
  guessContentType,
  humanSize,
  looksLikeWorldDbPath as isWorldDbPath,
  toDataRelative,
  worldDbRefusal as refuseWorldDb,
} from '../../hosts/paths.js';
import { fileErrorMessage } from './access.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * Plane-B — the asset FILE tools (the asset-management library, Groups A/B).
 *
 * These talk to the file plane (src/hosts): the host's DIRECT plane when one is configured
 * (WebDAV, the `Data/` directory of an install on this machine), else the bridge plane —
 * Foundry's own FilePicker through the joined page, which every host has. They never know which
 * plane they are on: every handler is written against the FilePlane contract and the Host's
 * `publicUrl`; a plane that lacks an operation (FilePicker has no delete / move) refuses it by
 * name. The bridge is also what the destructive tools consult for reference checks.
 *
 * GROUPS:
 *  - A (discover, read-only): `asset-url` (pure mapping), `list-assets`, `asset-info`, `download-asset`.
 *  - B (manage files, write): `upload-asset`, `upload-asset-tree`, `create-asset-folder`,
 *    `delete-asset`, `move-asset`, `copy-asset` — the destructive ones wired to bridge-side
 *    reference-checking so they can't silently break the game.
 *
 * HARD SAFETY RULES baked in (DESIGN §3/§5/§6):
 *  - The live world DB (LevelDB under `Data/worlds/<world>/data/`) is UNTOUCHABLE via the file plane
 *    while the server runs — a write there, over WebDAV or straight onto the disk, corrupts it
 *    permanently. Write tools REFUSE such paths. Mass DB ops are a separate offline job (stop →
 *    Create Backup → fvtt unpack → edit → pack → start).
 *  - Anything under `Data/` is served PUBLICLY over HTTP(S) with no auth → privacy caveat surfaced on
 *    upload: never put anything sensitive under `Data/`.
 */

interface AssetFileToolsOptions {
  logger: Logger;
  /** Where Foundry runs — supplies the direct file plane (if any) and the public-URL mapping. */
  host: Host;
  /**
   * The bridge: the plane itself when the host has no direct one, and what the destructive file
   * tools (delete/move-asset) consult for find-asset-references first so they don't silently
   * break the game (while it is down, they refuse unless `force` is set).
   */
  foundry: FoundryBridge;
}

// Single source of truth for each tool's input contract: the handler parses with these schemas and
// getToolDefinitions() advertises toInputSchema(...) of the same schema.

const ListAssetsSchema = z.object({
  remotePath: z
    .string()
    .default('')
    .describe(
      'Directory path relative to the Foundry `Data/` root (a leading "Data/" or "/" is ' +
        'tolerated). Omit or "" for the Data/ root, e.g. "assets" or "worlds/your-world".'
    ),
});

const AssetInfoSchema = z.object({
  remotePath: z
    .string()
    .min(1)
    .describe(
      'Path relative to the Foundry `Data/` root, e.g. ' +
        '"worlds/your-world/assets/maps/cavern.webp".'
    ),
});

const DownloadAssetSchema = z.object({
  remotePath: z.string().min(1).describe('Source path relative to the Foundry `Data/` root.'),
  localPath: z
    .string()
    .min(1)
    .describe('Absolute local destination path. Parent directories are created if missing.'),
});

const UploadAssetSchema = z.object({
  localPath: z.string().min(1).describe('Absolute path to the local file to upload.'),
  remotePath: z
    .string()
    .min(1)
    .describe(
      'Destination path RELATIVE TO the Foundry `Data/` root, e.g. ' +
        '"worlds/your-world/assets/maps/cavern.webp". Must be an asset location, never ' +
        "inside a world's `data/` (LevelDB) directory."
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Allow overwriting an existing file at remotePath.'),
});

const UploadAssetTreeSchema = z.object({
  localRoot: z
    .string()
    .min(1)
    .describe('Absolute path to a LOCAL directory; every file under it (recursive) is uploaded.'),
  remoteRoot: z
    .string()
    .min(1)
    .describe(
      'Destination directory RELATIVE TO the Foundry `Data/` root, e.g. ' +
        '"worlds/your-world/assets/tom-cartos/<id>/tiles". Each local file lands at ' +
        "remoteRoot/<path-relative-to-localRoot>. Never inside a world's `data/` (LevelDB) dir."
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Overwrite existing files (otherwise an already-present file is skipped).'),
  includeExt: z
    .array(z.string())
    .optional()
    .describe(
      'Only upload files with these extensions (no dot, case-insensitive), e.g. ' +
        '["webp","png","jpg"]. Omit to upload every file.'
    ),
});

const CreateAssetFolderSchema = z.object({
  remotePath: z
    .string()
    .min(1)
    .describe(
      'Folder path relative to the Foundry `Data/` root, e.g. ' +
        '"worlds/your-world/assets/audio/tavern".'
    ),
});

const DeleteAssetSchema = z.object({
  remotePath: z.string().min(1).describe('Path relative to the Foundry `Data/` root to delete.'),
  recursive: z
    .boolean()
    .default(false)
    .describe('Required to delete a directory (and everything under it).'),
  force: z
    .boolean()
    .default(false)
    .describe('Delete even if references exist or the bridge is unavailable to check them.'),
});

const MoveAssetSchema = z.object({
  fromPath: z.string().min(1).describe('Current Data-relative path.'),
  toPath: z.string().min(1).describe('New Data-relative path.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Allow overwriting an existing file at the destination.'),
  relink: z
    .boolean()
    .default(false)
    .describe('After moving, rewrite all references from the old path to the new one.'),
  force: z
    .boolean()
    .default(false)
    .describe('Move even if references exist (without relinking) or the bridge is down.'),
});

const CopyAssetSchema = z.object({
  fromPath: z.string().min(1).describe('Source Data-relative path.'),
  toPath: z.string().min(1).describe('Destination Data-relative path.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe('Allow overwriting an existing file at the destination.'),
});

const AssetUrlSchema = z.object({
  remotePath: z
    .string()
    .min(1)
    .describe(
      'Path relative to the Foundry `Data/` root (a leading "Data/" or "/" is tolerated ' +
        'and stripped), e.g. "worlds/your-world/assets/maps/cavern.webp".'
    ),
});

/**
 * Join a Data-relative remote root with a forward-slash relative path. LITERAL chars (spaces, `#`,
 * `&`, apostrophes) are PRESERVED — a plane encodes each segment exactly once when it needs to, so
 * passing already-encoded text here would double-encode (`%20`→`%2520`). Pure/exported for testing.
 */
export function joinRemote(remoteRoot: string, rel: string): string {
  const root = remoteRoot.replace(/\/+$/, '');
  const cleanRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return cleanRel ? `${root}/${cleanRel}` : root;
}

/** Does a filename's extension match the includeExt filter? (undefined/empty = accept all.) */
export function matchesIncludeExt(name: string, includeExt?: string[]): boolean {
  if (!includeExt || includeExt.length === 0) return true;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return includeExt.some(e => e.toLowerCase().replace(/^\./, '') === ext);
}

export class AssetFileTools {
  private logger: Logger;
  private host: Host;
  private foundry: FoundryBridge;
  private plane: FilePlane;

  constructor(options: AssetFileToolsOptions) {
    this.logger = options.logger;
    this.host = options.host;
    this.foundry = options.foundry;
    this.plane = filePlaneFor(options.host, options.foundry);
  }

  getToolDefinitions() {
    return [
      {
        name: 'list-assets',
        description:
          'Plane B (file channel, read-only). List the immediate contents of a directory under the ' +
          'Foundry `Data/` root through the file plane (folders + files, with size / type / ' +
          'public URL). Use to ' +
          'browse uploaded assets, e.g. `worlds/your-world/assets/audio`. Empty/omitted path lists the ' +
          '`Data/` root.',
        inputSchema: toInputSchema(ListAssetsSchema),
      },
      {
        name: 'asset-info',
        description:
          'Plane B (file channel, read-only). Report whether a single path under the Foundry `Data/` ' +
          'root exists, and (for files) its size, content-type, last-modified, and public HTTPS URL. ' +
          'A cheap existence/metadata check before uploading or linking.',
        inputSchema: toInputSchema(AssetInfoSchema),
      },
      {
        name: 'download-asset',
        description:
          'Plane B (file channel, read-only). Download a file from under the Foundry `Data/` root ' +
          '(through the file plane) to a local path on this machine. For grabbing an existing ' +
          'asset to inspect or re-process.',
        inputSchema: toInputSchema(DownloadAssetSchema),
      },
      {
        name: 'upload-asset',
        description:
          'Plane B (file channel, write). Upload an ASSET (map/token/audio/handout image) from a ' +
          'local file to the Foundry data area through the file plane and return its public URL. ' +
          'Missing parent folders are created automatically. ASSETS ONLY — never world-DB files ' +
          '(LevelDB writes while the server runs corrupt it; such paths are refused). PRIVACY: ' +
          'anything under Data/ is served publicly with no auth — do not upload anything sensitive. ' +
          "Works on every host (Foundry's own FilePicker through the bridge takes media and text " +
          'formats only; a direct plane takes any file).',
        inputSchema: toInputSchema(UploadAssetSchema),
      },
      {
        name: 'upload-asset-tree',
        description:
          'Plane B (file channel, write). Recursively upload a LOCAL directory tree of ASSETS to ' +
          'the Foundry data area through the file plane, preserving the subtree layout (each file → ' +
          'remoteRoot/<rel>), creating parent folders as needed. Use for BULK imports — a scene ' +
          "pack's images, a tiles folder — instead of one upload-asset per file. Skips files that " +
          'already exist unless overwrite:true; optional includeExt filter (e.g. ["webp"]). ASSETS ' +
          'ONLY — refuses live world-DB paths. Reports uploaded/skipped/error counts. PRIVACY: ' +
          'anything under Data/ is served publicly with no auth. A direct plane is the fast path for bulk.',
        inputSchema: toInputSchema(UploadAssetTreeSchema),
      },
      {
        name: 'create-asset-folder',
        description:
          'Plane B (file channel, write). Create a folder (and any missing parents) under the ' +
          'Foundry `Data/` root through the file plane. Idempotent — succeeds if the folder ' +
          'already exists. Refuses paths inside a live world DB.',
        inputSchema: toInputSchema(CreateAssetFolderSchema),
      },
      {
        name: 'delete-asset',
        description:
          'Plane B (file channel, write). Delete a file under the Foundry `Data/` root through the ' +
          'file plane. REFERENCE-AWARE: consults find-asset-references first and REFUSES if any scene/' +
          'actor/journal/playlist still points at it (pass force:true to override). Deleting a directory ' +
          'requires recursive:true. Refuses live world-DB paths. Needs a direct plane (FOUNDRY_DATA_DIR ' +
          'or FOUNDRY_WEBDAV_*): FilePicker cannot delete.',
        inputSchema: toInputSchema(DeleteAssetSchema),
      },
      {
        name: 'move-asset',
        description:
          'Plane B (file channel, write). Move/rename a file under the Foundry `Data/` root through ' +
          'the file plane; missing destination parent folders are created automatically. ' +
          'REFERENCE-AWARE: by default REFUSES with a report if anything references the source ' +
          '(moving would break those pointers). Pass relink:true to move AND rewrite all references ' +
          '(old→new), or force:true to move without relinking. Refuses live world-DB paths. Needs a ' +
          'direct plane (FOUNDRY_DATA_DIR or FOUNDRY_WEBDAV_*): FilePicker cannot move.',
        inputSchema: toInputSchema(MoveAssetSchema),
      },
      {
        name: 'copy-asset',
        description:
          'Plane B (file channel, write). Copy a file under the Foundry `Data/` root through the ' +
          'file plane; missing destination parent folders are created automatically. (Copying does not ' +
          'affect existing references, so no reference check is needed.) Refuses live world-DB ' +
          'destination paths. A directory copy needs a direct plane.',
        inputSchema: toInputSchema(CopyAssetSchema),
      },
      {
        name: 'asset-url',
        description:
          'Plane B (file channel). Return the public URL for a file under the Foundry `Data/` ' +
          'root. Pure mapping (no network): everything under Data/ is served at the server root ' +
          '(DESIGN §6), e.g. Data/worlds/w/maps/x.jpg → <serverUrl>/worlds/w/maps/x.jpg. Useful for ' +
          'turning an uploaded/known asset path into a link Foundry or a player can load.',
        inputSchema: toInputSchema(AssetUrlSchema),
      },
    ];
  }

  // --- handlers -------------------------------------------------------------

  async handleListAssets(args: any): Promise<string> {
    const { remotePath } = ListAssetsSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);
    const plane = this.plane;

    try {
      const children = await plane.list(clean);
      if (children === null) {
        return `Not found: "Data/${clean}" does not exist (or is not a directory).`;
      }
      if (children.length === 0) {
        return `Data/${clean || '(root)'} is empty.`;
      }
      children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const lines = children.map(e => this.formatEntryLine(e));
      const dirs = children.filter(e => e.isDirectory).length;
      const files = children.length - dirs;
      return `Data/${clean || '(root)'} — ${dirs} folder(s), ${files} file(s):\n${lines.join('\n')}`;
    } catch (err) {
      return this.fileError('list-assets', err);
    }
  }

  async handleAssetInfo(args: any): Promise<string> {
    const { remotePath } = AssetInfoSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);
    const plane = this.plane;

    try {
      const entry = await plane.stat(clean);
      if (!entry) return `Does not exist: "Data/${clean}".`;
      if (entry.isDirectory) {
        return `Data/${clean} — FOLDER${entry.lastModified ? ` (modified ${entry.lastModified})` : ''}.`;
      }
      const parts = [
        `Data/${clean} — FILE`,
        entry.size !== undefined ? `size ${humanSize(entry.size)} (${entry.size} B)` : null,
        entry.contentType ? `type ${entry.contentType}` : null,
        entry.lastModified ? `modified ${entry.lastModified}` : null,
        `public URL: ${this.host.publicUrl(clean)}`,
      ].filter(Boolean);
      return parts.join('\n  ');
    } catch (err) {
      return this.fileError('asset-info', err);
    }
  }

  async handleDownloadAsset(args: any): Promise<string> {
    const { remotePath, localPath } = DownloadAssetSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);
    const plane = this.plane;

    try {
      const bytes = await plane.read(clean);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, bytes);
      this.logger.info('download-asset', { remotePath: clean, localPath, bytes: bytes.length });
      return `Downloaded Data/${clean} → "${localPath}" (${humanSize(bytes.length)}, ${bytes.length} B).`;
    } catch (err) {
      return this.fileError('download-asset', err);
    }
  }

  async handleUploadAsset(args: any): Promise<string> {
    const { localPath, remotePath, overwrite } = UploadAssetSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);

    // Guard against the cardinal Plane-B sin: writing into a live world's LevelDB store.
    if (this.looksLikeWorldDbPath(clean)) {
      return this.worldDbRefusal(remotePath);
    }

    const plane = this.plane;

    let bytes: Uint8Array;
    try {
      bytes = await readFile(localPath);
    } catch (err) {
      return `Cannot read local file "${localPath}": ${(err as Error).message}`;
    }

    try {
      if (!overwrite && (await plane.exists(clean))) {
        return (
          `Refused: "Data/${clean}" already exists. Pass overwrite:true to replace it ` +
          '(or choose a different remotePath).'
        );
      }
      await plane.ensureParents(clean);
      await plane.write(clean, bytes, guessContentType(localPath));
      const publicUrl = this.host.publicUrl(clean);
      this.logger.info('upload-asset', { localPath, remotePath: clean, bytes: bytes.length });
      return (
        `Uploaded "${localPath}" (${humanSize(bytes.length)}) → Data/${clean}.\n` +
        `  Data-relative path: ${clean}\n` +
        `  Public URL: ${publicUrl}\n` +
        '  NOTE: this URL is publicly accessible with no auth — do not upload anything sensitive.'
      );
    } catch (err) {
      return this.fileError('upload-asset', err);
    }
  }

  async handleUploadAssetTree(args: any): Promise<string> {
    const { localRoot, remoteRoot, overwrite, includeExt } = UploadAssetTreeSchema.parse(
      args ?? {}
    );
    const root = toDataRelative(remoteRoot);

    // The root guard covers the whole subtree (every leaf is remoteRoot/<rel>, no `..`).
    if (this.looksLikeWorldDbPath(root)) return this.worldDbRefusal(remoteRoot);

    const plane = this.plane;

    // Enumerate local files (recursive). A missing/non-directory localRoot is a clear up-front error.
    let files: string[];
    try {
      const entries = await readdir(localRoot, { recursive: true, withFileTypes: true });
      files = entries
        .filter(e => e.isFile() && matchesIncludeExt(e.name, includeExt))
        // Dirent.parentPath (Node 20.12+); fall back to the deprecated .path for safety.
        .map(e => join((e as any).parentPath ?? (e as any).path, e.name));
    } catch (err) {
      return `Cannot read local directory "${localRoot}": ${(err as Error).message}`;
    }

    if (files.length === 0) {
      const filt = includeExt?.length ? ` matching {${includeExt.join(', ')}}` : '';
      return `No files${filt} found under "${localRoot}".`;
    }

    let uploaded = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const localPath of files) {
      // rel is always a forward descent under localRoot — pass LITERAL chars; the plane encodes once.
      const rel = relative(localRoot, localPath)
        .split(/[/\\]+/)
        .join('/');
      const remote = joinRemote(root, rel);
      try {
        if (!overwrite && (await plane.exists(remote))) {
          skipped++;
          continue;
        }
        const bytes = await readFile(localPath);
        await plane.ensureParents(remote);
        await plane.write(remote, bytes, guessContentType(localPath));
        uploaded++;
      } catch (err) {
        errors.push(`${rel}: ${(err as Error).message}`);
      }
    }

    this.logger.info('upload-asset-tree', {
      localRoot,
      remoteRoot: root,
      uploaded,
      skipped,
      errors: errors.length,
    });
    const lines = [
      `Uploaded ${uploaded} file(s) → Data/${root} (${skipped} skipped, ${errors.length} error(s)).`,
      `  Public root: ${this.host.publicUrl(root)}`,
      '  NOTE: anything under Data/ is publicly accessible with no auth — do not upload anything sensitive.',
    ];
    for (const e of errors.slice(0, 20)) lines.push(`  ⚠ ${e}`);
    if (errors.length > 20) lines.push(`  …and ${errors.length - 20} more error(s)`);
    return lines.join('\n');
  }

  async handleCreateAssetFolder(args: any): Promise<string> {
    const { remotePath } = CreateAssetFolderSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);

    if (this.looksLikeWorldDbPath(clean)) {
      return this.worldDbRefusal(remotePath);
    }

    const plane = this.plane;

    try {
      const existing = await plane.stat(clean);
      if (existing) {
        if (existing.isDirectory) return `Already exists: folder Data/${clean}.`;
        return `Refused: "Data/${clean}" already exists as a FILE, not a folder.`;
      }
      await plane.ensureParents(clean); // create any missing parents above the target
      await plane.mkdir(clean); // then the target folder itself
      this.logger.info('create-asset-folder', { remotePath: clean });
      return `Created folder Data/${clean}.`;
    } catch (err) {
      return this.fileError('create-asset-folder', err);
    }
  }

  async handleDeleteAsset(args: any): Promise<string> {
    const { remotePath, recursive, force } = DeleteAssetSchema.parse(args ?? {});
    const clean = toDataRelative(remotePath);

    if (this.looksLikeWorldDbPath(clean)) return this.worldDbRefusal(remotePath);
    const plane = this.plane;

    try {
      const entry = await plane.stat(clean);
      if (!entry) return `Nothing to delete: "Data/${clean}" does not exist.`;

      if (entry.isDirectory && !recursive) {
        return (
          `Refused: "Data/${clean}" is a directory. Pass recursive:true to delete it and everything ` +
          'inside (deliberately not the default).'
        );
      }

      if (!force) {
        if (entry.isDirectory) {
          return (
            `Refused: directory deletes can't be reference-checked per-file. Re-run with force:true ` +
            'if you are sure nothing in it is still used by a scene/actor/journal/playlist.'
          );
        }
        const { refs, checked } = await this.findReferences(clean);
        if (!checked) {
          return (
            `Refused: couldn't verify references for "Data/${clean}" (the Foundry bridge isn't ` +
            'connected). Open the world, or pass force:true to delete without checking.'
          );
        }
        if (refs.length > 0) {
          return `Refused: "Data/${clean}" is still referenced by ${refs.length} document(s):\n${this.formatRefs(
            refs
          )}\nRelink or remove those first, or pass force:true to delete anyway.`;
        }
      }

      await plane.remove(clean, entry.isDirectory);
      this.logger.info('delete-asset', { remotePath: clean, recursive, force });
      return `Deleted Data/${clean}${entry.isDirectory ? ' (directory)' : ''}.`;
    } catch (err) {
      return this.fileError('delete-asset', err);
    }
  }

  async handleMoveAsset(args: any): Promise<string> {
    const { fromPath, toPath, overwrite, relink, force } = MoveAssetSchema.parse(args ?? {});
    const cleanFrom = toDataRelative(fromPath);
    const cleanTo = toDataRelative(toPath);

    if (this.looksLikeWorldDbPath(cleanFrom)) return this.worldDbRefusal(fromPath);
    if (this.looksLikeWorldDbPath(cleanTo)) return this.worldDbRefusal(toPath);
    const plane = this.plane;

    try {
      const entry = await plane.stat(cleanFrom);
      if (!entry) return `Nothing to move: "Data/${cleanFrom}" does not exist.`;
      if (!overwrite && (await plane.exists(cleanTo))) {
        return `Refused: "Data/${cleanTo}" already exists. Pass overwrite:true to replace it.`;
      }

      let refs: any[] = [];
      if (entry.isDirectory) {
        if (!force) {
          return (
            `Refused: directory moves can't be reference-checked per-file. Re-run with force:true ` +
            '(then relink any affected references manually).'
          );
        }
      } else {
        const check = await this.findReferences(cleanFrom);
        refs = check.refs;
        if (!force && !relink) {
          if (!check.checked) {
            return (
              `Refused: couldn't verify references for "Data/${cleanFrom}" (bridge not connected). ` +
              'Pass relink:true (to move + rewrite once the world is open) or force:true (move only).'
            );
          }
          if (refs.length > 0) {
            return (
              `Refused: "Data/${cleanFrom}" is referenced by ${refs.length} document(s) — moving ` +
              `would break them:\n${this.formatRefs(refs)}\n` +
              'Re-run with relink:true to move AND fix the references, or force:true to move anyway.'
            );
          }
        }
      }

      // A plane's move does not create missing directories (Apache answers 500, not 409), so build the
      // destination's parents first — same contract as upload-asset.
      await plane.ensureParents(cleanTo);
      await plane.move(cleanFrom, cleanTo, overwrite, entry.isDirectory);
      this.logger.info('move-asset', { fromPath: cleanFrom, toPath: cleanTo, relink, force });

      let relinkNote = '';
      if (relink && !entry.isDirectory) {
        try {
          const r = await this.foundry.call('relinkAsset', {
            oldPath: cleanFrom,
            newPath: cleanTo,
          });
          relinkNote = `\nRelinked ${r?.changedCount ?? 0} reference(s).`;
        } catch (err) {
          relinkNote = `\nWARNING: move succeeded but relink failed (${(err as Error).message}). References may be broken — run relink-asset manually.`;
        }
      }
      return `Moved Data/${cleanFrom} → Data/${cleanTo}.${relinkNote}`;
    } catch (err) {
      return this.fileError('move-asset', err);
    }
  }

  async handleCopyAsset(args: any): Promise<string> {
    const { fromPath, toPath, overwrite } = CopyAssetSchema.parse(args ?? {});
    const cleanFrom = toDataRelative(fromPath);
    const cleanTo = toDataRelative(toPath);

    // Guard BOTH ends: a live world's LevelDB must not be read or written over the file channel.
    if (this.looksLikeWorldDbPath(cleanFrom)) return this.worldDbRefusal(fromPath);
    if (this.looksLikeWorldDbPath(cleanTo)) return this.worldDbRefusal(toPath);
    const plane = this.plane;

    try {
      const entry = await plane.stat(cleanFrom);
      if (!entry) return `Nothing to copy: "Data/${cleanFrom}" does not exist.`;
      if (!overwrite && (await plane.exists(cleanTo))) {
        return `Refused: "Data/${cleanTo}" already exists. Pass overwrite:true to replace it.`;
      }
      // copy has the same missing-directory failure mode as move — create parents first.
      await plane.ensureParents(cleanTo);
      await plane.copy(cleanFrom, cleanTo, overwrite, entry.isDirectory);
      this.logger.info('copy-asset', { fromPath: cleanFrom, toPath: cleanTo });
      return `Copied Data/${cleanFrom} → Data/${cleanTo}.`;
    } catch (err) {
      return this.fileError('copy-asset', err);
    }
  }

  /** Fully implemented — pure mapping, no network. */
  async handleAssetUrl(args: any): Promise<string> {
    const { remotePath } = AssetUrlSchema.parse(args ?? {});
    return this.host.publicUrl(toDataRelative(remotePath));
  }

  // --- helpers --------------------------------------------------------------

  private worldDbRefusal(remotePath: string): string {
    return refuseWorldDb(remotePath);
  }

  private fileError(tool: string, err: unknown): string {
    return fileErrorMessage(tool, err, this.logger);
  }

  /** Ask the bridge what references an asset path. `checked:false` = bridge unavailable. */
  private async findReferences(dataRelPath: string): Promise<{ refs: any[]; checked: boolean }> {
    try {
      const result = await this.foundry.call('findAssetReferences', {
        paths: [dataRelPath],
      });
      return { refs: result?.references?.[dataRelPath] ?? [], checked: true };
    } catch (err) {
      this.logger.warn('reference check failed (bridge down?)', { error: (err as Error).message });
      return { refs: [], checked: false };
    }
  }

  private formatRefs(refs: any[]): string {
    return refs
      .map(r => `    - ${r.documentType} "${r.documentName}" (${r.documentId}) :: ${r.field}`)
      .join('\n');
  }

  private formatEntryLine(e: FileEntry): string {
    if (e.isDirectory) return `  [DIR ] ${e.name}/`;
    const meta = [humanSize(e.size), e.contentType].filter(Boolean).join(', ');
    return `  [FILE] ${e.name}${meta ? `  (${meta})` : ''}  → ${this.host.publicUrl(e.path)}`;
  }

  /** Heuristic: is this path inside a world's live LevelDB store (`worlds/<w>/data/...`)? */
  private looksLikeWorldDbPath(dataRelativePath: string): boolean {
    return isWorldDbPath(dataRelativePath);
  }
}
