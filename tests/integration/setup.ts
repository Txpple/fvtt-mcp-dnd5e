// Shared harness for the LIVE integration suite.
//
// These tests drive a real headless Chromium against the live Molten world through
// src/foundry.ts (built to dist/). They are OFF by default in two independent ways:
//   1. The default `npm test` excludes tests/integration/** entirely (vitest.config.ts).
//   2. Even under vitest.integration.config.ts, every suite is gated on LIVE — true only
//      when RUN_LIVE=1 AND a populated .env is present. Otherwise each suite skips, so
//      `npm run test:integration` is safe to run offline (it just reports skips).
//
// The integration tests import the BUILT bridge from dist/ (mirroring the proven
// scripts/verify-*.mjs), so `npm run test:integration` runs `npm run build` first.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The built host seam, like the built bridge the suites import.
import {
  bridgeConfigOf,
  createHost,
  hostKindFromEnv,
  resolveHostConfig,
} from '../../dist/hosts/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

export type Env = Record<string, string>;

/** Parse the gitignored .env (KEY=value, # comments). Returns {} if absent. */
export function loadEnv(): Env {
  try {
    const txt = readFileSync(join(repoRoot, '.env'), 'utf8');
    const env: Env = {};
    for (const line of txt.split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue;
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

export const ENV = loadEnv();

const HAS_ENV = Boolean(ENV.MOLTEN_SERVER_URL);
const OPTED_IN = process.env.RUN_LIVE === '1' || process.env.RUN_LIVE === 'true';

/** Live suites run only when explicitly opted in (RUN_LIVE) AND credentials exist. */
export const LIVE = OPTED_IN && HAS_ENV;

if (OPTED_IN && !HAS_ENV) {
  console.warn(
    '[integration] RUN_LIVE is set but .env has no MOLTEN_SERVER_URL — live suites will skip.'
  );
}

/**
 * The FoundryConfig the bridge needs, derived from .env through the ONE env selector the server
 * and the verify scripts use (src/hosts/env.ts):  (or the pre-2.2
 * ) targets the LOCAL sandbox with the LOCAL_* overrides and MOLTEN_*
 * fallbacks; the default stays prod (molten), exactly as before. The Host rides along so the bridge
 * can wake a sleeping box (and the join user's password is forwarded — omitting it once made every
 * live suite fail on "Invalid password provided for <user>").
 */
export function foundryConfig() {
  const hostCfg = resolveHostConfig(ENV, hostKindFromEnv(process.env));
  return { ...bridgeConfigOf(hostCfg), host: createHost(hostCfg, noopLogger) };
}

/** No-op logger matching the src/logger.ts shape (child() returns itself) — silences the bridge. */
export const noopLogger: any = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
};

/**
 * beforeAll connect budget. A cold Molten box wakes via Magic URL, then the bridge
 * retries the /join form for up to ~4.5 min before game.ready — give it room.
 */
export const CONNECT_TIMEOUT_MS = 600_000;

/** Namespace tag for every document the write suites create (and then clean up). */
export const TAG = 'ZZ-MCP-IT';
