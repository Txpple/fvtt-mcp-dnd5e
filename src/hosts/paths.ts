// Foundry `Data/` path rules — host-neutral. These are facts about Foundry, not about any file
// plane: the Data-relative vocabulary, the live world-DB guard, the public-URL mapping.

import { FilePlaneError } from './types.js';

/**
 * Canonicalize a path to the Data-relative form this codebase speaks: forward slashes, no leading
 * slash, no `Data/` prefix, no trailing slash, and — crucially — collapse `.`/empty segments and
 * REJECT any `..` segment. Rejecting traversal here is a security boundary, not just tidiness: every
 * plane builds its target (a WebDAV URL, a filesystem path) from this output and the world-DB write
 * guard (looksLikeWorldDbPath) runs on it, so an un-canonicalized `assets/../worlds/<w>/data/x`
 * would otherwise slip past the guard and resolve straight into the live LevelDB. No legitimate
 * asset path needs `..`, so we throw rather than silently resolve it.
 */
export function toDataRelative(p: string): string {
  const stripped = p
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^Data\//i, '')
    .replace(/^\/+/, '');
  const segments: string[] = [];
  for (const seg of stripped.split('/')) {
    if (seg === '' || seg === '.') continue; // collapse `//` and `.` segments
    if (seg === '..') {
      throw new FilePlaneError(`Refused: path traversal ("..") is not allowed in "${p}".`, 400);
    }
    segments.push(seg);
  }
  return segments.join('/');
}

/**
 * Heuristic: is this Data-relative path inside a world's live LevelDB store (`worlds/<w>/data/...`)?
 * Matches the `data` dir itself and anything under it. Paths must be canonicalized by toDataRelative
 * (rejects `..`) before this runs, so traversal can't evade the guard.
 */
export function looksLikeWorldDbPath(dataRelativePath: string): boolean {
  return /^worlds\/[^/]+\/data(\/|$)/i.test(dataRelativePath);
}

/**
 * Refusal for any path inside a world's live LevelDB store. The same on every plane: a running
 * Foundry holds the store open, and a write behind its back — over WebDAV or straight onto the
 * disk — corrupts it permanently.
 */
export function worldDbRefusal(remotePath: string): string {
  return (
    `Refused: "${remotePath}" points inside a world's live LevelDB (\`.../data/\`). Writing there ` +
    'while the server runs corrupts the database. File tools are for assets only; mass DB changes ' +
    'are a separate offline job (stop → Create Backup → fvtt unpack → edit → pack → start).'
  );
}

/** Public URL for a path relative to `Data/` — Foundry serves `Data/` at the server root. */
export function buildPublicUrl(serverUrl: string, dataRelativePath: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${dataRelativePath}`;
}

/** Best-effort Content-Type from a file extension (asset-oriented). */
export function guessContentType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    webm: 'video/webm',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    pdf: 'application/pdf',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Human-readable byte size. */
export function humanSize(n?: number): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
