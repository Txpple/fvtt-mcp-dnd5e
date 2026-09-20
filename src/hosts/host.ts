import { Logger } from '../logger.js';
import { LocalFilePlane } from './local-files.js';
import { buildPublicUrl } from './paths.js';
import type { FilePlane, Host, HostKind, WakeContext } from './types.js';
import { WebDavClient } from './webdav.js';

/**
 * The one Host implementation. A host is a PRESET over the same few facts — the three kinds
 * differ only in which facts apply and in their defaults (all of that is decided by the env
 * selector, `resolveHostConfig`):
 *
 *   - `wakeUrl`  — a GET that brings a sleeping instance up (Molten's "Server Startup / Magic
 *                  URL" `…?s=token`; any managed host with the same idea). The token is a secret,
 *                  so `redact` strips it from any message that echoes the URL. Never on `local`.
 *   - `dataDir`  — the install's `Data/` directory: the filesystem plane (`local`, `generic`).
 *   - `webdav`   — a WebDAV endpoint over `Data/`: the WebDAV plane (`molten` derives the URL and
 *                  user from the server URL; `generic` needs all three set).
 *
 * The `kind` survives as the label, the unreachable hint (a local install is started by the
 * launcher, a managed box has to wake) and the get-world-info report.
 */
export interface HostConfig {
  kind: HostKind;
  serverUrl: string;
  user: string;
  password?: string | undefined;
  adminKey?: string | undefined;
  worldId?: string | undefined;
  /** FOUNDRY_WAKE_URL — GET to wake a sleeping instance. */
  wakeUrl?: string | undefined;
  /** FOUNDRY_DATA_DIR — the install's `Data/` directory (the filesystem plane). */
  dataDir?: string | undefined;
  /** FOUNDRY_WEBDAV_URL / _USER / _PASSWORD — the WebDAV plane; present only when complete. */
  webdav?: { url: string; user: string; password: string } | undefined;
}

const LABELS: Record<HostKind, string> = {
  molten: 'Molten Hosting',
  local: 'local install',
  generic: 'generic',
};

export class FoundryHost implements Host {
  readonly kind: HostKind;
  readonly label: string;
  readonly unreachableHint: string;
  readonly files: FilePlane | null;
  readonly wake: ((ctx: WakeContext) => Promise<void>) | undefined;

  constructor(
    private readonly cfg: HostConfig,
    logger: Logger
  ) {
    this.kind = cfg.kind;
    this.label = LABELS[cfg.kind];
    this.unreachableHint =
      cfg.kind === 'local'
        ? 'Is the local Foundry running? Start it with `node scripts/local-foundry.mjs start` ' +
          '(FOUNDRY_URL, default http://localhost:30000).'
        : cfg.wakeUrl
          ? 'Check FOUNDRY_URL / FOUNDRY_WAKE_URL, and that the instance actually woke.'
          : 'Check FOUNDRY_URL and that the world is launched on that server.';
    // The direct plane: the filesystem when the install is on this machine, else WebDAV, else
    // none — and then the tools use the bridge plane (filePlaneFor).
    this.files = cfg.dataDir
      ? new LocalFilePlane(cfg.dataDir)
      : cfg.webdav
        ? new WebDavClient({
            webdavUrl: cfg.webdav.url,
            user: cfg.webdav.user,
            password: cfg.webdav.password,
            logger,
          })
        : null;
    // A wake step only when there is a URL to GET — a host without one never sleeps (or is
    // expected to be up), and the bridge goes straight to /join.
    this.wake = cfg.wakeUrl ? ctx => this.wakeViaUrl(ctx) : undefined;
  }

  /** GET the wake URL to spin a sleeping instance back up (best-effort; a nav error is only logged). */
  private async wakeViaUrl(ctx: WakeContext): Promise<void> {
    if (!this.cfg.wakeUrl) return;
    ctx.log.debug('waking via FOUNDRY_WAKE_URL');
    await ctx.goto(this.cfg.wakeUrl).catch(e => {
      ctx.log.warn(`wake-url nav note: ${this.redact((e as Error).message)}`);
    });
  }

  /**
   * Strip the wake URL (and any `?s=<token>` startup secret) out of a message before it reaches
   * the logs: a Playwright nav error echoes back the URL it failed to load, which would otherwise
   * leak the wake token. Errors should name the failing thing, never its secret value.
   */
  redact(msg: string): string {
    let out = msg;
    if (this.cfg.wakeUrl) out = out.split(this.cfg.wakeUrl).join('<FOUNDRY_WAKE_URL>');
    return out.replace(/([?&]s=)[^\s&"']+/gi, '$1<redacted>');
  }

  publicUrl(dataRelativePath: string): string {
    return buildPublicUrl(this.cfg.serverUrl, dataRelativePath);
  }
}
