import { z } from 'zod';
import type { GenericHostConfig } from './generic.js';
import type { LocalHostConfig } from './local.js';
import type { MoltenHostConfig } from './molten.js';
import type { HostKind } from './types.js';

/**
 * The ONE env selector — which Foundry this process targets, and everything the host needs.
 *
 * Shared by the MCP server (src/config.ts), the verify / spike scripts (scripts/lib/bridge-config.mjs)
 * and the live integration suite (tests/integration/setup.ts), so the three can't drift. It takes a
 * plain env map (process.env, or a parsed .env) and never reads the process itself.
 *
 * The host is chosen per MCP-server REGISTRATION (its `env` block), never in .env: one .env then
 * serves every host — MOLTEN_* is the primary/prod set, LOCAL_* overrides what a local instance
 * genuinely changes, and the rest (world id, join user/password) is inherited from the prod values
 * because the sandbox is a byte copy of prod: its world id and users ARE prod's.
 *
 *   FOUNDRY_HOST=molten   (default)  MOLTEN_SERVER_URL · MOLTEN_MAGIC_URL · MOLTEN_ADMIN_KEY ·
 *                                    MOLTEN_WORLD_ID · MOLTEN_WEBDAV_* · FOUNDRY_USER / FOUNDRY_PASSWORD
 *   FOUNDRY_HOST=local               LOCAL_SERVER_URL (default http://localhost:30000) · LOCAL_ADMIN_KEY ·
 *                                    LOCAL_FOUNDRY_DATA (the file plane) · LOCAL_WORLD_ID → MOLTEN_WORLD_ID ·
 *                                    LOCAL_FOUNDRY_USER → FOUNDRY_USER · LOCAL_FOUNDRY_PASSWORD → FOUNDRY_PASSWORD
 *   FOUNDRY_HOST=generic             FOUNDRY_URL · FOUNDRY_ADMIN_KEY · FOUNDRY_WORLD_ID · FOUNDRY_USER / FOUNDRY_PASSWORD
 *
 * `FOUNDRY_PROFILE=local` (the pre-2.2 spelling) is honoured as an alias of FOUNDRY_HOST=local.
 *
 * Non-secret connection facts default to neutral `your-server` placeholders — set the real values
 * for your instance in a gitignored .env (see .env.example). Secrets AND worldId are optional with
 * NO default — worldId is left unset rather than a placeholder so the bridge's remote world-launch
 * only fires for a real, configured world (an unset world id then takes the manual-launch guidance
 * path, not a doomed launch). Tools check presence and tell the user which var to set.
 */
export type Env = Record<string, string | undefined>;

export type HostConfig = MoltenHostConfig | LocalHostConfig | GenericHostConfig;

const HOST_KINDS: readonly HostKind[] = ['molten', 'local', 'generic'];

/** FOUNDRY_HOST, else the FOUNDRY_PROFILE=local alias, else molten. An unknown value throws. */
export function hostKindFromEnv(env: Env): HostKind {
  const raw = env.FOUNDRY_HOST?.trim().toLowerCase();
  if (raw) {
    if ((HOST_KINDS as readonly string[]).includes(raw)) return raw as HostKind;
    throw new Error(
      `FOUNDRY_HOST="${env.FOUNDRY_HOST}" is not a known host (one of: ${HOST_KINDS.join(', ')}).`
    );
  }
  return env.FOUNDRY_PROFILE === 'local' ? 'local' : 'molten';
}

const common = {
  serverUrl: z.string().url(),
  user: z.string().min(1),
  password: z.string().optional(),
  adminKey: z.string().optional(),
  worldId: z.string().optional(),
};

const HostConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('molten'),
    ...common,
    magicUrl: z.string().optional(),
    webdavUrl: z.string().url(),
    fileBrowserUrl: z.string().url(),
    webdavUser: z.string().min(1),
    webdavPassword: z.string().optional(),
  }),
  z.object({
    kind: z.literal('local'),
    ...common,
    dataDir: z.string().optional(),
  }),
  z.object({
    kind: z.literal('generic'),
    ...common,
  }),
]);

/** An empty string in .env means "unset" for every optional field. */
const opt = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);

/** Resolve the host config for `kind` (default: what the env selects) from an env map. */
export function resolveHostConfig(env: Env, kind: HostKind = hostKindFromEnv(env)): HostConfig {
  let raw: HostConfig;
  switch (kind) {
    case 'local':
      raw = {
        kind,
        serverUrl: opt(env.LOCAL_SERVER_URL) ?? 'http://localhost:30000',
        user: opt(env.LOCAL_FOUNDRY_USER) ?? opt(env.FOUNDRY_USER) ?? 'MCP-Claude',
        password: opt(env.LOCAL_FOUNDRY_PASSWORD) ?? opt(env.FOUNDRY_PASSWORD),
        adminKey: opt(env.LOCAL_ADMIN_KEY), // unset -> manual world launch (click Play locally)
        worldId: opt(env.LOCAL_WORLD_ID) ?? opt(env.MOLTEN_WORLD_ID),
        dataDir: opt(env.LOCAL_FOUNDRY_DATA),
      };
      break;
    case 'generic':
      raw = {
        kind,
        serverUrl: opt(env.FOUNDRY_URL) ?? 'http://localhost:30000',
        user: opt(env.FOUNDRY_USER) ?? 'MCP-Claude',
        password: opt(env.FOUNDRY_PASSWORD),
        adminKey: opt(env.FOUNDRY_ADMIN_KEY),
        worldId: opt(env.FOUNDRY_WORLD_ID),
      };
      break;
    default:
      raw = {
        kind: 'molten',
        serverUrl: opt(env.MOLTEN_SERVER_URL) ?? 'https://your-server.moltenhosting.com',
        user: opt(env.FOUNDRY_USER) ?? 'MCP-Claude',
        password: opt(env.FOUNDRY_PASSWORD),
        adminKey: opt(env.MOLTEN_ADMIN_KEY),
        worldId: opt(env.MOLTEN_WORLD_ID), // unset -> manual-launch path (no placeholder)
        magicUrl: opt(env.MOLTEN_MAGIC_URL),
        webdavUrl: opt(env.MOLTEN_WEBDAV_URL) ?? 'https://your-server.webdav.moltenhosting.com',
        fileBrowserUrl:
          opt(env.MOLTEN_FILEBROWSER_URL) ?? 'https://your-server.files.moltenhosting.com',
        webdavUser: opt(env.MOLTEN_WEBDAV_USER) ?? 'foundry-ftp',
        webdavPassword: opt(env.MOLTEN_WEBDAV_PASSWORD),
      };
  }
  return HostConfigSchema.parse(raw);
}
