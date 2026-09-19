/**
 * Unit tests for the Region domain: the pure teleport-destination helpers (Set/Array/legacy-singular
 * normalization + the remap state machine — moved here with the code from scenes.ts), the dump, and
 * the descriptor's create/patch mapping (incl. the ctx-powered grid-rect convenience and the
 * NEVER-emit-behaviors rule). The game-touching special ops (createSceneTeleporter, remap) are
 * live-verified by convention.
 */

import { describe, it, expect } from 'vitest';
import {
  APPLY_EFFECT_BEHAVIOR,
  DIFFICULT_TERRAIN_BEHAVIOR,
  ROTATE_AREA_BEHAVIOR,
  dnd5eBehaviorSystem,
  rotateAreaSystem,
  dumpRegion,
  rectContainsSnappedCenter,
  regionDescriptor,
  absoluteTeleportDest,
  remapTeleportDestination,
  teleportDestUuid,
  teleportDestinationsOf,
  teleportPlacementWarning,
} from './region.js';

describe('teleportDestUuid', () => {
  it('builds a v12+ region teleport destination UUID', () => {
    expect(teleportDestUuid('sABC', 'rXYZ')).toBe('Scene.sABC.Region.rXYZ');
  });
});

describe('teleportDestinationsOf', () => {
  it('reads the LIVE `destinations` SET (v14.364 SetField model value)', () => {
    // The teleportToken `destinations` field is a SetField: the live model exposes a Set (an array
    // only via toObject()). dumpRegion/remap read the live doc, so a Set must be handled.
    expect(teleportDestinationsOf({ destinations: new Set(['Scene.a.Region.b']) })).toEqual([
      'Scene.a.Region.b',
    ]);
  });

  it('reads a plain destinations ARRAY (toObject() shape)', () => {
    expect(
      teleportDestinationsOf({
        destinations: ['Scene.a.Region.b', 'Scene.c.Region.d'],
      })
    ).toEqual(['Scene.a.Region.b', 'Scene.c.Region.d']);
  });

  it('falls back to a singular `destination` for pre-migration data', () => {
    expect(teleportDestinationsOf({ destination: 'Scene.a.Region.b' })).toEqual([
      'Scene.a.Region.b',
    ]);
  });

  it('prefers the plural over a stale singular when both exist', () => {
    expect(
      teleportDestinationsOf({
        destinations: ['Scene.new.Region.new'],
        destination: 'Scene.old.Region.old',
      })
    ).toEqual(['Scene.new.Region.new']);
  });

  it('drops empty / non-string entries and returns [] for a non-teleport behavior', () => {
    expect(teleportDestinationsOf({ destinations: ['Scene.a.Region.b', '', 42, null] })).toEqual([
      'Scene.a.Region.b',
    ]);
    expect(teleportDestinationsOf({})).toEqual([]);
    expect(teleportDestinationsOf(undefined)).toEqual([]);
    expect(teleportDestinationsOf({ destination: '' })).toEqual([]);
  });
});

describe('absoluteTeleportDest (14.368 relativized storage)', () => {
  // A behavior on Scene S / Region R — the parents core's buildRelativeUuid climbs.
  const behavior = { id: 'bhv', parent: { id: 'R', parent: { id: 'S' } } };
  it('leaves an absolute destination alone', () => {
    expect(absoluteTeleportDest('Scene.A.Region.X', behavior)).toBe('Scene.A.Region.X');
  });
  it('resolves a sibling region (`..X`) against the owning scene', () => {
    expect(absoluteTeleportDest('..X', behavior)).toBe('Scene.S.Region.X');
  });
  it("resolves another scene's region (`...A.Region.X`)", () => {
    expect(absoluteTeleportDest('...A.Region.X', behavior)).toBe('Scene.A.Region.X');
  });
  it('resolves the typed sibling form (`..Region.X`) and the self form (`..`)', () => {
    expect(absoluteTeleportDest('..Region.X', behavior)).toBe('Scene.S.Region.X');
    expect(absoluteTeleportDest('..', behavior)).toBe('Scene.S.Region.R');
  });
  it('returns an unresolvable relative form unchanged (no parents / unknown shape)', () => {
    expect(absoluteTeleportDest('..X')).toBe('..X');
    expect(absoluteTeleportDest('.Weird.Thing.Deep.Er', behavior)).toBe('.Weird.Thing.Deep.Er');
  });
  it('teleportDestinationsOf normalizes every entry through it', () => {
    expect(
      teleportDestinationsOf(
        { destinations: new Set(['..X', '...A.Region.Y', 'Scene.B.Region.Z']) },
        behavior
      )
    ).toEqual(['Scene.S.Region.X', 'Scene.A.Region.Y', 'Scene.B.Region.Z']);
  });
});

