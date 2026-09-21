/**
 * Unit tests for the PlaceableTools facade — the per-kind CRUD library.
 *
 * These handlers own: zod input parsing (required create fields; update needs one field beyond id;
 * delete needs ids), the exact page-op names + arg SHAPE forwarded across the bridge
 * (create/list/update/deleteScene<Kind> with items/patches/ids), and the output shaping via
 * utils/placeable-format. The consolidated kinds (tiles, lights, walls, drawings) ride ONE tool,
 * manage-placeables, selected by kind × action (src/tools/_union.ts); the rest are still their
 * pre-M8 per-op tools. The page-side kernel + descriptors are unit-tested next to their files and
 * live-verified.
 */

import { describe, it, expect } from 'vitest';
import { MANAGE_PLACEABLES, PlaceableTools } from './index.js';
import { makeLogger, makeFoundry } from '../test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new PlaceableTools({ foundry, logger: makeLogger() });
  /** One manage-placeables call. */
  const manage = (kind: string, action: string, args: Record<string, unknown> = {}) =>
    tools.handle(MANAGE_PLACEABLES, { kind, action, ...args });
  return { tools, calls, foundry, manage };
}

describe('PlaceableTools.getToolDefinitions', () => {
  it('exposes the COMPLETE placeable library: manage-placeables (5 kinds × 4 actions) + the pre-M8 kinds', () => {
    const { tools } = build();
    const defs = tools.getToolDefinitions();
    const names = defs.map(t => t.name).sort();
    expect(names).toEqual(
      [
        MANAGE_PLACEABLES,
        // Token (place/update bespoke/delete + list)
        'list-tokens',
        'place-tokens',
        'update-token',
        'delete-tokens',
        // Note (pins)
        'create-scene-notes',
        'list-notes',
        'update-note',
        'delete-note',
        // Region + teleporter special ops
        'create-region',
        'list-regions',
        'update-region',
        'delete-region',
        'create-teleporter',
        'add-region-behavior',
        'remap-teleporters',
      ].sort()
    );
    const union = defs.find(d => d.name === MANAGE_PLACEABLES)!.inputSchema as any;
    expect(union.properties.kind.enum).toEqual(['tiles', 'lights', 'walls', 'drawings', 'sounds']);
    expect(union.properties.action.enum).toEqual(['create', 'list', 'update', 'delete']);
    // the shared target leaf is described once, at the root; the members carry it bare
    expect(union.properties.sceneIdentifier.description).toMatch(/^Scene id or exact name/);
    expect(
      union.anyOf.map((m: any) => `${m.properties.kind.const}/${m.properties.action.const}`)
    ).toEqual(
      ['tiles', 'lights', 'walls', 'drawings', 'sounds'].flatMap(k =>
        ['create', 'list', 'update', 'delete'].map(a => `${k}/${a}`)
      )
    );
    for (const m of union.anyOf) {
      expect(m.description.length).toBeGreaterThan(10);
      expect(m.additionalProperties).toBe(false);
      expect(m.properties.sceneIdentifier).toEqual({ type: 'string' });
      expect(m.required.slice(0, 2)).toEqual(['kind', 'action']);
    }
  });

  it('every definition has an object inputSchema and a dispatchable handler', async () => {
    const { tools } = build({});
    for (const def of tools.getToolDefinitions()) {
      expect((def.inputSchema as any).type).toBe('object');
      expect(typeof (tools as any).handlers[def.name]).toBe('function');
    }
  });
});

