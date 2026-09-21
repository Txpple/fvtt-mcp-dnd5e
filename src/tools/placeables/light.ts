// AmbientLight CRUD tools — thin schemas/handlers over the page-side Light descriptor
// (src/page/placeables/light.ts). Emission nests under config{} page-side; these flat inputs fold in
// there. dim/bright are radii in grid-distance units (feet), NOT pixels. x/y are the light CENTER in
// absolute canvas pixels.

import { z } from 'zod';
import { toInputSchema } from '../../utils/schema.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceables,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { sceneTarget, type PlaceableModuleFactory } from './_module.js';

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
  lights: z
    .array(
      z.object({
        x: z.number().describe('Light center X in absolute canvas pixels.'),
        y: z.number().describe('Light center Y in absolute canvas pixels.'),
        ...lightFields,
      })
    )
    .min(1)
    .describe('One or more ambient lights (torches, glows, magical light) to place.'),
});

const ListLightsSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateLightSchema = z
  .object({
    id: z.string().min(1).describe('AmbientLight id (from list-lights).'),
    x: z.number().optional().describe('New center X in canvas pixels.'),
    y: z.number().optional().describe('New center Y in canvas pixels.'),
    ...lightFields,
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message: 'Provide at least one field to change besides id.',
  });

const UpdateLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  lights: z
    .array(UpdateLightSchema)
    .min(1)
    .describe('The light patches to apply (each targets one id).'),
});

const DeleteLightsSchema = z.object({
  sceneIdentifier: sceneTarget,
  lightIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('AmbientLight ids to delete (from list-lights).'),
});

export const lightToolModule: PlaceableModuleFactory = foundry => ({
  defs: [
    {
      name: 'create-lights',
      description:
        'Place ambient lights: x / y the center in canvas pixels, dim / bright radii in grid ' +
        'distance (feet), color, angle, luminosity, attenuation, animation, a darkness activation ' +
        'range, walls, vision. One bad light does not fail the batch. Returns the ids. GM-only.',
      inputSchema: toInputSchema(CreateLightsSchema),
    },
    {
      name: 'list-lights',
      description:
        'Every ambient light on a scene: id, center, rotation, dim / bright, color, angle, ' +
        'animation, hidden, walls / vision.',
      inputSchema: toInputSchema(ListLightsSchema),
    },
    {
      name: 'update-lights',
      description:
        'Edit placed ambient lights by id; only the fields passed change (a partial config never ' +
        'wipes the rest). Unresolved ids are reported. GM-only.',
      inputSchema: toInputSchema(UpdateLightsSchema),
    },
    {
      name: 'delete-lights',
      description: 'Delete ambient lights by id; missing ids are reported, never fatal. GM-only.',
      inputSchema: toInputSchema(DeleteLightsSchema),
    },
  ],
  handlers: {
    'create-lights': async args => {
      const { sceneIdentifier, lights } = CreateLightsSchema.parse(args ?? {});
      const result = await foundry.call('createSceneLights', { sceneIdentifier, items: lights });
      return formatCreatePlaceables(result, 'light');
    },
    'list-lights': async args => {
      const parsed = ListLightsSchema.parse(args ?? {});
      const result = await foundry.call('listSceneLights', parsed);
      return formatListPlaceables(result, 'light');
    },
    'update-lights': async args => {
      const { sceneIdentifier, lights } = UpdateLightsSchema.parse(args ?? {});
      const result = await foundry.call('updateSceneLights', { sceneIdentifier, patches: lights });
      return formatUpdatePlaceables(result, 'light');
    },
    'delete-lights': async args => {
      const { sceneIdentifier, lightIds } = DeleteLightsSchema.parse(args ?? {});
      const result = await foundry.call('deleteSceneLights', { sceneIdentifier, ids: lightIds });
      return formatDeletePlaceables(result, 'light');
    },
  },
});