describe('remapTeleportDestination', () => {
  const sceneIdMap = { oldSceneA: 'newSceneA', oldSceneC: 'newSceneC' };
  const regionIdMap = { oldRegB: 'newRegB', oldRegD: 'newRegD' };

  it('rewrites a Scene.X.Region.Y destination using both maps', () => {
    const res = remapTeleportDestination('Scene.oldSceneC.Region.oldRegD', sceneIdMap, regionIdMap);
    expect(res).toEqual({ status: 'rewritten', dest: 'Scene.newSceneC.Region.newRegD' });
  });

  it('reports unchanged when the destination already equals the rewrite', () => {
    const res = remapTeleportDestination(
      'Scene.newSceneC.Region.newRegD',
      { newSceneC: 'newSceneC' },
      { newRegD: 'newRegD' }
    );
    expect(res.status).toBe('unchanged');
  });

  it('is IDEMPOTENT: a destination already holding the new ids (map VALUES) is unchanged, not unresolved', () => {
    const res = remapTeleportDestination('Scene.newSceneC.Region.newRegD', sceneIdMap, regionIdMap);
    expect(res.status).toBe('unchanged');
  });

  it('is no-match for a non-teleport / unset destination', () => {
    expect(remapTeleportDestination(undefined, sceneIdMap, regionIdMap).status).toBe('no-match');
    expect(remapTeleportDestination('', sceneIdMap, regionIdMap).status).toBe('no-match');
    expect(remapTeleportDestination('Macro.abc', sceneIdMap, regionIdMap).status).toBe('no-match');
  });

  it('is unresolved (and reports the original) when the target scene or region was not imported', () => {
    const res = remapTeleportDestination('Scene.ghost.Region.oldRegB', sceneIdMap, regionIdMap);
    expect(res.status).toBe('unresolved');
    expect(res.reason).toBe('Scene.ghost.Region.oldRegB');
    expect(
      remapTeleportDestination('Scene.oldSceneA.Region.gone', sceneIdMap, regionIdMap).status
    ).toBe('unresolved');
  });
});

describe('dumpRegion', () => {
  it('serializes shapes bounds + teleport destinations (live Set tolerated)', () => {
    const region = {
      id: 'r1',
      name: 'Teleporter → Cave',
      shapes: [{ type: 'rectangle', x: 700, y: 840, width: 140, height: 140 }],
      behaviors: {
        contents: [
          { type: 'teleportToken', system: { destinations: new Set(['Scene.s2.Region.r2']) } },
          { type: 'executeMacro', system: {} },
        ],
      },
    };
    expect(dumpRegion(region)).toEqual({
      id: 'r1',
      name: 'Teleporter → Cave',
      shapes: [{ type: 'rectangle', x: 700, y: 840, width: 140, height: 140 }],
      behaviors: [
        { type: 'teleportToken', destinations: ['Scene.s2.Region.r2'] },
        { type: 'executeMacro' },
      ],
    });
  });
});

describe('dumpRegion — live-doc behavior fields', () => {
  it('surfaces behavior id/name/disabled when present (omits them for bare mocks)', () => {
    const region = {
      id: 'r1',
      name: 'X',
      shapes: [],
      behaviors: {
        contents: [
          {
            id: 'b1',
            name: 'Teleport to Cave',
            type: 'teleportToken',
            disabled: true,
            system: { destinations: ['Scene.a.Region.b'] },
          },
        ],
      },
    };
    expect(dumpRegion(region).behaviors).toEqual([
      {
        id: 'b1',
        name: 'Teleport to Cave',
        type: 'teleportToken',
        disabled: true,
        destinations: ['Scene.a.Region.b'],
      },
    ]);
  });
});

describe('rectContainsSnappedCenter', () => {
  // 140px cells anchored at sceneX/sceneY = 840 (the live basement geometry of 2026-07-08).
  const grid = { size: 140, sceneX: 840, sceneY: 840 };

  it('true for a grid-aligned cell — its own center is strictly inside', () => {
    expect(rectContainsSnappedCenter({ x: 980, y: 980, width: 140, height: 140 }, grid)).toBe(true);
  });

  it('false for the half-cell-offset pad — every snapped center lands exactly ON the boundary', () => {
    // The live silent-fail: rect corners at cell centers → MOVE_IN fires, placement finds nothing.
    expect(rectContainsSnappedCenter({ x: 910, y: 910, width: 140, height: 140 }, grid)).toBe(
      false
    );
  });

  it('true for a big misaligned rect that still swallows a full cell center', () => {
    expect(rectContainsSnappedCenter({ x: 910, y: 910, width: 280, height: 280 }, grid)).toBe(true);
  });
});

