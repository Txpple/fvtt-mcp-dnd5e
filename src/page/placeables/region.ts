// Page-side Region domain: the kernel descriptor (create/list/update/delete), the teleport-behavior
// helpers, and the two NAMED SPECIAL OPS that live outside generic CRUD (createSceneTeleporter,
// remapSceneTeleporters) because they cross-reference minted region ids across scenes.
//
// CORRECTNESS TRAPS this owns:
//  - `behaviors[]` are embedded sub-docs; a teleport destination is a UUID cross-referencing another
//    MINTED region id. buildPatch NEVER emits a `behaviors` key — a generic "replace behaviors whole"
//    on update would orphan the cross-link. Teleporter creation/repair stay the named special ops.
//  - v14.364 stores teleport destinations in `system.destinations`, a SetField — the LIVE value is a
//    Set (an array only via toObject()), and pre-migration data used a singular `system.destination`.
//  - v14.368 made `destinations` a `relativize: true` DocumentUUIDField: an absolute write is STORED
//    relative to the behavior (`..X` = sibling region, `...A.Region.X` = another scene's region).
//    `absoluteTeleportDest` restores the absolute form on every read; writes stay absolute.
//    `teleportDestinationsOf` is the ONE normalizer every read goes through.
//  - Deleting a region can orphan the OTHER end of a teleporter (its destination now points at a dead
//    id) — deleteSceneRegions scans the world afterwards and WARNS on each surviving reference.
//  - The `rect` update convenience reshapes to a grid-snapped rectangle from a CENTER point + cell
//    size (gridRectShape) — the by-hand move/resize loop the live session did.

import {
  crudCreate,
  crudDelete,
  crudList,
  crudUpdate,
  type CreateDocResult,
  type PatchResult,
  type PlaceableCtx,
  type PlaceableDescriptor,
} from '../_placeables.js';
import {
  ACTOR_SIZES,
  BEHAVIOR_DISPOSITIONS,
  CREATURE_TYPE_KEYS,
  DIFFICULT_TERRAIN_TYPES,
  ROTATE_DIRECTIONS,
  ROTATE_SPEED_MODES,
} from '../../utils/dnd5e-canonical.js';
import { resolveEffectRefs, type ResolvedEffect } from '../dnd5e/effect-refs.js';
import { TOKEN_DISPOSITION } from '../dnd5e/token-defaults.js';
import {
  gridRectShape,
  resolveSceneStrict,
  resolveTargetScene,
  sceneGrid,
  TOM_CARTOS_FLAG_SCOPE,
} from '../scenes.js';
import { ambiguous, invalid } from '../errors.js';

// --- dnd5e 6.0 behavior conveniences (pure) --------------------------------------

/** The dnd5e 6.0 behavior types the typed conveniences below know how to shape. */
export const APPLY_EFFECT_BEHAVIOR = 'dnd5e.applyActiveEffect';
export const DIFFICULT_TERRAIN_BEHAVIOR = 'dnd5e.difficultTerrain';
export const ROTATE_AREA_BEHAVIOR = 'dnd5e.rotateArea';

/**
 * dnd5e.rotateArea — a turning platform / puzzle room: the listed placeables rotate together around
 * the region's first shape's origin, stopping at `positions` (angles); a rotation is triggered from
 * the region config or a script (`behavior.system.rotate()`), never by token movement.
 */
export interface RotateAreaOpts {
  /** Stop angles in degrees, e.g. [0, 90, 180, 270]. Default [0]. */
  positions?: number[] | undefined;
  tiles?: string[] | undefined;
  walls?: string[] | undefined;
  lights?: string[] | undefined;
  regions?: string[] | undefined;
  sounds?: string[] | undefined;
  /** Rotate the listed walls as linked segments (default true). */
  linkWalls?: boolean | undefined;
  /** Animation time in ms — the whole turn (fixed) or per 90° (variable). Default 1000. */
  timeMs?: number | undefined;
  timeMode?: string | undefined;
  /** short (default) / long / cw / ccw. */
  direction?: string | undefined;
}

export interface Dnd5eBehaviorOpts {
  /** Names / uuids / "Item uuid#Effect" refs — resolved to ActiveEffect uuids (applyActiveEffect). */
  effects?: string[] | undefined;
  /** Token dispositions the behavior applies to (applyActiveEffect) / ignores (difficultTerrain). */
  dispositions?: string[] | undefined;
  sizes?: string[] | undefined;
  creatureTypes?: string[] | undefined;
  /** difficultTerrain: what kind of terrain (a creature may ignore some kinds). */
  terrainTypes?: string[] | undefined;
  /** difficultTerrain: magical terrain (Spike Growth) vs mundane (rubble). */
  magical?: boolean | undefined;
  /** rotateArea: the turning-platform configuration. */
  rotate?: RotateAreaOpts | undefined;
}

