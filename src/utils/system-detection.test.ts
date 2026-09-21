/**
 * Unit tests for the system + system-VERSION guard every dnd5e authoring tool runs up front.
 *
 * The version gate exists because this build emits native dnd5e 6.0 keys (condition effects with
 * `system.level`, the 6.0 calendar / settings DataModels, activities). A 5.x schema PRUNES those on
 * write — the call reports success and the document silently loses the data — so a sub-6 world is
 * a hard refusal for every caller of assertDnd5e, all of which write.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeFoundry, makeLogger } from '../tools/test-helpers.js';
import {
  assertDnd5e,
  clearSystemCache,
  detectGameSystem,
  dnd5eVersionAtLeast,
  getCachedSystemId,
  getCachedSystemVersion,
  majorVersion,
  REQUIRED_DND5E_MAJOR,
} from './system-detection.js';

function world(info: any) {
  const { foundry, calls } = makeFoundry((name: string) => (name === 'getWorldInfo' ? info : {}));
  return { foundry, calls, logger: makeLogger() };
}

beforeEach(() => clearSystemCache());

describe('majorVersion', () => {
  it('reads the leading integer of a version string', () => {
    expect(majorVersion('6.0.1')).toBe(6);
    expect(majorVersion('5.3.3')).toBe(5);
    expect(majorVersion('v14.367')).toBe(14);
    expect(majorVersion('10.0.0-rc1')).toBe(10);
  });

  it('answers null for anything without a number (never fabricates a refusal)', () => {
    expect(majorVersion(undefined)).toBeNull();
    expect(majorVersion(null)).toBeNull();
    expect(majorVersion('')).toBeNull();
    expect(majorVersion('unknown')).toBeNull();
  });
});

describe('detectGameSystem', () => {
  it('caches the id AND the version, and only calls the bridge once', async () => {
    const { foundry, calls, logger } = world({ system: 'dnd5e', systemVersion: '6.0.1' });
    expect(await detectGameSystem(foundry, logger)).toBe('dnd5e');
    expect(await detectGameSystem(foundry, logger)).toBe('dnd5e');
    expect(calls.filter(([n]) => n === 'getWorldInfo')).toHaveLength(1);
    expect(getCachedSystemId()).toBe('dnd5e');
    expect(getCachedSystemVersion()).toBe('6.0.1');
  });

  it('clearSystemCache clears the version alongside the id', async () => {
    const { foundry, logger } = world({ system: 'dnd5e', systemVersion: '6.0.1' });
    await detectGameSystem(foundry, logger);
    clearSystemCache();
    expect(getCachedSystemId()).toBeNull();
    expect(getCachedSystemVersion()).toBeNull();
  });

  it('a world that does not report a version caches null, not the literal', async () => {
    const { foundry, logger } = world({ system: 'dnd5e' });
    await detectGameSystem(foundry, logger);
    expect(getCachedSystemVersion()).toBeNull();
  });

  it('a non-dnd5e system resolves to other', async () => {
    const { foundry, logger } = world({ system: 'pf2e', systemVersion: '6.0.0' });
    expect(await detectGameSystem(foundry, logger)).toBe('other');
  });
});

describe('assertDnd5e', () => {
  it('passes on dnd5e 6.0.1', async () => {
    const { foundry, logger } = world({ system: 'dnd5e', systemVersion: '6.0.1' });
    await expect(assertDnd5e(foundry, logger, 'manage-calendar')).resolves.toBeUndefined();
  });

  it('refuses a sub-6 dnd5e, naming the tool and the detected version', async () => {
    const { foundry, logger } = world({ system: 'dnd5e', systemVersion: '5.3.3' });
    await expect(assertDnd5e(foundry, logger, 'apply-condition')).rejects.toThrow(
      'apply-condition requires dnd5e 6.0 or later (this build writes native 6.0 keys that a ' +
        '5.3.3 schema prunes on write). Detected dnd5e 5.3.3.'
    );
  });

  it('still refuses the wrong SYSTEM first', async () => {
    const { foundry, logger } = world({ system: 'pf2e', systemVersion: '6.0.1' });
    await expect(assertDnd5e(foundry, logger, 'author-npc')).rejects.toThrow(
      /requires D&D 5e. Detected system: "pf2e"/
    );
  });

  it('does not refuse when the world reports no version at all', async () => {
    const { foundry, logger } = world({ system: 'dnd5e' });
    await expect(assertDnd5e(foundry, logger, 'manage-actors update')).resolves.toBeUndefined();
  });

  it('passes on a FUTURE major', async () => {
    const { foundry, logger } = world({ system: 'dnd5e', systemVersion: '7.1.0' });
    await expect(assertDnd5e(foundry, logger, 'manage-actors update')).resolves.toBeUndefined();
  });
});

describe('dnd5eVersionAtLeast', () => {
  it('compares the cached major, treating an unknown version as satisfying the gate', async () => {
    expect(REQUIRED_DND5E_MAJOR).toBe(6);
    const six = world({ system: 'dnd5e', systemVersion: '6.0.1' });
    await detectGameSystem(six.foundry, six.logger);
    expect(dnd5eVersionAtLeast(6)).toBe(true);
    expect(dnd5eVersionAtLeast(7)).toBe(false);

    clearSystemCache();
    const five = world({ system: 'dnd5e', systemVersion: '5.3.3' });
    await detectGameSystem(five.foundry, five.logger);
    expect(dnd5eVersionAtLeast(6)).toBe(false);
    expect(dnd5eVersionAtLeast(5)).toBe(true);

    clearSystemCache();
    expect(dnd5eVersionAtLeast(6)).toBe(true); // unknown → usable
  });
});
