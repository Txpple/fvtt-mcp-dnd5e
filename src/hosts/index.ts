// src/hosts — the one place that knows where Foundry runs (design.md §2.6).
//
//   resolveHostConfig(env)     →  HostConfig  (the single env selector: FOUNDRY_*, the presets)
//   createHost(cfg, logger)    →  Host        (what the bridge and the tools are handed)
//   filePlaneFor(host, bridge) →  FilePlane   (the host's direct plane, else the bridge plane)
//
// The bridge's own config (serverUrl / user / password / adminKey / worldId) is read off the same
// HostConfig by `bridgeConfigOf`, so a script or the server builds both from one object.

import { Logger } from '../logger.js';
import { BridgeFilePlane } from './bridge-files.js';
import { FoundryHost } from './host.js';
import type { HostConfig } from './host.js';
import type { FilePlane, Host, PageCaller } from './types.js';

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
export type { FileEntry, FilePlane, Host, HostKind, PageCaller, WakeContext } from './types.js';

export function createHost(cfg: HostConfig, logger: Logger): Host {
  return new FoundryHost(cfg, logger);
}

/**
 * The file plane a tool uses on `host`: the host's direct plane when one is configured (WebDAV,
 * the local filesystem — the fast path), else the bridge plane, which every joinable Foundry
 * has. So the asset file tools never say "not configured" — at most a plane refuses the one
 * operation it does not have (delete / move through FilePicker), by name.
 */
export function filePlaneFor(host: Host, bridge: PageCaller): FilePlane {
  return host.files ?? new BridgeFilePlane(bridge);
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