/** Shape a rotateArea configuration into the behavior's `system` (ids already validated). Pure. */
export function rotateAreaSystem(r: RotateAreaOpts): Record<string, unknown> {
  const positions = r.positions ?? [0];
  if (!Array.isArray(positions) || positions.length === 0) {
    throw invalid('rotate.positions needs at least one stop angle (e.g. [0, 90, 180, 270]).');
  }
  for (const a of positions) {
    if (typeof a !== 'number' || !Number.isFinite(a) || a < -360 || a > 360) {
      throw invalid(`rotate.positions: "${a}" is not an angle between -360 and 360.`);
    }
  }
  const direction = r.direction ?? 'short';
  if (!(ROTATE_DIRECTIONS as readonly string[]).includes(direction)) {
    throw invalid(
      `rotate.direction "${direction}" is unknown. Use one of: ${ROTATE_DIRECTIONS.join(' ')}.`
    );
  }
  const timeMode = r.timeMode ?? 'fixed';
  if (!(ROTATE_SPEED_MODES as readonly string[]).includes(timeMode)) {
    throw invalid(
      `rotate.timeMode "${timeMode}" is unknown. Use one of: ${ROTATE_SPEED_MODES.join(' ')}.`
    );
  }
  const timeMs = r.timeMs ?? 1000;
  if (!Number.isInteger(timeMs) || timeMs < 0)
    throw invalid('rotate.timeMs must be a whole number of milliseconds.');
  const ids = (list: string[] | undefined) => [...(list ?? [])];
  return {
    time: { value: timeMs, mode: timeMode },
    tiles: { ids: ids(r.tiles) },
    walls: { ids: ids(r.walls), link: r.linkWalls ?? true },
    lights: { ids: ids(r.lights) },
    regions: { ids: ids(r.regions) },
    sounds: { ids: ids(r.sounds) },
    directionMode: direction,
    positions: positions.map(angle => ({ angle })),
  };
}

const assertKeys = (values: string[] | undefined, vocab: readonly string[], label: string) => {
  for (const v of values ?? []) {
    if (!vocab.includes(v))
      throw invalid(`${label} "${v}" is unknown. Use one of: ${vocab.join(' ')}.`);
  }
};

/**
 * Shape the typed conveniences into the behavior's `system` (merged OVER a verbatim `system`).
 * `effectUuids` are already resolved. Pure — unit-tested. Throws on a convenience given for a
 * behavior type it does not belong to, an unknown disposition / size / creature / terrain key, or
 * an applyActiveEffect without an effect.
 */
export function dnd5eBehaviorSystem(
  type: string,
  opts: Dnd5eBehaviorOpts,
  effectUuids: string[]
): Record<string, unknown> {
  const given = (
    [
      'effects',
      'dispositions',
      'sizes',
      'creatureTypes',
      'terrainTypes',
      'magical',
      'rotate',
    ] as const
  ).filter(k => opts[k] !== undefined);
  if (given.length === 0) return {};
  if (type === ROTATE_AREA_BEHAVIOR) {
    const bad = given.filter(k => k !== 'rotate');
    if (bad.length) throw invalid(`${bad.join(', ')} do not apply to ${ROTATE_AREA_BEHAVIOR}.`);
    return rotateAreaSystem(opts.rotate ?? {});
  }
  if (opts.rotate !== undefined) throw invalid(`rotate only applies to ${ROTATE_AREA_BEHAVIOR}.`);
  assertKeys(opts.dispositions, BEHAVIOR_DISPOSITIONS, 'disposition');
  const dispositionNumbers = (opts.dispositions ?? []).map(
    d => TOKEN_DISPOSITION[d as keyof typeof TOKEN_DISPOSITION]
  );
  if (type === APPLY_EFFECT_BEHAVIOR) {
    const bad = given.filter(k => k === 'terrainTypes' || k === 'magical');
    if (bad.length) throw invalid(`${bad.join(', ')} only apply to ${DIFFICULT_TERRAIN_BEHAVIOR}.`);
    if (effectUuids.length === 0) {
      throw invalid(
        `${APPLY_EFFECT_BEHAVIOR} needs at least one effect (effects: ["Poisoned"] …).`
      );
    }
    assertKeys(opts.sizes, ACTOR_SIZES, 'size');
    assertKeys(opts.creatureTypes, CREATURE_TYPE_KEYS, 'creature type');
    return {
      effects: [...effectUuids],
      ...(opts.dispositions ? { dispositions: dispositionNumbers } : {}),
      ...(opts.sizes ? { sizes: [...opts.sizes] } : {}),
      ...(opts.creatureTypes ? { types: [...opts.creatureTypes] } : {}),
    };
  }
  if (type === DIFFICULT_TERRAIN_BEHAVIOR) {
    const bad = given.filter(k => k === 'effects' || k === 'sizes' || k === 'creatureTypes');
    if (bad.length) throw invalid(`${bad.join(', ')} only apply to ${APPLY_EFFECT_BEHAVIOR}.`);
    assertKeys(opts.terrainTypes, DIFFICULT_TERRAIN_TYPES, 'terrain type');
    return {
      ...(opts.terrainTypes ? { types: [...opts.terrainTypes] } : {}),
      ...(typeof opts.magical === 'boolean' ? { magical: opts.magical } : {}),
      ...(opts.dispositions ? { ignoredDispositions: dispositionNumbers } : {}),
    };
  }
  throw invalid(
    `${given.join(', ')} are dnd5e behavior conveniences — only valid with type ` +
      `${APPLY_EFFECT_BEHAVIOR}, ${DIFFICULT_TERRAIN_BEHAVIOR} or ${ROTATE_AREA_BEHAVIOR} (got "${type}").`
  );
}