describe('manage-placeables — tiles', () => {
  it('create forwards {sceneIdentifier, items} and formats the created ids', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      created: 1,
      items: [{ id: 'tileA', name: 'Blood Splatter' }],
    });
    const out = await manage('tiles', 'create', {
      sceneIdentifier: 'Cave',
      items: [{ src: 'worlds/w/props/blood.png', x: 100, y: 200, width: 280, height: 320 }],
    });
    expect(calls[0][0]).toBe('createSceneTiles');
    expect(calls[0][1]).toEqual({
      sceneIdentifier: 'Cave',
      items: [{ src: 'worlds/w/props/blood.png', x: 100, y: 200, width: 280, height: 320 }],
    });
    expect(out).toContain('Created 1 tile(s) on "Cave" (sc1)');
    expect(out).toContain('tileA — Blood Splatter');
  });

  it('create surfaces per-tile errors + warnings from the kernel result', async () => {
    const { manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      created: 0,
      errors: ['Tile 0: src (texture path) is required'],
      warnings: ['Supplied src "x.png" was not found on the server — ...'],
    });
    const out = await manage('tiles', 'create', {
      sceneIdentifier: 'Cave',
      items: [{ src: 'x.png', x: 0, y: 0, width: 10, height: 10 }],
    });
    expect(out).toContain('Created 0 tile(s)');
    expect(out).toContain('⚠ Tile 0: src (texture path) is required');
    expect(out).toContain('1 warning(s)');
  });

  it('create reports scene-not-found and rejects invalid input', async () => {
    const { manage } = build({ success: true, created: 0, notFound: 'Nowhere' });
    await expect(
      manage('tiles', 'create', {
        sceneIdentifier: 'Nowhere',
        items: [{ src: 'x.png', x: 0, y: 0, width: 10, height: 10 }],
      })
    ).rejects.toThrow('Scene not found: "Nowhere". No tiles created.');
    await expect(
      manage('tiles', 'create', { sceneIdentifier: 'Cave', items: [{ src: 'x.png', x: 0, y: 0 }] })
    ).rejects.toThrow();
    await expect(
      manage('tiles', 'create', { sceneIdentifier: 'Cave', items: [] })
    ).rejects.toThrow();
  });

  it('list renders one line per tile under a header with the column order, and reports a missing scene', async () => {
    const result = {
      found: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      sceneActive: true,
      count: 2,
      items: [
        { id: 't1', x: 0, y: 0, width: 100, height: 100, hidden: false, src: 'a.png', scaleX: 1 },
        {
          id: 't2',
          name: 'Big Rock',
          x: 50,
          y: 60,
          width: 100,
          height: 100,
          hidden: true,
          src: 'props/big rock.png',
          scaleX: 1.25,
        },
      ],
    };
    const { calls, manage } = build(result);
    const out = await manage('tiles', 'list', { sceneIdentifier: 'Cave' });
    expect(calls[0][0]).toBe('listSceneTiles');
    expect(calls[0][1]).toEqual({ sceneIdentifier: 'Cave' });
    expect(out).toBe(
      [
        '2 tile(s) on "Cave" (sc1) [active]: id x y width height hidden src scaleX name',
        't1 0 0 100 100 false a.png 1 -',
        't2 50 60 100 100 true "props/big rock.png" 1.25 "Big Rock"',
      ].join('\n')
    );

    const { manage: m2 } = build({ found: false, notFound: 'Ghost' });
    await expect(m2('tiles', 'list', { sceneIdentifier: 'Ghost' })).rejects.toThrow(
      'Scene not found: "Ghost". No tiles listed.'
    );
    // the active scene by default: no sceneIdentifier forwarded
    const { calls: c3, manage: m3 } = build({
      found: true,
      sceneId: 's',
      sceneName: 'S',
      items: [],
    });
    expect(await m3('tiles', 'list')).toBe('0 tile(s) on "S" (s).');
    expect(c3[0][1]).toEqual({});
  });

  it('update forwards {patches}, reports matched/updated + unresolved ids, rejects an empty patch', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      matched: 1,
      updated: 1,
    });
    const out = await manage('tiles', 'update', {
      sceneIdentifier: 'Cave',
      patches: [{ id: 't1', width: 400, height: 460 }],
    });
    expect(calls[0][0]).toBe('updateSceneTiles');
    expect(calls[0][1]).toEqual({
      sceneIdentifier: 'Cave',
      patches: [{ id: 't1', width: 400, height: 460 }],
    });
    expect(out).toContain('Updated 1 of 1 matched tile(s) on "Cave" (sc1)');

    const { manage: m2 } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      matched: 0,
      updated: 0,
      notFoundIds: ['ghostTile'],
    });
    const out2 = await m2('tiles', 'update', {
      sceneIdentifier: 'Cave',
      patches: [{ id: 'ghostTile', x: 5 }],
    });
    expect(out2).toContain('No tiles matched');
    expect(out2).toContain('not found: ghostTile');

    await expect(
      manage('tiles', 'update', { sceneIdentifier: 'Cave', patches: [{ id: 't1' }] })
    ).rejects.toThrow('Provide at least one field to change besides id');
  });

  it('delete forwards {ids} and reports count + missing ids', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      deleted: 1,
      notFoundIds: ['ghost'],
    });
    const out = await manage('tiles', 'delete', { sceneIdentifier: 'Cave', ids: ['t1', 'ghost'] });
    expect(calls[0][0]).toBe('deleteSceneTiles');
    expect(calls[0][1]).toEqual({ sceneIdentifier: 'Cave', ids: ['t1', 'ghost'] });
    expect(out).toContain('Deleted 1 tile(s) from "Cave" (sc1)');
    expect(out).toContain('1 id(s) not found: ghost');
  });

  it('refuses an unknown kind / action / argument by name, naming what it takes', async () => {
    const { manage, tools } = build();
    await expect(manage('roofs', 'list')).rejects.toThrow(
      'manage-placeables: kind must be one of "tiles", "lights", "walls", "drawings", "sounds" (got "roofs").'
    );
    await expect(manage('tiles', 'move')).rejects.toThrow(
      'manage-placeables: action must be one of "create", "list", "update", "delete" for kind "tiles" (got "move").'
    );
    await expect(tools.handle(MANAGE_PLACEABLES, { action: 'list' })).rejects.toThrow(
      'kind must be one of "tiles", "lights", "walls", "drawings", "sounds" (got nothing)'
    );
    // the old per-kind key is an unknown argument now — refused, never silently dropped
    await expect(
      manage('tiles', 'delete', { sceneIdentifier: 'Cave', tileIds: ['t1'] })
    ).rejects.toThrow(
      'manage-placeables (kind "tiles", action "delete"): unknown argument "tileIds" — it takes: kind, action, sceneIdentifier, ids.'
    );
  });
});

