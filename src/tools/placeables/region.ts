// Region actions of manage-placeables — create / list / update / delete over the page-side Region
// descriptor (src/page/placeables/region.ts), plus the NAMED SPECIAL ACTIONS outside generic CRUD:
// create-teleporter (two cross-linked regions in one call), add-behavior (wire a behavior onto an
// EXISTING region — the create / update gap), and remap-teleporters (post-import destination
// repair). Like every other kind: update takes one patch per region, delete takes ids, the scene
// defaults to the active one; the specials carry their own targets.

import { z } from 'zod';
import { SCENE_TARGET, sceneTargetRequired } from '../_targets.js';
import {
  ACTOR_SIZES,
  BEHAVIOR_DISPOSITIONS,
  CREATURE_TYPE_KEYS,
  DIFFICULT_TERRAIN_TYPES,
  ROTATE_DIRECTIONS,
  ROTATE_SPEED_MODES,
} from '../../utils/dnd5e-canonical.js';
import { FormattedToolError } from '../../utils/error-handler.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceableLines,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { type PlaceableKindFactory, placeableAction, sceneTarget } from './_module.js';

const RegionShapeSchema = z.object({ type: z.string().optional() }).passthrough();
const RegionBehaviorSchema = z
  .object({ type: z.string().optional(), system: z.object({}).passthrough().optional() })
  .passthrough();

const CreateRegionsSchema = z.object({
  sceneIdentifier: sceneTarget,
  items: z
    .array(
      z.object({
        name: z.string().optional().describe('Region label.'),
        color: z.string().optional().describe('Region tint hex, e.g. "#3fb0ff".'),
        visibility: z
          .number()
          .optional()
          .describe('0 layer (GM overlay, default), 1 gamemaster, 2 always.'),
        shapes: z
          .array(RegionShapeSchema)
          .min(1)
          .describe(
            'v14 shapes in canvas px: rectangle {x, y, width, height}, ellipse {x, y, radiusX, ' +
              'radiusY}, polygon {points}.'
          ),
        behaviors: z
          .array(RegionBehaviorSchema)
          .optional()
          .describe('Behaviors carried whole; a teleportToken needs system.destinations as uuids.'),
      })
    )
    .min(1)
    .describe('The regions to create.'),
});

const ListRegionsSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateRegionSchema = z
  .object({
    id: z.string().min(1).describe('Region id (from action list).'),
    name: z.string().optional().describe('New region label.'),
    color: z.string().optional().describe('New region tint hex.'),
    visibility: z.number().optional().describe('0 layer / 1 gamemaster / 2 always.'),
    shapes: z.array(RegionShapeSchema).optional().describe('Replaces the shapes (v14, canvas px).'),
    rect: z
      .object({
        x: z.number().describe('Rectangle CENTER x in canvas px.'),
        y: z.number().describe('Rectangle CENTER y in canvas px.'),
        widthCells: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Width in grid cells (default 1).'),
        heightCells: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Height in grid cells (default 1).'),
        snapToGrid: z.boolean().optional().describe('Snap to the grid (default true).'),
      })
      .optional()
      .describe(
        'Reshape to one grid rectangle centered at (x, y), sized in cells; ignored with shapes.'
      ),
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message:
      'Provide at least one field to change besides id (name, color, visibility, shapes, rect).',
  });

const UpdateRegionsSchema = z.object({
  sceneIdentifier: sceneTarget,
  patches: z
    .array(UpdateRegionSchema)
    .min(1)
    .describe('One patch per region; each targets one id.'),
});

const DeleteRegionsSchema = z.object({
  sceneIdentifier: sceneTarget,
  ids: z.array(z.string().min(1)).min(1).describe('Region ids to delete.'),
});

const TeleporterEndpointSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
  x: z.number().describe('Trigger center x in canvas px.'),
  y: z.number().describe('Trigger center y in canvas px.'),
});

const CreateTeleporterSchema = z.object({
  from: TeleporterEndpointSchema.describe('The first endpoint.'),
  to: TeleporterEndpointSchema.describe('The second endpoint (may be the same scene).'),
  twoWay: z.boolean().default(true).describe('false = one-way, from → to.'),
  widthCells: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe('Trigger width in grid cells, both ends.'),
  heightCells: z.number().int().positive().default(1).describe('Trigger height in grid cells.'),
  snapToGrid: z.boolean().default(true).describe('Snap each trigger to the grid under its center.'),
  confirm: z
    .boolean()
    .default(true)
    .describe(
      'The moving player gets the Teleport / Do Not Teleport dialog; false fires silently.'
    ),
  fromName: z.string().optional().describe('Name for the from-side region.'),
  toName: z.string().optional().describe('Name for the to-side region.'),
  color: z.string().optional().describe('Region tint hex (default "#3fb0ff").'),
});

