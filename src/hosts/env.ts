import { z } from 'zod';
import type { HostConfig } from './host.js';
import type { HostKind } from './types.js';

/**
 * The ONE env selector — which Foundry this process targets, and everything the host needs.
 *
 * Shared by the MCP server (src/config.ts), the verify / spike scripts (scripts/lib/bridge-config.mjs)
 * and the live integration suite (tests/integration/setup.ts), so the three can't drift. It takes a
 * plain env map (process.env, or a parsed .env) and never reads the process itself.
 *
 * The contract is the FOUNDRY_* set, the same on every host:
 *
 *   FOUNDRY_URL          the instance's base URL (required — the placeholder is refused at startup)
 *   FOUNDRY_USER         the user the bridge joins as (default MCP-Claude); FOUNDRY_PASSWORD if it has one
 *   FOUNDRY_ADMIN_KEY    the admin access key — lets the bridge launch a world from /setup
 *   FOUNDRY_WORLD_ID     which world to launch; unset = the only world on /setup is launched
 *   FOUNDRY_HOST         the host PRESET (default generic): molten · local · generic
 *   FOUNDRY_WAKE_URL     a GET that wakes a sleeping instance (any host but local)
 *   FOUNDRY_DATA_DIR     the install's Data/ directory — the filesystem plane (local, generic)
 *   FOUNDRY_WEBDAV_URL / _USER / _PASSWORD   a WebDAV endpoint over Data/ (molten, generic)
 *
 * The host is chosen per MCP-server REGISTRATION (its `env` block), and a registration's env
 * beats the shared .env — one .env can serve several registrations, each setting what differs.
 * The presets: `molten` derives the WebDAV URL + user from FOUNDRY_URL and never has a
 * filesystem plane (a remote box); `local` (an install on THIS machine) defaults FOUNDRY_URL to
 * http://localhost:30000, never wakes and never dials WebDAV; `generic` reads every variable.
 *
 * Legacy names are honoured HERE and nowhere else, each logged once as an alias when it is what
 * supplied the value, and only under the host they belong to — MOLTEN_* under molten, LOCAL_*
 * under local — so a .env written for the 2.x layout keeps working unchanged. Precedence:
 * host-prefixed alias > FOUNDRY_* > default. `FOUNDRY_PROFILE=local` (pre-2.2) = FOUNDRY_HOST=local.
 * MOLTEN_FILEBROWSER_URL was never read by anything and is dropped. The table is LEGACY_NAMES;
 * `npm run init` asks it (`legacyNameOf`) which line of a .env supplies an answer it updates, and
 * a reader that needs a key under every name asks `namesOf`. The 2.x names of the suite and player
 * identities are IDENTITY_NAMES. `git grep MOLTEN_ src` answers this file and its test only.
 *
 * Secrets AND the world id are optional with NO default — an unset world id means "discover it on
 * /setup" (one world) rather than a doomed launch. Tools check presence and name the variable.
 */
export type Env = Record<string, string | undefined>;

export type { HostConfig } from './host.js';

const HOST_KINDS: readonly HostKind[] = ['molten', 'local', 'generic'];

/** The neutral stand-in for an unset FOUNDRY_URL — refused before any connect is attempted. */
export const PLACEHOLDER_URL = 'https://your-foundry.example.com';

/** Is this still a placeholder (ours, or the 2.x .env.example's Molten one) rather than a real URL? */
export function isPlaceholderUrl(url: string): boolean {
  return /^https?:\/\/your-(foundry|server)\./i.test(url.trim());
}

/** The startup refusal for a config that can never connect, or `undefined` when it can. */
export function hostConfigProblem(cfg: HostConfig): string | undefined {
  if (isPlaceholderUrl(cfg.serverUrl)) {
    return (
      `FOUNDRY_URL is not set (it is still the placeholder "${cfg.serverUrl}"). Set it to your ` +
      "Foundry instance's base URL — https://your-box.moltenhosting.com, http://localhost:30000 " +
      "— in the MCP registration's env block or the repo .env."
    );
  }
  return undefined;
}

/** Where an alias note goes (the server logs them once at startup; scripts may ignore them). */
export type AliasWarn = (msg: string) => void;