/** Every id a rotateArea lists must be a placeable on THIS scene — a typo would rotate nothing, silently. */
function assertRotateIds(scene: any, r: RotateAreaOpts): void {
  const check = (label: string, collection: any, ids: string[] | undefined) => {
    for (const id of ids ?? []) {
      if (!collection?.get?.(id)) {
        throw invalid(
          `rotate.${label}: "${id}" is not a ${label.replace(/s$/, '')} on scene "${scene.name}".`
        );
      }
    }
  };
  check('tiles', scene.tiles, r.tiles);
  check('walls', scene.walls, r.walls);
  check('lights', scene.lights, r.lights);
  check('regions', scene.regions, r.regions);
  check('sounds', scene.sounds, r.sounds);
}

// --- teleport-behavior helpers (pure) -----------------------------------------

/** A teleporter destination UUID: Scene.<sceneId>.Region.<regionId> (ids have no dots). */
const TELEPORT_DEST_RE = /^Scene\.([^.]+)\.Region\.([^.]+)$/;

/** A v12+ teleporter destination UUID for a region. Pure/exported for unit testing. */
export function teleportDestUuid(sceneId: string, regionId: string): string {
  return `Scene.${sceneId}.Region.${regionId}`;
}

/**
 * Read a `teleportToken` behavior's destination UUID(s) from its `system`. Foundry v14.364's
 * `teleportToken` uses a `destinations` field holding SEVERAL endpoints (a region can offer a choice
 * when `choice:true`). It is a `SetField`, so the LIVE model value is a **Set** (an array only via
 * `toObject()`); older data used a singular `system.destination` string. This tolerates a Set, an
 * Array, OR the legacy singular, drops empty/non-string entries, and returns [] for a non-teleport
 * behavior. Pure/exported for unit testing — the ONE place that normalizes all three shapes, so every
 * read (dumpRegion, remap) goes through it.
 */
export function teleportDestinationsOf(system: any, behavior?: any): string[] {
  const raw = system?.destinations;
  const clean = (arr: unknown[]) =>
    arr
      .filter((d: unknown): d is string => typeof d === 'string' && d.trim() !== '')
      .map(d => absoluteTeleportDest(d, behavior));
  if (raw instanceof Set) return clean([...raw]);
  if (Array.isArray(raw)) return clean(raw);
  const single = system?.destination;
  return typeof single === 'string' && single.trim() !== '' ? [single] : [];
}

/**
 * Restore the absolute `Scene.<sceneId>.Region.<regionId>` form of a teleport destination. Foundry
 * 14.368 made `teleportToken.destinations` a `relativize: true` DocumentUUIDField (fix #14703):
 * `_cleanType` runs `buildRelativeUuid(value, behavior)` on every write that has a parent document,
 * so the STORED string is relative to the behavior — `..X` for a sibling region on the same scene,
 * `...A.Region.X` for another scene's region, `..` for the behavior's own region (one leading dot
 * per parent level climbed, per `_resolveRelativeUuid`). 14.367 data and behaviors created inline
 * with their region (no parent at clean time) still hold the absolute form. Given the live behavior
 * document this resolves through core's own `foundry.utils.parseUuid(…, { relative })`; without one
 * (unit tests, mocks) the three shapes above are resolved from the behavior's parents when present.
 * An unrecognised relative form is returned unchanged so it surfaces in read-back instead of
 * vanishing. Pure/exported for unit testing.
 */
export function absoluteTeleportDest(dest: string, behavior?: any): string {
  if (!dest.startsWith('.')) return dest;
  const parseUuid = (globalThis as any).foundry?.utils?.parseUuid;
  if (typeof parseUuid === 'function' && behavior?.parent) {
    try {
      const resolved = parseUuid(dest, { relative: behavior })?.uuid;
      if (typeof resolved === 'string' && TELEPORT_DEST_RE.test(resolved)) return resolved;
    } catch {
      /* fall through to the shape-based fallback */
    }
  }
  const regionId: string | undefined = behavior?.parent?.id;
  const sceneId: string | undefined = behavior?.parent?.parent?.id;
  const rest = dest.replace(/^\.+/, '');
  if (rest === '') return sceneId && regionId ? teleportDestUuid(sceneId, regionId) : dest;
  const other = rest.match(/^([^.]+)\.Region\.([^.]+)$/);
  if (other) return teleportDestUuid(other[1], other[2]);
  const typed = rest.match(/^Region\.([^.]+)$/);
  if (typed && sceneId) return teleportDestUuid(sceneId, typed[1]);
  if (!rest.includes('.') && sceneId) return teleportDestUuid(sceneId, rest);
  return dest;
}

