import { z } from 'zod';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envPath, repoRoot } from './env.js';
import { hostConfigProblem, resolveHostConfig, type HostConfig } from './hosts/env.js';
import { parseToolsetsEnv } from './toolsets.js';

// Layer the family's .env (src/env.ts: <repo>/.env, or FVTT_MCP_ENV) UNDER process.env, whatever
// the process's cwd — the server is launched by an MCP client from anywhere. dotenv never
// overrides a variable that is already set, which is what lets a registration's `env` block beat
// the shared file. (If import.meta.url is ever unavailable — an esbuild bundle replacing it with a
// sentinel — envPath throws and we fall back to dotenv's default cwd lookup.)
try {
  dotenv.config({ path: envPath() });
} catch {
  dotenv.config();
}

/**
 * Single source of truth for the version the MCP server advertises: package.json at the repo
 * root. Reading it here keeps the wire version, the npm package version, and the docs from
 * drifting apart. Falls back gracefully if the file can't be read.
 */
function readPackageVersion(): string {
  try {
    const pkgPath = resolve(repoRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const ConfigSchema = z.object({
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  logFormat: z.enum(['json', 'simple']).default('simple'),
  enableFileLogging: z.boolean().default(false),
  logFilePath: z.string().optional(),
  toolResponseMaxChars: z.number().min(256).max(500000).default(20000),
  server: z.object({
    name: z.string().default('foundry-mcp-server'),
    // Default only applies if rawConfig provides nothing; rawConfig reads package.json (see below).
    version: z.string().default('0.0.0'),
  }),
  /**
   * Which toolsets this registration advertises (FOUNDRY_TOOLSETS, comma-separated; empty = all).
   * Validated by the registry against src/toolsets.ts — the single source of truth for the names.
   */
  toolsets: z.array(z.string().min(1)).default([]),
});

export type Config = z.infer<typeof ConfigSchema> & {
  /**
   * Which Foundry this server process targets and everything its host needs — resolved by the ONE
   * env selector (src/hosts/env.ts) from the FOUNDRY_* set; FOUNDRY_HOST (default generic) picks
   * the preset, per MCP-server REGISTRATION (its `env` block, which beats the shared .env).
   */
  host: HostConfig;
  /**
   * Legacy (2.x, host-prefixed) variable names that supplied a value — logged once at startup so
   * an old .env keeps working while saying what to rename.
   */
  notes: string[];
};

const rawConfig = {
  logLevel: process.env.LOG_LEVEL || 'warn',
  logFormat: process.env.LOG_FORMAT || 'simple',
  enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
  logFilePath: process.env.LOG_FILE_PATH,
  toolResponseMaxChars: parseInt(process.env.TOOL_RESPONSE_MAX_CHARS || '20000', 10),
  server: {
    name: process.env.SERVER_NAME || 'foundry-mcp-server',
    version: process.env.SERVER_VERSION || readPackageVersion(),
  },
  toolsets: parseToolsetsEnv(process.env.FOUNDRY_TOOLSETS),
};

const notes: string[] = [];
const host = resolveHostConfig(process.env, undefined, { warn: m => notes.push(m) });

// A config that can never connect is refused HERE, before the server answers anything: an unset
// FOUNDRY_URL used to sit behind the bridge's 600 s cold-boot budget before the first error.
const problem = hostConfigProblem(host);
if (problem) throw new Error(problem);

export const config: Config = {
  ...ConfigSchema.parse(rawConfig),
  host,
  notes,
};
