/**
 * Offline unit tests for the shared dnd5e actor-field mappers (src/page/dnd5e/actor-fields.ts).
 * Pure functions, so they run in Node — they back both NPC creation and actor editing, so a
 * regression here would silently corrupt either path.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSize,
  normalizeSkill,
  normalizeCR,
  formatCR,
  CREATURE_TYPES,
  CONDITION_TYPES,
  ARMOR_CALC,
  AC_DEFAULT_CALCS,
  buildAcUpdate,
  DAMAGE_TYPES,
  ABILITIES,
  SKILL_ABILITY,
  SKILL_KEYS,
} from './actor-fields.js';

describe('normalizeSize', () => {
  it('accepts long names and short codes, case-insensitively', () => {
    expect(normalizeSize('medium')).toBe('med');
    expect(normalizeSize('Large')).toBe('lg');
    expect(normalizeSize('grg')).toBe('grg');
    expect(normalizeSize('GARGANTUAN')).toBe('grg');
  });
  it('returns undefined for an unknown size', () => {
    expect(normalizeSize('colossal')).toBeUndefined();
    expect(normalizeSize('')).toBeUndefined();
  });
});

describe('normalizeSkill', () => {
  it('maps full names and keys to the dnd5e key', () => {
    expect(normalizeSkill('Perception')).toBe('prc');
    expect(normalizeSkill('sleight of hand')).toBe('slt');
    expect(normalizeSkill('prc')).toBe('prc');
  });
  it('returns undefined for an unknown skill', () => {
    expect(normalizeSkill('Underwater Basket Weaving')).toBeUndefined();
  });
});

describe('SKILL_ABILITY', () => {
  it('maps every one of the 18 skill keys to a valid ability', () => {
    expect(Object.keys(SKILL_ABILITY).sort()).toEqual([...SKILL_KEYS].sort());
    for (const ability of Object.values(SKILL_ABILITY)) {
      expect(ABILITIES).toContain(ability);
    }
  });
  it('uses the canonical dnd5e governing abilities', () => {
    expect(SKILL_ABILITY.ath).toBe('str'); // Athletics
    expect(SKILL_ABILITY.per).toBe('cha'); // Persuasion
    expect(SKILL_ABILITY.prc).toBe('wis'); // Perception
    expect(SKILL_ABILITY.arc).toBe('int'); // Arcana
  });
});

describe('normalizeCR / formatCR', () => {
  it('round-trips canonical fractional CRs', () => {
    expect(normalizeCR('1/8')).toBeCloseTo(0.125);
    expect(normalizeCR('5')).toBe(5);
    expect(normalizeCR(0.25)).toBe(0.25);
    expect(formatCR(0.25)).toBe('1/4');
    expect(formatCR(5)).toBe('5');
    expect(formatCR(0)).toBe('0');
  });
});

describe('canonical value sets (live CONFIG.DND5E)', () => {
  it('has the expected sizes/counts', () => {
    expect(CREATURE_TYPES.size).toBe(14);
    expect(CONDITION_TYPES.size).toBe(26);
    expect(ARMOR_CALC.has('natural')).toBe(true);
    expect(ARMOR_CALC.has('armored')).toBe(true); // 6.0 armorClasses keys
    expect(ARMOR_CALC.has('flat')).toBe(false); // 5.x mode, not a calculation
    // 6.0.1 CONFIG.DND5E.damageTypes has 13 keys — the 5.3.3-era 'none'/'vitality' are gone.
    expect(DAMAGE_TYPES.size).toBe(13);
    expect(DAMAGE_TYPES.has('vitality')).toBe(false);
    expect(DAMAGE_TYPES.has('none')).toBe(false);
    expect(ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  });
});

describe('buildAcUpdate (dnd5e 6.0 attributes.ac model)', () => {
  const AC = 'system.attributes.ac';

  it('returns nothing for an absent block', () => {
    expect(buildAcUpdate(undefined)).toEqual({ update: {}, warnings: [] });
  });

  it('override = a fixed AC; null clears it', () => {
    expect(buildAcUpdate({ override: 17 }).update).toEqual({ [`${AC}.override`]: 17 });
    expect(buildAcUpdate({ override: null }).update).toEqual({ [`${AC}.override`]: null });
  });

  it('natural = calcs ["natural"] + flat, clearing a stale override', () => {
    expect(buildAcUpdate({ natural: 15 }).update).toEqual({
      [`${AC}.calcs`]: ['natural'],
      [`${AC}.flat`]: 15,
      [`${AC}.override`]: null,
    });
  });

  it('calcs are written as given and unknown keys warn (not block)', () => {
    const r = buildAcUpdate({ calcs: ['unarmored', 'armored', 'unarmoredMonk', 'bogus'] });
    expect(r.update).toEqual({
      [`${AC}.calcs`]: ['unarmored', 'armored', 'unarmoredMonk', 'bogus'],
    });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/bogus/);
  });

  it('formulas are normalized to the {formula,label,armored,shielded} element', () => {
    expect(buildAcUpdate({ formulas: [{ formula: '13 + @abilities.dex.mod' }] }).update).toEqual({
      [`${AC}.formulas`]: [
        { formula: '13 + @abilities.dex.mod', label: '', armored: null, shielded: null },
      ],
    });
  });

  it('5.x calc "flat" → override (needs flat)', () => {
    expect(buildAcUpdate({ calc: 'flat', flat: 19 }).update).toEqual({ [`${AC}.override`]: 19 });
    const r = buildAcUpdate({ calc: 'flat' });
    expect(r.update).toEqual({});
    expect(r.warnings[0]).toMatch(/needs ac.flat/);
  });

  it('5.x calc "natural" → calcs ["natural"] + flat + override cleared', () => {
    expect(buildAcUpdate({ calc: 'natural', flat: 19 }).update).toEqual({
      [`${AC}.calcs`]: ['natural'],
      [`${AC}.flat`]: 19,
      [`${AC}.override`]: null,
    });
  });

  it('5.x calc "default" → a REAL reset to the default calcs (the system migration would no-op)', () => {
    expect(buildAcUpdate({ calc: 'default' }).update).toEqual({
      [`${AC}.calcs`]: [...AC_DEFAULT_CALCS],
      [`${AC}.override`]: null,
    });
  });

  it('5.x calc "custom" + formula → one custom formula (needs formula)', () => {
    expect(buildAcUpdate({ calc: 'custom', formula: '12 + @abilities.con.mod' }).update).toEqual({
      [`${AC}.formulas`]: [
        { formula: '12 + @abilities.con.mod', label: 'Custom', armored: null, shielded: null },
      ],
    });
    expect(buildAcUpdate({ calc: 'custom' }).warnings[0]).toMatch(/needs ac.formula/);
  });

  it('5.x class calc (mage, unarmoredMonk, …) → default calcs + that key, like _migrateArmorClass', () => {
    expect(buildAcUpdate({ calc: 'unarmoredMonk' }).update).toEqual({
      [`${AC}.calcs`]: ['unarmored', 'armored', 'unarmoredMonk'],
      [`${AC}.override`]: null,
    });
    const r = buildAcUpdate({ calc: 'plate' });
    expect(r.update).toEqual({});
    expect(r.warnings[0]).toMatch(/plate/);
  });

  it('an explicit override in the same call is never clobbered by a legacy alias', () => {
    expect(buildAcUpdate({ calc: 'natural', flat: 14, override: 20 }).update).toEqual({
      [`${AC}.calcs`]: ['natural'],
      [`${AC}.flat`]: 14,
      [`${AC}.override`]: 20,
    });
  });

  it('bare flat / formula (no calc) still land on their 6.0 homes', () => {
    expect(buildAcUpdate({ flat: 13 }).update).toEqual({ [`${AC}.flat`]: 13 });
    expect(buildAcUpdate({ formula: '10 + @abilities.wis.mod' }).update).toEqual({
      [`${AC}.formulas`]: [
        { formula: '10 + @abilities.wis.mod', label: 'Custom', armored: null, shielded: null },
      ],
    });
  });
});
