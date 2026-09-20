// The family's .env — where it is and how it is read. One implementation for the server
// (src/config.ts), the scripts (scripts/*.mjs), the live suite (tests/integration/setup.ts) and
// the sibling repos (`import { loadEnv } from 'fvtt-mcp-dnd5e/env'`), which until 3.0 each carried
// their own six-line KEY=value loop — 97 copies in this repo alone, in three variants.
//
// `loadEnv` PARSES; it never touches process.env. The server layers the file under process.env
// itself (config.ts) so an MCP registration's `env` block keeps beating the shared file; a script
// or a sibling hands the parsed map to the host selector (`resolveHostConfig`) or to
// `connectFoundry`, and reads any other key off it directly.

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from './hosts/env.js';

export type { Env } from './hosts/env.js';

/**
 * The repo root — one level up from the compiled `dist/env.js`. Resolving from `import.meta.url`
 * makes it independent of the process's cwd: the server is launched by an MCP client from
 * anywhere, a sibling's tool from its own repo.
 */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Where the .env lives: `FVTT_MCP_ENV` when set (a different file for a CI box, a second
 * checkout), else `<repo>/.env`. The siblings read THIS repo's file — it is the family's one
 * secrets file (design.md §2.6) — so an override here moves it for all of them at once.
 */
export function envPath(processEnv: Env = process.env): string {
  const override = processEnv.FVTT_MCP_ENV?.trim();
  return override ? resolve(override) : resolve(repoRoot(), '.env');
}

/**
 * Parse a .env file into a plain map — `KEY=value` lines, `#` comments, quoted values unquoted
 * (dotenv's grammar, so the file the server reads and the file a script reads agree byte for
 * byte). A missing file is `{}`: every reader treats an absent key as unset and names it.
 */
export function loadEnv(path: string = envPath()): Env {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  return dotenv.parse(text);
}
