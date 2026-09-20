// Live acceptance: prove the bridge auto-recovers a COLD box end to end.
//   Phase 1: take the world DOWN to create the cold "no world" state — POST /setup
//            {action:"worldShutdown", adminPassword} (Foundry 14.368's own route, the one
//            scripts/local-foundry.mjs uses; an admin key gates it, so a GM's bare
//            game.shutDown() is refused when one is set — it is the fallback without a key).
//   Phase 2: a fresh bridge.connect() must, with NO human steps, wake the box -> detect
//            'no world active' -> launch the world via admin /setup (game.post) -> join ->
//            game.ready, then round-trip getWorldInfo.
// DESTRUCTIVE: phase 1 shuts the world down. It therefore refuses to run without an explicit
// host — `FOUNDRY_HOST=local node scripts/verify-wake.mjs` (the sandbox: no wake, straight to
// /join, then the /setup relaunch) or `FOUNDRY_HOST=molten …` (prod: the Magic-URL wake first).
// Needs the host's admin key (LOCAL_ADMIN_KEY / MOLTEN_ADMIN_KEY) — or a GM bridge user as fallback.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const txt = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
// No implicit target for a script that takes the world down: the selector's default is prod.
if (!process.env.FOUNDRY_HOST && !process.env.FOUNDRY_PROFILE) {
  console.error(
    'verify-wake shuts the world down — name the target explicitly: FOUNDRY_HOST=local (sandbox) or FOUNDRY_HOST=molten (prod).'
  );
  process.exit(2);
}
const cfg = bridgeConfig(env);
const base = cfg.serverUrl.replace(/\/$/, '');
const stamp = () => new Date().toISOString().slice(11, 19);
const log = {
  debug: m => console.log(`    ${stamp()} [foundry] ${m}`),
  info: m => console.log(`    ${stamp()} [foundry] ${m}`),
  warn: m => console.log(`    ${stamp()} [foundry] WARN: ${m}`),
  error: m => console.log(`    ${stamp()} [foundry] ERR: ${m}`),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function isDown() {
  try {
    const t = await (await fetch(`${base}/join`, { redirect: 'follow' })).text();
    return /no active game session/i.test(t);
  } catch {
    return false;
  }
}

// ---- Phase 1: take the world down ---------------------------------------------------------
console.log('PHASE 1 — take the running world down to create the cold state');
const shutter = new Foundry(cfg, log);
await shutter.connect();
const probe = await shutter.evaluate(() => {
  const g = globalThis.game;
  const has = n => typeof g?.[n] === 'function';
  return { isGM: g?.user?.isGM ?? false, shutDown: has('shutDown'), logOut: has('logOut') };
}, null);
console.log(
  '  bridge user:',
  cfg.user,
  '| isGM:',
  probe.isGM,
  '| has game.shutDown:',
  probe.shutDown
);
if (!probe.isGM || !probe.shutDown) {
  console.log(
    '  ABORT (safe): need a GM with game.shutDown(). Click "Return to Setup" manually, then re-run.'
  );
  await shutter.dispose();
  process.exit(2);
}
await shutter.dispose();
if (cfg.adminKey) {
  console.log(
    '  POST /setup {action:"worldShutdown"} with the admin key (returns the world to setup) ...'
  );
  const res = await fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin },
    body: JSON.stringify({ action: 'worldShutdown', adminPassword: cfg.adminKey }),
    redirect: 'manual',
  });
  // 302 → /setup is success; a JSON body is a refusal.
  console.log(
    `  -> HTTP ${res.status} ${res.headers.get('location') ?? (await res.text()).slice(0, 120)}`
  );
} else {
  console.log(
    '  no admin key — firing game.shutDown() as the GM (refused by v14 when a key is set) ...'
  );
  const gm = new Foundry(cfg, log);
  await gm.connect();
  await gm.evaluate(() => globalThis.game.shutDown(), null).catch(() => {});
  await gm.dispose();
}

let down = false;
for (let i = 0; i < 36 && !down; i++) {
  await sleep(5000);
  if (await isDown()) {
    down = true;
    console.log(`  world is DOWN ("no active game session") after ~${(i + 1) * 5}s`);
  }
}
if (!down) {
  console.log('  ABORT (safe): world did not reach the "no world" state within ~3 min.');
  process.exit(3);
}

// ---- Phase 2: cold bring-up entirely via the bridge ---------------------------------------
console.log('\nPHASE 2 — COLD bring-up via the bridge (wake -> detect no-world -> launch -> join)');
const t0 = Date.now();
const bridge = new Foundry(cfg, log);
await bridge.connect();
const info = await bridge.call('getWorldInfo');
const players = await bridge.call('getConnectedPlayers').catch(() => null);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n✅ COLD BRING-UP OK in ${secs}s`);
console.log(`   world="${info?.title ?? info?.worldId}"  system="${info?.system ?? '?'}"`);
console.log(
  `   connected as "${cfg.user}"; getConnectedPlayers -> ${JSON.stringify(players)?.slice(0, 120)}`
);
await bridge.dispose();
process.exit(0);