describe('manage-placeables — lights', () => {
  it('create forwards {items}; update {patches}; delete {ids}', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Tavern',
      created: 1,
      matched: 1,
      updated: 1,
      deleted: 2,
      items: [{ id: 'l1' }],
    });
    const out = await manage('lights', 'create', {
      sceneIdentifier: 'Tavern',
      items: [{ x: 100, y: 100, dim: 40, bright: 20, animationType: 'torch' }],
    });
    expect(calls[0][0]).toBe('createSceneLights');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Tavern',
      items: [{ x: 100, y: 100, dim: 40, animationType: 'torch' }],
    });
    expect(out).toContain('Created 1 light(s) on "Tavern" (sc1)');

    await manage('lights', 'update', {
      sceneIdentifier: 'Tavern',
      patches: [{ id: 'l1', dim: 60, animationType: 'flame' }],
    });
    expect(calls[1][0]).toBe('updateSceneLights');
    expect(calls[1][1]).toMatchObject({
      sceneIdentifier: 'Tavern',
      patches: [{ id: 'l1', dim: 60, animationType: 'flame' }],
    });

    const out3 = await manage('lights', 'delete', { sceneIdentifier: 'Tavern', ids: ['a', 'b'] });
    expect(calls[2][0]).toBe('deleteSceneLights');
    expect(calls[2][1]).toMatchObject({ sceneIdentifier: 'Tavern', ids: ['a', 'b'] });
    expect(out3).toContain('Deleted 2 light(s)');
  });

  it('list renders the light columns (a null color / animation as -)', async () => {
    const { manage } = build({
      found: true,
      sceneId: 'sc1',
      sceneName: 'Tavern',
      items: [
        {
          id: 'l1',
          x: 100,
          y: 100,
          rotation: 0,
          hidden: false,
          walls: true,
          vision: false,
          dim: 40,
          bright: 20,
          color: '#fcd674',
          angle: 360,
          animation: null,
        },
      ],
    });
    expect(await manage('lights', 'list', { sceneIdentifier: 'Tavern' })).toBe(
      '1 light(s) on "Tavern" (sc1): id x y rotation hidden walls vision dim bright color angle animation\n' +
        'l1 100 100 0 false true false 40 20 #fcd674 360 -'
    );
  });

  it('rejects a light create missing a center coord and a patch with no field beyond id', async () => {
    const { manage } = build();
    await expect(
      manage('lights', 'create', { sceneIdentifier: 'Tavern', items: [{ x: 100, dim: 40 }] })
    ).rejects.toThrow();
    await expect(
      manage('lights', 'update', { sceneIdentifier: 'Tavern', patches: [{ id: 'l1' }] })
    ).rejects.toThrow();
  });
});

describe('manage-placeables — sounds', () => {
  it('create forwards {items} with the radius + effects fields', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Falls',
      created: 1,
      items: [{ id: 's1', name: 'Waterfall' }],
    });
    const out = await manage('sounds', 'create', {
      sceneIdentifier: 'Falls',
      items: [
        {
          path: 'worlds/w/audio/waterfall.ogg',
          x: 1200,
          y: 900,
          radius: 30,
          repeat: true,
          baseEffect: 'lowpass',
        },
      ],
    });
    expect(calls[0][0]).toBe('createSceneSounds');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Falls',
      items: [{ path: 'worlds/w/audio/waterfall.ogg', radius: 30, repeat: true }],
    });
    expect(out).toContain('Created 1 sound(s) on "Falls" (sc1)');
    expect(out).toContain('s1 — Waterfall');
  });

  it('update / delete forward {patches} / {ids}; create rejects a missing radius', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Falls',
      matched: 1,
      updated: 1,
      deleted: 1,
    });
    await manage('sounds', 'update', {
      sceneIdentifier: 'Falls',
      patches: [{ id: 's1', volume: 0.8, radius: 45 }],
    });
    expect(calls[0][0]).toBe('updateSceneSounds');
    expect(calls[0][1]).toMatchObject({ patches: [{ id: 's1', volume: 0.8, radius: 45 }] });

    await manage('sounds', 'delete', { sceneIdentifier: 'Falls', ids: ['s1'] });
    expect(calls[1][0]).toBe('deleteSceneSounds');
    expect(calls[1][1]).toMatchObject({ ids: ['s1'] });

    await expect(
      manage('sounds', 'create', {
        sceneIdentifier: 'Falls',
        items: [{ path: 'a.ogg', x: 0, y: 0 }],
      })
    ).rejects.toThrow();
  });

  it('list renders the sound columns (a path with a space quoted)', async () => {
    const { manage } = build({
      found: true,
      sceneId: 'sc1',
      sceneName: 'Falls',
      items: [
        {
          id: 's1',
          name: 'Waterfall',
          x: 1200,
          y: 900,
          radius: 30,
          path: 'audio/water fall.ogg',
          volume: 0.5,
          repeat: true,
        },
      ],
    });
    expect(await manage('sounds', 'list', { sceneIdentifier: 'Falls' })).toBe(
      '1 sound(s) on "Falls" (sc1): id name x y radius path volume repeat\n' +
        's1 Waterfall 1200 900 30 "audio/water fall.ogg" 0.5 true'
    );
  });
});

