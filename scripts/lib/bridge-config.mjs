// Host-aware bridge config for the verify / spike / probe scripts — the SAME selector src/config.ts
// applies to the MCP server itself (src/hosts/env.ts): the FOUNDRY_* set, with FOUNDRY_HOST picking
// the preset. `FOUNDRY_HOST=local node scripts/<script>.mjs` targets the sandbox,
// `FOUNDRY_HOST=molten …` prod; unset = `generic`, whose FOUNDRY_URL must be set (the 2.x
// MOLTEN_* / LOCAL_* names are still read as aliases under their own host — see src/hosts/env.ts).
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
 * Just the Host for an env (default: molten — these are the prod-only scripts that still read
 * MOLTEN_* by hand and only need the wake step attached; `host: hostFor(env)` where they used to
 * pass `magicUrl`).
 */
export function hostFor(env, kind = 'molten') {
  return createHost(resolveHostConfig(env, kind), quietLogger);
}
