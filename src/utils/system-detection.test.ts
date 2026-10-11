/**
 * Unit tests for the system + system-VERSION guard every dnd5e authoring tool runs up front.
 *
 * The version gate exists because this build emits native dnd5e 6.0 keys (condition effects with
 * `system.level`, the 6.0 calendar / settings DataModels, activities). A 5.x schema PRUNES those on
 * write — the call reports success and the document silently loses the data — so a sub-6 world is
 * a hard refusal for every caller of assertDnd5e, all of which write.
 */

import { readFileSync } from 'node:fs';
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
  TESTED_DND5E,
  TESTED_FOUNDRY,
  versionBelow,
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

describe('versionBelow: the tested line (get-world-info warns below it, issue #9)', () => {
  it('compares numerically, part by part', () => {
    expect(versionBelow('14.367', TESTED_FOUNDRY)).toBe(true);
    expect(versionBelow('13.351', TESTED_FOUNDRY)).toBe(true);
    expect(versionBelow('14.368', TESTED_FOUNDRY)).toBe(false);
    expect(versionBelow('14.369', TESTED_FOUNDRY)).toBe(false);
    expect(versionBelow('6.0.4', TESTED_DND5E)).toBe(true);
    expect(versionBelow('6.0.5', TESTED_DND5E)).toBe(false);
    expect(versionBelow('6.0.6', TESTED_DND5E)).toBe(false);
    expect(versionBelow('6.0.10', '6.0.9')).toBe(false); // not a string comparison
    expect(versionBelow('6.0.9', '6.0.10')).toBe(true);
    expect(versionBelow('6.1', '6.0.5')).toBe(false); // a missing part is 0
    expect(versionBelow('6', '6.0.5')).toBe(true);
    expect(versionBelow('v6.0.6-beta.1', '6.0.5')).toBe(false);
  });

  it('an unreadable version is never below: no warning is fabricated', () => {
    expect(versionBelow(undefined, TESTED_DND5E)).toBe(false);
    expect(versionBelow(null, TESTED_DND5E)).toBe(false);
    expect(versionBelow('', TESTED_DND5E)).toBe(false);
    expect(versionBelow('unknown', TESTED_DND5E)).toBe(false);
  });

  it("is the README's requirements line", () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(`Foundry ${TESTED_FOUNDRY}+ with dnd5e ${TESTED_DND5E}+`);
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