describe('manage-placeables — drawings', () => {
  it('create forwards {items} with shape + style fields', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      created: 1,
      items: [{ id: 'd1' }],
    });
    const out = await manage('drawings', 'create', {
      sceneIdentifier: 'Cave',
      items: [
        {
          x: 400,
          y: 500,
          shapeType: 'rectangle',
          width: 600,
          height: 300,
          text: 'Secret Area',
          hidden: true,
        },
      ],
    });
    expect(calls[0][0]).toBe('createSceneDrawings');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Cave',
      items: [{ shapeType: 'rectangle', width: 600, text: 'Secret Area', hidden: true }],
    });
    expect(out).toContain('Created 1 drawing(s)');
  });

  it('update / delete forward {patches} / {ids}; create rejects a bad shapeType', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      matched: 1,
      updated: 1,
      deleted: 1,
    });
    await manage('drawings', 'update', {
      sceneIdentifier: 'Cave',
      patches: [{ id: 'd1', width: 800, text: '' }],
    });
    expect(calls[0][0]).toBe('updateSceneDrawings');
    expect(calls[0][1]).toMatchObject({ patches: [{ id: 'd1', width: 800, text: '' }] });

    await manage('drawings', 'delete', { sceneIdentifier: 'Cave', ids: ['d1'] });
    expect(calls[1][0]).toBe('deleteSceneDrawings');
    expect(calls[1][1]).toMatchObject({ ids: ['d1'] });

    await expect(
      manage('drawings', 'create', {
        sceneIdentifier: 'Cave',
        items: [{ x: 0, y: 0, shapeType: 'blob' }],
      })
    ).rejects.toThrow();
  });

  it('list renders a text label with spaces quoted and a conditional column as -', async () => {
    const { manage } = build({
      found: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      items: [
        {
          id: 'd1',
          x: 0,
          y: 0,
          shapeType: 'rectangle',
          width: 10,
          height: 10,
          text: 'Secret Area',
          hidden: true,
        },
        { id: 'd2', x: 5, y: 5, shapeType: 'circle', radius: 20, hidden: false },
      ],
    });
    expect(await manage('drawings', 'list', { sceneIdentifier: 'Cave' })).toBe(
      '2 drawing(s) on "Cave" (sc1): id x y shapeType width height text hidden radius\n' +
        'd1 0 0 rectangle 10 10 "Secret Area" true -\n' +
        'd2 5 5 circle - - - false 20'
    );
  });
});

describe('manage-placeables — walls', () => {
  it('create forwards {items}; list passes doorsOnly through and renders the segment as one cell', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      created: 1,
      items: [{ id: 'w1' }],
    });
    const out = await manage('walls', 'create', {
      sceneIdentifier: 'Cave',
      items: [{ x0: 1000, y0: 1000, x1: 1100, y1: 1000, door: 1, ds: 0 }],
    });
    expect(calls[0][0]).toBe('createSceneWalls');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Cave',
      items: [{ x0: 1000, door: 1 }],
    });
    expect(out).toContain('Created 1 wall(s)');

    const { calls: c2, manage: m2 } = build({
      found: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      items: [
        {
          id: 'w1',
          c: [1000, 1000, 1100, 1000],
          move: 20,
          sight: 20,
          light: 20,
          sound: 20,
          dir: 0,
          door: 1,
          ds: 0,
        },
        {
          id: 'w2',
          c: [0, 0, 0, 100],
          move: 20,
          sight: 20,
          light: 20,
          sound: 20,
          dir: 0,
          door: 2,
          ds: 2,
          doorSound: 'woodBasic',
        },
      ],
    });
    const listed = await m2('walls', 'list', { sceneIdentifier: 'Cave', doorsOnly: true });
    expect(c2[0][0]).toBe('listSceneWalls');
    expect(c2[0][1]).toEqual({ sceneIdentifier: 'Cave', doorsOnly: true });
    expect(listed).toBe(
      '2 wall(s) on "Cave" (sc1): id c move sight light sound dir door ds doorSound\n' +
        'w1 1000,1000,1100,1000 20 20 20 20 0 1 0 -\n' +
        'w2 0,0,0,100 20 20 20 20 0 2 2 woodBasic'
    );
  });

  it('update forwards {patches} (door state edits); delete {ids}', async () => {
    const { calls, manage } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Cave',
      matched: 2,
      updated: 2,
      deleted: 1,
    });
    const out = await manage('walls', 'update', {
      sceneIdentifier: 'Cave',
      patches: [
        { id: 'w1', door: 2, ds: 2 },
        { id: 'w2', ds: 1 },
      ],
    });
    expect(calls[0][0]).toBe('updateSceneWalls');
    expect(calls[0][1]).toMatchObject({
      patches: [
        { id: 'w1', door: 2, ds: 2 },
        { id: 'w2', ds: 1 },
      ],
    });
    expect(out).toContain('Updated 2 of 2 matched wall(s)');

    await manage('walls', 'delete', { sceneIdentifier: 'Cave', ids: ['w9'] });
    expect(calls[1][0]).toBe('deleteSceneWalls');
    expect(calls[1][1]).toMatchObject({ ids: ['w9'] });
  });
});

