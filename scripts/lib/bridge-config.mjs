// Host-aware bridge config for the verify / spike / probe scripts — the SAME selector src/config.ts
// applies to the MCP server itself (src/hosts/env.ts), so a script can be pointed at the LOCAL
// sandbox with `FOUNDRY_HOST=local node scripts/<script>.mjs` (the pre-2.2 `FOUNDRY_PROFILE=local`
// still works) and at prod (the default, `molten`) otherwise.
//
//   local   : LOCAL_SERVER_URL (default http://localhost:30000), no wake (a local box does not
//             sleep), LOCAL_FOUNDRY_USER / LOCAL_FOUNDRY_PASSWORD / LOCAL_WORLD_ID / LOCAL_ADMIN_KEY,
//             each falling back to the MOLTEN_* value (a sandbox is a byte copy — same world id,
//             same users); LOCAL_FOUNDRY_DATA is the file plane.
//   molten  : the MOLTEN_* set, exactly as every script wrote it by hand before.
//   generic : FOUNDRY_URL and the FOUNDRY_* set — a URL and nothing else.
//
// `env` is the script's own parsed .env (loadEnv()); process.env.FOUNDRY_HOST picks the host. The
// returned object is what `new Foundry(cfg)` takes, with the Host attached (`cfg.host`) so the
// bridge can wake a sleeping instance and a script can reach the file plane (`cfg.host.files`).

import {
  bridgeConfigOf,
  createHost,
  hostKindFromEnv,
  resolveHostConfig,
} from '../../dist/hosts/index.js';

const quietLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

/** Build the `new Foundry(...)` config for the selected host and announce the target once. */
export function bridgeConfig(env, { profile, host, quiet = false } = {}) {
  // `profile` is the pre-2.2 option name; `host` is the 2.2 one. Either wins over the env.
  const kind = host ?? profile ?? hostKindFromEnv(process.env);
  const hostCfg = resolveHostConfig(env, kind);
  const cfg = { ...bridgeConfigOf(hostCfg), host: createHost(hostCfg, quietLogger) };
  if (!quiet) {
    const label = kind === 'local' ? 'LOCAL sandbox' : kind === 'molten' ? 'prod (Molten)' : kind;
    console.log(`target: ${label} (${cfg.serverUrl})`);
  }
  return cfg;
}

/**
 * Just the Host for an env (default: molten) — for the older scripts that build their own
 * `new Foundry({...})` config by hand and only need the wake step attached (`host: hostFor(env)`
 * where they used to pass `magicUrl`).
 */
export function hostFor(env, kind = 'molten') {
  return createHost(resolveHostConfig(env, kind), quietLogger);
}
