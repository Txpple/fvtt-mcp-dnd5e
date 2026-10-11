// Live verify for get-world-info's `bridge` block (issue #9), through the registry's own dispatch,
// as the MCP server routes a call: the block names the renderer (GPU or software, with the page's
// unmasked WebGL name), the canvas is ready, each Open Roll 5e module reads as its version when the
// page finds it active and `not active` otherwise, the seat's `since` is an ISO date, the version is
// package.json's, the toolsets are `all`, the join user is `bridgeUser`'s alone (the block does not
// echo it), and the warnings are exactly the true ones; a second
// registry over the same bridge, built read-only, warns that the joined user can write (the
// sandbox's bridge user is an Assistant GM).
//   npm run build && FOUNDRY_HOST=local node scripts/verify-bridge-status.mjs
// Read-only: get-world-info only reads, and no world document is touched. One bridge, left in
// finally.
import { readFileSync } from 'node:fs';
import { connectFoundry, quietLogger } from '../dist/client.js';
import { buildToolRegistry } from '../dist/registry.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const MODULES = { battleflow: 'Battle Flow', areasounds: 'Area Sounds', openserver: 'Open Server' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};

let conn = null;
try {
  conn = await connectFoundry({
    identity: 'bridge',
    tag: 'verify-bridge-status',
    watchdogMs: 300_000,
  });
  const { f, host, hostConfig } = conn;
  const registry = (deps = {}) =>
    buildToolRegistry({
      foundry: f,
      logger: quietLogger(),
      host,
      serverUrl: hostConfig.serverUrl,
      serverVersion: version,
      ...deps,
    });

  // 1. The block, as a full registration's get-world-info answers it.
  const world = await registry().dispatch('get-world-info', {});
  const b = world?.bridge;
  console.log(`      | bridge: ${JSON.stringify(b)}`);
  // The page's own facts, read straight off the seam, to hold the block against.
  const page = (await f.call('getWorldInfo')).bridge;

  check('get-world-info carries a bridge block', !!b && typeof b === 'object');
  const r = /^(GPU|software): (.+)$/.exec(b?.renderer ?? '');
  check(
    "it names the renderer: GPU or software, with the page's non-empty WebGL name",
    !!r && r[2].trim().length > 0 && r[2] === page?.renderer?.name,
    b?.renderer
  );
  check('the canvas is ready', b?.canvasReady === true);
  for (const [key, name] of Object.entries(MODULES)) {
    const fact = page?.modules?.[key];
    const want = fact?.active ? fact.version : 'not active';
    check(
      `${name}: its version when active, else "not active"`,
      b?.modules?.[key] === want && (want === 'not active' || /^\d+\.\d+/.test(want ?? '')),
      `${b?.modules?.[key]} (page: active ${fact?.active}, version ${fact?.version})`
    );
  }
  check(
    'since: an ISO date',
    typeof b?.since === 'string' && ISO.test(b.since) && !Number.isNaN(Date.parse(b.since)),
    b?.since
  );
  check(`version: package.json's ${version}`, b?.version === version, b?.version);
  check('toolsets: all', b?.toolsets === 'all', b?.toolsets);
  check(
    'the join user is bridgeUser alone, as joined: the block does not echo it',
    !Object.hasOwn(b ?? {}, 'user') && world?.bridgeUser?.name === hostConfig.user,
    `bridgeUser ${world?.bridgeUser?.name}; block keys ${Object.keys(b ?? {}).join(', ')}`
  );
  check('woken: false (the sandbox world was up)', b?.woken === false, String(b?.woken));
  const inactive = Object.keys(MODULES).filter(k => !page?.modules?.[k]?.active);
  const software = r?.[1] === 'software';
  const warnings = b?.warnings ?? [];
  check(
    'warnings: exactly the true ones (a software renderer, an inactive module), or none at all',
    warnings.length === inactive.length + (software ? 1 : 0) &&
      inactive.every(k => warnings.some(w => w.startsWith(`${MODULES[k]} is not active`))) &&
      (!software || warnings.some(w => w.startsWith('Chromium renders in software'))) &&
      (warnings.length > 0 || !Object.hasOwn(b ?? {}, 'warnings')),
    warnings.join(' | ') || 'none'
  );

  // 2. The same bridge under a read-only registration: the joined user can write.
  const ro = (await registry({ toolsets: ['readonly'] }).dispatch('get-world-info', {}))?.bridge;
  const roWarning = (ro?.warnings ?? []).find(w => w.startsWith('read-only registration joined'));
  check(
    'a read-only registration reports itself and warns that its Assistant GM can write',
    ro?.toolsets === 'readonly' &&
      world?.bridgeUser?.role === 'ASSISTANT' &&
      /^read-only registration joined as Assistant GM: the role is the boundary/.test(
        roWarning ?? ''
      ),
    roWarning ?? `role ${world?.bridgeUser?.role}`
  );
} catch (e) {
  check('the run completes', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  await conn?.dispose();
}
const passed = checks.filter(c => c.ok).length;
console.log(`\n[verify-bridge-status] ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
