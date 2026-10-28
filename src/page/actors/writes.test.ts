/**
 * Unit tests for extractDamageProfile — the PURE damage-theme reader create-actor-from-compendium uses
 * to surface a copied creature's attack damage types (rule 7: a reskin must reconcile off-theme damage,
 * not reflavor in prose). The async createActorFromCompendium (live copy) is covered by the integration
 * suite + scripts/verify-reskin-visibility.mjs.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { extractDamageProfile, prepareUuidItemCopy, removeActorItems } from './writes.js';

// Minimal source-item shapes (as toSource(item) yields): a weapon's base damage + activity parts.
const weapon = (name: string, baseTypes: string[]) => ({
  name,
  type: 'weapon',
  system: { damage: { base: { types: baseTypes } } },
});
const saveFeat = (name: string, partTypes: string[]) => ({
  name,
  type: 'feat',
  system: { activities: { a1: { type: 'save', damage: { parts: [{ types: partTypes }] } } } },
});

describe('extractDamageProfile', () => {
  it('reads a weapon base damage type', () => {
    const p = extractDamageProfile([weapon('Radiant Flail', ['radiant'])]);
    expect(p.damageTypes).toEqual(['radiant']);
    expect(p.attacks).toEqual([{ name: 'Radiant Flail', types: ['radiant'] }]);
  });

  it('reads damage types from a feat save activity', () => {
    const p = extractDamageProfile([saveFeat('Holy Nova', ['radiant', 'fire'])]);
    expect(p.damageTypes).toEqual(['fire', 'radiant']); // sorted + unioned
    expect(p.attacks[0]).toEqual({ name: 'Holy Nova', types: ['fire', 'radiant'] });
  });

  it('unions across items and de-dupes/sorts the overall type set', () => {
    const p = extractDamageProfile([
      weapon('Bite', ['piercing']),
      saveFeat('Searing Light', ['radiant']),
      weapon('Smite', ['radiant', 'bludgeoning']),
    ]);
    expect(p.damageTypes).toEqual(['bludgeoning', 'piercing', 'radiant']);
    expect(p.attacks).toHaveLength(3);
  });

  it('ignores non-weapon/feat items and items with no damage', () => {
    const p = extractDamageProfile([
      { name: 'Plate Armor', type: 'equipment', system: { armor: { value: 18 } } },
      { name: 'Magic Resistance', type: 'feat', system: { activities: {} } },
    ]);
    expect(p.damageTypes).toEqual([]);
    expect(p.attacks).toEqual([]);
  });

  it('is safe on empty/garbage input', () => {
    expect(extractDamageProfile([])).toEqual({ damageTypes: [], attacks: [] });
    expect(extractDamageProfile(undefined as any)).toEqual({ damageTypes: [], attacks: [] });
  });
});

// removeActorItems (remove-from-actor): an item name several items share is refused before
// anything is deleted (design.md §3, a write never breaks a tie), never "the first one".
describe('prepareUuidItemCopy — the create-doc for an add-feature items uuid copy', () => {
  const source = {
    _id: 'src00000000000001',
    name: 'Arrow',
    type: 'consumable',
    img: 'icons/arrow.webp',
    system: { quantity: 1, price: { value: 5, denomination: 'cp' } },
  };

  it('drops the source id and applies rename, quantity and a system patch; the source is untouched', () => {
    const { doc, warnings } = prepareUuidItemCopy(
      source,
      { name: 'Silvered Arrow', quantity: 20, system: { price: { value: 1 } } },
      'items[0]'
    );
    expect(warnings).toEqual([]);
    expect(doc._id).toBeUndefined();
    expect(doc.name).toBe('Silvered Arrow');
    expect(doc.img).toBe('icons/arrow.webp');
    expect(doc.system.quantity).toBe(20);
    expect(doc.system.price.value).toBe(1);
    expect(source.system.quantity).toBe(1);
    expect(source._id).toBe('src00000000000001');
  });

  it('a container copy keeps quantity 1 and says so', () => {
    const { doc, warnings } = prepareUuidItemCopy(
      { _id: 'x', name: 'Backpack', type: 'container', system: {} },
      { quantity: 3 },
      'items[1]'
    );
    expect(doc.system.quantity).toBe(1);
    expect(warnings).toEqual([
      'items[1]: quantity 3 ignored — "Backpack" is a container, always one item.',
    ]);
  });

  it('with no overrides the copy is the source minus its id', () => {
    const { doc, warnings } = prepareUuidItemCopy(source, {}, 'items[0]');
    expect(warnings).toEqual([]);
    expect(doc).toEqual({ ...source, _id: undefined, system: source.system });
    expect('_id' in doc).toBe(false);
  });
});

describe('removeActorItems: a name several items share is refused', () => {
  const items = [
    { id: 'i1', name: 'Fortified Familiar', type: 'feat' },
    { id: 'i2', name: 'Fortified Familiar', type: 'feat' },
    { id: 'i3', name: 'Dagger', type: 'weapon' },
    { id: 'i4', name: 'dagger', type: 'weapon' },
    { id: 'i5', name: 'Shield', type: 'equipment' },
  ];
  /** One actor whose items record each delete (`game` is a page global). */
  function stubActor() {
    const docs = [...items];
    const deleted: string[][] = [];
    const actor: any = {
      id: 'a1',
      name: 'Tychon',
      items: {
        get contents() {
          return docs;
        },
        get: (id: string) => docs.find(d => d.id === id),
        getName: (name: string) => docs.find(d => d.name === name),
      },
      getEmbeddedDocument: (_doc: string, id: string) => docs.find(d => d.id === id),
      deleteEmbeddedDocuments: async (_doc: string, ids: string[]) => {
        deleted.push(ids);
        const gone = docs.filter(d => ids.includes(d.id));
        for (const g of gone) docs.splice(docs.indexOf(g), 1);
        return gone;
      },
    };
    (globalThis as any).game = {
      actors: { contents: [actor], get: (id: string) => (id === actor.id ? actor : undefined) },
      scenes: [],
    };
    return deleted;
  }
  afterEach(() => {
    delete (globalThis as any).game;
  });

  it('refuses the tie, naming both, and deletes nothing', async () => {
    const deleted = stubActor();
    const err = await removeActorItems({
      actorIdentifier: 'a1',
      itemNames: ['Shield', 'Fortified Familiar'],
    }).catch(e => e);
    expect(err.name).toBe('PageError:ambiguous');
    expect(err.message).toMatch(
      /^Item "Fortified Familiar" matches 2: "Fortified Familiar" \(i1\), "Fortified Familiar" \(i2\)/
    );
    expect(deleted).toEqual([]);
  });

  it('the exact name answers before the name without case; ids still remove several', async () => {
    const deleted = stubActor();
    const r = await removeActorItems({ actorIdentifier: 'a1', itemNames: ['dagger', 'SHIELD'] });
    expect(r.removed.map(i => i.id)).toEqual(['i4', 'i5']);
    expect(deleted).toEqual([['i4', 'i5']]);
    const both = stubActor();
    await removeActorItems({ actorIdentifier: 'a1', itemIds: ['i1', 'i2'] });
    expect(both).toEqual([['i1', 'i2']]);
  });

  it('a type narrows the name; a name that matches nothing is reported', async () => {
    stubActor();
    const r = await removeActorItems({
      actorIdentifier: 'a1',
      itemNames: ['Fortified Familiar', 'Ghost'],
      type: 'weapon',
    });
    expect(r.removed).toEqual([]);
    expect(r.notFound).toEqual(['Fortified Familiar', 'Ghost']);
  });
});
