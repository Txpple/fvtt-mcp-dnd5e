// siblings-contract-probe.mjs — OFFLINE: what a sibling would import after the path fix, and what the
// hosts seam already gives them (no connect, fake env).
import { Foundry } from '../dist/foundry.js';
import { bridgeConfigOf, createHost, hostKindFromEnv, resolveHostConfig } from '../dist/hosts/index.js';
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
const env = { LOCAL_SERVER_URL: 'http://localhost:30000', LOCAL_ADMIN_KEY: 'k', MOLTEN_WORLD_ID: 'w', FOUNDRY_USER: 'DM Assistant', BF_SUITE_USER: 'Tester Assistant' };
const kind = hostKindFromEnv({ FOUNDRY_HOST: 'local' });
const hostCfg = resolveHostConfig(env, kind);
const cfg = { ...bridgeConfigOf(hostCfg), host: createHost(hostCfg, quiet) };
// what battleflow/fxstudio do by hand today: override the join identity to the suite user
const suiteCfg = { ...cfg, user: env.BF_SUITE_USER, password: '' };
const f = new Foundry(suiteCfg, quiet);
console.log(JSON.stringify({
  kind, serverUrl: cfg.serverUrl, worldId: cfg.worldId, adminKey: cfg.adminKey ? 'set' : 'unset',
  bridgeUser: cfg.user, suiteUser: suiteCfg.user, hostLabel: cfg.host.label, hasWake: typeof cfg.host.wake === 'function',
  filePlane: cfg.host.files ? cfg.host.files.label : null,
  foundryPublic: Object.getOwnPropertyNames(Object.getPrototypeOf(f)).filter(n => !n.startsWith('_') && n !== 'constructor'),
  hasDisconnect: typeof f.disconnect,
  pageIsTsPrivateOnly: 'page' in f,
}, null, 1));
await f.dispose(); // idempotent while disconnected
