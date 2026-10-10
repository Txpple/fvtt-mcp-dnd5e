import dotenv from 'dotenv';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { envFileWarnings, envPath, loadEnv, repoRoot } from './env.js';

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

describe('envFileWarnings — the .env slips that fail far from their cause', () => {
  const warn = (lines: string[], processEnv = {}) => {
    const text = lines.join('\r\n');
    return envFileWarnings(text, dotenv.parse(text), processEnv);
  };

  it('names a key filled in but left commented, without echoing its value', () => {
    const out = warn(['# FOUNDRY_ADMIN_KEY=hunter2', 'FOUNDRY_USER=Assistant DM']);
    expect(out).toEqual([
      'FOUNDRY_ADMIN_KEY has a value but is commented out, so it is unset — delete the "# " to set it.',
    ]);
    expect(out.join('')).not.toContain('hunter2');
  });

  it('stays quiet for an empty commented key, an inline comment, an active key or a process one', () => {
    expect(
      warn(
        [
          '# FOUNDRY_PASSWORD=',
          '# FOUNDRY_WEBDAV_PASSWORD=     # Molten: the File Manager password',
          '# FOUNDRY_WORLD_ID=old-world',
          'FOUNDRY_WORLD_ID=new-world',
          '# FOUNDRY_HOST=local',
          '#   FOUNDRY_URL=http://localhost:30000',
          '# a comment that mentions FOUNDRY_USER=someone in passing',
        ],
        { FOUNDRY_HOST: 'local' }
      )
    ).toEqual([]);
  });

  it('flags a license key pasted as the admin password', () => {
    expect(warn(['FOUNDRY_ADMIN_KEY=ABCD-EF12-3456-7890-WXYZ-0000'])).toEqual([
      "FOUNDRY_ADMIN_KEY looks like a Foundry license key. It is the Administrator Password you type on Foundry's Setup screen, not the license key.",
    ]);
    expect(warn(['FOUNDRY_ADMIN_KEY=correct-horse-battery-staple'])).toEqual([]);
  });
});
