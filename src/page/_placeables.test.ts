/**
 * The placeable CRUD kernel's scene target: an identifier resolves strictly; none means the
 * world's ACTIVE scene (one per world — a fact, never the bridge's viewed scene); no active
 * scene is an error, not an empty list.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { crudList } from './_placeables.js';
import { resolveTargetScene } from './scenes.js';
import * as drawing from './placeables/drawing.js';
import * as light from './placeables/light.js';
import * as note from './placeables/note.js';
import * as region from './placeables/region.js';
import * as sound from './placeables/sound.js';
import * as tile from './placeables/tile.js';
import * as token from './placeables/token.js';
import * as wall from './placeables/wall.js';

const modules: Record<string, any> = { drawing, light, note, region, sound, tile, token, wall };

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

describe('the scene placeable functions — an unknown key throws', () => {
  // A missing sceneIdentifier means the active scene, so `{ sceneId }` once listed (or wrote) the
  // active scene's placeables as the requested scene's (issue #22).
  const kinds: Array<[string, string, string]> = [
    ['token', 'Tokens', 'place'],
    ['tile', 'Tiles', 'create'],
    ['light', 'Lights', 'create'],
    ['wall', 'Walls', 'create'],
    ['note', 'Notes', 'create'],
    ['region', 'Regions', 'create'],
    ['sound', 'Sounds', 'create'],
    ['drawing', 'Drawings', 'create'],
  ];
  const load = async (file: string) => modules[file];
  const sceneHint = '— use sceneIdentifier (a scene id or exact name; none means the active scene)';

  it.each(
    kinds
  )('listScene%s refuses sceneId, scene, identifier and sceneName', async (file, kind) => {
    stubScenes([cave, crypt], cave);
    const fn = (await load(file))[`listScene${kind}`];
    for (const key of ['sceneId', 'scene', 'identifier', 'sceneName']) {
      expect(() => fn({ [key]: 'sc2' })).toThrow(
        `listScene${kind}: unknown key '${key}' ${sceneHint}`
      );
    }
  });

  it.each(kinds)('the %s list still takes sceneIdentifier, or nothing', async (file, kind) => {
    stubScenes([crypt], cave);
    const fn = (await load(file))[`listScene${kind}`];
    expect(fn({ sceneIdentifier: 'Nowhere' })).toEqual({ found: false, notFound: 'Nowhere' });
    expect(() => fn(undefined)).not.toThrow(/unknown key/);
  });

  it.each(
    kinds
  )('the %s create / update / delete refuse sceneId before writing', async (file, kind, create) => {
    stubScenes([cave, crypt], cave);
    const mod = await load(file);
    const calls: Array<[string, Record<string, unknown>, string]> = [
      [`${create}Scene${kind}`, { items: [{}] }, 'sceneIdentifier, items'],
      [`deleteScene${kind}`, { ids: ['x'] }, 'sceneIdentifier, ids'],
    ];
    if (kind !== 'Tokens')
      calls.push([`updateScene${kind}`, { patches: [{ id: 'x' }] }, 'sceneIdentifier, patches']);
    for (const [name, rest, takes] of calls) {
      await expect(mod[name]({ sceneId: 'sc2', ...rest })).rejects.toThrow(
        `${name}: unknown key 'sceneId' ${sceneHint}; it takes ${takes}`
      );
    }
  });

  it('updateSceneTokens refuses sceneId, and a key that is not the scene is named without the hint', async () => {
    stubScenes([cave, crypt], cave);
    const { updateSceneTokens } = await load('token');
    await expect(updateSceneTokens({ sceneId: 'sc2', tokenIds: ['t'] })).rejects.toThrow(
      `updateSceneTokens: unknown key 'sceneId' ${sceneHint}; it takes sceneIdentifier, tokenIds`
    );
    await expect(updateSceneTokens({ tokenIds: ['t'], rotate: 90 })).rejects.toThrow(
      /^updateSceneTokens: unknown key 'rotate'; it takes sceneIdentifier, tokenIds, actorIds, rotation/
    );
  });

  it('addRegionBehavior refuses sceneId before resolving anything', async () => {
    stubScenes([cave, crypt], cave);
    await expect(
      region.addRegionBehavior({
        sceneId: 'sc2',
        regionIdentifier: 'Door',
        type: 'teleportToken',
      } as any)
    ).rejects.toThrow(
      `addRegionBehavior: unknown key 'sceneId' ${sceneHint}; it takes sceneIdentifier, regionIdentifier`
    );
  });

  it('listSceneWalls also takes doorsOnly', async () => {
    const { listSceneWalls } = await load('wall');
    stubScenes([cave, crypt], cave);
    expect(() => listSceneWalls({ doorsOnly: true, sceneIdentifier: 'Nowhere' })).not.toThrow();
    expect(() => listSceneWalls({ doorsOnly: true, sceneId: 'sc2' })).toThrow(
      `listSceneWalls: unknown key 'sceneId' ${sceneHint}; it takes sceneIdentifier, doorsOnly`
    );
  });
});