describe('token handlers', () => {
  it('list-tokens passes the structured result through', async () => {
    const result = { found: true, sceneId: 'sc1', count: 1, items: [{ id: 'tk1', name: 'Guard' }] };
    const { tools, calls } = build(result);
    const out = await tools.handle('list-tokens', { sceneIdentifier: 'Bridge' });
    expect(calls[0][0]).toBe('listSceneTokens');
    expect(out).toEqual(result);
  });

  it('place-tokens forwards {items} with actor + placement overrides', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Bridge',
      created: 2,
      items: [
        { id: 'tk1', name: 'Hobgoblin Captain' },
        { id: 'tk2', name: 'Hobgoblin Warrior' },
      ],
    });
    const out = await tools.handle('place-tokens', {
      sceneIdentifier: 'Bridge',
      tokens: [
        { actor: 'Hobgoblin Captain', x: 1400, y: 980, disposition: 'hostile' },
        { actor: 'Hobgoblin Warrior', x: 1540, y: 980, hidden: true },
      ],
    });
    expect(calls[0][0]).toBe('placeSceneTokens');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Bridge',
      items: [
        { actor: 'Hobgoblin Captain', x: 1400, disposition: 'hostile' },
        { actor: 'Hobgoblin Warrior', hidden: true },
      ],
    });
    expect(out).toContain('Created 2 token(s) on "Bridge" (sc1)');
    expect(out).toContain('Hobgoblin Captain');
  });

  it('place-tokens surfaces an unresolved-actor error from the kernel', async () => {
    const { tools } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Bridge',
      created: 0,
      errors: ['Token 0: actor not found: "Ghost" (id or exact name)'],
    });
    const out = await tools.handle('place-tokens', {
      sceneIdentifier: 'Bridge',
      tokens: [{ actor: 'Ghost', x: 0, y: 0 }],
    });
    expect(out).toContain('⚠ Token 0: actor not found');
  });

  it('place-tokens rejects a bad disposition at the schema layer', async () => {
    const { tools } = build();
    await expect(
      tools.handle('place-tokens', {
        sceneIdentifier: 'Bridge',
        tokens: [{ actor: 'A', x: 0, y: 0, disposition: 'buddy' }],
      })
    ).rejects.toThrow();
  });

  it('update-token forwards targets + patch and formats matched/updated with the unlock warning', async () => {
    const { tools, calls } = build({
      success: true,
      matched: 2,
      updated: 2,
      sceneId: 'sc1',
      sceneName: 'Bridge',
      tokens: [
        { id: 'tk1', name: 'Dead Guard', rotation: 141, scale: 1, elevation: 0, hidden: false },
        { id: 'tk2', name: 'Dead Guard', rotation: 275, scale: 1, elevation: 0, hidden: false },
      ],
      warnings: ['"Dead Guard" (tk1): auto-unlocked rotation (lockRotation was true, …).'],
    });
    const out = await tools.handle('update-token', {
      sceneIdentifier: 'Bridge',
      actorIds: ['Dead Guard'],
      randomizeRotation: true,
    });
    expect(calls[0][0]).toBe('updateSceneTokens');
    expect(calls[0][1]).toMatchObject({ actorIds: ['Dead Guard'], randomizeRotation: true });
    expect(out).toContain('Updated 2 of 2 matched token(s) on "Bridge" (sc1)');
    expect(out).toContain('auto-unlocked');
  });

  it('update-token requires a target and a field (refines)', async () => {
    const { tools } = build();
    await expect(
      tools.handle('update-token', { sceneIdentifier: 'Bridge', rotation: 90 })
    ).rejects.toThrow();
    await expect(
      tools.handle('update-token', { sceneIdentifier: 'Bridge', tokenIds: ['tk1'] })
    ).rejects.toThrow();
  });

  it('update-token accepts imagePath as the sole change (placed-instance reskin) and echoes the art', async () => {
    const { tools, calls } = build({
      success: true,
      matched: 1,
      updated: 1,
      sceneId: 'sc1',
      sceneName: 'Cave',
      tokens: [
        {
          id: 'tk1',
          name: 'Wisp',
          rotation: 0,
          scale: 1,
          elevation: 0,
          hidden: false,
          src: 'assets/tokens/wisp.webm',
        },
      ],
    });
    const out = await tools.handle('update-token', {
      sceneIdentifier: 'Cave',
      tokenIds: ['tk1'],
      imagePath: 'assets/tokens/wisp.webm',
    });
    expect(calls[0][0]).toBe('updateSceneTokens');
    expect(calls[0][1]).toMatchObject({ tokenIds: ['tk1'], imagePath: 'assets/tokens/wisp.webm' });
    expect(out).toContain('art assets/tokens/wisp.webm');
  });

  it('delete-tokens forwards tokenIds as {ids}', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Bridge',
      deleted: 3,
    });
    const out = await tools.handle('delete-tokens', {
      sceneIdentifier: 'Bridge',
      tokenIds: ['a', 'b', 'c'],
    });
    expect(calls[0][0]).toBe('deleteSceneTokens');
    expect(calls[0][1]).toMatchObject({ ids: ['a', 'b', 'c'] });
    expect(out).toContain('Deleted 3 token(s)');
  });
});

