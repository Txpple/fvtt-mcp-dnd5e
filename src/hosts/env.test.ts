/**
 * The ONE env selector (hosts/env.ts): which host a registration targets and what it reads.
 *
 * These pin the contract the server, the verify scripts and the integration suite all share —
 * the FOUNDRY_HOST switch, the FOUNDRY_PROFILE=local alias, and the LOCAL_* → MOLTEN_* fallbacks
 * that let one .env serve every host.
 */

import { describe, it, expect } from 'vitest';
import { hostKindFromEnv, resolveHostConfig } from './env.js';
import { createHost } from './index.js';

const prodEnv = {
  MOLTEN_SERVER_URL: 'https://eoh.moltenhosting.com',
  MOLTEN_MAGIC_URL: 'https://eoh.moltenhosting.com/wake?s=secret',
  MOLTEN_WORLD_ID: 'greenrest',
  MOLTEN_ADMIN_KEY: 'admin-prod',
  MOLTEN_WEBDAV_URL: 'https://eoh.webdav.moltenhosting.com',
  MOLTEN_WEBDAV_PASSWORD: 'dav-secret',
  FOUNDRY_USER: 'MCP-Claude',
  FOUNDRY_PASSWORD: 'join-secret',
  LOCAL_ADMIN_KEY: 'admin-local',
  LOCAL_FOUNDRY_DATA: 'C:/Foundry/Data',
};

const noopLogger: any = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

describe('hostKindFromEnv', () => {
  it('defaults to molten', () => {
    expect(hostKindFromEnv({})).toBe('molten');
  });

  it('reads FOUNDRY_HOST (case-insensitive, trimmed)', () => {
    expect(hostKindFromEnv({ FOUNDRY_HOST: 'local' })).toBe('local');
    expect(hostKindFromEnv({ FOUNDRY_HOST: ' Generic ' })).toBe('generic');
  });

  it('honours the pre-2.2 FOUNDRY_PROFILE=local alias, with FOUNDRY_HOST winning when both are set', () => {
    expect(hostKindFromEnv({ FOUNDRY_PROFILE: 'local' })).toBe('local');
    expect(hostKindFromEnv({ FOUNDRY_PROFILE: 'local', FOUNDRY_HOST: 'molten' })).toBe('molten');
  });

  it('refuses an unknown host by name', () => {
    expect(() => hostKindFromEnv({ FOUNDRY_HOST: 'forge' })).toThrow(/not a known host/);
  });
});

describe('resolveHostConfig — molten', () => {
  it('reads the MOLTEN_* set and the FOUNDRY_USER / FOUNDRY_PASSWORD join pair', () => {
    const cfg = resolveHostConfig(prodEnv);
    expect(cfg.kind).toBe('molten');
    expect(cfg).toMatchObject({
      serverUrl: 'https://eoh.moltenhosting.com',
      user: 'MCP-Claude',
      password: 'join-secret',
      adminKey: 'admin-prod',
      worldId: 'greenrest',
    });
    if (cfg.kind !== 'molten') throw new Error('unreachable');
    expect(cfg.magicUrl).toBe('https://eoh.moltenhosting.com/wake?s=secret');
    expect(cfg.webdavPassword).toBe('dav-secret');
  });

  it('falls back to neutral placeholders and leaves secrets + worldId unset', () => {
    const cfg = resolveHostConfig({});
    if (cfg.kind !== 'molten') throw new Error('unreachable');
    expect(cfg.serverUrl).toBe('https://your-server.moltenhosting.com');
    expect(cfg.worldId).toBeUndefined();
    expect(cfg.magicUrl).toBeUndefined();
    expect(cfg.webdavPassword).toBeUndefined();
  });

  it('treats an empty value as unset', () => {
    const cfg = resolveHostConfig({ ...prodEnv, MOLTEN_WEBDAV_PASSWORD: '  ' });
    if (cfg.kind !== 'molten') throw new Error('unreachable');
    expect(cfg.webdavPassword).toBeUndefined();
  });
});

describe('resolveHostConfig — local', () => {
  it('reads the LOCAL_* overrides and inherits the rest from the prod values', () => {
    const cfg = resolveHostConfig(prodEnv, 'local');
    expect(cfg.kind).toBe('local');
    expect(cfg).toMatchObject({
      serverUrl: 'http://localhost:30000',
      user: 'MCP-Claude', // FOUNDRY_USER (no LOCAL_FOUNDRY_USER)
      password: 'join-secret', // FOUNDRY_PASSWORD
      adminKey: 'admin-local', // LOCAL_ADMIN_KEY — never the prod key
      worldId: 'greenrest', // MOLTEN_WORLD_ID (the sandbox is a byte copy)
    });
    if (cfg.kind !== 'local') throw new Error('unreachable');
    expect(cfg.dataDir).toBe('C:/Foundry/Data');
    expect((cfg as any).magicUrl).toBeUndefined(); // a local box does not sleep
    expect((cfg as any).webdavPassword).toBeUndefined(); // and never dials prod's file plane
  });

  it('lets LOCAL_* override every inherited value', () => {
    const cfg = resolveHostConfig(
      {
        ...prodEnv,
        LOCAL_SERVER_URL: 'http://localhost:30001',
        LOCAL_FOUNDRY_USER: 'Sandbox-GM',
        LOCAL_FOUNDRY_PASSWORD: 'pw',
        LOCAL_WORLD_ID: 'zz-test',
      },
      'local'
    );
    expect(cfg).toMatchObject({
      serverUrl: 'http://localhost:30001',
      user: 'Sandbox-GM',
      password: 'pw',
      worldId: 'zz-test',
    });
  });
});