const AddRegionBehaviorSchema = z.object({
  sceneIdentifier: sceneTarget,
  regionIdentifier: z
    .string()
    .min(1)
    .describe('Region id or exact name on that scene (an ambiguous name errors).'),
  type: z
    .string()
    .min(1)
    .describe(
      'Type key, live-validated: core (teleportToken, executeMacro …), ' +
        'dnd5e.applyActiveEffect / difficultTerrain / rotateArea.'
    ),
  name: z.string().optional().describe("Label (default the type's name)."),
  disabled: z.boolean().optional().describe('Created disabled.'),
  system: z
    .object({})
    .passthrough()
    .optional()
    .describe('System data for the type, verbatim, e.g. executeMacro {uuid}.'),
  // dnd5e 6.0 conveniences — names / words in, uuids / numbers out (resolved on the page)
  effects: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'applyActiveEffect: effects applied on entry, removed on exit — stock names, uuids, or ' +
        '"<Item uuid>#<effect>".'
    ),
  dispositions: z
    .array(z.enum(BEHAVIOR_DISPOSITIONS))
    .optional()
    .describe('applyActiveEffect: only these dispositions; difficultTerrain: these ignore it.'),
  sizes: z.array(z.enum(ACTOR_SIZES)).optional().describe('applyActiveEffect: only these sizes.'),
  creatureTypes: z
    .array(z.enum(CREATURE_TYPE_KEYS))
    .optional()
    .describe('applyActiveEffect: only these creature types.'),
  terrainTypes: z
    .array(z.enum(DIFFICULT_TERRAIN_TYPES))
    .optional()
    .describe('difficultTerrain: the terrain kinds (omit = generic).'),
  magical: z.boolean().optional().describe('difficultTerrain: magical (Spike Growth) vs mundane.'),
  rotate: z
    .object({
      positions: z
        .array(z.number().min(-360).max(360))
        .optional()
        .describe('Stop angles in degrees (default [0]).'),
      tiles: z.array(z.string()).optional().describe('Tile ids that turn with the area.'),
      walls: z.array(z.string()).optional().describe('Wall ids that turn with the area.'),
      lights: z.array(z.string()).optional().describe('Light ids that turn with the area.'),
      regions: z.array(z.string()).optional().describe('Other region ids that turn with the area.'),
      sounds: z.array(z.string()).optional().describe('Ambient-sound ids that turn with the area.'),
      linkWalls: z.boolean().optional().describe('Rotate the walls as linked segments.'),
      timeMs: z.number().int().min(0).optional().describe('Animation time in ms (default 1000).'),
      timeMode: z
        .enum(ROTATE_SPEED_MODES)
        .optional()
        .describe('fixed: timeMs per turn; variable: timeMs per 90°.'),
      direction: z
        .enum(ROTATE_DIRECTIONS)
        .optional()
        .describe('How the area travels to the next stop.'),
    })
    .optional()
    .describe(
      "rotateArea: the listed placeables (validated on the scene) turn around the region's first " +
        'shape, stopping at positions.'
    ),
  teleportTo: z
    .object({
      sceneIdentifier: sceneTargetRequired.describe(`${SCENE_TARGET} of the destination.`),
      regionIdentifier: z
        .string()
        .min(1)
        .describe('Destination region id or exact name (the landing pad).'),
    })
    .optional()
    .describe(
      'teleportToken: the destination, resolved and appended to system.destinations; system.choice ' +
        'defaults to true.'
    ),
});

const RemapTeleportersSchema = z.object({
  sourceModule: z
    .string()
    .min(1)
    .describe('The sourceModule stamped in the import flags; every scene carrying it is scanned.'),
});