describe('note handlers', () => {
  it('create-scene-notes forwards notes as {items} and surfaces ids + labels', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Iris',
      created: 1,
      items: [{ id: 'note9', text: '1 — Entry' }],
    });
    const out = await tools.handle('create-scene-notes', {
      sceneIdentifier: 'Iris',
      notes: [{ journal: 'Temple Keys', x: 1, y: 2, label: '1 — Entry' }],
    });
    expect(calls[0][0]).toBe('createSceneNotes');
    expect(calls[0][1]).toMatchObject({
      sceneIdentifier: 'Iris',
      items: [{ journal: 'Temple Keys', x: 1, y: 2 }],
    });
    expect(out).toContain('Created 1 map-note pin(s) on "Iris" (sc1)');
    expect(out).toContain('note9 — 1 — Entry');
  });

  it('create-scene-notes surfaces per-note errors, dropped-icon warnings, and a missing scene', async () => {
    const { tools } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Iris',
      created: 1,
      errors: ['Note 1: No journal found matching "Missing" (by id or exact name).'],
      warnings: ['Supplied icon "x/nope.webp" was not found on the server — substituted …'],
    });
    const out = await tools.handle('create-scene-notes', {
      sceneIdentifier: 'Iris',
      notes: [{ journal: 'Temple Keys', x: 1, y: 2, icon: 'x/nope.webp' }],
    });
    expect(out).toContain('⚠ Note 1: No journal found');
    expect(out).toContain('warning(s):');

    const { tools: t2 } = build({ success: true, created: 0, notFound: 'Ghost' });
    await expect(
      t2.handle('create-scene-notes', {
        sceneIdentifier: 'Ghost',
        notes: [{ journal: 'X', x: 1, y: 2 }],
      })
    ).rejects.toThrow('Scene not found: "Ghost". No map-note pins created.');
  });

  it('update-note wraps the single note into a kernel patch and confirms', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Iris',
      matched: 1,
      updated: 1,
    });
    const out = await tools.handle('update-note', {
      sceneIdentifier: 'Iris',
      noteId: 'note9',
      x: 150,
      label: '1 — Antechamber',
    });
    expect(calls[0][0]).toBe('updateSceneNotes');
    expect(calls[0][1]).toEqual({
      sceneIdentifier: 'Iris',
      patches: [{ id: 'note9', x: 150, label: '1 — Antechamber' }],
    });
    expect(out).toContain('Updated note note9 on "Iris" (sc1)');
  });

  it('update-note distinguishes not-found vs matched-but-unchanged (dropped icon)', async () => {
    const { tools } = build({ success: true, matched: 0, updated: 0, notFoundIds: ['note9'] });
    const out = await tools.handle('update-note', {
      sceneIdentifier: 'Iris',
      noteId: 'note9',
      x: 1,
    });
    expect(out).toBe('Note not found: "note9". Nothing changed.');

    const { tools: t2 } = build({
      success: true,
      sceneId: 'sc1',
      sceneName: 'Iris',
      matched: 1,
      updated: 0,
      warnings: ['Supplied icon "bad.webp" was not found …'],
    });
    const out2 = await t2.handle('update-note', {
      sceneIdentifier: 'Iris',
      noteId: 'note9',
      icon: 'bad.webp',
    });
    expect(out2).toContain('No changes applied to note note9');
    expect(out2).toContain('warning(s)');
  });

  it('update-note rejects when no updatable field is supplied (refine)', async () => {
    const { tools } = build();
    await expect(
      tools.handle('update-note', { sceneIdentifier: 'Iris', noteId: 'note9' })
    ).rejects.toThrow();
  });

  it('delete-note forwards noteIds as {ids} and reports missing ids + missing scene', async () => {
    const { tools, calls } = build({
      success: true,
      deleted: 1,
      sceneId: 'sc1',
      sceneName: 'Iris',
      notFoundIds: ['ghost'],
    });
    const out = await tools.handle('delete-note', {
      sceneIdentifier: 'Iris',
      noteIds: ['a', 'ghost'],
    });
    expect(calls[0][0]).toBe('deleteSceneNotes');
    expect(calls[0][1]).toEqual({ sceneIdentifier: 'Iris', ids: ['a', 'ghost'] });
    expect(out).toContain('Deleted 1 note(s) from "Iris" (sc1)');
    expect(out).toContain('1 id(s) not found: ghost');

    const { tools: t2 } = build({ success: true, deleted: 0, notFound: 'Ghost' });
    await expect(
      t2.handle('delete-note', { sceneIdentifier: 'Ghost', noteIds: ['a'] })
    ).rejects.toThrow('Scene not found: "Ghost". Nothing deleted.');
  });
});

describe('region handlers', () => {
  it('create-region forwards regions as {items} and lists created ids', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Cave',
      created: 1,
      items: [{ id: 'r1', name: 'Trap' }],
    });
    const out = await tools.handle('create-region', {
      sceneIdentifier: 'Cave',
      regions: [
        { name: 'Trap', shapes: [{ type: 'rectangle', x: 0, y: 0, width: 140, height: 140 }] },
      ],
    });
    expect(calls[0][0]).toBe('createSceneRegions');
    expect((calls[0][1] as any).items[0].name).toBe('Trap');
    expect(out).toContain('Created 1 region');
    expect(out).toContain('r1 — Trap');
  });

  it('create-region rejects a region with no shapes (schema) and reports a missing scene', async () => {
    const { tools } = build({ success: true, created: 0, notFound: 'Nowhere' });
    await expect(
      tools.handle('create-region', {
        sceneIdentifier: 'Cave',
        regions: [{ name: 'X', shapes: [] }],
      })
    ).rejects.toThrow();
    await expect(
      tools.handle('create-region', {
        sceneIdentifier: 'Nowhere',
        regions: [{ shapes: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }] }],
      })
    ).rejects.toThrow('Scene not found');
  });

  it('update-region wraps the single region into a kernel patch and reports the new shape', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Cave',
      matched: 1,
      updated: 1,
      items: [
        {
          id: 'r1',
          name: 'Trap',
          shapes: [{ type: 'rectangle', x: 700, y: 840, width: 420, height: 140 }],
          behaviors: [],
        },
      ],
    });
    const out = await tools.handle('update-region', {
      sceneIdentifier: 'Cave',
      regionId: 'r1',
      rect: { x: 910, y: 910, widthCells: 3 },
    });
    expect(calls[0][0]).toBe('updateSceneRegions');
    expect(calls[0][1]).toEqual({
      sceneIdentifier: 'Cave',
      patches: [{ id: 'r1', rect: { x: 910, y: 910, widthCells: 3 } }],
    });
    expect(out).toContain('Updated region r1');
    expect(out).toContain('420×140px');
  });

  it('update-region reports region-not-found and rejects an empty patch (refine)', async () => {
    const { tools } = build({ success: true, matched: 0, updated: 0, notFoundIds: ['rZ'] });
    const out = await tools.handle('update-region', {
      sceneIdentifier: 'Cave',
      regionId: 'rZ',
      name: 'x',
    });
    expect(out).toContain('Region not found');
    await expect(
      tools.handle('update-region', { sceneIdentifier: 'Cave', regionId: 'r1' })
    ).rejects.toThrow();
  });

  it('delete-region reports missing ids AND the orphaned-teleporter warning', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Cave',
      deleted: 1,
      notFoundIds: ['rZ'],
      warnings: [
        'teleporter "Teleporter → Cave" on "Bridge" still points at deleted region r1 — …',
      ],
    });
    const out = await tools.handle('delete-region', {
      sceneIdentifier: 'Cave',
      regionIds: ['r1', 'rZ'],
    });
    expect(calls[0][0]).toBe('deleteSceneRegions');
    expect(calls[0][1]).toEqual({ sceneIdentifier: 'Cave', ids: ['r1', 'rZ'] });
    expect(out).toContain('Deleted 1 region');
    expect(out).toContain('rZ');
    expect(out).toContain('still points at deleted region');
  });

  it('list-regions passes the kernel list through and reports a missing scene', async () => {
    const result = {
      found: true,
      sceneId: 's1',
      sceneName: 'Cave',
      count: 1,
      items: [{ id: 'r1', name: 'Trap', shapes: [], behaviors: [] }],
    };
    const { tools } = build(result);
    const out = await tools.handle('list-regions', { sceneIdentifier: 'Cave' });
    expect(out).toEqual(result);

    const { tools: t2 } = build({ found: false, notFound: 'Nope' });
    await expect(t2.handle('list-regions', { sceneIdentifier: 'Nope' })).rejects.toThrow(
      'Scene not found'
    );
  });
});

