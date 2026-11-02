/**
 * Offline test for addFeaturesFromCompendium (add-feature, compendium-features mode): the copy it
 * embeds carries its compendium source. dnd5e finds an actor's items by that stamp
 * (`actor.sourcedItems`), so a copied feature whose activity spends another item by its pack uuid
 * (Inspiring Smite and Peerless Athlete spending Channel Divinity) finds it only on a stamped copy.
 * Proven live on the sandbox by the session's compendium-source check; here the globals are stubbed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFeaturesFromCompendium } from './compendium-features.js';

const PACK = 'dnd-players-handbook.classes';

function stubWorld() {
  const created: Array<Record<string, any>> = [];
  const actor = {
    id: 'kartor',
    name: 'Kartor',
    items: [] as any[],
    createEmbeddedDocuments: vi.fn(async (_type: string, data: any[]) =>
      data.map((d, i) => {
        created.push(d);
        return { id: `new${i}`, toObject: () => d };
      })
    ),
  };
  const doc = {
    pack: PACK,
    uuid: `Compendium.${PACK}.Item.phbpdnChannelDiv`,
    toObject: () => ({
      _id: 'phbpdnChannelDiv',
      name: 'Channel Divinity',
      type: 'feat',
      system: {},
      _stats: { compendiumSource: null },
    }),
  };
  const pack = {
    metadata: { type: 'Item', label: "Player's Handbook: Classes" },
    indexed: true,
    index: new Map([['phbpdnChannelDiv', { _id: 'phbpdnChannelDiv', name: 'Channel Divinity' }]]),
    getDocument: vi.fn(async () => doc),
  };
  vi.stubGlobal('game', {
    system: { id: 'dnd5e' },
    actors: { get: (id: string) => (id === actor.id ? actor : undefined) },
    packs: { get: (id: string) => (id === PACK ? pack : undefined) },
  });
  return { created };
}

describe('addFeaturesFromCompendium', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('embeds a copy stamped with its compendium source, with a fresh id', async () => {
    const { created } = stubWorld();
    const res: any = await addFeaturesFromCompendium({
      actorIdentifier: 'kartor',
      featureNames: ['Channel Divinity'],
      compendiumPacks: [PACK],
    });

    expect(res.added.map((a: any) => a.name)).toEqual(['Channel Divinity']);
    expect(created).toHaveLength(1);
    expect(created[0]?._id).toBeUndefined();
    expect(created[0]?._stats?.compendiumSource).toBe(`Compendium.${PACK}.Item.phbpdnChannelDiv`);
  });
});