export type RemapStatus = 'rewritten' | 'unchanged' | 'no-match' | 'unresolved';

/**
 * Compute the rewritten teleporter destination for one behavior's destination entry.
 * Pure/exported — the page write-back fn applies the result; this is the unit-tested core.
 *  - `no-match`: not a Scene.X.Region.Y string (a non-teleport behavior or an unset destination).
 *  - `unresolved`: a valid destination whose scene OR region was NOT in this import (e.g. it
 *    points at a variant the user chose not to import) — left as-is and reported, not silently dropped.
 *  - `unchanged`: maps resolve but the destination already equals the rewrite (keepId / re-run).
 *  - `rewritten`: returns the new Scene.<new>.Region.<new> destination to persist.
 */
export function remapTeleportDestination(
  dest: unknown,
  sceneIdMap: Record<string, string>,
  regionIdMap: Record<string, string>
): { status: RemapStatus; dest?: string | undefined; reason?: string | undefined } {
  if (typeof dest !== 'string' || dest.trim() === '') return { status: 'no-match' };
  const m = dest.match(TELEPORT_DEST_RE);
  if (!m) return { status: 'no-match' };
  const [, oldScene, oldRegion] = m;
  const newScene = sceneIdMap[oldScene];
  const newRegion = regionIdMap[oldRegion];
  if (newScene && newRegion) {
    const newDest = `Scene.${newScene}.Region.${newRegion}`;
    return newDest === dest
      ? { status: 'unchanged', dest }
      : { status: 'rewritten', dest: newDest };
  }
  // Re-run / resume: the destination may already hold the NEW ids (the map VALUES, not keys) from a
  // prior remap. That's done, not broken — report `unchanged`, not `unresolved`. Only a destination
  // whose scene+region is neither an old source id NOR a current in-import id truly points outside it.
  const sceneIsCurrent = Object.values(sceneIdMap).includes(oldScene);
  const regionIsCurrent = Object.values(regionIdMap).includes(oldRegion);
  if (sceneIsCurrent && regionIsCurrent) return { status: 'unchanged', dest };
  return { status: 'unresolved', reason: dest };
}

// --- the descriptor ------------------------------------------------------------

export interface RegionInput {
  name?: string | undefined;
  color?: string | undefined;
  visibility?: number | undefined;
  shapes?: Record<string, unknown>[] | undefined;
  behaviors?: Record<string, unknown>[] | undefined;
}

export interface RegionPatch {
  name?: string | undefined;
  color?: string | undefined;
  visibility?: number | undefined;
  shapes?: Record<string, unknown>[] | undefined;
  rect?:
    | {
        x: number;
        y: number;
        widthCells?: number | undefined;
        heightCells?: number | undefined;
        snapToGrid?: boolean | undefined;
      }
    | undefined;
}

/**
 * Serialize ONE behavior for read-back: type always; id/name/disabled only when present (unit-test
 * mocks and pre-create docs lack them), teleport destinations when the behavior has any.
 */
export function dumpBehavior(b: any): Record<string, unknown> {
  const destinations = teleportDestinationsOf(b?.system, b);
  return {
    ...(b?.id ? { id: b.id } : {}),
    type: b?.type,
    ...(typeof b?.name === 'string' && b.name !== '' ? { name: b.name } : {}),
    ...(b?.disabled ? { disabled: true } : {}),
    ...(destinations.length ? { destinations } : {}),
  };
}

/** Serialize a region for read-back: id, name, its shapes' bounds, and any teleport destinations. */
export function dumpRegion(region: any): Record<string, unknown> {
  return {
    id: region.id,
    name: region.name,
    shapes: (region.shapes ?? []).map((s: any) => ({
      type: s.type,
      ...(s.x !== undefined ? { x: s.x, y: s.y } : {}),
      ...(s.width !== undefined ? { width: s.width, height: s.height } : {}),
      ...(s.radiusX !== undefined ? { radiusX: s.radiusX, radiusY: s.radiusY } : {}),
    })),
    behaviors: (region.behaviors?.contents ?? region.behaviors ?? []).map(dumpBehavior),
  };
}

/**
 * Does a rectangle contain at least one grid-SNAPPED token center STRICTLY inside it? v13+/v14
 * movement snaps a 1×1 token's center to cell centers (sceneX/sceneY-anchored, origin + (k+0.5)·g),
 * and region containment excludes the boundary — so a rect that misses every snapped center is a
 * teleport destination no walking token can ever be placed in, and core fails SILENTLY (found live
 * 2026-07-08: half-cell-offset stair pads — MOVE_IN fires, placement finds nothing, nothing happens).
 * Pure/exported for unit testing.
 */
export function rectContainsSnappedCenter(
  rect: { x: number; y: number; width: number; height: number },
  grid: { size: number; sceneX: number; sceneY: number }
): boolean {
  const g = grid.size > 0 ? grid.size : 100;
  const hasCenterStrictlyInside = (lo: number, len: number, origin: number) => {
    // smallest k with origin+(k+0.5)·g > lo, then check that center against the far edge
    const k = Math.floor((lo - origin) / g - 0.5) + 1;
    return origin + (k + 0.5) * g < lo + len;
  };
  return (
    hasCenterStrictlyInside(rect.x, rect.width, grid.sceneX) &&
    hasCenterStrictlyInside(rect.y, rect.height, grid.sceneY)
  );
}