describe('teleporter special ops', () => {
  it('create-teleporter forwards from/to + defaults and reports both regions', async () => {
    const { tools, calls } = build({
      success: true,
      twoWay: true,
      from: {
        sceneId: 's1',
        sceneName: 'Bridge',
        id: 'rA',
        name: 'A',
        behaviors: [{ type: 'teleportToken', destinations: ['Scene.s2.Region.rB'] }],
      },
      to: {
        sceneId: 's2',
        sceneName: 'Cave',
        id: 'rB',
        name: 'B',
        behaviors: [{ type: 'teleportToken', destinations: ['Scene.s1.Region.rA'] }],
      },
    });
    const out = await tools.handle('create-teleporter', {
      from: { sceneIdentifier: 'Bridge', x: 100, y: 200 },
      to: { sceneIdentifier: 'Cave', x: 300, y: 400 },
    });
    const call = calls.find(([n]) => n === 'createSceneTeleporter');
    expect(call?.[1].from).toEqual({ sceneIdentifier: 'Bridge', x: 100, y: 200 });
    expect(call?.[1].twoWay).toBe(true);
    expect(call?.[1].widthCells).toBe(1);
    expect(call?.[1].snapToGrid).toBe(true);
    // The confirm-before-moving house default: choice:true unless explicitly disabled.
    expect(call?.[1].confirm).toBe(true);
    expect(out).toContain('two-way teleporter');
    expect(out).toContain('rA');
    expect(out).toContain('Scene.s2.Region.rB');
  });

  it('create-teleporter reports one-way (no return link) and scene-not-found', async () => {
    const { tools } = build({
      success: true,
      twoWay: false,
      from: {
        sceneId: 's1',
        sceneName: 'Bridge',
        id: 'rA',
        name: 'A',
        behaviors: [{ type: 'teleportToken', destinations: ['Scene.s2.Region.rB'] }],
      },
      to: { sceneId: 's2', sceneName: 'Cave', id: 'rB', name: 'B', behaviors: [] },
    });
    const out = await tools.handle('create-teleporter', {
      from: { sceneIdentifier: 'Bridge', x: 1, y: 2 },
      to: { sceneIdentifier: 'Cave', x: 3, y: 4 },
      twoWay: false,
    });
    expect(out).toContain('one-way teleporter');
    expect(out).toContain('no return link');

    const { tools: t2 } = build({ success: true, notFound: 'Nowhere' });
    const out2 = await t2.handle('create-teleporter', {
      from: { sceneIdentifier: 'Nowhere', x: 1, y: 2 },
      to: { sceneIdentifier: 'Cave', x: 3, y: 4 },
    });
    expect(out2).toContain('No teleporter created');
  });

  it('remap-teleporters forwards sourceModule and summarizes rewritten/unchanged/unresolved', async () => {
    const { tools, calls } = build({
      success: true,
      sourceModule: 'tom-cartos-temple',
      scenesScanned: 3,
      behaviorsScanned: 6,
      rewritten: 4,
      unchanged: 2,
      unresolved: ['01 Iris: Scene.gone.Region.x'],
    });
    const out = await tools.handle('remap-teleporters', { sourceModule: 'tom-cartos-temple' });
    expect(calls[0][0]).toBe('remapSceneTeleporters');
    expect(calls[0][1]).toEqual({ sourceModule: 'tom-cartos-temple' });
    expect(out).toContain('Teleporter remap for "tom-cartos-temple"');
    expect(out).toContain('scenes scanned: 3');
    expect(out).toContain('teleporters rewritten: 4 (2 already correct)');
    expect(out).toContain('01 Iris: Scene.gone.Region.x');
  });

  it('remap-teleporters rejects an empty sourceModule', async () => {
    const { tools } = build();
    await expect(tools.handle('remap-teleporters', { sourceModule: '' })).rejects.toThrow();
  });

  it('add-region-behavior forwards to addRegionBehavior and reports behavior + destination + warning', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Basement',
      regionId: 'r1',
      regionName: 'WP_TRIG',
      behavior: { id: 'b1', type: 'teleportToken', destinations: ['Scene.s2.Region.r2'] },
      warnings: ['destination region "Pad" contains NO grid-snapped token position…'],
    });
    const out = await tools.handle('add-region-behavior', {
      sceneIdentifier: 'Basement',
      regionIdentifier: 'WP_TRIG',
      type: 'teleportToken',
      teleportTo: { sceneIdentifier: 'Ground', regionIdentifier: 'WP_LAND' },
    });
    const call = calls.find(([n]) => n === 'addRegionBehavior');
    expect(call?.[1]).toMatchObject({
      sceneIdentifier: 'Basement',
      regionIdentifier: 'WP_TRIG',
      type: 'teleportToken',
      teleportTo: { sceneIdentifier: 'Ground', regionIdentifier: 'WP_LAND' },
    });
    expect(out).toContain('Added teleportToken behavior b1');
    expect(out).toContain('→ Scene.s2.Region.r2');
    expect(out).toContain('⚠ destination region "Pad"');
  });

  it('add-region-behavior reports scene / region not-found without changing anything', async () => {
    const { tools } = build({ success: true, notFound: 'Nowhere' });
    const out = await tools.handle('add-region-behavior', {
      sceneIdentifier: 'Nowhere',
      regionIdentifier: 'X',
      type: 'executeMacro',
    });
    expect(out).toContain('Scene not found: "Nowhere"');

    const { tools: t2 } = build({ success: true, notFoundRegion: 'X', sceneName: 'Basement' });
    const out2 = await t2.handle('add-region-behavior', {
      sceneIdentifier: 'Basement',
      regionIdentifier: 'X',
      type: 'executeMacro',
    });
    expect(out2).toContain('Region not found: "X" on "Basement"');
  });

  it('add-region-behavior rejects a missing type', async () => {
    const { tools } = build();
    await expect(
      tools.handle('add-region-behavior', { sceneIdentifier: 'A', regionIdentifier: 'B' })
    ).rejects.toThrow();
  });
});

