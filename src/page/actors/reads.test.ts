/**
 * Unit tests for the PURE builders of the actor reads (src/page/actors/reads.ts — F45 split the
 * page-side actor module along its export groups): the spell targeting line and the slot pools the
 * compact sheet prints. The page functions that walk game.* are covered live
 * (scripts/verify-actor-tooling.mjs, the integration reads).
 */

import { describe, it, expect } from 'vitest';
import { extractDnd5eSpellSlots, extractDnd5eSpellTargeting } from './reads.js';

describe('extractDnd5eSpellTargeting', () => {
  it('renders the range units the way the sheet does', () => {
    expect(extractDnd5eSpellTargeting({ range: { units: 'self' } }).range).toBe('Self');
    expect(extractDnd5eSpellTargeting({ range: { units: 'touch' } }).range).toBe('Touch');
    expect(extractDnd5eSpellTargeting({ range: { units: 'spec', special: 'Sight' } }).range).toBe(
      'Sight'
    );
    expect(extractDnd5eSpellTargeting({ range: { value: 120, units: 'ft' } }).range).toBe('120 ft');
    expect(extractDnd5eSpellTargeting({}).range).toBeUndefined();
  });

  it('pluralises creature targets and turns a template into an area', () => {
    expect(extractDnd5eSpellTargeting({ target: { type: 'creature', value: 1 } }).target).toBe(
      '1 creature'
    );
    expect(extractDnd5eSpellTargeting({ target: { type: 'creature', value: 3 } }).target).toBe(
      '3 creatures'
    );
    expect(extractDnd5eSpellTargeting({ target: { type: 'self' } }).target).toBe('self');
    const fireball = extractDnd5eSpellTargeting({
      range: { value: 150, units: 'ft' },
      target: { type: 'point', template: { type: 'sphere', size: 20 } },
    });
    expect(fireball).toEqual({ range: '150 ft', target: 'area', area: '20-ft sphere' });
  });
});

describe('extractDnd5eSpellSlots', () => {
  it('keys the non-empty pools level1..level9 (+ pact) and omits the rest', () => {
    expect(
      extractDnd5eSpellSlots({
        spell1: { value: 2, max: 4 },
        spell2: { value: 0, max: 0 },
        spell3: { value: 0, max: 2 },
        pact: { value: 1, max: 1 },
      })
    ).toEqual({
      level1: { value: 2, max: 4 },
      level3: { value: 0, max: 2 },
      pact: { value: 1, max: 1 },
    });
    expect(extractDnd5eSpellSlots({ spell1: { value: 0, max: 0 } })).toBeUndefined();
    expect(extractDnd5eSpellSlots(undefined)).toBeUndefined();
  });
});
