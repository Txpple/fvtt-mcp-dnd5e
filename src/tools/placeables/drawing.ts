// Drawing CRUD tools — GM annotations (secret-area boxes, trap outlines, labels, planning marks)
// over the page-side Drawing descriptor (src/page/placeables/drawing.ts). x/y are the TOP-LEFT
// origin in absolute canvas pixels; polygon points are RELATIVE to that origin. Drawings default to
// hidden:false and the GM's stroke color — set hidden:true for GM-only planning marks.

import { z } from 'zod';
import { toInputSchema } from '../../utils/schema.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceables,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { sceneTarget, type PlaceableModuleFactory } from './_module.js';

const drawingStyleFields = {
  rotation: z.number().optional().describe('Rotation in degrees (0–359).'),
  elevation: z.number().optional().describe('Elevation in grid-distance units.'),
  sort: z.number().int().optional().describe('Z-sort within the elevation band.'),
  strokeWidth: z.number().min(0).optional().describe('Outline width in px (default 8).'),
  strokeColor: z.string().optional().describe('Outline color hex (default: your user color).'),
  strokeAlpha: z.number().min(0).max(1).optional().describe('Outline opacity 0–1 (default 1).'),
  fillType: z
    .number()
    .int()
    .optional()
    .describe('Fill: 0 none (default), 1 solid, 2 pattern (set fillTexture).'),
  fillColor: z.string().optional().describe('Fill color hex.'),
  fillAlpha: z.number().min(0).max(1).optional().describe('Fill opacity 0–1 (default 0.5).'),
  fillTexture: z
    .string()
    .optional()
    .describe('Data-relative image path for a pattern fill (fillType 2).'),
  text: z.string().optional().describe('Label text rendered at the drawing center.'),
  fontFamily: z.string().optional().describe('Label font family (default Signika).'),
  fontSize: z.number().int().positive().optional().describe('Label font size in px (default 48).'),
  textColor: z.string().optional().describe('Label color hex (default #ffffff).'),
  textAlpha: z.number().min(0).max(1).optional().describe('Label opacity 0–1.'),
  hidden: z.boolean().optional().describe('Hide from players (GM-only planning mark).'),
  locked: z.boolean().optional().describe('Lock against accidental drag/edit in-app.'),
  interface: z
    .boolean()
    .optional()
    .describe('Render on the interface layer (above fog/tokens, like a UI overlay).'),
};

const CreateDrawingsSchema = z.object({
  sceneIdentifier: sceneTarget,
  drawings: z
    .array(
      z.object({
        x: z.number().describe('Top-left origin X in absolute canvas pixels.'),
        y: z.number().describe('Top-left origin Y in absolute canvas pixels.'),
        shapeType: z
          .enum(['rectangle', 'circle', 'ellipse', 'polygon'])
          .optional()
          .describe('Shape kind (default rectangle).'),
        width: z.number().positive().optional().describe('Shape width in px (rectangle/ellipse).'),
        height: z
          .number()
          .positive()
          .optional()
          .describe('Shape height in px (rectangle/ellipse).'),
        radius: z.number().positive().optional().describe('Radius in px (circle).'),
        points: z
          .array(z.number())
          .optional()
          .describe(
            'Polygon vertices as a flat [x1,y1,x2,y2,…] list, RELATIVE to the x/y origin (≥3 pairs).'
          ),
        ...drawingStyleFields,
      })
    )
    .min(1)
    .describe('One or more drawings (annotation shapes / labels) to place.'),
});

const ListDrawingsSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateDrawingSchema = z
  .object({
    id: z.string().min(1).describe('Drawing id (from list-drawings).'),
    x: z.number().optional().describe('New top-left origin X in canvas pixels.'),
    y: z.number().optional().describe('New top-left origin Y in canvas pixels.'),
    width: z.number().positive().optional().describe('Resize width in px (rectangle/ellipse).'),
    height: z.number().positive().optional().describe('Resize height in px (rectangle/ellipse).'),
    radius: z.number().positive().optional().describe('Resize radius in px (circle).'),
    points: z
      .array(z.number())
      .optional()
      .describe('Replace polygon vertices (flat relative [x1,y1,…], ≥3 pairs).'),
    ...drawingStyleFields,
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message: 'Provide at least one field to change besides id.',
  });

const UpdateDrawingsSchema = z.object({
  sceneIdentifier: sceneTarget,
  drawings: z
    .array(UpdateDrawingSchema)
    .min(1)
    .describe('The drawing patches to apply (each targets one id).'),
});

const DeleteDrawingsSchema = z.object({
  sceneIdentifier: sceneTarget,
  drawingIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Drawing ids to delete (from list-drawings).'),
});

export const drawingToolModule: PlaceableModuleFactory = foundry => ({
  defs: [
    {
      name: 'create-drawings',
      description:
        'Place drawings: x / y the top-left in canvas pixels; shapeType rectangle / ellipse (width + ' +
        'height), circle (radius) or polygon (relative points); stroke, fill, a text label, hidden, ' +
        'interface. One bad drawing does not fail the batch. Returns the ids. GM-only.',
      inputSchema: toInputSchema(CreateDrawingsSchema),
    },
    {
      name: 'list-drawings',
      description:
        'Every drawing on a scene: id, origin, shape and dimensions, rotation, text, fill, stroke, ' +
        'hidden / locked / interface.',
      inputSchema: toInputSchema(ListDrawingsSchema),
    },
    {
      name: 'update-drawings',
      description:
        'Edit placed drawings by id (text:"" clears the label); the shape kind cannot change. Only ' +
        'the fields passed change. GM-only.',
      inputSchema: toInputSchema(UpdateDrawingsSchema),
    },
    {
      name: 'delete-drawings',
      description: 'Delete drawings by id; missing ids are reported, never fatal. GM-only.',
      inputSchema: toInputSchema(DeleteDrawingsSchema),
    },
  ],
  handlers: {
    'create-drawings': async args => {
      const { sceneIdentifier, drawings } = CreateDrawingsSchema.parse(args ?? {});
      const result = await foundry.call('createSceneDrawings', {
        sceneIdentifier,
        items: drawings,
      });
      return formatCreatePlaceables(result, 'drawing');
    },
    'list-drawings': async args => {
      const parsed = ListDrawingsSchema.parse(args ?? {});
      const result = await foundry.call('listSceneDrawings', parsed);
      return formatListPlaceables(result, 'drawing');
    },
    'update-drawings': async args => {
      const { sceneIdentifier, drawings } = UpdateDrawingsSchema.parse(args ?? {});
      const result = await foundry.call('updateSceneDrawings', {
        sceneIdentifier,
        patches: drawings,
      });
      return formatUpdatePlaceables(result, 'drawing');
    },
    'delete-drawings': async args => {
      const { sceneIdentifier, drawingIds } = DeleteDrawingsSchema.parse(args ?? {});
      const result = await foundry.call('deleteSceneDrawings', {
        sceneIdentifier,
        ids: drawingIds,
      });
      return formatDeletePlaceables(result, 'drawing');
    },
  },
});
