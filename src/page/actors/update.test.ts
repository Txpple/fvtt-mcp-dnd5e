/**
 * Unit tests for updateActor's details group (src/page/actors/update.ts) against a stub `game`:
 * the two biographies are two fields, each written without touching the other. The rest of the
 * page function (the field paths, the NPC-only gating, the Set read-modify-write) is covered live
 * (scripts/verify-actor-tooling.mjs); its missing-key message is in reads.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { updateActor } from './update.js';

/** One NPC in the world, recording what `actor.update()` was handed. */
function stubWorld() {
  const updates: Array<Record<string, unknown>> = [];
  const actor: any = {
    id: 'a1',
    name: 'Osric the Bartender',
    type: 'npc',
    system: { details: { biography: { value: '<p>GM only.</p>', public: '' } } },
    prototypeToken: {},
    update: async (data: Record<string, unknown>) => {
      updates.push(data);
    },
  };
  (globalThis as any).game = {
    actors: { contents: [actor], get: (id: string) => (id === actor.id ? actor : undefined) },
    scenes: [],
  };
  return { actor, updates };
}

afterEach(() => {
  delete (globalThis as any).game;
});

describe('updateActor — the two biographies', () => {
  it('biographyPublic writes system.details.biography.public alone, and applied names it', async () => {
    const { updates } = stubWorld();
    const out = await updateActor({
      actorIdentifier: 'a1',
      biographyPublic: '<p>Keeps the Gilded Tankard.</p>',
    });
    expect(updates).toEqual([
      { 'system.details.biography.public': '<p>Keeps the Gilded Tankard.</p>' },
    ]);
    expect(out).toEqual({
      success: true,
      actor: { id: 'a1', name: 'Osric the Bartender', type: 'npc' },
      applied: ['biographyPublic'],
      warnings: [],
    });
  });

  it('biography and biographyPublic are two fields of the one patch', async () => {
    const { updates } = stubWorld();
    const out = await updateActor({
      actorIdentifier: 'Osric the Bartender',
      biography: '<p>GM: he waters the ale.</p>',
      biographyPublic: '<p>Keeps the Gilded Tankard.</p>',
    });
    expect(updates).toEqual([
      {
        'system.details.biography.value': '<p>GM: he waters the ale.</p>',
        'system.details.biography.public': '<p>Keeps the Gilded Tankard.</p>',
      },
    ]);
    expect(out.applied).toEqual(['biography', 'biographyPublic']);
  });

  it('an empty string clears the public biography (a string, not an absence)', async () => {
    const { updates } = stubWorld();
    await updateActor({ actorIdentifier: 'a1', biographyPublic: '' });
    expect(updates).toEqual([{ 'system.details.biography.public': '' }]);
  });
});
