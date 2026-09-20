/**
 * The ONE env selector (hosts/env.ts): which host a registration targets and what it reads.
 *
 * These pin the contract the server, the verify scripts and the integration suite all share —
 * the FOUNDRY_* set on every host, `generic` as the default, the placeholder refusal, and the
 * legacy MOLTEN_* / LOCAL_* / FOUNDRY_PROFILE aliases that keep a 2.x .env working (each read
 * only under its own host, each reported once).
 */

import { describe, it, expect } from 'vitest';
import { hostConfigProblem, hostKindFromEnv, PLACEHOLDER_URL, resolveHostConfig } from './env.js';
import { createHost, filePlaneFor } from './index.js';

/** A 2.x-layout .env: the MOLTEN_* prod set plus the LOCAL_* sandbox overrides, side by side. */
const legacyEnv = {
  MOLTEN_SERVER_URL: 'https://box.moltenhosting.com',
  MOLTEN_MAGIC_URL: 'https://box.moltenhosting.com/wake?s=secret',
  MOLTEN_WORLD_ID: 'prod-world',
  MOLTEN_ADMIN_KEY: 'admin-prod',
  MOLTEN_WEBDAV_URL: 'https://box.webdav.moltenhosting.com',
  MOLTEN_WEBDAV_PASSWORD: 'dav-secret',
  FOUNDRY_USER: 'MCP-Claude',
  FOUNDRY_PASSWORD: 'join-secret',
  LOCAL_ADMIN_KEY: 'admin-local',
  LOCAL_FOUNDRY_DATA: 'C:/Foundry/Data',
};

/** The 3.0 contract: FOUNDRY_* only. */
const canonicalEnv = {
  FOUNDRY_URL: 'https://vtt.example.org',
  FOUNDRY_USER: 'Bridge',
  FOUNDRY_PASSWORD: 'pw',
  FOUNDRY_ADMIN_KEY: 'k',
  FOUNDRY_WORLD_ID: 'w',
  FOUNDRY_WAKE_URL: 'https://panel.example.org/wake?s=tok',
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
  it('defaults to generic', () => {
    expect(hostKindFromEnv({})).toBe('generic');
  });

  it('reads FOUNDRY_HOST (case-insensitive, trimmed)', () => {
    expect(hostKindFromEnv({ FOUNDRY_HOST: 'local' })).toBe('local');
    expect(hostKindFromEnv({ FOUNDRY_HOST: ' Molten ' })).toBe('molten');
  });

  it('honours the pre-2.2 FOUNDRY_PROFILE=local alias (reported), with FOUNDRY_HOST winning', () => {
    const notes: string[] = [];
    expect(hostKindFromEnv({ FOUNDRY_PROFILE: 'local' }, m => notes.push(m))).toBe('local');
    expect(notes).toEqual(['FOUNDRY_PROFILE=local is a legacy alias of FOUNDRY_HOST=local.']);
    expect(hostKindFromEnv({ FOUNDRY_PROFILE: 'local', FOUNDRY_HOST: 'molten' })).toBe('molten');
  });

  it('refuses an unknown host by name', () => {
    expect(() => hostKindFromEnv({ FOUNDRY_HOST: 'forge' })).toThrow(/not a known host/);
  });
});

