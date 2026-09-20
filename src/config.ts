import { z } from 'zod';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveHostConfig, type HostConfig } from './hosts/env.js';
import { parseToolsetsEnv } from './toolsets.js';

// Load .env from the repo root regardless of the process's CWD, so the server picks up its
// config whether it's launched from the repo root or wired into Claude Code from another directory.
// The compiled file lives at <repo>/dist/config.js, so the repo-root .env is one level up.
// (If import.meta.url is ever unavailable — e.g. an esbuild bundle replaces it with a sentinel —
// fileURLToPath throws and we fall back to dotenv's default CWD lookup.)
try {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
} catch {
  dotenv.config();
}

/**
 * Single source of truth for the version the MCP server advertises: package.json (one level up
 * from the compiled dist/config.js). Reading it here keeps the wire version, the npm package
 * version, and the docs from drifting apart. Falls back gracefully if the file can't be read.
 */
function readPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
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
   * env selector (src/hosts/env.ts) from FOUNDRY_HOST (`FOUNDRY_PROFILE=local` still honoured).
   * The host is set per MCP-server REGISTRATION (its `env` block), never in .env, so one .env
   * serves every host.
   */
  host: HostConfig;
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

export const config: Config = {
  ...ConfigSchema.parse(rawConfig),
  host: resolveHostConfig(process.env),
};
