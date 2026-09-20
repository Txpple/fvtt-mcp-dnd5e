import { LocalFilePlane } from './local-files.js';
import { buildPublicUrl } from './paths.js';
import type { FilePlane, Host } from './types.js';

/**
 * A Foundry install on THIS machine (the sandbox — docs/local-sandbox.md, run headless by
 * scripts/local-foundry.mjs). "local" means on this machine, never "not Molten" (design.md §2.6).
 *
 *  - no wake: a local process does not sleep. If it is not running the bridge fails fast with
 *    the launcher named, rather than polling a box that will never come up.
 *  - the file plane is the `Data/` directory itself (LOCAL_FOUNDRY_DATA), over node:fs. Unset =
 *    no plane, and the asset tools say so — a local-host process must never reach for a remote
 *    plane by accident.
 *  - `Data/` is served at the server root here too, so public URLs are `<LOCAL_SERVER_URL>/<path>`.
 */
export interface LocalHostConfig {
  kind: 'local';
  serverUrl: string;
  user: string;
  password?: string | undefined;
  adminKey?: string | undefined;
  worldId?: string | undefined;
  /** LOCAL_FOUNDRY_DATA — the install's `Data/` directory (the file plane). */
  dataDir?: string | undefined;
}

export class LocalHost implements Host {
  readonly kind = 'local' as const;
  readonly label = 'local install';
  readonly vars = {
    serverUrl: 'LOCAL_SERVER_URL',
    adminKey: 'LOCAL_ADMIN_KEY',
    worldId: 'LOCAL_WORLD_ID',
  };
  readonly unreachableHint =
    'Is the local Foundry running? Start it with `node scripts/local-foundry.mjs start` ' +
    '(LOCAL_SERVER_URL, default http://localhost:30000).';
  readonly files: FilePlane | null;
  readonly worldId: string | undefined;

  constructor(private readonly cfg: LocalHostConfig) {
    this.worldId = cfg.worldId;
    this.files = cfg.dataDir ? new LocalFilePlane(cfg.dataDir) : null;
  }

  redact(msg: string): string {
    return msg;
  }

  filesNotConfigured(tool: string): string {
    return (
      `${tool} is not configured for the local host: set LOCAL_FOUNDRY_DATA in your .env to the ` +
      "install's Data directory (the same one scripts/local-foundry.mjs serves)."
    );
  }

  publicUrl(dataRelativePath: string): string {
    return buildPublicUrl(this.cfg.serverUrl, dataRelativePath);
  }
}
