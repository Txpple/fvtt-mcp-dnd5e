// src/hosts — the one place that knows where Foundry runs (design.md §2.6).
//
//   resolveHostConfig(env)  →  HostConfig   (the single env selector)
//   createHost(cfg, logger) →  Host         (what the bridge and the tools are handed)
//
// The bridge's own config (serverUrl / user / password / adminKey / worldId) is read off the same
// HostConfig by `bridgeConfigOf`, so a script or the server builds both from one object.

import { Logger } from '../logger.js';
import { GenericHost } from './generic.js';
import { LocalHost } from './local.js';
import { MoltenHost } from './molten.js';
import type { HostConfig } from './env.js';
import type { Host } from './types.js';

export { hostKindFromEnv, resolveHostConfig } from './env.js';
export type { Env, HostConfig } from './env.js';
export type { MoltenHostConfig } from './molten.js';
export type { LocalHostConfig } from './local.js';
export type { GenericHostConfig } from './generic.js';
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
  switch (cfg.kind) {
    case 'molten':
      return new MoltenHost(cfg, logger);
    case 'local':
      return new LocalHost(cfg);
    case 'generic':
      return new GenericHost(cfg);
  }
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
