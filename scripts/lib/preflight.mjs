// The checks that come before anything in dist/ can load, for the scripts that hand over to it
// (doctor.mjs, init.mjs): Node against package.json's engines (the ">=X.Y.Z" form it uses), and
// dist/ built and not older than src/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newest(p));
    else if (e.name.endsWith('.ts') && !e.name.includes('.test.'))
      t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}

/**
 * `{ pkg, lines, fatal }`: package.json, a `{ mark, text }` line for Node and one for the build
 * (✓ ok, ✗ fail, ! warn), and `fatal` when dist/ lacks one of `files`: then nothing can load.
 */
export function preflight(files) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lines = [];

  const range = pkg.engines?.node ?? '';
  const min = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const have = process.versions.node.split('.').map(Number);
  const need = min ? min.slice(1).map(Number) : [0, 0, 0];
  const tooOld = (have[0] - need[0] || have[1] - need[1] || have[2] - need[2]) < 0;
  lines.push(
    tooOld
      ? {
          mark: 'fail',
          text: `Node ${process.versions.node}: needs ${range} — install a newer Node.js`,
        }
      : { mark: 'ok', text: `Node ${process.versions.node} (needs ${range || 'any'})` }
  );

  const built = files.map(f => join(root, 'dist', f));
  const missing = built.filter(p => !existsSync(p));
  if (missing.length) {
    lines.push({
      mark: 'fail',
      text: `build: dist/ is missing ${missing.map(p => p.slice(root.length)).join(', ')} — run \`npm run build\``,
    });
    return { pkg, lines, fatal: true };
  }
  const builtAt = Math.min(...built.map(p => statSync(p).mtimeMs));
  lines.push(
    newest(join(root, 'src')) > builtAt
      ? { mark: 'warn', text: 'build: src/ changed after the last build — run `npm run build`' }
      : { mark: 'ok', text: 'build: dist/ is built' }
  );
  return { pkg, lines, fatal: false };
}
