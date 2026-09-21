// Tile CRUD tools — thin schemas/handlers over the page-side Tile descriptor (src/page/placeables/tile.ts).

import { z } from 'zod';
import { toInputSchema } from '../../utils/schema.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceables,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { sceneTarget, type PlaceableModuleFactory } from './_module.js';

// The editable Tile fields shared by create-tiles and update-tiles. A tile's on-map SIZE is
// width/height (px) — that is the "scale" you resize a prop with; texture.scaleX/scaleY instead
// zoom the image WITHIN that frame. x/y are absolute canvas pixels, TOP-LEFT of the tile (see
// get-scene-dimensions for the padding-aware cell→px math) — the page layer converts to/from the
// v14 doc's center-anchored x/y, so callers never see the anchor math.
const tileFields = {
  rotation: z.number().optional().describe('Rotation in degrees (0–359).'),
  alpha: z.number().min(0).max(1).optional().describe('Opacity 0–1 (default 1).'),
  elevation: z.number().optional().describe('Elevation in grid-distance units (stacking/height).'),
  sort: z.number().int().optional().describe('Z-sort within the elevation band (higher = on top).'),
  scaleX: z
    .number()
    .positive()
    .optional()
    .describe('Texture scale X: zooms the image inside the frame (not the tile size).'),
  scaleY: z
    .number()
    .positive()
    .optional()
    .describe('Texture scale Y (image zoom within the frame).'),
  tint: z.string().optional().describe('Texture tint hex, e.g. "#ffffff" (no tint).'),
  fit: z
    .enum(['fill', 'contain', 'cover', 'width', 'height'])
    .optional()
    .describe('How the image fits its width/height frame (default "fill").'),
  occlusionMode: z
    .number()
    .int()
    .optional()
    .describe('Overhead occlusion: 0 none, 1 fade, 2 surface, 4 radial, 8 vision.'),
  occlusionAlpha: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Alpha the tile fades TO when occluding (0 = fully transparent).'),
  restrictLight: z.boolean().optional().describe('Block light from passing through this tile.'),
  restrictWeather: z.boolean().optional().describe('Block weather from showing over this tile.'),
  videoLoop: z.boolean().optional().describe('For a video tile: loop playback.'),
  videoAutoplay: z.boolean().optional().describe('For a video tile: autoplay.'),
  videoVolume: z.number().min(0).max(1).optional().describe('For a video tile: volume 0–1.'),
  hidden: z.boolean().optional().describe('Hide the tile from players (GM-only visible).'),
  locked: z.boolean().optional().describe('Lock the tile against accidental drag/edit in-app.'),
};

const CreateTilesSchema = z.object({
  sceneIdentifier: sceneTarget,
  tiles: z
    .array(
      z.object({
        src: z
          .string()
          .min(1)
          .describe('Data-relative image (or video) path for the tile texture.'),
        x: z
          .number()
          .describe('Top-left X in absolute canvas pixels (the center-anchor conversion is done).'),
        y: z.number().describe('Top-left Y in absolute canvas pixels.'),
        width: z.number().positive().describe('On-map width in canvas pixels.'),
        height: z.number().positive().describe('On-map height in canvas pixels.'),
        ...tileFields,
      })
    )
    .min(1)
    .describe('The tiles to place.'),
});

const ListTilesSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateTileSchema = z
  .object({
    id: z.string().min(1).describe('Tile id (from list-tiles).'),
    x: z.number().optional().describe('New top-left X in canvas pixels.'),
    y: z.number().optional().describe('New top-left Y in canvas pixels.'),
    width: z
      .number()
      .positive()
      .optional()
      .describe('New width in px; the top-left stays unless x is given.'),
    height: z
      .number()
      .positive()
      .optional()
      .describe('New height in px; the top-left stays unless y is given.'),
    src: z.string().min(1).optional().describe('Swap the texture (Data-relative path).'),
    ...tileFields,
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message: 'Provide at least one field to change besides id.',
  });

const UpdateTilesSchema = z.object({
  sceneIdentifier: sceneTarget,
  tiles: z
    .array(UpdateTileSchema)
    .min(1)
    .describe('The tile patches to apply (each targets one id).'),
});

const DeleteTilesSchema = z.object({
  sceneIdentifier: sceneTarget,
  tileIds: z.array(z.string().min(1)).min(1).describe('Tile ids to delete (from list-tiles).'),
});

export const tileToolModule: PlaceableModuleFactory = foundry => ({
  defs: [
    {
      name: 'create-tiles',
      description:
        'Place tiles (props, roofs, decals, video overlays) from Data-relative paths: x / y the ' +
        'top-left and width / height the on-map size, all in canvas pixels (the center-anchor ' +
        'conversion is done). A 404 texture keeps the path with a warning; one bad tile does not ' +
        'fail the batch. Returns the ids. GM-only.',
      inputSchema: toInputSchema(CreateTilesSchema),
    },
    {
      name: 'list-tiles',
      description:
        'Every tile on a scene: id, top-left x / y, width / height, rotation, elevation, sort, ' +
        'texture, image scale, hidden / locked.',
      inputSchema: toInputSchema(ListTilesSchema),
    },
    {
      name: 'update-tiles',
      description:
        'Edit placed tiles by id: move (x / y, the top-left), resize (width / height), and any ' +
        'other tile field. Only the fields passed change; unresolved ids are reported, not fatal. ' +
        'GM-only.',
      inputSchema: toInputSchema(UpdateTilesSchema),
    },
    {
      name: 'delete-tiles',
      description: 'Delete tiles by id; missing ids are reported, never fatal. GM-only.',
      inputSchema: toInputSchema(DeleteTilesSchema),
    },
  ],
  handlers: {
    'create-tiles': async args => {
      const { sceneIdentifier, tiles } = CreateTilesSchema.parse(args ?? {});
      const result = await foundry.call('createSceneTiles', { sceneIdentifier, items: tiles });
      return formatCreatePlaceables(result, 'tile');
    },
    'list-tiles': async args => {
      const parsed = ListTilesSchema.parse(args ?? {});
      const result = await foundry.call('listSceneTiles', parsed);
      return formatListPlaceables(result, 'tile');
    },
    'update-tiles': async args => {
      const { sceneIdentifier, tiles } = UpdateTilesSchema.parse(args ?? {});
      const result = await foundry.call('updateSceneTiles', { sceneIdentifier, patches: tiles });
      return formatUpdatePlaceables(result, 'tile');
    },
    'delete-tiles': async args => {
      const { sceneIdentifier, tileIds } = DeleteTilesSchema.parse(args ?? {});
      const result = await foundry.call('deleteSceneTiles', { sceneIdentifier, ids: tileIds });
      return formatDeletePlaceables(result, 'tile');
    },
  },
});
