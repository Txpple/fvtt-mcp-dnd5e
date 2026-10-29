/**
 * Unit tests for deleteWorldItems — the page-side delete behind manage-items delete: strict (the
 * exact id, then the exact name), and a name two world items share is refused before anything is
 * deleted (design.md §3, a write never breaks a tie).
 *
 * `game` is a page global; these tests stand up the world items and record each delete.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { deleteWorldItems, worldItemTypes } from './items.js';

function stubWorld(items: Array<{ id: string; name: string; type: string }>) {
  const live = new Map<string, any>();
  const deleted: string[] = [];
  for (const d of items) {
    live.set(d.id, {
      ...d,
      delete: async () => {
        deleted.push(d.id);
        live.delete(d.id);
      },
    });
  }
  (globalThis as any).game = {
    items: {
      get contents() {
        return [...live.values()];
      },
      get: (id: string) => live.get(id),
      getName: (name: string) => [...live.values()].find(l => l.name === name),
    },
  };
  return deleted;
}

afterEach(() => {
  delete (globalThis as any).game;
});

describe('deleteWorldItems: strict, and a shared name is refused', () => {
  const items = [
    { id: 'w1', name: 'Potion of Healing', type: 'consumable' },
    { id: 'w2', name: 'Potion of Healing', type: 'consumable' },
    { id: 'w3', name: 'Rope', type: 'loot' },
  ];

  it('refuses a name two items share, naming them, and deletes nothing', async () => {
    const deleted = stubWorld(items);
    const err = await deleteWorldItems({ identifiers: ['Rope', 'Potion of Healing'] }).catch(
      e => e
    );
    expect(err.name).toBe('PageError:ambiguous');
    expect(err.message).toMatch(
      /matches 2: "Potion of Healing" \(w1\), "Potion of Healing" \(w2\)/
    );
    expect(deleted).toEqual([]);
  });

  it('deletes by id or exact name, never by case or substring', async () => {
    const deleted = stubWorld(items);
    const r = await deleteWorldItems({ identifiers: ['w2', 'Rope', 'rope', 'Potion'] });
    expect(deleted).toEqual(['w2', 'w3']);
    expect(r.deletedCount).toBe(2);
    expect(r.notFound).toEqual(['rope', 'Potion']);
  });
});

describe('worldItemTypes: the system and the active modules', () => {
  it('takes game.documentTypes, a module type included, never "base"', () => {
    (globalThis as any).game = {
      documentTypes: { Item: ['base', 'weapon', 'loot', 'fvtt-mod-clueboard.clue'] },
      system: { documentTypes: { Item: { weapon: {}, loot: {} } } },
    };
    expect(worldItemTypes()).toEqual(['weapon', 'loot', 'fvtt-mod-clueboard.clue']);
  });
  it("falls back to the system's own types, then to null", () => {
    (globalThis as any).game = { system: { documentTypes: { Item: { weapon: {}, loot: {} } } } };
    expect(worldItemTypes()).toEqual(['weapon', 'loot']);
    (globalThis as any).game = {};
    expect(worldItemTypes()).toBeNull();
  });
});
