import { Logger } from '../logger.js';
import { buildPublicUrl } from './paths.js';
import type { FilePlane, Host, WakeContext } from './types.js';
import { WebDavClient } from './webdav.js';

/**
 * Molten Hosting — a managed host whose box SLEEPS between sessions.
 *
 * What is Molten-specific, and therefore lives here and nowhere else:
 *  - the "Server Startup / Magic URL" (`…?s=token`): a GET wakes a sleeping VM. The wake rides
 *    the bridge's real browser page (proven on every cold start since 2026-06); the token is a
 *    secret, so `redact` strips it from any message that echoes the URL.
 *  - the file plane is WebDAV (Apache mod_dav behind Basic auth, user `foundry-ftp`, password =
 *    the panel's File-Manager token). Unset password = no plane; the tools say which var to set.
 *  - anything under `Data/` is served publicly over HTTPS with no auth (the upload tools carry the
 *    privacy caveat).
 */
export interface MoltenHostConfig {
  kind: 'molten';
  serverUrl: string;
  user: string;
  password?: string | undefined;
  adminKey?: string | undefined;
  worldId?: string | undefined;
  /** MOLTEN_MAGIC_URL — GET to wake (…?s=token). */
  magicUrl?: string | undefined;
  webdavUrl: string;
  fileBrowserUrl: string;
  webdavUser: string;
  webdavPassword?: string | undefined;
}

export class MoltenHost implements Host {
  readonly kind = 'molten' as const;
  readonly label = 'Molten Hosting';
  readonly vars = {
    serverUrl: 'MOLTEN_SERVER_URL',
    adminKey: 'MOLTEN_ADMIN_KEY',
    worldId: 'MOLTEN_WORLD_ID',
  };
  readonly unreachableHint =
    'Check MOLTEN_SERVER_URL / MOLTEN_MAGIC_URL, and that the box actually woke.';
  readonly files: FilePlane | null;
  readonly worldId: string | undefined;

  constructor(
    private readonly cfg: MoltenHostConfig,
    logger: Logger
  ) {
    this.worldId = cfg.worldId;
    this.files = cfg.webdavPassword
      ? new WebDavClient({
          webdavUrl: cfg.webdavUrl,
          user: cfg.webdavUser,
          password: cfg.webdavPassword,
          logger,
        })
      : null;
  }

  /** GET the Magic URL to spin a sleeping box back up (best-effort; a nav error is only logged). */
  async wake(ctx: WakeContext): Promise<void> {
    if (!this.cfg.magicUrl) return;
    ctx.log.debug('waking via Magic URL');
    await ctx.goto(this.cfg.magicUrl).catch(e => {
      ctx.log.warn(`magic-url nav note: ${this.redact((e as Error).message)}`);
    });
  }

  /**
   * Strip the Magic URL (and any `?s=<token>` startup secret) out of a message before it reaches
   * the logs: a Playwright nav error echoes back the URL it failed to load, which would otherwise
   * leak the wake token. Errors should name the failing thing, never its secret value.
   */
  redact(msg: string): string {
    let out = msg;
    if (this.cfg.magicUrl) out = out.split(this.cfg.magicUrl).join('<MOLTEN_MAGIC_URL>');
    return out.replace(/([?&]s=)[^\s&"']+/gi, '$1<redacted>');
  }

  filesNotConfigured(tool: string): string {
    return (
      `${tool} is not configured: set MOLTEN_WEBDAV_PASSWORD in your .env (the File Manager ` +
      `password from the Molten panel; user "${this.cfg.webdavUser}"). Never commit it.`
    );
  }

  publicUrl(dataRelativePath: string): string {
    return buildPublicUrl(this.cfg.serverUrl, dataRelativePath);
  }
}
