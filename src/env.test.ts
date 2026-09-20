import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { envPath, loadEnv, repoRoot } from './env.js';

describe('env — the family .env', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('envPath: <repo>/.env by default, FVTT_MCP_ENV when set', () => {
    expect(envPath({})).toBe(resolve(repoRoot(), '.env'));
    expect(envPath({ FVTT_MCP_ENV: 'C:/elsewhere/ci.env' })).toBe(resolve('C:/elsewhere/ci.env'));
    expect(envPath({ FVTT_MCP_ENV: '  ' })).toBe(resolve(repoRoot(), '.env'));
  });

  it('loadEnv parses KEY=value with comments, blanks and quotes — exactly what the loop read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fvtt-env-'));
    dirs.push(dir);
    const file = join(dir, '.env');
    writeFileSync(
      file,
      [
        '# the prod box',
        'FOUNDRY_URL=https://box.moltenhosting.com',
        '',
        'FOUNDRY_USER = MCP-Claude ',
        'FOUNDRY_DATA_DIR=C:\\Users\\you\\AppData\\Local\\FoundryVTT\\Data',
        'FOUNDRY_WAKE_URL=https://box.moltenhosting.com/?s=abc123',
        "FOUNDRY_PASSWORD='p a s s'",
        'EMPTY=',
      ].join('\r\n')
    );
    const env = loadEnv(file);
    expect(env).toEqual({
      FOUNDRY_URL: 'https://box.moltenhosting.com',
      FOUNDRY_USER: 'MCP-Claude',
      FOUNDRY_DATA_DIR: 'C:\\Users\\you\\AppData\\Local\\FoundryVTT\\Data',
      FOUNDRY_WAKE_URL: 'https://box.moltenhosting.com/?s=abc123',
      FOUNDRY_PASSWORD: 'p a s s',
      EMPTY: '',
    });
  });

  it('a missing file is an empty map, never a throw', () => {
    expect(loadEnv(join(tmpdir(), 'no-such-dir-fvtt', '.env'))).toEqual({});
  });
});
