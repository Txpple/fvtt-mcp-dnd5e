// Map-note (pin) actions of manage-placeables — the legend→pins pipeline over the page-side Note
// descriptor (src/page/placeables/note.ts). Like every other kind: create / update take one entry
// per pin (the pin-nudge loop passes one), delete takes ids, the scene defaults to the active one.

import { z } from 'zod';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceableLines,
  formatUpdatePlaceables,
} from '../../utils/placeable-format.js';
import { placeableAction, sceneTarget, type PlaceableKindFactory } from './_module.js';

const CreateNotesSchema = z.object({
  sceneIdentifier: sceneTarget,
  items: z
    .array(
      z.object({
        journal: z.string().min(1).describe('JournalEntry id or exact name the pin opens.'),
        page: z.string().optional().describe('Page id or exact name within that entry.'),
        x: z.number().describe('Pin X in absolute canvas pixels.'),
        y: z.number().describe('Pin Y in absolute canvas pixels.'),
        label: z.string().optional().describe('Pin text (default the entry name).'),
        icon: z.string().optional().describe('Data-relative icon path (default the note pin).'),
        iconSize: z.number().int().positive().optional().describe('Icon size in px (min 32).'),
        global: z
          .boolean()
          .optional()
          .describe("Shown through fog (not a permission: secrecy is the journal's ownership)."),
      })
    )
    .min(1)
    .describe('The map-note pins to create.'),
});

const ListNotesSchema = z.object({ sceneIdentifier: sceneTarget });

const UpdateNoteSchema = z
  .object({
    id: z.string().min(1).describe('Note id (from action create / list).'),
    x: z.number().optional().describe('New pin X in absolute canvas pixels.'),
    y: z.number().optional().describe('New pin Y in absolute canvas pixels.'),
    label: z.string().optional().describe('New text shown on the pin.'),
    iconSize: z.number().int().positive().optional().describe('New icon size in px (min 32).'),
    global: z
      .boolean()
      .optional()
      .describe('Render the pin through fog/vision occlusion (NOT a permission control).'),
    icon: z.string().optional().describe('New Data-relative icon image src.'),
    journal: z
      .string()
      .optional()
      .describe('Re-point the pin to a different JournalEntry (id or exact name, strict resolve).'),
    page: z
      .string()
      .optional()
      .describe('Page id or exact name within the (re-pointed) journal; only used with `journal`.'),
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as any)[k] !== undefined), {
    message:
      'Provide at least one field to change besides id (x, y, label, iconSize, global, icon, journal).',
  });

const UpdateNotesSchema = z.object({
  sceneIdentifier: sceneTarget,
  patches: z.array(UpdateNoteSchema).min(1).describe('One patch per pin; each targets one id.'),
});

const DeleteNotesSchema = z.object({
  sceneIdentifier: sceneTarget,
  ids: z
    .array(z.string().min(1))
    .min(1)
    .describe('Note ids to delete (from action create / list).'),
});

export const noteKindModule: PlaceableKindFactory = foundry => ({
  kind: 'notes',
  actions: [
    placeableAction({
      action: 'create',
      description:
        'Place map-note pins, each linked to a JournalEntry (and optionally a page), at canvas-pixel ' +
        'x / y with a label / icon / size. A pin whose journal does not resolve is skipped and ' +
        'reported.',
      schema: CreateNotesSchema,
      handler: async ({ sceneIdentifier, items }) => {
        const result = await foundry.call('createSceneNotes', { sceneIdentifier, items });
        return formatCreatePlaceables(result, 'note');
      },
    }),
    placeableAction({
      action: 'list',
      description:
        'Every map-note pin on a scene: id, x / y, label, entryId / pageId, icon + size, global, ' +
        'font.',
      schema: ListNotesSchema,
      handler: async parsed => {
        const result = await foundry.call('listSceneNotes', parsed);
        return formatListPlaceableLines(result, 'note');
      },
    }),
    placeableAction({
      action: 'update',
      description:
        'Edit map-note pins by id: position, label, icon, global, or the journal / page. Only the ' +
        'fields passed change; a dropped (404) icon is a warning, not a change.',
      schema: UpdateNotesSchema,
      handler: async ({ sceneIdentifier, patches }) => {
        const result = await foundry.call('updateSceneNotes', { sceneIdentifier, patches });
        return formatUpdatePlaceables(result, 'note');
      },
    }),
    placeableAction({
      action: 'delete',
      description: 'Remove map-note pins by id.',
      schema: DeleteNotesSchema,
      handler: async ({ sceneIdentifier, ids }) => {
        const result = await foundry.call('deleteSceneNotes', { sceneIdentifier, ids });
        return formatDeletePlaceables(result, 'note');
      },
    }),
  ],
});