/** FOUNDRY_HOST, else the FOUNDRY_PROFILE=local alias, else generic. An unknown value throws. */
export function hostKindFromEnv(env: Env, warn?: AliasWarn): HostKind {
  const raw = env.FOUNDRY_HOST?.trim().toLowerCase();
  if (raw) {
    if ((HOST_KINDS as readonly string[]).includes(raw)) return raw as HostKind;
    throw new Error(
      `FOUNDRY_HOST="${env.FOUNDRY_HOST}" is not a known host (one of: ${HOST_KINDS.join(', ')}).`
    );
  }
  if (env.FOUNDRY_PROFILE === 'local') {
    warn?.('FOUNDRY_PROFILE=local is a legacy alias of FOUNDRY_HOST=local.');
    return 'local';
  }
  return 'generic';
}

const HostConfigSchema = z.object({
  kind: z.enum(['molten', 'local', 'generic']),
  serverUrl: z.string().url(),
  user: z.string().min(1),
  password: z.string().optional(),
  adminKey: z.string().optional(),
  worldId: z.string().optional(),
  wakeUrl: z.string().url().optional(),
  dataDir: z.string().optional(),
  webdav: z
    .object({ url: z.string().url(), user: z.string().min(1), password: z.string().min(1) })
    .optional(),
});

/**
 * The 2.x names still read, per host: canonical → its legacy alias. Read only under its own host,
 * where it wins over the canonical name (what lets one 2.x .env, MOLTEN_* for prod and LOCAL_* for
 * the sandbox, serve two registrations).
 */
const LEGACY_NAMES: Record<HostKind, Readonly<Record<string, string>>> = {
  local: {
    FOUNDRY_URL: 'LOCAL_SERVER_URL',
    FOUNDRY_USER: 'LOCAL_FOUNDRY_USER',
    FOUNDRY_PASSWORD: 'LOCAL_FOUNDRY_PASSWORD',
    FOUNDRY_ADMIN_KEY: 'LOCAL_ADMIN_KEY',
    FOUNDRY_WORLD_ID: 'LOCAL_WORLD_ID',
    FOUNDRY_DATA_DIR: 'LOCAL_FOUNDRY_DATA',
  },
  molten: {
    FOUNDRY_URL: 'MOLTEN_SERVER_URL',
    FOUNDRY_ADMIN_KEY: 'MOLTEN_ADMIN_KEY',
    FOUNDRY_WORLD_ID: 'MOLTEN_WORLD_ID',
    FOUNDRY_WAKE_URL: 'MOLTEN_MAGIC_URL',
    FOUNDRY_WEBDAV_URL: 'MOLTEN_WEBDAV_URL',
    FOUNDRY_WEBDAV_USER: 'MOLTEN_WEBDAV_USER',
    FOUNDRY_WEBDAV_PASSWORD: 'MOLTEN_WEBDAV_PASSWORD',
  },
  generic: {},
};

/** The legacy name that, when set, supplies `canonical` under `kind` in its place, if any. */
export function legacyNameOf(kind: HostKind, canonical: string): string | undefined {
  return LEGACY_NAMES[kind][canonical];
}

/**
 * Every name `canonical` is read under on some host: the canonical name first, then each host's
 * legacy alias of it (`FOUNDRY_ADMIN_KEY`, then the 2.x local and Molten names). For a check that
 * looks at a key whichever host reads it (the .env slips, src/env.ts) and for a caller that
 * withholds a key from every host at once (the doctor's login, src/doctor.ts).
 */
export function namesOf(canonical: string): string[] {
  const names = [canonical];
  for (const kind of HOST_KINDS) {
    const alias = LEGACY_NAMES[kind][canonical];
    if (alias && !names.includes(alias)) names.push(alias);
  }
  return names;
}

/**
 * The env names of the second identities a script joins as (`resolveIdentity`, src/client.ts): a
 * suite user and a player, the canonical name first, then the 2.x name still read in its place.
 */
export const IDENTITY_NAMES = {
  suite: {
    user: ['FOUNDRY_SUITE_USER', 'BF_SUITE_USER'],
    password: ['FOUNDRY_SUITE_PASSWORD', 'BF_SUITE_PASSWORD'],
  },
  player: {
    user: ['FOUNDRY_PLAYER_USER', 'MOLTEN_TEST_USER'],
    password: ['FOUNDRY_PLAYER_PASSWORD', 'MOLTEN_TEST_PASSWORD'],
  },
} as const;

