// AmbientLight actions of manage-placeables — thin schemas/handlers over the page-side Light descriptor
// (src/page/placeables/light.ts). Emission nests under config{} page-side; these flat inputs fold in
// there. dim/bright are radii in grid-distance units (feet), NOT pixels. x/y are the light CENTER in
// absolute canvas pixels.

import { z } from 'zod';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceableLines,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { placeableAction, sceneTarget, type PlaceableKindFactory } from './_module.js';

const lightFields = {
  rotation: z.number().optional().describe('Rotation in degrees.'),
  walls: z.boolean().optional().describe('Walls block it (default true).'),
  vision: z.boolean().optional().describe('Grants vision (default false).'),
  hidden: z.boolean().optional().describe('GM-only.'),
  elevation: z.number().optional().describe('Elevation (grid units).'),
  dim: z.number().optional().describe('Dim radius (grid units).'),
  bright: z.number().optional().describe('Bright radius (grid units).'),
  color: z.string().optional().describe('Tint hex, e.g. "#fcd674".'),
  alpha: z.number().min(0).max(1).optional().describe('Tint intensity 0–1.'),
  angle: z.number().optional().describe('Cone angle (360 = full).'),
  luminosity: z.number().optional().describe('Luminosity -1..1 (0.5 default).'),
  attenuation: z.number().min(0).max(1).optional().describe('Falloff 0–1 (higher = softer).'),
  animationType: z.string().optional().describe('"torch", "flame", "pulse" …; "" clears.'),
  animationSpeed: z.number().int().min(0).max(10).optional().describe('Speed 0–10.'),
  animationIntensity: z.number().int().min(0).max(10).optional().describe('Intensity 0–10.'),
  darknessMin: z.number().min(0).max(1).optional().describe('Emit at darkness ≥ this.'),
  darknessMax: z.number().min(0).max(1).optional().describe('Emit at darkness ≤ this.'),
  coloration: z.number().int().optional().describe('Coloration id.'),
  saturation: z.number().optional().describe('-1..1.'),
  contrast: z.number().optional().describe('-1..1.'),
  shadows: z.number().optional().describe('0..1.'),
  negative: z.boolean().optional().describe('Darkness source.'),
  priority: z.number().int().optional().describe('Draw priority.'),
  animationReverse: z.boolean().optional().describe('Reverse the animation.'),
  locked: z.boolean().optional().describe('Locked in the canvas.'),
};

const CreateLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  lights: z
    .array(
      z.object({
        x: z.number().describe('Light center X in absolute canvas pixels.'),
        y: z.number().describe('Light center Y in absolute canvas pixels.'),
        ...lightFields,
      })
    )
    .min(1)
    .describe('The ambient lights (torches, glows, magical light) to place.'),
});

const ListLightsSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateLightSchema = z
  .object({
    id: z.string().min(1).describe('AmbientLight id (from action list).'),
    x: z.number().optional().describe('New center X in canvas pixels.'),
    y: z.number().optional().describe('New center Y in canvas pixels.'),
    ...lightFields,
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message: 'Provide at least one field to change besides id.',
  });

const UpdateLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  lightPatches: z
    .array(UpdateLightSchema)
    .min(1)
    .describe('One patch per light; each targets one id.'),
});

const DeleteLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  lightIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('AmbientLight ids to delete (from action list).'),
});

export const lightKindModule: PlaceableKindFactory = foundry => ({
  kind: 'lights',
  actions: [
    placeableAction({
      action: 'create',
      description:
        'Place ambient lights: x / y the center in canvas pixels, dim / bright radii in grid ' +
        'distance (feet), color, angle, luminosity, attenuation, animation, a darkness activation ' +
        'range, walls, vision.',
      schema: CreateLightsSchema,
      handler: async ({ sceneIdentifier, lights }) => {
        const result = await foundry.call('createSceneLights', { sceneIdentifier, items: lights });
        return formatCreatePlaceables(result, 'light');
      },
    }),
    placeableAction({
      action: 'list',
      description: 'Every ambient light on a scene, read back whole under the create field names.',
      schema: ListLightsSchema,
      handler: async parsed => {
        const result = await foundry.call('listSceneLights', parsed);
        return formatListPlaceableLines(result, 'light');
      },
    }),
    placeableAction({
      action: 'update',
      description:
        'Edit placed ambient lights by id; only the fields passed change (a partial config never ' +
        'wipes the rest).',
      schema: UpdateLightsSchema,
      handler: async ({ sceneIdentifier, lightPatches }) => {
        const result = await foundry.call('updateSceneLights', {
          sceneIdentifier,
          patches: lightPatches,
        });
        return formatUpdatePlaceables(result, 'light');
      },
    }),
    placeableAction({
      action: 'delete',
      description: 'Delete ambient lights by id.',
      schema: DeleteLightsSchema,
      handler: async ({ sceneIdentifier, lightIds }) => {
        const result = await foundry.call('deleteSceneLights', { sceneIdentifier, ids: lightIds });
        return formatDeletePlaceables(result, 'light');
      },
    }),
  ],
});
