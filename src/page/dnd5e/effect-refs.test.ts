import { describe, expect, it } from 'vitest';
import { parseEffectRef } from './effect-refs.js';

// The reference grammar a behavior's `effects` accept. The live lookup (stock pack index, world
// items, fromUuid) is covered by scripts/verify-region-effects.mjs.

describe('parseEffectRef', () => {
  it('classifies an ActiveEffect uuid (compendium or world item)', () => {
    expect(parseEffectRef('Compendium.dnd5e.effects.ActiveEffect.iDKAOo77qtodPd30')).toEqual({
      kind: 'effect-uuid',
      uuid: 'Compendium.dnd5e.effects.ActiveEffect.iDKAOo77qtodPd30',
    });
    expect(parseEffectRef('Item.abcdefghijklmnop.ActiveEffect.ABCDEFGHIJKLMNOP')).toEqual({
      kind: 'effect-uuid',
      uuid: 'Item.abcdefghijklmnop.ActiveEffect.ABCDEFGHIJKLMNOP',
    });
  });

  it('classifies an Item uuid with and without a "#effect name"', () => {
    expect(
      parseEffectRef('Compendium.dnd-players-handbook.spells.Item.phbsplWebxxxxxxx#Web')
    ).toEqual({
      kind: 'item-uuid',
      uuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplWebxxxxxxx',
      effectName: 'Web',
    });
    expect(parseEffectRef('Item.abcdefghijklmnop')).toEqual({
      kind: 'item-uuid',
      uuid: 'Item.abcdefghijklmnop',
    });
  });

  it('treats anything else as a name, with an optional "#effect" for a world item by name', () => {
    expect(parseEffectRef('Poisoned')).toEqual({ kind: 'name', name: 'Poisoned' });
    expect(parseEffectRef('  Fire Resistance ')).toEqual({ kind: 'name', name: 'Fire Resistance' });
    expect(parseEffectRef('Flame Tongue#Fiery')).toEqual({
      kind: 'name',
      name: 'Flame Tongue',
      effectName: 'Fiery',
    });
  });

  it('rejects an empty reference or a "#" with nothing before it', () => {
    expect(() => parseEffectRef('')).toThrow(/name or a uuid/);
    expect(() => parseEffectRef(undefined)).toThrow(/name or a uuid/);
    expect(() => parseEffectRef('#Fiery')).toThrow(/no name before/);
  });
});
