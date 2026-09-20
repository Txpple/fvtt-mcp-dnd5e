/**
 * The placeable CRUD kernel's scene target: an identifier resolves strictly; none means the
 * world's ACTIVE scene (one per world — a fact, never the bridge's viewed scene); no active
 * scene is an error, not an empty list.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { crudList } from './_placeables.js';
import { resolveTargetScene } from './scenes.js';

const cave = { id: 'sc1', name: 'Cave', active: true, tiles: [{ id: 't1', x: 1 }] };
const crypt = { id: 'sc2', name: 'Crypt', active: false, tiles: [] };

function stubScenes(scenes: any[], active: any | null) {
  (globalThis as any).game = {
    scenes: {
      get: (id: string) => scenes.find(s => s.id === id),
      find: (fn: (s: any) => boolean) => scenes.find(fn),
      active,
      // The bridge's own viewed scene — must never be the default.
      current: crypt,
    },
  };
}

const tileDescriptor: any = {
  docName: 'Tile',
  collection: (scene: any) => scene.tiles,
  dump: (d: any) => ({ id: d.id }),
};

afterEach(() => {
  delete (globalThis as any).game;
});

describe('resolveTargetScene', () => {
  it('resolves an identifier strictly (id or exact name), null when it does not resolve', () => {
    stubScenes([cave, crypt], cave);
    expect(resolveTargetScene('sc2')).toBe(crypt);
    expect(resolveTargetScene('Crypt')).toBe(crypt);
    expect(resolveTargetScene('cry')).toBeNull();
  });

  it('defaults to game.scenes.active, not the viewed scene', () => {
    stubScenes([cave, crypt], cave);
    expect(resolveTargetScene(undefined)).toBe(cave);
    expect(resolveTargetScene('')).toBe(cave);
  });

  it('throws when nothing is active', () => {
    stubScenes([cave, crypt], null);
    expect(() => resolveTargetScene(undefined)).toThrow(/No active scene/);
  });
});

describe('crudList — scene default', () => {
  it('lists the active scene when no identifier is given and echoes it', () => {
    stubScenes([cave, crypt], cave);
    expect(crudList(tileDescriptor, {})).toEqual({
      found: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      sceneActive: true,
      count: 1,
      items: [{ id: 't1' }],
    });
  });

  it('reports a miss for an identifier that does not resolve', () => {
    stubScenes([cave, crypt], cave);
    expect(crudList(tileDescriptor, { sceneIdentifier: 'Nowhere' })).toEqual({
      found: false,
      notFound: 'Nowhere',
    });
  });
});
