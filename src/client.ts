// The library surface — `import { … } from 'fvtt-mcp-dnd5e/client'` (also the package's `.`).
//
// This is what the sibling repos consume: the house modules' `tools/` harnesses and the
// artificer drive a live world through the same headless bridge the MCP server uses, never
// through the server itself. Before 3.0 they reached `dist/foundry.js` by absolute path and
// parsed this repo's .env by hand (design.md §2.6; the review's §7) — and the rename broke every
// one of them. The contract, declared:
//
//   Foundry                       the bridge: `new Foundry(cfg)`, `connect()`, `evaluate(fn, arg)`,
//                                 `call(name, args)`, `screenshot(path)`, `dispose()` (alias
//                                 `disconnect()`)
//   connectFoundry(opts)          the harness in one call: .env → host → identity → connect, with
//                                 the watchdog and the raced teardown every sibling had written
//   loadEnv(path?)                this repo's .env as a map (`fvtt-mcp-dnd5e/env`)
//   resolveHostConfig / createHost / bridgeConfigOf / hostKindFromEnv / filePlaneFor
//                                 the host seam (`fvtt-mcp-dnd5e/hosts`)
//
// It deliberately does NOT import src/config.ts: that module reads process.env and refuses a
// placeholder at import time — right for the server, wrong for a library.

import { Foundry, type FoundryConfig, type FoundryLogger } from './foundry.js';
import { envPath, loadEnv } from './env.js';
import type { Env } from './hosts/env.js';
import {
  bridgeConfigOf,
  createHost,
  hostConfigProblem,
  hostKindFromEnv,
  resolveHostConfig,
} from './hosts/index.js';
import type { Host, HostConfig, HostKind } from './hosts/index.js';
import { Logger } from './logger.js';

export { Foundry } from './foundry.js';
export type { FoundryBridge, FoundryConfig, FoundryLogger } from './foundry.js';
export { envPath, loadEnv, repoRoot } from './env.js';
export type { Env } from './env.js';
export {
  bridgeConfigOf,
  createHost,
  filePlaneFor,
  hostConfigProblem,
  hostKindFromEnv,
  isPlaceholderUrl,
  PLACEHOLDER_URL,
  resolveHostConfig,
} from './hosts/index.js';
export type {
  FileEntry,
  FilePlane,
  Host,
  HostConfig,
  HostKind,
  PageCaller,
} from './hosts/index.js';
export { FilePlaneError } from './hosts/index.js';
export { Logger } from './logger.js';

/**
 * Who the client joins as.
 *
 *   'bridge'   the MCP's own user — FOUNDRY_USER / FOUNDRY_PASSWORD (the default)
 *   'suite'    a test suite's own GM-capable user — FOUNDRY_SUITE_USER / FOUNDRY_SUITE_PASSWORD.
 *              Distinct from the bridge on purpose: a bridge left connected then shows up as a
 *              SECOND user instead of an invisible collision (`game.users.activeGM` elects one
 *              client per user, so two sessions on one account fight over every application)
 *   'player'   a player-role user for two-client probes — FOUNDRY_PLAYER_USER / _PASSWORD;
 *              joins with no admin key (a player has no business launching the world)
 *   {user, password?}   spelled out
 */
export type Identity = 'bridge' | 'suite' | 'player' | { user: string; password?: string };

export interface ConnectOptions {
  /** Which Foundry (the preset). Default: FOUNDRY_HOST from process.env, else generic. */
  host?: HostKind;
  /** The parsed .env. Default: `loadEnv()` — this repo's file, or FVTT_MCP_ENV. */
  env?: Env;
  identity?: Identity;
  /** Where the bridge's own diagnostics go. Default: silent. */
  logger?: FoundryLogger;
  /** Prefix for the target line and the watchdog message (`[tag] …`). Default: 'client'. */
  tag?: string;
  /**
   * Arm a hard-abort timer (exit 3) BEFORE connecting, so a world that never finishes launching
   * is exactly the hang it breaks. Cleared by `dispose()`. Unset = no watchdog.
   */
  watchdogMs?: number;
  /** Print `target: …` (to stderr, where diagnostics go) before connecting. Default true. */
  announce?: boolean;
}

export interface Connected {
  /** The live bridge, connected and at game.ready. */
  f: Foundry;
  /** The .env map the connection was built from (for any other key the caller reads). */
  env: Env;
  host: Host;
  hostConfig: HostConfig;
  /**
   * Hang up for real: `Foundry#dispose()` raced against a ceiling. A dispose that hangs (an
   * in-flight connect that never settles, a browser that will not close) must not turn a green
   * run into a watchdog abort, so after the ceiling it is abandoned to process exit — which is
   * where teardown lived for every sibling before this existed. Also clears the watchdog.
   */
  dispose(): Promise<void>;
}

