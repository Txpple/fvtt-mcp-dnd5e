// Profile-aware bridge config for the verify / spike / probe scripts — the same selector
// src/config.ts applies to the MCP server itself, so a script can be pointed at the LOCAL sandbox
// with `FOUNDRY_PROFILE=local node scripts/<script>.mjs` and at prod (the default) otherwise.
//
//   local : LOCAL_SERVER_URL (default http://localhost:30000), no wake URL (a local box does not
//           sleep), LOCAL_FOUNDRY_USER / LOCAL_FOUNDRY_PASSWORD / LOCAL_WORLD_ID / LOCAL_ADMIN_KEY,
//           each falling back to the MOLTEN_* value (a sandbox is a byte copy — same world id,
//           same users).
//   prod  : the MOLTEN_* set, exactly as every script wrote it by hand before.
//
// `env` is the script's own parsed .env (loadEnv()); process.env.FOUNDRY_PROFILE picks the profile.

/** Build the `new Foundry(...)` config for the selected profile and announce the target once. */
export function bridgeConfig(env, { profile = process.env.FOUNDRY_PROFILE, quiet = false } = {}) {
  const local = profile === 'local';
  const cfg = local
    ? {
        serverUrl: env.LOCAL_SERVER_URL || 'http://localhost:30000',
        user: env.LOCAL_FOUNDRY_USER || env.FOUNDRY_USER || 'MCP-Claude',
        password: env.LOCAL_FOUNDRY_PASSWORD ?? env.FOUNDRY_PASSWORD,
        adminKey: env.LOCAL_ADMIN_KEY,
        worldId: env.LOCAL_WORLD_ID || env.MOLTEN_WORLD_ID,
      }
    : {
        serverUrl: env.MOLTEN_SERVER_URL,
        magicUrl: env.MOLTEN_MAGIC_URL,
        user: env.FOUNDRY_USER || 'MCP-Claude',
        password: env.FOUNDRY_PASSWORD,
        adminKey: env.MOLTEN_ADMIN_KEY,
        worldId: env.MOLTEN_WORLD_ID,
      };
  if (!quiet) console.log(`target: ${local ? 'LOCAL sandbox' : 'prod'} (${cfg.serverUrl})`);
  return cfg;
}