describe('teleportPlacementWarning', () => {
  const grid = { size: 140, sceneX: 0, sceneY: 0 };

  it('null for an aligned rectangle destination', () => {
    expect(
      teleportPlacementWarning(
        { name: 'Pad', shapes: [{ type: 'rectangle', x: 140, y: 140, width: 140, height: 140 }] },
        grid
      )
    ).toBeNull();
  });

  it('warns on the silent-no-op geometry (no snapped center strictly inside any rect)', () => {
    const w = teleportPlacementWarning(
      { name: 'Pad', shapes: [{ type: 'rectangle', x: 70, y: 70, width: 140, height: 140 }] },
      grid
    );
    expect(w).toMatch(/NO grid-snapped token position/);
    expect(w).toContain('"Pad"');
  });

  it('does not analyze non-rectangle or holed geometry', () => {
    expect(
      teleportPlacementWarning(
        { name: 'Pad', shapes: [{ type: 'polygon', points: [0, 0, 10, 0, 10, 10] }] },
        grid
      )
    ).toBeNull();
    expect(
      teleportPlacementWarning(
        {
          name: 'Pad',
          shapes: [{ type: 'rectangle', x: 70, y: 70, width: 140, height: 140, hole: true }],
        },
        grid
      )
    ).toBeNull();
  });
});

describe('regionDescriptor.toCreateDoc', () => {
  it('carries shapes/color/visibility/behaviors whole and defaults the name by batch index', () => {
    const r = regionDescriptor.toCreateDoc!(
      {
        color: '#3fb0ff',
        visibility: 0,
        shapes: [{ type: 'rectangle', x: 0, y: 0, width: 140, height: 140 }],
        behaviors: [{ type: 'teleportToken', system: { destinations: ['Scene.a.Region.b'] } }],
      },
      { scene: {}, index: 1 }
    ) as { doc?: any };
    expect(r.doc).toMatchObject({
      name: 'Region 2',
      color: '#3fb0ff',
      visibility: 0,
      shapes: [{ type: 'rectangle' }],
      behaviors: [{ type: 'teleportToken' }],
    });
  });

  it('errors (isolated) when no shape is given', () => {
    const r = regionDescriptor.toCreateDoc!({ name: 'X', shapes: [] }, { scene: {}, index: 0 });
    expect((r as any).error).toMatch(/shape/);
  });
});

describe('regionDescriptor.buildPatch', () => {
  it('reshapes via the grid-rect convenience using the ctx scene geometry', () => {
    // 140px cells, background inset 280px — the snapped 3-cell-wide rect the review loop wants.
    const scene = { dimensions: { size: 140, sceneX: 280, sceneY: 280 } };
    const r = regionDescriptor.buildPatch!(
      {},
      { id: 'r1', rect: { x: 851, y: 881, widthCells: 3 } },
      { scene }
    ) as { changed: boolean; patch?: any };
    expect(r.changed).toBe(true);
    const shape = r.patch.shapes[0];
    expect(shape).toMatchObject({ type: 'rectangle', width: 420, height: 140 });
    expect((shape.x - 280) % 140).toBe(0); // grid-snapped
    expect((shape.y - 280) % 140).toBe(0);
  });

  it('explicit shapes win over rect; behaviors are NEVER emitted', () => {
    const r = regionDescriptor.buildPatch!(
      {},
      {
        id: 'r1',
        name: ' Trap ',
        shapes: [{ type: 'ellipse', x: 1, y: 2, radiusX: 3, radiusY: 4 }],
        rect: { x: 0, y: 0 },
        behaviors: [{ type: 'teleportToken' }],
      } as any,
      { scene: {} }
    ) as { patch?: any };
    expect(r.patch.name).toBe('Trap');
    expect(r.patch.shapes[0].type).toBe('ellipse');
    expect(r.patch).not.toHaveProperty('behaviors');
  });

  it('changed:false when only the id is supplied', () => {
    const r = regionDescriptor.buildPatch!({}, { id: 'r1' }, { scene: {} }) as {
      changed: boolean;
    };
    expect(r.changed).toBe(false);
  });
});