/**
 * Teleport-destination sanity: null when the landing region is fine, else a human warning. Only
 * all-rectangle, hole-free geometry is analyzed (polygons/ellipses are assumed intentional); a
 * destination whose every rect misses every snapped token center is the silent-no-op geometry
 * rectContainsSnappedCenter documents. Pure/exported for unit testing.
 */
export function teleportPlacementWarning(
  destRegion: { name?: string | undefined; shapes?: any[] | undefined },
  grid: { size: number; sceneX: number; sceneY: number }
): string | null {
  const shapes = destRegion.shapes ?? [];
  const rects = shapes.filter((s: any) => s?.type === 'rectangle' && !s.hole);
  if (rects.length === 0 || rects.length !== shapes.length) return null; // non-rect geometry — not analyzed
  if (rects.some((s: any) => rectContainsSnappedCenter(s, grid))) return null;
  return (
    `destination region "${destRegion.name}" contains NO grid-snapped token position strictly inside ` +
    `it (rect off the grid?) — snapped movement cannot land there and the teleport silently no-ops; ` +
    `re-align it with update-region's rect convenience`
  );
}

/** Resolve ONE region on a scene by id or EXACT name (ambiguous names throw — use the id). */
export function resolveRegionStrict(scene: any, identifier: string): any | null {
  const byId = scene.regions?.get?.(identifier);
  if (byId) return byId;
  const matches = (scene.regions?.contents ?? []).filter((r: any) => r.name === identifier);
  if (matches.length > 1) {
    throw ambiguous(
      `Region name "${identifier}" is ambiguous on "${scene.name}" (${matches.length} matches) — use an id`
    );
  }
  return matches[0] ?? null;
}

function toCreateDoc(input: RegionInput, ctx: PlaceableCtx): CreateDocResult {
  if (!Array.isArray(input?.shapes) || input.shapes.length === 0) {
    return { error: 'at least one shape is required' };
  }
  const doc: Record<string, unknown> = {
    name: input.name ?? `Region ${(ctx.index ?? 0) + 1}`,
    shapes: input.shapes,
  };
  if (typeof input.color === 'string' && input.color.trim() !== '') doc.color = input.color;
  if (typeof input.visibility === 'number') doc.visibility = input.visibility;
  // Behaviors passthrough — a teleportToken here needs system.destinations already an array of
  // "Scene.<id>.Region.<id>" UUIDs; for two NEW cross-linked regions use createSceneTeleporter.
  if (Array.isArray(input.behaviors) && input.behaviors.length > 0) doc.behaviors = input.behaviors;
  return { doc };
}

function buildPatch(
  _existing: any,
  p: RegionPatch & { id: string },
  ctx: PlaceableCtx
): PatchResult {
  const patch: Record<string, unknown> = {};
  if (typeof p.name === 'string' && p.name.trim() !== '') patch.name = p.name.trim();
  if (typeof p.color === 'string' && p.color.trim() !== '') patch.color = p.color;
  if (typeof p.visibility === 'number') patch.visibility = p.visibility;
  if (Array.isArray(p.shapes) && p.shapes.length > 0) patch.shapes = p.shapes;
  else if (p.rect) {
    patch.shapes = [
      gridRectShape(
        sceneGrid(ctx.scene),
        p.rect.x,
        p.rect.y,
        p.rect.widthCells ?? 1,
        p.rect.heightCells ?? 1,
        p.rect.snapToGrid !== false
      ),
    ];
  }
  // NEVER patch.behaviors — replacing behaviors whole would orphan teleporter cross-links.
  return { patch, changed: Object.keys(patch).length > 0 };
}

export const regionDescriptor: PlaceableDescriptor = {
  docName: 'Region',
  collection: (scene: any) => scene.regions,
  dump: dumpRegion,
  toCreateDoc,
  buildPatch,
};

// --- bridge page functions (registered in src/page/index.ts) -------------------

export const createSceneRegions = (args: {
  sceneIdentifier?: string | undefined;
  items: RegionInput[];
}) => crudCreate(regionDescriptor, args);
export const listSceneRegions = (args: { sceneIdentifier?: string | undefined }) =>
  crudList(regionDescriptor, args);
export const updateSceneRegions = (args: {
  sceneIdentifier?: string | undefined;
  patches: Array<{ id: string } & RegionPatch>;
}) => crudUpdate(regionDescriptor, args);

/**
 * Delete regions, then scan EVERY scene's surviving teleport behaviors for destinations pointing at
 * a just-deleted region id — the orphaned-other-end trap. Orphans are warned, never auto-deleted
 * (the GM may be mid-rebuild).
 */
