import { buildPublicUrl } from './paths.js';
import type { Host } from './types.js';

/**
 * Any Foundry reachable at a URL, and nothing else known about it: no wake, no file plane. The
 * whole bridge surface works (it is Foundry's own client); the asset FILE tools report that this
 * host has no plane. A self-hosted box elsewhere, a Forge world — each becomes its own host when
 * we know how it wakes and how its files are reached; until then it is `generic`.
 */
export interface GenericHostConfig {
  kind: 'generic';
  serverUrl: string;
  user: string;
  password?: string | undefined;
  adminKey?: string | undefined;
  worldId?: string | undefined;
}

export class GenericHost implements Host {
  readonly kind = 'generic' as const;
  readonly label = 'generic';
  readonly vars = {
    serverUrl: 'FOUNDRY_URL',
    adminKey: 'FOUNDRY_ADMIN_KEY',
    worldId: 'FOUNDRY_WORLD_ID',
  };
  readonly unreachableHint = 'Check FOUNDRY_URL and that the world is launched on that server.';
  readonly files = null;
  readonly worldId: string | undefined;

  constructor(private readonly cfg: GenericHostConfig) {
    this.worldId = cfg.worldId;
  }

  redact(msg: string): string {
    return msg;
  }

  filesNotConfigured(tool: string): string {
    return (
      `${tool} is unavailable: the generic host (FOUNDRY_HOST=generic) has no file plane. ` +
      'Put assets in place through Foundry itself, or run against a host that has one ' +
      '(FOUNDRY_HOST=molten with MOLTEN_WEBDAV_PASSWORD, or FOUNDRY_HOST=local with LOCAL_FOUNDRY_DATA).'
    );
  }

  publicUrl(dataRelativePath: string): string {
    return buildPublicUrl(this.cfg.serverUrl, dataRelativePath);
  }
}
