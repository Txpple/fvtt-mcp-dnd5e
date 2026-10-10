// The setup doctor: every check a fresh install trips on, in order, one actionable line each
// (✓ fine, ✗ broken, ! worth a look, - skipped). Exit 1 on any ✗. Issue #3.
//
//   npm run doctor                                  # the .env as the server reads it
//   FOUNDRY_HOST=local npm run doctor               # pick the host as a registration does
//   FVTT_MCP_ENV=.env.<box> FOUNDRY_HOST=molten npm run doctor
//
// Node and dist/ are checked here (nothing else loads without a build); the rest is
// src/doctor.ts. Read-only, and safe against prod: it never launches or stops a world; it joins
// once as the bridge user, like any tool call, and disconnects. A sleeping box is not woken; the
// doctor reports it unreachable.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const MARK = { ok: '✓', fail: '✗', warn: '!', skip: '-' };
let failed = 0;
function say(mark, text) {
  if (mark === 'fail') failed++;
  console.log(`${MARK[mark]} ${text}`);
}

console.log(`fvtt-mcp-dnd5e ${pkg.version} doctor`);

// --- Node: package.json's engines (the ">=X.Y.Z" form it uses) -------------------------------
const range = pkg.engines?.node ?? '';
const min = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
const have = process.versions.node.split('.').map(Number);
const need = min ? min.slice(1).map(Number) : [0, 0, 0];
const tooOld = (have[0] - need[0] || have[1] - need[1] || have[2] - need[2]) < 0;
if (tooOld) say('fail', `Node ${process.versions.node}: needs ${range} — install a newer Node.js`);
else say('ok', `Node ${process.versions.node} (needs ${range || 'any'})`);

// --- dist/: built, and not older than src/ ----------------------------------------------------
const built = ['index.js', 'client.js', 'doctor.js', 'page.bundle.js'].map(f =>
  join(root, 'dist', f)
);
const missing = built.filter(p => !existsSync(p));
if (missing.length) {
  say(
    'fail',
    `build: dist/ is missing ${missing.map(p => p.slice(root.length)).join(', ')} — run \`npm run build\``
  );
  process.exit(1);
}
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
const builtAt = Math.min(...built.map(p => statSync(p).mtimeMs));
if (newest(join(root, 'src')) > builtAt)
  say('warn', 'build: src/ changed after the last build — run `npm run build`');
else say('ok', 'build: dist/ is built');

// --- everything else ----------------------------------------------------------------------------
let runDoctor;
try {
  ({ runDoctor } = await import('../dist/doctor.js'));
} catch (err) {
  say(
    'fail',
    `dependencies: dist/doctor.js does not load (${String(err?.message ?? err).split('\n')[0]}) — run \`npm ci\`, then \`npm run build\``
  );
  process.exit(1);
}
const { foundryApp } = await import('./lib/foundry-app.mjs');
await runDoctor({ say, foundryApp });

console.log(
  failed
    ? `${failed} problem${failed === 1 ? '' : 's'} — fix the ✗ lines above`
    : 'all checks passed'
);
// exitCode, not exit(): a hard exit with live fetch sockets trips a libuv assertion on Windows.
process.exitCode = failed ? 1 : 0;
