// `npm run init` (issue #7): one Foundry instance from a built clone to a checked registration. It
// says first that the Foundry user the bridge joins as must exist, asks for the connection (or
// takes it as flags), writes the .env and the MCP registration, runs the doctor on them, and prints
// the registration as an mcpServers block for any other MCP client.
//
//   npm run init                                    # asks
//   npm run init -- --help                          # every flag
//   npm run init -- --yes --host local --admin-key <pw> --target user
//
// Node and dist/ are checked here (nothing else loads without a build); the rest, the questions
// on the terminal included, is src/init.ts. It writes the .env (an existing one copied to .bak
// first) and the registration file (~/.claude.json copied to .bak-<time> first), never a secret
// into the registration. The doctor it ends with is `npm run doctor`: read-only, it never launches
// or stops a world.
import { foundryApp } from './lib/foundry-app.mjs';
import { preflight } from './lib/preflight.mjs';

const MARK = { ok: '✓', fail: '✗', warn: '!', skip: '-' };
const say = (mark, text) => console.log(`${MARK[mark]} ${text}`);

const { pkg, lines, fatal } = preflight([
  'index.js',
  'client.js',
  'doctor.js',
  'init.js',
  'page.bundle.js',
]);
console.log(`fvtt-mcp-dnd5e ${pkg.version} init`);
if (fatal || lines.some(line => line.mark === 'fail')) {
  for (const line of lines) say(line.mark, line.text);
  process.exit(1);
}
let init;
try {
  init = await import('../dist/init.js');
} catch (err) {
  say(
    'fail',
    `dependencies: dist/init.js does not load (${String(err?.message ?? err).split('\n')[0]}) — run \`npm ci\`, then \`npm run build\``
  );
  process.exit(1);
}

const terminal = init.terminalAsker(process.stdin, process.stdout);
try {
  process.exitCode = await init.runInit(process.argv.slice(2), {
    print: text => console.log(text),
    say,
    foundryApp,
    ask: terminal.ask,
    hidesSecrets: terminal.hidesSecrets,
    preflight: lines,
  });
} finally {
  terminal.close();
}
// exitCode, not exit(): a hard exit with live fetch sockets trips a libuv assertion on Windows.
