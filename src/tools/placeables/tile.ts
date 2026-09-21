// Tile actions of manage-placeables — thin schemas/handlers over the page-side Tile descriptor
// (src/page/placeables/tile.ts).

import { z } from 'zod';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceableLines,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { placeableAction, sceneTarget, type PlaceableKindFactory } from './_module.js';

// The editable Tile fields shared by the create and update actions. A tile's on-map SIZE is
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
  items: z
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
    id: z.string().min(1).describe('Tile id (from action list).'),
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
  patches: z.array(UpdateTileSchema).min(1).describe('One patch per tile; each targets one id.'),
});

const DeleteTilesSchema = z.object({
  sceneIdentifier: sceneTarget,
  ids: z.array(z.string().min(1)).min(1).describe('Tile ids to delete (from action list).'),
});

export const tileKindModule: PlaceableKindFactory = foundry => ({
  kind: 'tiles',
  actions: [
    placeableAction({
      action: 'create',
      description:
        'Place tiles (props, roofs, decals, video overlays) from Data-relative paths: x / y the ' +
        'top-left and width / height the on-map size, all in canvas pixels (the center-anchor ' +
        'conversion is done). A 404 texture keeps the path with a warning.',
      schema: CreateTilesSchema,
      handler: async ({ sceneIdentifier, items }) => {
        const result = await foundry.call('createSceneTiles', { sceneIdentifier, items });
        return formatCreatePlaceables(result, 'tile');
      },
    }),
    placeableAction({
      action: 'list',
      description:
        'Every tile on a scene: id, top-left x / y, width / height, rotation, elevation, sort, ' +
        'hidden / locked, texture src, image scale.',
      schema: ListTilesSchema,
      handler: async parsed => {
        const result = await foundry.call('listSceneTiles', parsed);
        return formatListPlaceableLines(result, 'tile');
      },
    }),
    placeableAction({
      action: 'update',
      description:
        'Edit placed tiles by id: move (x / y, the top-left), resize (width / height), and any ' +
        'other tile field. Only the fields passed change.',
      schema: UpdateTilesSchema,
      handler: async ({ sceneIdentifier, patches }) => {
        const result = await foundry.call('updateSceneTiles', { sceneIdentifier, patches });
        return formatUpdatePlaceables(result, 'tile');
      },
    }),
    placeableAction({
      action: 'delete',
      description: 'Delete tiles by id.',
      schema: DeleteTilesSchema,
      handler: async ({ sceneIdentifier, ids }) => {
        const result = await foundry.call('deleteSceneTiles', { sceneIdentifier, ids });
        return formatDeletePlaceables(result, 'tile');
      },
    }),
  ],
});
