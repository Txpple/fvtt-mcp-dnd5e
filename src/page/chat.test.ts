/**
 * Unit tests for postItemCard — the page-side write behind post-item-card. A card that could not
 * be posted is a coded refusal (design.md §3), never a `posted: false` answer: no activity on the
 * item, a named activity it does not have, an action its activity cannot roll, a module's veto.
 *
 * `game` is a page global; these tests stand up one actor with its items around it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { postItemCard } from './chat.js';

/** A Foundry-like collection: get by id, getName, find, contents, iteration. */
function collection<T extends { id: string; name?: string; type?: string }>(docs: T[]) {
  return {
    contents: docs,
    get: (id: string) => docs.find(d => d.id === id),
    getName: (name: string) => docs.find(d => d.name === name),
    find: (fn: (d: T) => boolean) => docs.find(fn),
    filter: (fn: (d: T) => boolean) => docs.filter(fn),
    getByType: (type: string) => docs.filter(d => d.type === type),
    [Symbol.iterator]: () => docs[Symbol.iterator](),
  };
}

function stubWorld(items: any[]) {
  const actor = { id: 'a1', name: 'Ankylosaurus', items: collection(items) };
  (globalThis as any).game = { actors: collection([actor]), scenes: [] };
  return actor;
}

afterEach(() => {
  delete (globalThis as any).game;
});

describe('postItemCard: a card it could not post is an error with a code', () => {
  const use = vi.fn(async () => ({ message: { id: 'm1' } }));
  const tail = {
    id: 'i1',
    name: 'Tail',
    type: 'weapon',
    system: { activities: collection([{ id: 'act1', name: 'Swing', type: 'attack', use }]) },
  };

  it('posts the usage card of the first activity', async () => {
    stubWorld([tail]);
    const r = await postItemCard({ actor: 'Ankylosaurus', item: 'Tail' });
    expect(r).toMatchObject({ posted: true, activityType: 'attack', messageId: 'm1' });
  });

  it('an item name two items share is refused, naming them (a card is a write)', async () => {
    stubWorld([tail, { ...tail, id: 'i9' }]);
    const err = await postItemCard({ actor: 'a1', item: 'Tail' }).catch(e => e);
    expect(err.name).toBe('PageError:ambiguous');
    expect(err.message).toMatch(/^Item "Tail" matches 2: "Tail" \(i1\), "Tail" \(i9\)/);
    // the id still names one
    await expect(postItemCard({ actor: 'a1', item: 'i9' })).resolves.toMatchObject({
      posted: true,
    });
  });

  it('an item with no activities is unsupported', async () => {
    stubWorld([{ id: 'i2', name: 'Plain Feature', type: 'feat', system: {} }]);
    const err = await postItemCard({ actor: 'Ankylosaurus', item: 'Plain Feature' }).catch(e => e);
    expect(err.name).toBe('PageError:unsupported');
    expect(err.message).toMatch(/"Plain Feature" on "Ankylosaurus" has no activities/);
    expect(err.message).toMatch(/send-chat-message/);
  });

  it('a named activity the item does not have is not-found, listing its activities', async () => {
    stubWorld([tail]);
    const err = await postItemCard({ actor: 'a1', item: 'Tail', activity: 'Bite' }).catch(e => e);
    expect(err.name).toBe('PageError:not-found');
    expect(err.message).toBe(
      'activity "Bite" not found on "Tail" (its activities: "Swing" (act1))'
    );
  });

  it('a module veto of the use is unsupported: nothing was posted', async () => {
    const vetoed = {
      ...tail,
      system: {
        activities: collection([
          { id: 'act1', name: 'Swing', type: 'attack', use: async () => undefined },
        ]),
      },
    };
    stubWorld([vetoed]);
    const err = await postItemCard({ actor: 'a1', item: 'Tail' }).catch(e => e);
    expect(err.name).toBe('PageError:unsupported');
    expect(err.message).toMatch(/^Nothing was posted: a module hook vetoed the use of "Tail"/);
    expect(err.message).toMatch(/action "attack" \/ "damage"/);
  });

  it('a vetoed attack or damage roll is unsupported', async () => {
    const rolls = { rollAttack: async () => null, rollDamage: async () => [] };
    const item = {
      ...tail,
      system: { activities: collection([{ id: 'act1', name: 'Swing', type: 'attack', ...rolls }]) },
    };
    stubWorld([item]);
    for (const action of ['attack', 'damage'] as const) {
      const err = await postItemCard({ actor: 'a1', item: 'Tail', action }).catch(e => e);
      expect(err.name).toBe('PageError:unsupported');
      expect(err.message).toContain(`vetoed the ${action} roll of "Tail"`);
    }
  });

  it('an action the activity cannot roll is invalid, never a veto', async () => {
    const utility = { id: 'act2', name: 'Signal', type: 'utility', use };
    stubWorld([{ ...tail, system: { activities: collection([utility]) } }]);
    const attack = await postItemCard({ actor: 'a1', item: 'Tail', action: 'attack' }).catch(
      e => e
    );
    expect(attack.name).toBe('PageError:invalid');
    expect(attack.message).toBe('"Tail" has no attack activity: post it with action "use"');
    const damage = await postItemCard({ actor: 'a1', item: 'Tail', action: 'damage' }).catch(
      e => e
    );
    expect(damage.name).toBe('PageError:invalid');
    expect(damage.message).toMatch(/^the utility activity of "Tail" rolls no damage/);
  });
});
