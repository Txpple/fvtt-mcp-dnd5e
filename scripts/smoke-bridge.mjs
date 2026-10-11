// The bridge smoke for an upgrade review: join the selected Foundry as the MCP's own user, read the
// world's versions, leave. The one live check that catches a /join reshape (Foundry 14.367, 14.369)
// the moment a host runs the new build. Read-only: nothing is written to the world.
//
//   npm run build && FOUNDRY_HOST=local npm run smoke:bridge
//
// stdout is one line meant to be pasted into the review issue's fvtt-mcp-dnd5e row: the versions,
// the join time, Chromium's renderer and the Open Roll 5e modules the skills lean on. It names the
// host kind, never its URL or world, so it is safe in a public issue. Exit 0 on PASS, 1 on FAIL.
import { readFileSync } from 'node:fs';
import { connectFoundry, hostKindFromEnv, targetLabel } from '../dist/client.js';
import { bridgeLine } from '../dist/utils/bridge-facts.js';

const kind = hostKindFromEnv(process.env);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const date = new Date().toISOString().slice(0, 10);
const head = `bridge smoke ${date}, ${targetLabel(kind)}, fvtt-mcp-dnd5e ${version}`;

const started = Date.now();
let conn;
let ok = false;
try {
  conn = await connectFoundry({
    host: kind,
    identity: 'bridge',
    tag: 'smoke',
    watchdogMs: 600_000,
    announce: false,
  });
  const joined = ((Date.now() - started) / 1000).toFixed(1);
  const info = await conn.f.call('getWorldInfo');
  ok = Boolean(info?.foundryVersion);
  console.log(
    `${head}: ${ok ? 'PASS' : 'FAIL'}. Foundry ${info?.foundryVersion ?? '?'}, ${info?.system ?? '?'} ${info?.systemVersion ?? '?'}; joined in ${joined} s; ${bridgeLine(info?.bridge).text}.`
  );
} catch (e) {
  console.log(`${head}: FAIL. ${String(e?.message || e).split('\n')[0]}`);
} finally {
  await conn?.dispose();
  process.exit(ok ? 0 : 1);
}