export const regionKindModule: PlaceableKindFactory = foundry => ({
  kind: 'regions',
  actions: [
    placeableAction({
      action: 'create',
      description:
        'Create regions on a scene from v14 shapes (canvas px), color, visibility and behaviors ' +
        'passed verbatim (a teleportToken needs its destination uuids; create-teleporter and ' +
        'add-behavior resolve those).',
      schema: CreateRegionsSchema,
      handler: async ({ sceneIdentifier, items }) => {
        const result = await foundry.call('createSceneRegions', { sceneIdentifier, items });
        return formatCreatePlaceables(result, 'region');
      },
    }),
    placeableAction({
      action: 'list',
      description:
        "Every region on a scene: id, name, each shape's bounds, its behaviors with any teleporter " +
        'destinations.',
      schema: ListRegionsSchema,
      handler: async parsed => {
        const result = await foundry.call('listSceneRegions', parsed);
        return formatListPlaceableLines(result, 'region');
      },
    }),
    placeableAction({
      action: 'update',
      description:
        'Edit regions by id: name, color, visibility, shapes, or the rect convenience. Behaviors ' +
        'are untouched.',
      schema: UpdateRegionsSchema,
      handler: async ({ sceneIdentifier, patches }) => {
        const result = await foundry.call('updateSceneRegions', { sceneIdentifier, patches });
        return formatUpdatePlaceables(result, 'region');
      },
    }),
    placeableAction({
      action: 'delete',
      description:
        'Delete regions by id; a teleporter left pointing at a deleted region is warned.',
      schema: DeleteRegionsSchema,
      handler: async ({ sceneIdentifier, ids }) => {
        const result = await foundry.call('deleteSceneRegions', { sceneIdentifier, ids });
        return formatDeletePlaceables(result, 'region');
      },
    }),
    placeableAction({
      action: 'create-teleporter',
      description:
        'Create a teleporter between two points (from / to, the same scene allowed): a grid-sized ' +
        'trigger region at each with a teleportToken behavior pointing at the other; one-way with ' +
        'twoWay:false, silent with confirm:false. Regions are layer-visible (no player overlay).',
      schema: CreateTeleporterSchema,
      handler: async parsed => {
        const result = await foundry.call('createSceneTeleporter', parsed);
        if (result?.notFound) {
          throw new FormattedToolError(
            `Scene not found: "${result.notFound}". No teleporter created.`
          );
        }
        const dest = (r: any) =>
          r?.behaviors?.find((b: any) => b.destinations?.length)?.destinations?.[0] ?? '(none)';
        const dir = result?.twoWay ? '⇄' : '→';
        return (
          `Created ${result?.twoWay ? 'two-way' : 'one-way'} teleporter:\n` +
          `  • ${result?.from?.sceneName} region ${result?.from?.id} (${result?.from?.name}) ${dir} ${result?.to?.sceneName}\n` +
          `      → ${dest(result?.from)}\n` +
          `  • ${result?.to?.sceneName} region ${result?.to?.id} (${result?.to?.name})` +
          (result?.twoWay ? `\n      → ${dest(result?.to)}` : ' (no return link)')
        );
      },
    }),
    placeableAction({
      action: 'add-behavior',
      description:
        'Add one behavior to an existing region (the type validated against the registry). For a ' +
        'teleporter, teleportTo resolves the destination and warns when the landing region holds no ' +
        'grid-snapped token position.',
      schema: AddRegionBehaviorSchema,
      handler: async parsed => {
        const result = await foundry.call('addRegionBehavior', parsed);
        if (result?.notFound) {
          throw new FormattedToolError(`Scene not found: "${result.notFound}". Nothing changed.`);
        }
        if (result?.notFoundRegion) {
          const where = result?.sceneName ? ` on "${result.sceneName}"` : '';
          throw new FormattedToolError(
            `Region not found: "${result.notFoundRegion}"${where}. Nothing changed.`
          );
        }
        const b: any = result?.behavior ?? {};
        const lines = [
          `Added ${b.type} behavior ${b.id ?? '(no id)'} to region "${result?.regionName}" ` +
            `(${result?.regionId}) on "${result?.sceneName}" (${result?.sceneId}).`,
        ];
        for (const d of b.destinations ?? []) lines.push(`    → ${d}`);
        for (const e of (result?.effects ?? []) as any[]) {
          lines.push(`    ✦ effect "${e.name}" (${e.source}) → ${e.uuid}`);
        }
        const warnings: string[] = Array.isArray(result?.warnings) ? result.warnings : [];
        for (const w of warnings) lines.push(`  ⚠ ${w}`);
        return lines.join('\n');
      },
    }),
    placeableAction({
      action: 'remap-teleporters',
      description:
        'After a scene-pack import, rewrite every teleportToken destination from the old ids to the ' +
        'minted ones using the provenance flags of every scene stamped with sourceModule. Idempotent; ' +
        'destinations outside the import are reported, not dropped.',
      schema: RemapTeleportersSchema,
      handler: async parsed => {
        const result = await foundry.call('remapSceneTeleporters', parsed);
        const unresolved: string[] = Array.isArray(result?.unresolved) ? result.unresolved : [];
        const lines = [
          `Teleporter remap for "${result?.sourceModule}":`,
          `  scenes scanned: ${result?.scenesScanned ?? 0}`,
          `  teleporters rewritten: ${result?.rewritten ?? 0}` +
            (result?.unchanged ? ` (${result.unchanged} already correct)` : ''),
        ];
        if (unresolved.length > 0) {
          lines.push(
            `  ⚠ ${unresolved.length} destination(s) point outside this import (not rewritten):`
          );
          for (const u of unresolved.slice(0, 20)) lines.push(`      - ${u}`);
          if (unresolved.length > 20) lines.push(`      …and ${unresolved.length - 20} more`);
        }
        return lines.join('\n');
      },
    }),
  ],
});
