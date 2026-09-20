/**
 * The compendium index warm-up (page side): which packs it builds, that it builds them all at
 * once, that it runs once per session, and that a search arriving mid-build waits for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakePack = {
  metadata: { id: string; type: string; label: string };
  documentName: string;
  indexed: boolean;
  index: Map<string, any>;
  getIndex: ReturnType<typeof vi.fn>;
  resolveIndex?: () => void;
};

/** A pack whose getIndex resolves only when the test says so (to observe concurrency). */
function pack(id: string, type: string, indexed = false, fail = false): FakePack {
  const p: FakePack = {
    metadata: { id, type, label: id },
    documentName: type,
    indexed,
    index: new Map(),
    getIndex: vi.fn(),
  };
  // First call: pending until the test releases it. Later calls settle at once (a pack that
  // failed to index throws again, as Foundry's would; a built one is a no-op).
  p.getIndex.mockImplementation(() => {
    if (p.resolveIndex) {
      return fail ? Promise.reject(new Error(`${id}: index failed`)) : Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      p.resolveIndex = () => {
        if (fail) reject(new Error(`${id}: index failed`));
        else {
          p.indexed = true;
          resolve();
        }
      };
    });
  });
  return p;
}

let packs: FakePack[];

beforeEach(() => {
  vi.resetModules(); // the warm-up promise is per module instance (= per browser session)
  packs = [
    pack('dnd-monster-manual.actors', 'Actor'),
    pack('dnd-dungeon-masters-guide.equipment', 'Item'),
    pack('dnd-players-handbook.spells', 'Item', true), // already indexed at connect
    pack('dnd5e.monsters24', 'Actor'), // SRD — never touched
    pack('tom-cartos.maps', 'Scene'), // Scene packs are never searched
    pack('some-module.tables', 'RollTable', false, true), // fails to index
  ];
  (globalThis as any).game = { packs: new Map(packs.map(p => [p.metadata.id, p])) };
});

afterEach(() => {
  delete (globalThis as any).game;
});

describe('warmCompendiumIndexes', () => {
  it('indexes every searchable cold pack at once, skipping SRD, Scene and warm packs', async () => {
    const { warmCompendiumIndexes } = await import('./compendium.js');
    const done = warmCompendiumIndexes();
    // Every cold, searchable pack has been asked before any answered — all in flight together.
    expect(packs[0].getIndex).toHaveBeenCalledTimes(1);
    expect(packs[1].getIndex).toHaveBeenCalledTimes(1);
    expect(packs[5].getIndex).toHaveBeenCalledTimes(1);
    expect(packs[2].getIndex).not.toHaveBeenCalled(); // warm
    expect(packs[3].getIndex).not.toHaveBeenCalled(); // SRD
    expect(packs[4].getIndex).not.toHaveBeenCalled(); // Scene
    for (const p of [packs[0], packs[1], packs[5]]) p.resolveIndex!();
    const r = await done;
    // A failing pack is skipped, never a rejection; the count says what was attempted.
    expect(r).toMatchObject({ packs: 4, built: 3 });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('runs once per session — a second call returns the same promise', async () => {
    const { warmCompendiumIndexes } = await import('./compendium.js');
    const first = warmCompendiumIndexes();
    const second = warmCompendiumIndexes();
    expect(second).toBe(first);
    expect(packs[0].getIndex).toHaveBeenCalledTimes(1);
    for (const p of [packs[0], packs[1], packs[5]]) p.resolveIndex!();
    await first;
  });

  it('a search that arrives during the warm-up waits for it instead of re-indexing', async () => {
    const { searchCompendium, warmCompendiumIndexes } = await import('./compendium.js');
    packs[0].index.set('mmGoblin', { _id: 'mmGoblin', name: 'Goblin', type: 'npc' });
    const warm = warmCompendiumIndexes();
    let settled = false;
    const search = searchCompendium({ query: 'goblin' }).then(r => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // blocked on the build, not building its own
    for (const p of [packs[0], packs[1], packs[5]]) p.resolveIndex!();
    await warm;
    const r = await search;
    expect(packs[0].getIndex).toHaveBeenCalledTimes(1); // the warm-up's call, not a second one
    expect(r.totalFound).toBe(1);
    expect(r.results[0]).toMatchObject({
      id: 'mmGoblin',
      name: 'Goblin',
      pack: 'dnd-monster-manual.actors',
      uuid: 'Compendium.dnd-monster-manual.actors.Actor.mmGoblin',
    });
  });
});