export async function deleteSceneRegions(args: {
  sceneIdentifier?: string | undefined;
  ids: string[];
}) {
  const result = await crudDelete(regionDescriptor, args);
  if (!result.deleted || !result.sceneId) return result;
  const deletedIds = new Set(args.ids.filter(id => !(result.notFoundIds ?? []).includes(id)));
  const warnings: string[] = [];
  for (const s of game.scenes?.contents ?? []) {
    for (const region of s.regions ?? []) {
      for (const behavior of region.behaviors ?? []) {
        for (const dest of teleportDestinationsOf(behavior?.system, behavior)) {
          const m = dest.match(TELEPORT_DEST_RE);
          if (m && deletedIds.has(m[2])) {
            warnings.push(
              `teleporter "${region.name}" on "${s.name}" still points at deleted region ${m[2]} — ` +
                `retarget or delete it too`
            );
          }
        }
      }
    }
  }
  return warnings.length > 0 ? { ...result, warnings } : result;
}

// --- named special ops (outside generic CRUD — they cross-reference minted ids) -

/**
 * Two-way (or one-way) teleporter between two points — the killer convenience. Creates a rectangle
 * region at each end (sized in whole grid cells, snapped to the grid by default) and wires a
 * `teleportToken` behavior on each pointing at the OTHER region. Both regions are created BEFORE
 * either behavior so the cross-linked destination UUIDs resolve. `from`/`to` give a CENTER point in
 * canvas px on each scene (may be the same scene). Returns both created region ids + their final
 * shapes/destinations for verification. `confirm` (default TRUE — the table-approved house
 * pattern) sets the behavior's `choice` flag, so the moving player gets core v14's
 * "Teleport / Do Not Teleport" dialog instead of being yanked silently; pass false only for
 * trap/plot teleports that SHOULD fire without asking.
 */
export async function createSceneTeleporter(args: {
  from: { sceneIdentifier: string; x: number; y: number };
  to: { sceneIdentifier: string; x: number; y: number };
  widthCells?: number | undefined;
  heightCells?: number | undefined;
  twoWay?: boolean | undefined;
  snapToGrid?: boolean | undefined;
  confirm?: boolean | undefined;
  fromName?: string | undefined;
  toName?: string | undefined;
  color?: string | undefined;
}): Promise<{
  success: boolean;
  notFound?: string | undefined;
  twoWay?: boolean | undefined;
  from?: (Record<string, unknown> & { sceneId: string; sceneName: string }) | undefined;
  to?: (Record<string, unknown> & { sceneId: string; sceneName: string }) | undefined;
}> {
  if (!args?.from?.sceneIdentifier || !args?.to?.sceneIdentifier) {
    throw invalid('both from.sceneIdentifier and to.sceneIdentifier are required');
  }
  const fromScene = resolveSceneStrict(args.from.sceneIdentifier);
  if (!fromScene) return { success: true, notFound: args.from.sceneIdentifier };
  const toScene = resolveSceneStrict(args.to.sceneIdentifier);
  if (!toScene) return { success: true, notFound: args.to.sceneIdentifier };

  const wc = args.widthCells ?? 1;
  const hc = args.heightCells ?? 1;
  const snap = args.snapToGrid !== false;
  const twoWay = args.twoWay !== false;
  const confirm = args.confirm !== false;
  const color = typeof args.color === 'string' && args.color.trim() !== '' ? args.color : '#3fb0ff';
  const fromShape = gridRectShape(sceneGrid(fromScene), args.from.x, args.from.y, wc, hc, snap);
  const toShape = gridRectShape(sceneGrid(toScene), args.to.x, args.to.y, wc, hc, snap);

  // 1) Create both regions first (no behaviors) so both ids exist for the cross-links.
  const [regA] = await fromScene.createEmbeddedDocuments('Region', [
    { name: args.fromName ?? `Teleporter → ${toScene.name}`, color, shapes: [fromShape] },
  ]);
  const [regB] = await toScene.createEmbeddedDocuments('Region', [
    { name: args.toName ?? `Teleporter → ${fromScene.name}`, color, shapes: [toShape] },
  ]);

  // 2) Wire the teleportToken behavior(s), each pointing at the OTHER region. v14.364 stores the
  // destination in a `destinations` ARRAY (not a singular `destination`); with a single destination
  // `choice:true` means "show the teleportation confirmation dialog" (teleport-token.mjs) — the
  // house default, so players are asked before changing maps.
  await regA.createEmbeddedDocuments('RegionBehavior', [
    {
      name: `Teleport to ${toScene.name}`,
      type: 'teleportToken',
      system: { destinations: [teleportDestUuid(toScene.id, regB.id)], choice: confirm },
    },
  ]);
  if (twoWay) {
    await regB.createEmbeddedDocuments('RegionBehavior', [
      {
        name: `Teleport to ${fromScene.name}`,
        type: 'teleportToken',
        system: { destinations: [teleportDestUuid(fromScene.id, regA.id)], choice: confirm },
      },
    ]);
  }

  // Re-fetch fresh so the read-back includes the just-added behaviors.
  const freshA = fromScene.regions.get(regA.id);
  const freshB = toScene.regions.get(regB.id);
  return {
    success: true,
    twoWay,
    from: { sceneId: fromScene.id, sceneName: fromScene.name, ...dumpRegion(freshA) },
    to: { sceneId: toScene.id, sceneName: toScene.name, ...dumpRegion(freshB) },
  };
}