describe('resolveHostConfig — generic (the default)', () => {
  it('reads the whole FOUNDRY_* set', () => {
    const cfg = resolveHostConfig({
      ...canonicalEnv,
      FOUNDRY_DATA_DIR: '/srv/foundry/Data',
      FOUNDRY_WEBDAV_URL: 'https://dav.example.org',
      FOUNDRY_WEBDAV_USER: 'dav',
      FOUNDRY_WEBDAV_PASSWORD: 'dav-pw',
    });
    expect(cfg).toEqual({
      kind: 'generic',
      serverUrl: 'https://vtt.example.org',
      user: 'Bridge',
      password: 'pw',
      adminKey: 'k',
      worldId: 'w',
      wakeUrl: 'https://panel.example.org/wake?s=tok',
      dataDir: '/srv/foundry/Data',
      webdav: { url: 'https://dav.example.org', user: 'dav', password: 'dav-pw' },
    });
  });

  it('with nothing set: the placeholder URL, the default user, no secrets, no world id', () => {
    const cfg = resolveHostConfig({});
    expect(cfg.kind).toBe('generic');
    expect(cfg.serverUrl).toBe(PLACEHOLDER_URL);
    expect(cfg.user).toBe('MCP-Claude');
    expect(cfg.worldId).toBeUndefined();
    expect(cfg.wakeUrl).toBeUndefined();
    expect(cfg.dataDir).toBeUndefined();
    expect(cfg.webdav).toBeUndefined();
  });

  it('the WebDAV plane needs all three variables', () => {
    const cfg = resolveHostConfig({
      ...canonicalEnv,
      FOUNDRY_WEBDAV_URL: 'https://dav.example.org',
      FOUNDRY_WEBDAV_PASSWORD: 'dav-pw',
    });
    expect(cfg.webdav).toBeUndefined();
  });

  it('never reads a MOLTEN_* or LOCAL_* name', () => {
    const notes: string[] = [];
    const cfg = resolveHostConfig(legacyEnv, 'generic', { warn: m => notes.push(m) });
    expect(cfg.serverUrl).toBe(PLACEHOLDER_URL);
    expect(cfg.adminKey).toBeUndefined();
    expect(cfg.dataDir).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it('treats an empty value as unset', () => {
    expect(resolveHostConfig({ FOUNDRY_URL: '  ' }).serverUrl).toBe(PLACEHOLDER_URL);
  });

  it('rejects a non-URL server value', () => {
    expect(() => resolveHostConfig({ FOUNDRY_URL: 'not a url' })).toThrow();
  });
});

describe('resolveHostConfig — molten', () => {
  it('is generic + the WebDAV defaults derived from FOUNDRY_URL, and never a filesystem plane', () => {
    const cfg = resolveHostConfig(
      {
        FOUNDRY_URL: 'https://box.moltenhosting.com',
        FOUNDRY_WEBDAV_PASSWORD: 'dav-secret',
        FOUNDRY_DATA_DIR: 'C:/Foundry/Data',
      },
      'molten'
    );
    expect(cfg).toMatchObject({
      kind: 'molten',
      serverUrl: 'https://box.moltenhosting.com',
      user: 'MCP-Claude',
      webdav: {
        url: 'https://box.webdav.moltenhosting.com',
        user: 'foundry-ftp',
        password: 'dav-secret',
      },
    });
    expect(cfg.dataDir).toBeUndefined();
  });

  it('reads the MOLTEN_* aliases of a 2.x .env, reporting each one', () => {
    const notes: string[] = [];
    const cfg = resolveHostConfig(legacyEnv, 'molten', { warn: m => notes.push(m) });
    expect(cfg).toMatchObject({
      kind: 'molten',
      serverUrl: 'https://box.moltenhosting.com',
      user: 'MCP-Claude',
      password: 'join-secret',
      adminKey: 'admin-prod',
      worldId: 'prod-world',
      wakeUrl: 'https://box.moltenhosting.com/wake?s=secret',
      webdav: {
        url: 'https://box.webdav.moltenhosting.com',
        user: 'foundry-ftp',
        password: 'dav-secret',
      },
    });
    expect(cfg.dataDir).toBeUndefined(); // LOCAL_FOUNDRY_DATA is local's, never molten's
    expect(notes).toEqual([
      'MOLTEN_SERVER_URL is a legacy alias of FOUNDRY_URL — set FOUNDRY_URL instead.',
      'MOLTEN_WEBDAV_URL is a legacy alias of FOUNDRY_WEBDAV_URL — set FOUNDRY_WEBDAV_URL instead.',
      'MOLTEN_WEBDAV_PASSWORD is a legacy alias of FOUNDRY_WEBDAV_PASSWORD — set FOUNDRY_WEBDAV_PASSWORD instead.',
      'MOLTEN_ADMIN_KEY is a legacy alias of FOUNDRY_ADMIN_KEY — set FOUNDRY_ADMIN_KEY instead.',
      'MOLTEN_WORLD_ID is a legacy alias of FOUNDRY_WORLD_ID — set FOUNDRY_WORLD_ID instead.',
      'MOLTEN_MAGIC_URL is a legacy alias of FOUNDRY_WAKE_URL — set FOUNDRY_WAKE_URL instead.',
    ]);
  });

  it('an alias beats the canonical name (one .env, several registrations)', () => {
    const cfg = resolveHostConfig(
      { FOUNDRY_URL: 'http://localhost:30000', MOLTEN_SERVER_URL: 'https://box.moltenhosting.com' },
      'molten'
    );
    expect(cfg.serverUrl).toBe('https://box.moltenhosting.com');
  });

  it('no WebDAV password → no plane; a non-Molten URL derives no WebDAV URL', () => {
    expect(
      resolveHostConfig({ FOUNDRY_URL: 'https://box.moltenhosting.com' }, 'molten').webdav
    ).toBeUndefined();
    expect(
      resolveHostConfig(
        { FOUNDRY_URL: 'https://vtt.example.org', FOUNDRY_WEBDAV_PASSWORD: 'x' },
        'molten'
      ).webdav
    ).toBeUndefined();
  });
});

describe('resolveHostConfig — local', () => {
  it('defaults FOUNDRY_URL to localhost:30000, never wakes, never dials WebDAV', () => {
    const cfg = resolveHostConfig(
      {
        FOUNDRY_ADMIN_KEY: 'k',
        FOUNDRY_DATA_DIR: 'C:/Foundry/Data',
        FOUNDRY_WAKE_URL: 'https://panel.example.org/wake?s=tok',
        FOUNDRY_WEBDAV_URL: 'https://dav.example.org',
        FOUNDRY_WEBDAV_USER: 'dav',
        FOUNDRY_WEBDAV_PASSWORD: 'dav-pw',
      },
      'local'
    );
    expect(cfg).toEqual({
      kind: 'local',
      serverUrl: 'http://localhost:30000',
      user: 'MCP-Claude',
      password: undefined,
      adminKey: 'k',
      worldId: undefined,
      dataDir: 'C:/Foundry/Data',
    });
  });

  it('reads the LOCAL_* aliases of a 2.x .env and nothing from the MOLTEN_* set', () => {
    const notes: string[] = [];
    const cfg = resolveHostConfig(legacyEnv, 'local', { warn: m => notes.push(m) });
    expect(cfg).toMatchObject({
      kind: 'local',
      serverUrl: 'http://localhost:30000',
      user: 'MCP-Claude', // FOUNDRY_USER (no LOCAL_FOUNDRY_USER)
      password: 'join-secret', // FOUNDRY_PASSWORD
      adminKey: 'admin-local', // LOCAL_ADMIN_KEY — never the prod key
      dataDir: 'C:/Foundry/Data',
    });
    expect(cfg.worldId).toBeUndefined(); // MOLTEN_WORLD_ID is not inherited: /setup discovery
    expect(cfg.wakeUrl).toBeUndefined();
    expect(cfg.webdav).toBeUndefined();
    expect(notes).toEqual([
      'LOCAL_ADMIN_KEY is a legacy alias of FOUNDRY_ADMIN_KEY — set FOUNDRY_ADMIN_KEY instead.',
      'LOCAL_FOUNDRY_DATA is a legacy alias of FOUNDRY_DATA_DIR — set FOUNDRY_DATA_DIR instead.',
    ]);
  });

  it('lets every LOCAL_* alias override the canonical value', () => {
    const cfg = resolveHostConfig(
      {
        ...canonicalEnv,
        LOCAL_SERVER_URL: 'http://localhost:30001',
        LOCAL_FOUNDRY_USER: 'Sandbox-GM',
        LOCAL_FOUNDRY_PASSWORD: 'pw2',
        LOCAL_WORLD_ID: 'zz-test',
      },
      'local'
    );
    expect(cfg).toMatchObject({
      serverUrl: 'http://localhost:30001',
      user: 'Sandbox-GM',
      password: 'pw2',
      worldId: 'zz-test',
    });
  });
});

describe('hostConfigProblem — the startup refusal', () => {
  it('refuses the placeholder URL, naming FOUNDRY_URL', () => {
    expect(hostConfigProblem(resolveHostConfig({}))).toMatch(/FOUNDRY_URL is not set/);
    expect(
      hostConfigProblem(
        resolveHostConfig({ FOUNDRY_URL: 'https://your-server.moltenhosting.com' }, 'molten')
      )
    ).toMatch(/FOUNDRY_URL is not set/);
  });

  it('accepts a real URL — including local\u2019s default', () => {
    expect(hostConfigProblem(resolveHostConfig(canonicalEnv))).toBeUndefined();
    expect(hostConfigProblem(resolveHostConfig({}, 'local'))).toBeUndefined();
  });
});

describe('createHost', () => {
  it('molten: wakes through FOUNDRY_WAKE_URL, redacts it, has a WebDAV plane when the password is set', async () => {
    const host = createHost(resolveHostConfig(legacyEnv, 'molten'), noopLogger);
    expect(host.kind).toBe('molten');
    expect(host.label).toBe('Molten Hosting');
    expect(host.files?.label).toBe('WebDAV');
    const visited: string[] = [];
    await host.wake?.({
      goto: async url => {
        visited.push(url);
      },
      log: { debug() {}, warn() {} },
    });
    expect(visited).toEqual(['https://box.moltenhosting.com/wake?s=secret']);
    expect(host.redact('nav failed: https://box.moltenhosting.com/wake?s=secret')).toBe(
      'nav failed: <FOUNDRY_WAKE_URL>'
    );
    expect(host.redact('GET /x?s=abc123 failed')).toBe('GET /x?s=<redacted> failed');
    expect(host.publicUrl('worlds/w/a.png')).toBe('https://box.moltenhosting.com/worlds/w/a.png');
    expect(host.unreachableHint).toMatch(/FOUNDRY_WAKE_URL/);
  });

  it('molten: no password → no direct plane; the tools then get the bridge plane', () => {
    const host = createHost(
      resolveHostConfig({ ...legacyEnv, MOLTEN_WEBDAV_PASSWORD: '' }, 'molten'),
      noopLogger
    );
    expect(host.files).toBeNull();
    expect(filePlaneFor(host, { call: async () => null }).label).toBe('bridge (FilePicker)');
  });

  it('a wake nav error is logged, never thrown', async () => {
    const host = createHost(resolveHostConfig(legacyEnv, 'molten'), noopLogger);
    const warned: string[] = [];
    await expect(
      host.wake?.({
        goto: async () => {
          throw new Error('net::ERR at https://box.moltenhosting.com/wake?s=secret');
        },
        log: { debug() {}, warn: m => warned.push(m) },
      })
    ).resolves.toBeUndefined();
    expect(warned[0]).toContain('<FOUNDRY_WAKE_URL>');
    expect(warned[0]).not.toContain('s=secret');
  });

  it('local: no wake, a filesystem plane over FOUNDRY_DATA_DIR, local public URLs', () => {
    const host = createHost(resolveHostConfig(legacyEnv, 'local'), noopLogger);
    expect(host.kind).toBe('local');
    expect(host.wake).toBeUndefined();
    expect(host.files?.label).toBe('local filesystem');
    expect(host.publicUrl('worlds/w/a.png')).toBe('http://localhost:30000/worlds/w/a.png');
    expect(host.unreachableHint).toMatch(/local-foundry\.mjs/);
  });

  it('local: no FOUNDRY_DATA_DIR → no direct plane (the bridge plane serves)', () => {
    const host = createHost(
      resolveHostConfig({ ...legacyEnv, LOCAL_FOUNDRY_DATA: '' }, 'local'),
      noopLogger
    );
    expect(host.files).toBeNull();
    expect(filePlaneFor(host, { call: async () => null }).label).toBe('bridge (FilePicker)');
  });

  it('generic: a wake when FOUNDRY_WAKE_URL is set, a direct plane from either extra, else the bridge plane', () => {
    const bare = createHost(
      resolveHostConfig({ FOUNDRY_URL: 'https://vtt.example.org' }),
      noopLogger
    );
    expect(bare.wake).toBeUndefined();
    expect(bare.files).toBeNull();
    expect(filePlaneFor(bare, { call: async () => null }).label).toBe('bridge (FilePicker)');
    expect(bare.unreachableHint).toMatch(/FOUNDRY_URL/);

    const woken = createHost(resolveHostConfig(canonicalEnv), noopLogger);
    expect(woken.wake).toBeDefined();
    expect(woken.redact('x https://panel.example.org/wake?s=tok y')).toBe('x <FOUNDRY_WAKE_URL> y');

    const fs = createHost(
      resolveHostConfig({ ...canonicalEnv, FOUNDRY_DATA_DIR: 'C:/Foundry/Data' }),
      noopLogger
    );
    expect(fs.files?.label).toBe('local filesystem');
    const dav = createHost(
      resolveHostConfig({
        ...canonicalEnv,
        FOUNDRY_WEBDAV_URL: 'https://dav.example.org',
        FOUNDRY_WEBDAV_USER: 'dav',
        FOUNDRY_WEBDAV_PASSWORD: 'dav-pw',
      }),
      noopLogger
    );
    expect(dav.files?.label).toBe('WebDAV');
    // A direct plane wins over the bridge plane.
    expect(filePlaneFor(dav, { call: async () => null }).label).toBe('WebDAV');
  });
});
