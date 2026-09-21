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
  rotation: z.number().optional().describe('Emission-cone rotation in degrees.'),
  walls: z.boolean().optional().describe('Confine the light within walls (default true).'),
  vision: z.boolean().optional().describe('This light provides vision (default false).'),
  hidden: z.boolean().optional().describe('Hide the light from players (GM-only).'),
  elevation: z.number().optional().describe('Light elevation in grid-distance units.'),
  dim: z.number().optional().describe('Dim radius in grid-distance units (e.g. ft).'),
  bright: z.number().optional().describe('Bright radius in grid-distance units (e.g. ft).'),
  color: z.string().optional().describe('Tint color hex, e.g. "#fcd674" (warm torch).'),
  alpha: z.number().min(0).max(1).optional().describe('Tint intensity 0–1 (default ~0.3).'),
  angle: z.number().optional().describe('Emission cone angle in degrees (360 = full circle).'),
  luminosity: z
    .number()
    .optional()
    .describe('Luminosity -1..1 (0.5 default; lower = softer glow).'),
  attenuation: z.number().min(0).max(1).optional().describe('Falloff 0–1 (higher = softer edge).'),
  animationType: z
    .string()
    .optional()
    .describe('Animation key, e.g. "torch", "flame", "pulse", "" for none (steady).'),
  animationSpeed: z.number().int().min(0).max(10).optional().describe('Animation speed 0–10.'),
  animationIntensity: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Animation intensity 0–10.'),
  darknessMin: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Only emit when scene darkness ≥ this (0–1). Use ~0.1 for a torch that lights at dusk.'
    ),
  darknessMax: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Only emit when scene darkness ≤ this (0–1).'),
};

const CreateLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  items: z
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
  patches: z.array(UpdateLightSchema).min(1).describe('One patch per light; each targets one id.'),
});

const DeleteLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  ids: z.array(z.string().min(1)).min(1).describe('AmbientLight ids to delete (from action list).'),
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
      handler: async ({ sceneIdentifier, items }) => {
        const result = await foundry.call('createSceneLights', { sceneIdentifier, items });
        return formatCreatePlaceables(result, 'light');
      },
    }),
    placeableAction({
      action: 'list',
      description:
        'Every ambient light on a scene: id, center, rotation, hidden, walls / vision, dim / ' +
        'bright, color, angle, animation.',
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
      handler: async ({ sceneIdentifier, patches }) => {
        const result = await foundry.call('updateSceneLights', { sceneIdentifier, patches });
        return formatUpdatePlaceables(result, 'light');
      },
    }),
    placeableAction({
      action: 'delete',
      description: 'Delete ambient lights by id.',
      schema: DeleteLightsSchema,
      handler: async ({ sceneIdentifier, ids }) => {
        const result = await foundry.call('deleteSceneLights', { sceneIdentifier, ids });
        return formatDeletePlaceables(result, 'light');
      },
    }),
  ],
});