/** An empty string in .env means "unset" for every optional field. */
const opt = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);

/**
 * The value of `canonical`, unless one of its host-prefixed `aliases` is set (the first set alias
 * wins and is reported through `warn`). Empty = unset throughout.
 */
function pick(env: Env, warn: AliasWarn | undefined, canonical: string, ...aliases: string[]) {
  for (const alias of aliases) {
    const v = opt(env[alias]);
    if (v !== undefined) {
      warn?.(`${alias} is a legacy alias of ${canonical} — set ${canonical} instead.`);
      return v;
    }
  }
  return opt(env[canonical]);
}

/** Molten's WebDAV endpoint lives beside the server: `https://<box>.moltenhosting.com` → `…webdav…`. */
function moltenWebdavUrl(serverUrl: string): string | undefined {
  const m = /^(https?:\/\/[^./]+)\.(moltenhosting\.com)\/?$/i.exec(serverUrl.trim());
  return m ? `${m[1]}.webdav.${m[2]}` : undefined;
}

/** Resolve the host config for `kind` (default: what the env selects) from an env map. */
export function resolveHostConfig(
  env: Env,
  kind?: HostKind,
  opts: { warn?: AliasWarn } = {}
): HostConfig {
  const { warn } = opts;
  const host: HostKind = kind ?? hostKindFromEnv(env, warn);
  const p = (canonical: string) => {
    const alias = legacyNameOf(host, canonical);
    return alias ? pick(env, warn, canonical, alias) : pick(env, warn, canonical);
  };
  let raw: HostConfig;
  switch (host) {
    case 'local': {
      raw = {
        kind: host,
        serverUrl: p('FOUNDRY_URL') ?? 'http://localhost:30000',
        user: p('FOUNDRY_USER') ?? 'MCP-Claude',
        password: p('FOUNDRY_PASSWORD'),
        adminKey: p('FOUNDRY_ADMIN_KEY'), // unset -> manual world launch
        worldId: p('FOUNDRY_WORLD_ID'),
        dataDir: p('FOUNDRY_DATA_DIR'),
        // no wakeUrl (a local process does not sleep), no webdav (nothing to dial)
      };
      break;
    }
    case 'molten': {
      const serverUrl = p('FOUNDRY_URL') ?? PLACEHOLDER_URL;
      const webdavUrl = p('FOUNDRY_WEBDAV_URL') ?? moltenWebdavUrl(serverUrl);
      const webdavUser = p('FOUNDRY_WEBDAV_USER') ?? 'foundry-ftp';
      const webdavPassword = p('FOUNDRY_WEBDAV_PASSWORD');
      raw = {
        kind: host,
        serverUrl,
        user: p('FOUNDRY_USER') ?? 'MCP-Claude',
        password: p('FOUNDRY_PASSWORD'),
        adminKey: p('FOUNDRY_ADMIN_KEY'),
        worldId: p('FOUNDRY_WORLD_ID'),
        wakeUrl: p('FOUNDRY_WAKE_URL'),
        webdav:
          webdavUrl && webdavPassword
            ? { url: webdavUrl, user: webdavUser, password: webdavPassword }
            : undefined,
        // no dataDir: a managed box's disk is never this machine's
      };
      break;
    }
    default: {
      const webdavUrl = p('FOUNDRY_WEBDAV_URL');
      const webdavUser = p('FOUNDRY_WEBDAV_USER');
      const webdavPassword = p('FOUNDRY_WEBDAV_PASSWORD');
      raw = {
        kind: 'generic',
        serverUrl: p('FOUNDRY_URL') ?? PLACEHOLDER_URL,
        user: p('FOUNDRY_USER') ?? 'MCP-Claude',
        password: p('FOUNDRY_PASSWORD'),
        adminKey: p('FOUNDRY_ADMIN_KEY'),
        worldId: p('FOUNDRY_WORLD_ID'),
        wakeUrl: p('FOUNDRY_WAKE_URL'),
        dataDir: p('FOUNDRY_DATA_DIR'),
        webdav:
          webdavUrl && webdavUser && webdavPassword
            ? { url: webdavUrl, user: webdavUser, password: webdavPassword }
            : undefined,
      };
    }
  }
  return HostConfigSchema.parse(raw);
}