describe('add-region-behavior — dnd5e 6.0 conveniences', () => {
  it('advertises effects / dispositions / sizes / creatureTypes / terrainTypes / magical and forwards them', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Crypt',
      regionId: 'r1',
      regionName: 'Poison Pool',
      behavior: { id: 'b1', type: 'dnd5e.applyActiveEffect' },
      effects: [
        {
          ref: 'Poisoned',
          uuid: 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa',
          name: 'Poisoned',
          source: 'dnd5e.effects',
        },
      ],
    });
    const def = tools
      .getToolDefinitions()
      .find((d: any) => d.name === 'add-region-behavior') as any;
    const props = def.inputSchema.properties;
    expect(props.effects.items.type).toBe('string');
    expect(props.dispositions.items.enum).toEqual(['hostile', 'neutral', 'friendly']);
    expect(props.terrainTypes.items.enum).toContain('web');
    expect(props.sizes.items.enum).toContain('grg');
    expect(props.creatureTypes.items.enum).toContain('undead');
    const out = await tools.handle('add-region-behavior', {
      sceneIdentifier: 'Crypt',
      regionIdentifier: 'Poison Pool',
      type: 'dnd5e.applyActiveEffect',
      effects: ['Poisoned'],
      dispositions: ['hostile'],
    });
    const call = calls.find(([n]) => n === 'addRegionBehavior');
    expect(call?.[1]).toMatchObject({ effects: ['Poisoned'], dispositions: ['hostile'] });
    expect(out).toContain('Added dnd5e.applyActiveEffect behavior b1');
    expect(out).toContain(
      '✦ effect "Poisoned" (dnd5e.effects) → Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa'
    );
  });

  it('rejects an unknown disposition / terrain type at the contract', async () => {
    const { tools } = build({ success: true });
    await expect(
      tools.handle('add-region-behavior', {
        sceneIdentifier: 'Crypt',
        regionIdentifier: 'X',
        type: 'dnd5e.applyActiveEffect',
        dispositions: ['secret'],
      })
    ).rejects.toThrow();
    await expect(
      tools.handle('add-region-behavior', {
        sceneIdentifier: 'Crypt',
        regionIdentifier: 'X',
        type: 'dnd5e.difficultTerrain',
        terrainTypes: ['lava'],
      })
    ).rejects.toThrow();
  });
});

describe('add-region-behavior — dnd5e.rotateArea conveniences', () => {
  it('advertises `rotate` and forwards it', async () => {
    const { tools, calls } = build({
      success: true,
      sceneId: 's1',
      sceneName: 'Vault',
      regionId: 'r1',
      regionName: 'Turntable',
      behavior: { id: 'b1', type: 'dnd5e.rotateArea' },
    });
    const def = tools
      .getToolDefinitions()
      .find((d: any) => d.name === 'add-region-behavior') as any;
    const rotate = def.inputSchema.properties.rotate.properties;
    expect(rotate.direction.enum).toEqual(['short', 'long', 'cw', 'ccw']);
    expect(rotate.timeMode.enum).toEqual(['fixed', 'variable']);
    const out = await tools.handle('add-region-behavior', {
      sceneIdentifier: 'Vault',
      regionIdentifier: 'Turntable',
      type: 'dnd5e.rotateArea',
      rotate: { positions: [0, 90], tiles: ['t1'], direction: 'cw' },
    });
    expect(calls.find(([n]) => n === 'addRegionBehavior')?.[1].rotate).toEqual({
      positions: [0, 90],
      tiles: ['t1'],
      direction: 'cw',
    });
    expect(out).toContain('Added dnd5e.rotateArea behavior b1');
    await expect(
      tools.handle('add-region-behavior', {
        sceneIdentifier: 'Vault',
        regionIdentifier: 'Turntable',
        type: 'dnd5e.rotateArea',
        rotate: { positions: [720] },
      })
    ).rejects.toThrow();
  });
});