/**
 * Add ONE behavior to an EXISTING region — the gap between create-region (behaviors only at create
 * time) and update-region (deliberately never touches behaviors): a real
 * region.createEmbeddedDocuments('RegionBehavior') so the doc validates against its registered data
 * model, exactly the path createSceneTeleporter uses. `teleportTo` resolves a scene+region pair to
 * the Scene.<id>.Region.<id> UUID (no hand-built UUIDs) and appends it to system.destinations. Every
 * teleport destination is then geometry-checked (teleportPlacementWarning) so the half-cell-offset
 * silent no-op is caught at authoring time, not at the table.
 */
export async function addRegionBehavior(
  args: {
    sceneIdentifier?: string | undefined;
    regionIdentifier: string;
    type: string;
    name?: string | undefined;
    disabled?: boolean | undefined;
    system?: Record<string, unknown> | undefined;
    teleportTo?: { sceneIdentifier: string; regionIdentifier: string } | undefined;
  } & Dnd5eBehaviorOpts
): Promise<Record<string, unknown>> {
  if (!args?.regionIdentifier) throw invalid('regionIdentifier is required');
  if (!args?.type) throw invalid('type is required');
  const scene = resolveTargetScene(args.sceneIdentifier);
  if (!scene) return { success: true, notFound: args.sceneIdentifier };
  const region = resolveRegionStrict(scene, args.regionIdentifier);
  if (!region) {
    return { success: true, notFoundRegion: args.regionIdentifier, sceneName: scene.name };
  }

  const registered = Object.keys(
    (globalThis as any).CONFIG?.RegionBehavior?.dataModels ?? {}
  ) as string[];
  if (registered.length > 0 && !registered.includes(args.type)) {
    throw invalid(`Unknown behavior type "${args.type}" — registered: ${registered.join(', ')}`);
  }

  const system: Record<string, unknown> = { ...(args.system ?? {}) };
  // dnd5e 6.0 conveniences: names → effect uuids, disposition words → numbers, vocab checks.
  let resolvedEffects: ResolvedEffect[] = [];
  const warnings: string[] = [];
  {
    const { effects, dispositions, sizes, creatureTypes, terrainTypes, magical, rotate } = args;
    const opts: Dnd5eBehaviorOpts = {
      ...(effects !== undefined ? { effects } : {}),
      ...(dispositions !== undefined ? { dispositions } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(creatureTypes !== undefined ? { creatureTypes } : {}),
      ...(terrainTypes !== undefined ? { terrainTypes } : {}),
      ...(magical !== undefined ? { magical } : {}),
      ...(rotate !== undefined ? { rotate } : {}),
    };
    if (rotate && args.type === ROTATE_AREA_BEHAVIOR) assertRotateIds(scene, rotate);
    let uuids: string[] = [];
    if (Array.isArray(effects) && effects.length > 0) {
      const r = await resolveEffectRefs(effects);
      uuids = r.uuids;
      resolvedEffects = r.resolved;
      warnings.push(...r.warnings);
    }
    Object.assign(system, dnd5eBehaviorSystem(args.type, opts, uuids));
  }
  if (args.type === APPLY_EFFECT_BEHAVIOR) {
    const effects = system.effects;
    if (!Array.isArray(effects) || effects.length === 0) {
      throw invalid(
        `${APPLY_EFFECT_BEHAVIOR} needs at least one effect — pass effects: ["Poisoned"] (a name, an ActiveEffect uuid, or "Item uuid#Effect").`
      );
    }
  }
  if (args.teleportTo) {
    if (args.type !== 'teleportToken') {
      throw invalid('teleportTo is only valid with type "teleportToken"');
    }
    const destScene = resolveSceneStrict(args.teleportTo.sceneIdentifier);
    if (!destScene) return { success: true, notFound: args.teleportTo.sceneIdentifier };
    const destRegion = resolveRegionStrict(destScene, args.teleportTo.regionIdentifier);
    if (!destRegion) {
      return {
        success: true,
        notFoundRegion: args.teleportTo.regionIdentifier,
        sceneName: destScene.name,
      };
    }
    const existing = Array.isArray(system.destinations) ? system.destinations : [];
    system.destinations = [...existing, teleportDestUuid(destScene.id, destRegion.id)];
  }
  if (
    args.type === 'teleportToken' &&
    !(Array.isArray(system.destinations) && system.destinations.length > 0)
  ) {
    throw invalid('a teleportToken needs a destination — pass teleportTo or system.destinations');
  }
  // House default for transitions: ask before moving maps. Core's `choice` field ("show
  // teleportation confirmation dialog?", teleport-token.mjs) initials to false, so an unset
  // choice here is defaulted to true; pass system.choice:false explicitly for silent teleports.
  if (args.type === 'teleportToken' && system.choice === undefined) system.choice = true;

  const doc: Record<string, unknown> = { type: args.type };
  if (Object.keys(system).length > 0) doc.system = system;
  if (typeof args.name === 'string' && args.name.trim() !== '') doc.name = args.name.trim();
  if (typeof args.disabled === 'boolean') doc.disabled = args.disabled;
  const [behavior] = await region.createEmbeddedDocuments('RegionBehavior', [doc]);

  // Teleport-destination geometry check — the silent-no-op guard.
  for (const dest of teleportDestinationsOf(behavior.system, behavior)) {
    const m = dest.match(TELEPORT_DEST_RE);
    if (!m) continue;
    const dScene = game.scenes?.get?.(m[1]);
    const dRegion = dScene?.regions?.get?.(m[2]);
    if (!dScene || !dRegion) {
      warnings.push(`destination ${dest} does not resolve to an existing region`);
      continue;
    }
    const warn = teleportPlacementWarning(dRegion, sceneGrid(dScene));
    if (warn) warnings.push(`${warn} (on "${dScene.name}")`);
  }

  return {
    success: true,
    sceneId: scene.id,
    sceneName: scene.name,
    regionId: region.id,
    regionName: region.name,
    behavior: dumpBehavior(behavior),
    ...(resolvedEffects.length > 0 ? { effects: resolvedEffects } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Post-import teleporter repair: find every scene the given module import stamped,
 * reconstruct origId→newId maps from the provenance flags both carry
 * (flags[TOM_CARTOS_FLAG_SCOPE].{sourceModule,sourceId}), then update every
 * teleport destination via `region.updateEmbeddedDocuments('RegionBehavior', …)`.
 * Idempotent (already-correct destinations are 'unchanged'); reports destinations
 * that point outside the import ('unresolved') rather than swallowing them.
 */
export async function remapSceneTeleporters(args: { sourceModule: string }): Promise<{
  success: boolean;
  sourceModule: string;
  scenesScanned: number;
  behaviorsScanned: number;
  rewritten: number;
  unchanged: number;
  unresolved: string[];
}> {
  if (!args?.sourceModule) throw invalid('sourceModule is required');
  const scope = TOM_CARTOS_FLAG_SCOPE;
  // Read the provenance flag by DIRECT property access — never `doc.getFlag(scope, …)`, which THROWS
  // ("Flag scope is not valid or not currently active") for any document lacking the flag when `scope`
  // is not a registered module id. This filter runs over EVERY scene in the world, most of which have
  // no tom-cartos flag, so getFlag would abort the whole remap. Flags are stored under `doc.flags[scope]`
  // verbatim (that is how the import stamps them), so the direct read is both safe and sufficient.
  const flagOf = (doc: any, key: string): string | undefined => {
    const v = doc?.flags?.[scope]?.[key];
    return typeof v === 'string' ? v : undefined;
  };

  const scenes: any[] = (game.scenes?.contents || []).filter(
    (s: any) => flagOf(s, 'sourceModule') === args.sourceModule
  );

  // Pass 1 — reconstruct old→new id maps from world state (no agent id-shuttling).
  const sceneIdMap: Record<string, string> = {};
  const regionIdMap: Record<string, string> = {};
  for (const s of scenes) {
    const sid = flagOf(s, 'sourceId');
    if (sid) sceneIdMap[sid] = s.id;
    for (const region of s.regions ?? []) {
      const rid = flagOf(region, 'sourceId');
      if (rid) regionIdMap[rid] = region.id;
    }
  }

  // Pass 2 — rewrite + persist each teleport destination. v14.364 stores destinations in a
  // `system.destinations` ARRAY, so each entry is remapped independently and the whole array is written
  // back when any entry changed (per-destination counting preserves the single-destination semantics).
  // Reads come back ABSOLUTE (teleportDestinationsOf) whatever 14.368 relativized on disk, and the
  // absolute rewrite is what gets written — core relativizes it again itself on the way in.
  let rewritten = 0;
  let unchanged = 0;
  const unresolved: string[] = [];
  let behaviorsScanned = 0;
  for (const s of scenes) {
    for (const region of s.regions ?? []) {
      const updates: Array<Record<string, unknown>> = [];
      for (const behavior of region.behaviors ?? []) {
        behaviorsScanned++;
        const dests = teleportDestinationsOf(behavior?.system, behavior);
        if (dests.length === 0) continue; // non-teleport behavior / unset destination
        let changed = false;
        const newDests = dests.map(d => {
          const res = remapTeleportDestination(d, sceneIdMap, regionIdMap);
          if (res.status === 'rewritten') {
            changed = true;
            rewritten++;
            return res.dest as string;
          }
          if (res.status === 'unchanged') unchanged++;
          else if (res.status === 'unresolved') unresolved.push(`${s.name}: ${res.reason}`);
          return d;
        });
        if (changed) updates.push({ _id: behavior.id, 'system.destinations': newDests });
      }
      if (updates.length > 0) {
        await region.updateEmbeddedDocuments('RegionBehavior', updates);
      }
    }
  }

  return {
    success: true,
    sourceModule: args.sourceModule,
    scenesScanned: scenes.length,
    behaviorsScanned,
    rewritten,
    unchanged,
    unresolved,
  };
}
