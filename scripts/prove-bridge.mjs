// Phase-1 proof: exercise the real foundry.ts seam end to end.
//   foundry.connect() -> foundry.call('getWorldInfo') / call('listActors') against live Molten.
// Requires a build first: `npm run build` (tsc) + `node esbuild.page.mjs`.
// Run: node scripts/prove-bridge.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();
const f = new Foundry(bridgeConfig(env));

let ok = false;
try {
  await f.connect();
  const info = await f.call('getWorldInfo');
  console.log('[prove] getWorldInfo:', JSON.stringify(info, null, 2));
  const actors = await f.call('listActors', {});
  console.log(`[prove] listActors: ${actors.length} -> ${actors.map(a => a.name).join(', ')}`);
  ok = Boolean(info?.id) && Array.isArray(actors);
} catch (e) {
  console.error('[prove] ERROR:', e?.message || e);
} finally {
  await f.dispose();
  console.log(ok ? '[prove] RESULT: PASS' : '[prove] RESULT: FAIL');
  process.exit(ok ? 0 : 1);
}
