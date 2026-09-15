/**
 * Offline unit tests for the pure parts of apply-condition (src/page/dnd5e/conditions.ts). They lock
 * the dnd5e 6.0.1 facts the live path depends on: CONFIG.statusEffects is an OBJECT keyed by id
 * (5.x was an array — `.map` on it threw), and the exhaustion level lives in `system.level` on the
 * condition effect, not in a flag. The live toggle/sync sequence is covered by the acceptance
 * script (scripts/verify-actor-tooling.mjs).
 */

import { describe, it, expect } from 'vitest';
import { collectStatusIds, readExhaustionLevel, resolveExhaustionLevel } from './conditions.js';

describe('collectStatusIds', () => {
  it('reads the dnd5e 6.0 object form of CONFIG.statusEffects', () => {
    const ids = collectStatusIds({
      DND5E: { conditionTypes: { blinded: {}, exhaustion: {} } },
      statusEffects: {
        blinded: { id: 'blinded' },
        coverHalf: { id: 'coverHalf' },
        concentrating: { id: 'concentrating' },
      },
    });
    expect(ids).toEqual(new Set(['blinded', 'exhaustion', 'coverHalf', 'concentrating']));
  });

  it('still reads the 5.x array form', () => {
    const ids = collectStatusIds({
      DND5E: { conditionTypes: { prone: {} } },
      statusEffects: [{ id: 'prone' }, { id: 'dead' }, {} as any],
    });
    expect(ids).toEqual(new Set(['prone', 'dead']));
  });

  it('tolerates a missing config', () => {
    expect(collectStatusIds({})).toEqual(new Set());
  });
});

describe('resolveExhaustionLevel', () => {
  it('clamps an explicit level to 0–6 and rounds', () => {
    expect(resolveExhaustionLevel(4, true)).toBe(4);
    expect(resolveExhaustionLevel(9, true)).toBe(6);
    expect(resolveExhaustionLevel(-2, true)).toBe(0);
    expect(resolveExhaustionLevel(2.6, true)).toBe(3);
  });

  it('defaults to 1 when applying and 0 when removing', () => {
    expect(resolveExhaustionLevel(undefined, true)).toBe(1);
    expect(resolveExhaustionLevel(undefined, false)).toBe(0);
  });
});

describe('readExhaustionLevel', () => {
  it('reads the 6.0 condition-effect level from system.level', () => {
    expect(readExhaustionLevel({ system: { level: 3 } })).toBe(3);
  });

  it('falls back to the legacy 5.x flag, then to level 1', () => {
    expect(readExhaustionLevel({ flags: { dnd5e: { exhaustionLevel: 2 } } })).toBe(2);
    expect(readExhaustionLevel({ system: {} })).toBe(1);
    expect(readExhaustionLevel(undefined)).toBe(1);
  });
});
