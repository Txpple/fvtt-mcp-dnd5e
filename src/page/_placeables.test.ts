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

describe('the scene placeable lists — an unknown key throws', () => {
  // A missing sceneIdentifier means the active scene, so `{ sceneId }` once listed the active
  // scene's placeables as the requested scene's (issue #22).
  const lists: Array<[string, () => Promise<any>]> = [
    ['listSceneTokens', async () => (await import('./placeables/token.js')).listSceneTokens],
    ['listSceneTiles', async () => (await import('./placeables/tile.js')).listSceneTiles],
    ['listSceneLights', async () => (await import('./placeables/light.js')).listSceneLights],
    ['listSceneWalls', async () => (await import('./placeables/wall.js')).listSceneWalls],
    ['listSceneNotes', async () => (await import('./placeables/note.js')).listSceneNotes],
    ['listSceneRegions', async () => (await import('./placeables/region.js')).listSceneRegions],
    ['listSceneSounds', async () => (await import('./placeables/sound.js')).listSceneSounds],
    ['listSceneDrawings', async () => (await import('./placeables/drawing.js')).listSceneDrawings],
  ];

  it.each(lists)('%s refuses sceneId, scene, identifier and sceneName', async (name, load) => {
    stubScenes([cave, crypt], cave);
    const fn = await load();
    for (const key of ['sceneId', 'scene', 'identifier', 'sceneName']) {
      expect(() => fn({ [key]: 'sc2' })).toThrow(
        new RegExp(`^${name}: unknown key ${key}; it takes sceneIdentifier`)
      );
    }
  });

  it.each(lists)('%s still takes sceneIdentifier, or nothing', async (_name, load) => {
    stubScenes(
      [
        {
          ...crypt,
          tokens: [],
          lights: [],
          walls: [],
          notes: [],
          regions: [],
          sounds: [],
          drawings: [],
        },
      ],
      cave
    );
    const fn = await load();
    expect(fn({ sceneIdentifier: 'Nowhere' })).toEqual({ found: false, notFound: 'Nowhere' });
    expect(() => fn(undefined)).not.toThrow(/unknown key/);
  });

  it('listSceneWalls also takes doorsOnly', async () => {
    const { listSceneWalls } = await import('./placeables/wall.js');
    stubScenes([cave, crypt], cave);
    expect(() => listSceneWalls({ doorsOnly: true, sceneIdentifier: 'Nowhere' })).not.toThrow();
    expect(() => listSceneWalls({ doorsOnly: true, sceneId: 'sc2' } as any)).toThrow(
      /unknown key sceneId; it takes sceneIdentifier, doorsOnly/
    );
  });
});