describe('dnd5eBehaviorSystem (dnd5e 6.0 region behavior conveniences → system)', () => {
  const UUID = 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa';

  it("returns {} when no convenience was given (verbatim system stays the caller's)", () => {
    expect(dnd5eBehaviorSystem('teleportToken', {}, [])).toEqual({});
    expect(dnd5eBehaviorSystem(APPLY_EFFECT_BEHAVIOR, {}, [])).toEqual({});
  });

  it('shapes applyActiveEffect: effect uuids, disposition words → numbers, sizes, types', () => {
    expect(
      dnd5eBehaviorSystem(
        APPLY_EFFECT_BEHAVIOR,
        {
          effects: ['Poisoned'],
          dispositions: ['hostile', 'neutral'],
          sizes: ['med'],
          creatureTypes: ['undead'],
        },
        [UUID]
      )
    ).toEqual({ effects: [UUID], dispositions: [-1, 0], sizes: ['med'], types: ['undead'] });
    expect(dnd5eBehaviorSystem(APPLY_EFFECT_BEHAVIOR, { effects: ['Poisoned'] }, [UUID])).toEqual({
      effects: [UUID],
    });
  });

  it('shapes difficultTerrain: types, magical, ignoredDispositions', () => {
    expect(
      dnd5eBehaviorSystem(
        DIFFICULT_TERRAIN_BEHAVIOR,
        { terrainTypes: ['web', 'plants'], magical: true, dispositions: ['friendly'] },
        []
      )
    ).toEqual({ types: ['web', 'plants'], magical: true, ignoredDispositions: [1] });
  });

  it('rejects a convenience on the wrong type, an applyActiveEffect without effects, and unknown keys', () => {
    expect(() =>
      dnd5eBehaviorSystem(APPLY_EFFECT_BEHAVIOR, { terrainTypes: ['web'] }, [UUID])
    ).toThrow(/only apply to dnd5e\.difficultTerrain/);
    expect(() => dnd5eBehaviorSystem(DIFFICULT_TERRAIN_BEHAVIOR, { sizes: ['med'] }, [])).toThrow(
      /only apply to dnd5e\.applyActiveEffect/
    );
    expect(() => dnd5eBehaviorSystem(APPLY_EFFECT_BEHAVIOR, { sizes: ['med'] }, [])).toThrow(
      /needs at least one effect/
    );
    expect(() =>
      dnd5eBehaviorSystem(APPLY_EFFECT_BEHAVIOR, { effects: ['x'], dispositions: ['secret'] }, [
        UUID,
      ])
    ).toThrow(/disposition "secret" is unknown/);
    expect(() => dnd5eBehaviorSystem('executeMacro', { effects: ['Poisoned'] }, [UUID])).toThrow(
      /only valid with type dnd5e\.applyActiveEffect, dnd5e\.difficultTerrain or dnd5e\.rotateArea/
    );
  });
});

describe('rotateAreaSystem (dnd5e.rotateArea — the turning platform)', () => {
  it('shapes the full system with defaults (one stop at 0°, 1000 ms fixed, shortest way, linked walls)', () => {
    expect(rotateAreaSystem({})).toEqual({
      time: { value: 1000, mode: 'fixed' },
      tiles: { ids: [] },
      walls: { ids: [], link: true },
      lights: { ids: [] },
      regions: { ids: [] },
      sounds: { ids: [] },
      directionMode: 'short',
      positions: [{ angle: 0 }],
    });
    expect(
      rotateAreaSystem({
        positions: [0, 90, 180, 270],
        tiles: ['t1'],
        walls: ['w1', 'w2'],
        linkWalls: false,
        timeMs: 2500,
        timeMode: 'variable',
        direction: 'cw',
      })
    ).toEqual({
      time: { value: 2500, mode: 'variable' },
      tiles: { ids: ['t1'] },
      walls: { ids: ['w1', 'w2'], link: false },
      lights: { ids: [] },
      regions: { ids: [] },
      sounds: { ids: [] },
      directionMode: 'cw',
      positions: [{ angle: 0 }, { angle: 90 }, { angle: 180 }, { angle: 270 }],
    });
  });

  it('rejects an empty / out-of-range position list, an unknown direction or speed mode, a bad time', () => {
    expect(() => rotateAreaSystem({ positions: [] })).toThrow(/at least one stop angle/);
    expect(() => rotateAreaSystem({ positions: [400] })).toThrow(/not an angle/);
    expect(() => rotateAreaSystem({ direction: 'left' })).toThrow(/rotate\.direction "left"/);
    expect(() => rotateAreaSystem({ timeMode: 'slow' })).toThrow(/rotate\.timeMode "slow"/);
    expect(() => rotateAreaSystem({ timeMs: -5 })).toThrow(/whole number of milliseconds/);
  });

  it('dnd5eBehaviorSystem routes `rotate` to rotateArea only', () => {
    expect(
      dnd5eBehaviorSystem(ROTATE_AREA_BEHAVIOR, { rotate: { positions: [0, 90] } }, [])
    ).toMatchObject({
      positions: [{ angle: 0 }, { angle: 90 }],
    });
    expect(() =>
      dnd5eBehaviorSystem(ROTATE_AREA_BEHAVIOR, { rotate: {}, magical: true }, [])
    ).toThrow(/do not apply to dnd5e\.rotateArea/);
    expect(() => dnd5eBehaviorSystem(DIFFICULT_TERRAIN_BEHAVIOR, { rotate: {} }, [])).toThrow(
      /rotate only applies to dnd5e\.rotateArea/
    );
  });
});