/** The suite / player identities, with the 2.x sibling names honoured as aliases. */
const IDENTITY_KEYS = {
  suite: {
    user: ['FOUNDRY_SUITE_USER', 'BF_SUITE_USER'],
    password: ['FOUNDRY_SUITE_PASSWORD', 'BF_SUITE_PASSWORD'],
  },
  player: {
    user: ['FOUNDRY_PLAYER_USER', 'MOLTEN_TEST_USER'],
    password: ['FOUNDRY_PLAYER_PASSWORD', 'MOLTEN_TEST_PASSWORD'],
  },
} as const;

function firstSet(env: Env, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * The join identity as `{user, password?}` — from the host config for 'bridge', from the env for
 * 'suite' / 'player' (an unset user is a refusal naming the variable; an unset password is a
 * passwordless user), or as given.
 */
export function resolveIdentity(
  identity: Identity,
  env: Env,
  hostConfig: HostConfig
): { user: string; password?: string } {
  if (typeof identity === 'object') {
    return identity.password
      ? { user: identity.user, password: identity.password }
      : { user: identity.user };
  }
  if (identity === 'bridge') {
    return hostConfig.password
      ? { user: hostConfig.user, password: hostConfig.password }
      : { user: hostConfig.user };
  }
  const keys = IDENTITY_KEYS[identity];
  const user = firstSet(env, keys.user);
  if (!user) {
    throw new Error(
      `identity '${identity}' needs ${keys.user[0]} in the .env (the user a ${identity} joins as; ` +
        `the 2.x name ${keys.user[1]} is still read).`
    );
  }
  const password = firstSet(env, keys.password);
  return password ? { user, password } : { user };
}

const DISPOSE_CEILING_MS = 15_000;

const silentFoundryLogger: FoundryLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A logger that writes nowhere — the default for a script's bridge diagnostics. */
export function quietLogger(): Logger {
  return new Logger({ level: 'error', enableConsole: false, enableFile: false });
}

/**
 * Connect to the selected Foundry as the given identity: the harness every sibling had copied
 * (read the .env, pick the host, build the config, arm a watchdog, `new Foundry`, `connect`)
 * in one call. Returns the live bridge; `dispose()` is the raced teardown.
 *
 *   const { f, dispose } = await connectFoundry({ host: 'local', identity: 'suite', tag: 'smoke', watchdogMs: 300_000 });
 *   try { await f.evaluate(() => game.world.id, null); } finally { await dispose(); }
 */
export async function connectFoundry(opts: ConnectOptions = {}): Promise<Connected> {
  const tag = opts.tag ?? 'client';
  const env = opts.env ?? loadEnv();
  const kind = opts.host ?? hostKindFromEnv(process.env);
  const hostConfig = resolveHostConfig(env, kind);
  const problem = hostConfigProblem(hostConfig);
  if (problem) throw new Error(`[${tag}] ${problem} (.env: ${envPath()})`);
  const identity = opts.identity ?? 'bridge';
  const who = resolveIdentity(identity, env, hostConfig);
  const host = createHost(hostConfig, quietLogger());
  const base = bridgeConfigOf(hostConfig);
  const cfg: FoundryConfig = {
    serverUrl: base.serverUrl,
    user: who.user,
    ...(who.password ? { password: who.password } : {}),
    // A player never launches the world (and is not allowed to): the world is up by the time a
    // second client joins.
    ...(base.adminKey && identity !== 'player' ? { adminKey: base.adminKey } : {}),
    ...(base.worldId ? { worldId: base.worldId } : {}),
    host,
  };
  if (opts.announce ?? true) {
    const label = kind === 'local' ? 'local sandbox' : kind === 'molten' ? 'prod (Molten)' : kind;
    console.error(`[${tag}] target: ${label} (${cfg.serverUrl}) as "${who.user}"`);
  }

  let watchdog: NodeJS.Timeout | undefined;
  if (opts.watchdogMs) {
    watchdog = setTimeout(() => {
      console.error(`[${tag}] WATCHDOG ${Math.round((opts.watchdogMs ?? 0) / 1000)}s — hard abort`);
      process.exit(3);
    }, opts.watchdogMs);
  }

  const f = new Foundry(cfg, opts.logger ?? silentFoundryLogger);
  await f.connect();

  let hungUp = false;
  const dispose = async (): Promise<void> => {
    if (hungUp) return;
    hungUp = true;
    if (watchdog) clearTimeout(watchdog);
    let settled = false;
    await Promise.race([
      f
        .dispose()
        .then(() => {
          settled = true;
        })
        .catch(err => {
          settled = true;
          console.warn(`[${tag}] dispose() failed — ${(err as Error).message}`);
        }),
      new Promise<void>(r => setTimeout(r, DISPOSE_CEILING_MS)),
    ]);
    if (!settled) {
      console.warn(
        `[${tag}] dispose() did not finish in ${DISPOSE_CEILING_MS / 1000}s — abandoning it to process exit`
      );
    }
  };
  return { f, env, host, hostConfig, dispose };
}
