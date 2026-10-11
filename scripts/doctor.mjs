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
import { preflight } from './lib/preflight.mjs';

const MARK = { ok: '✓', fail: '✗', warn: '!', skip: '-' };
let failed = 0;
function say(mark, text) {
  if (mark === 'fail') failed++;
  console.log(`${MARK[mark]} ${text}`);
}

// --- Node, and dist/ built and not older than src/ (scripts/lib/preflight.mjs) ----------------
const { pkg, lines, fatal } = preflight(['index.js', 'client.js', 'doctor.js', 'page.bundle.js']);
console.log(`fvtt-mcp-dnd5e ${pkg.version} doctor`);
for (const line of lines) say(line.mark, line.text);
if (fatal) process.exit(1);

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
