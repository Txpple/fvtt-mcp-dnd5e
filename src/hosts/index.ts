// src/hosts — the one place that knows where Foundry runs (design.md §2.6).
//
//   resolveHostConfig(env)  →  HostConfig   (the single env selector: FOUNDRY_*, the presets)
//   createHost(cfg, logger) →  Host         (what the bridge and the tools are handed)
//
// The bridge's own config (serverUrl / user / password / adminKey / worldId) is read off the same
// HostConfig by `bridgeConfigOf`, so a script or the server builds both from one object.

import { Logger } from '../logger.js';
import { FoundryHost } from './host.js';
import type { HostConfig } from './host.js';
import type { Host } from './types.js';

export {
  hostConfigProblem,
  hostKindFromEnv,
  isPlaceholderUrl,
  PLACEHOLDER_URL,
  resolveHostConfig,
} from './env.js';
export type { AliasWarn, Env } from './env.js';
export type { HostConfig } from './host.js';
export {
  buildPublicUrl,
  guessContentType,
  humanSize,
  looksLikeWorldDbPath,
  toDataRelative,
  worldDbRefusal,
} from './paths.js';
export { FilePlaneError } from './types.js';
export type { FileEntry, FilePlane, Host, HostKind, WakeContext } from './types.js';

export function createHost(cfg: HostConfig, logger: Logger): Host {
  return new FoundryHost(cfg, logger);
}

/** The connection half of a HostConfig — what `new Foundry(...)` takes, minus the host itself. */
export function bridgeConfigOf(cfg: HostConfig): {
  serverUrl: string;
  user: string;
  password?: string;
  adminKey?: string;
  worldId?: string;
} {
  return {
    serverUrl: cfg.serverUrl,
    user: cfg.user,
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.adminKey ? { adminKey: cfg.adminKey } : {}),
    ...(cfg.worldId ? { worldId: cfg.worldId } : {}),
  };
}