describe('resolveHostConfig — generic', () => {
  it('reads the FOUNDRY_* set and nothing host-specific', () => {
    const cfg = resolveHostConfig(
      { FOUNDRY_URL: 'https://vtt.example.org', FOUNDRY_ADMIN_KEY: 'k', FOUNDRY_WORLD_ID: 'w' },
      'generic'
    );
    expect(cfg).toEqual({
      kind: 'generic',
      serverUrl: 'https://vtt.example.org',
      user: 'MCP-Claude',
      password: undefined,
      adminKey: 'k',
      worldId: 'w',
    });
  });

  it('rejects a non-URL server value', () => {
    expect(() => resolveHostConfig({ FOUNDRY_URL: 'not a url' }, 'generic')).toThrow();
  });
});

describe('createHost', () => {
  it('molten: wakes through the Magic URL, redacts it, has a WebDAV plane when the password is set', async () => {
    const host = createHost(resolveHostConfig(prodEnv), noopLogger);
    expect(host.kind).toBe('molten');
    expect(host.files?.label).toBe('WebDAV');
    expect(host.worldId).toBe('greenrest');
    const visited: string[] = [];
    await host.wake?.({
      goto: async url => {
        visited.push(url);
      },
      log: { debug() {}, warn() {} },
    });
    expect(visited).toEqual(['https://eoh.moltenhosting.com/wake?s=secret']);
    expect(host.redact('nav failed: https://eoh.moltenhosting.com/wake?s=secret')).toBe(
      'nav failed: <MOLTEN_MAGIC_URL>'
    );
    expect(host.redact('GET /x?s=abc123 failed')).toBe('GET /x?s=<redacted> failed');
    expect(host.publicUrl('worlds/w/a.png')).toBe('https://eoh.moltenhosting.com/worlds/w/a.png');
  });

  it('molten: no password → no plane, and the message names MOLTEN_WEBDAV_PASSWORD', () => {
    const host = createHost(
      resolveHostConfig({ ...prodEnv, MOLTEN_WEBDAV_PASSWORD: '' }),
      noopLogger
    );
    expect(host.files).toBeNull();
    expect(host.filesNotConfigured('upload-asset')).toMatch(/MOLTEN_WEBDAV_PASSWORD/);
  });

  it('molten: a wake nav error is logged, never thrown', async () => {
    const host = createHost(resolveHostConfig(prodEnv), noopLogger);
    const warned: string[] = [];
    await expect(
      host.wake?.({
        goto: async () => {
          throw new Error('net::ERR at https://eoh.moltenhosting.com/wake?s=secret');
        },
        log: { debug() {}, warn: m => warned.push(m) },
      })
    ).resolves.toBeUndefined();
    expect(warned[0]).toContain('<MOLTEN_MAGIC_URL>');
    expect(warned[0]).not.toContain('s=secret');
  });

  it('local: no wake, a filesystem plane over LOCAL_FOUNDRY_DATA, local public URLs', () => {
    const host = createHost(resolveHostConfig(prodEnv, 'local'), noopLogger);
    expect(host.kind).toBe('local');
    expect(host.wake).toBeUndefined();
    expect(host.files?.label).toBe('local filesystem');
    expect(host.publicUrl('worlds/w/a.png')).toBe('http://localhost:30000/worlds/w/a.png');
    expect(host.unreachableHint).toMatch(/local-foundry\.mjs/);
  });

  it('local: no LOCAL_FOUNDRY_DATA → no plane, and the message names it', () => {
    const host = createHost(
      resolveHostConfig({ ...prodEnv, LOCAL_FOUNDRY_DATA: '' }, 'local'),
      noopLogger
    );
    expect(host.files).toBeNull();
    expect(host.filesNotConfigured('list-assets')).toMatch(/LOCAL_FOUNDRY_DATA/);
  });

  it('generic: no wake, no plane, and the message points at the hosts that have one', () => {
    const host = createHost(resolveHostConfig({}, 'generic'), noopLogger);
    expect(host.wake).toBeUndefined();
    expect(host.files).toBeNull();
    expect(host.filesNotConfigured('upload-asset')).toMatch(
      /FOUNDRY_HOST=molten|FOUNDRY_HOST=local/
    );
    expect(host.vars).toEqual({
      serverUrl: 'FOUNDRY_URL',
      adminKey: 'FOUNDRY_ADMIN_KEY',
      worldId: 'FOUNDRY_WORLD_ID',
    });
  });
});
