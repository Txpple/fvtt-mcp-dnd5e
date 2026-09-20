// Host-aware bridge config for the verify / probe scripts — the SAME selector src/config.ts
// applies to the MCP server itself (src/hosts/env.ts): the FOUNDRY_* set, with FOUNDRY_HOST picking
// the preset. `FOUNDRY_HOST=local node scripts/<script>.mjs` targets the sandbox,
// `FOUNDRY_HOST=molten …` prod; unset = `generic`, whose FOUNDRY_URL must be set (the 2.x
// MOLTEN_* / LOCAL_* names are still read as aliases under their own host — see src/hosts/env.ts).
//
// A thin layer over the library surface the siblings import (`fvtt-mcp-dnd5e/client`,
// src/client.ts): `foundryConfig` builds what `new Foundry(cfg)` takes, with the Host attached
// (`cfg.host`) so the bridge can wake a sleeping instance and a script can reach the file plane
// (`cfg.host.files`). This wrapper adds only the `target:` line and the pre-2.2 `profile` name.
// `env` is the script's own parsed .env (`loadEnv()` from dist/env.js).

import { foundryConfig, hostKindFromEnv, targetLabel } from '../../dist/client.js';

/** Build the `new Foundry(...)` config for the selected host and announce the target once. */
export function bridgeConfig(env, { profile, host, quiet = false } = {}) {
  // `profile` is the pre-2.2 option name; `host` is the 2.2 one. Either wins over the env.
  const kind = host ?? profile ?? hostKindFromEnv(process.env);
  const cfg = foundryConfig(env, kind);
  if (!quiet) console.log(`target: ${targetLabel(kind)} (${cfg.serverUrl})`);
  return cfg;
}
