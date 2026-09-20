// Shared harness for the LIVE integration suite.
//
// These tests drive a real headless Chromium against a live world through src/foundry.ts
// (built to dist/) — the host FOUNDRY_HOST selects (`FOUNDRY_HOST=local RUN_LIVE=1 npm run
// test:integration` is the sandbox). They are OFF by default in two independent ways:
//   1. The default `npm test` excludes tests/integration/** entirely (vitest.config.ts).
//   2. Even under vitest.integration.config.ts, every suite is gated on LIVE — true only
//      when RUN_LIVE=1 AND the selected host resolves to a real FOUNDRY_URL. Otherwise each
//      suite skips, so `npm run test:integration` is safe to run offline (it just reports skips).
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
  hostConfigProblem,
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

/** The host this run targets (process.env picks it, exactly as for the server and the scripts). */
const HOST_CFG = resolveHostConfig(ENV, hostKindFromEnv(process.env));
const CONFIG_PROBLEM = hostConfigProblem(HOST_CFG);
const OPTED_IN = process.env.RUN_LIVE === '1' || process.env.RUN_LIVE === 'true';

/** Live suites run only when explicitly opted in (RUN_LIVE) AND the host has a real URL. */
export const LIVE = OPTED_IN && !CONFIG_PROBLEM;

if (OPTED_IN && CONFIG_PROBLEM) {
  console.warn(`[integration] RUN_LIVE is set but the live suites will skip: ${CONFIG_PROBLEM}`);
}

/**
 * The FoundryConfig the bridge needs, derived from .env through the ONE env selector the server
 * and the verify scripts use (src/hosts/env.ts). The Host rides along so the bridge can wake a
 * sleeping box (and the join user's password is forwarded — omitting it once made every live
 * suite fail on "Invalid password provided for <user>").
 */
export function foundryConfig() {
  return { ...bridgeConfigOf(HOST_CFG), host: createHost(HOST_CFG, noopLogger) };
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
