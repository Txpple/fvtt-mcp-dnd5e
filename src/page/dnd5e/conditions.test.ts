/**
 * Offline unit tests for the pure parts of apply-condition (src/page/dnd5e/conditions.ts). They lock
 * the dnd5e 6.0.1 facts the live path depends on: CONFIG.statusEffects is an OBJECT keyed by id
 * (5.x was an array — `.map` on it threw), and the exhaustion level lives in `system.level` on the
 * condition effect, not in a flag; and when the persisted exhaustion may follow a level change
 * (the derived level's 6.0.4 change). The live toggle/sync sequence is covered by the acceptance
 * script (scripts/verify-actor-tooling.mjs).
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalStatusId,
  canSyncSourceExhaustion,
  collectStatusIds,
  readExhaustionLevel,
  resolveExhaustionLevel,
} from './conditions.js';

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

  it('a REMOVE always resolves to 0, even with an explicit level alongside it', () => {
    // active:false + exhaustionLevel used to resolve to the LEVEL and silently re-apply it.
    expect(resolveExhaustionLevel(4, false)).toBe(0);
    expect(resolveExhaustionLevel(1, false)).toBe(0);
    expect(resolveExhaustionLevel(0, false)).toBe(0);
  });
});

describe('canonicalStatusId', () => {
  const ids = new Set([
    'blinded',
    'exhaustion',
    'coverHalf',
    'coverThreeQuarters',
    'coverTotal',
    'heavilyEncumbered',
  ]);

  it('resolves dnd5e 6.0 camelCase statuses whatever case the caller used', () => {
    expect(canonicalStatusId('coverHalf', ids)).toBe('coverHalf');
    expect(canonicalStatusId('coverhalf', ids)).toBe('coverHalf');
    expect(canonicalStatusId('COVERTOTAL', ids)).toBe('coverTotal');
    expect(canonicalStatusId('  coverThreeQuarters  ', ids)).toBe('coverThreeQuarters');
    expect(canonicalStatusId('heavilyencumbered', ids)).toBe('heavilyEncumbered');
  });

  it('still resolves the plain lower-case ids and rejects unknowns', () => {
    expect(canonicalStatusId('Blinded', ids)).toBe('blinded');
    expect(canonicalStatusId('exhaustion', ids)).toBe('exhaustion');
    expect(canonicalStatusId('confuddled', ids)).toBeNull();
    expect(canonicalStatusId('   ', ids)).toBeNull();
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

describe('canSyncSourceExhaustion', () => {
  it('writes when the derived level already reads the target (active effect; any effect ≥ 6.0.4)', () => {
    expect(canSyncSourceExhaustion(5, 3, 5)).toBe(true);
  });

  it('skips a suppressed effect on ≤ 6.0.3, where the derived level reads 0 — no second level', () => {
    expect(canSyncSourceExhaustion(0, 3, 5)).toBe(false);
  });

  it('skips when the persisted field is already in step, or the derived value is missing', () => {
    expect(canSyncSourceExhaustion(5, 5, 5)).toBe(false);
    expect(canSyncSourceExhaustion(undefined, 3, 5)).toBe(false);
  });
});
