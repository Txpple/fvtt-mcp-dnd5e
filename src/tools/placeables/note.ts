// Map-note (pin) tools — the legend→pins pipeline: create-scene-notes / list-notes / update-note /
// delete-note over the page-side Note descriptor (src/page/placeables/note.ts). update-note stays
// SINGLE-target by schema (the pin-nudge loop edits one pin at a time); it rides the same kernel
// batch machinery underneath.

import { z } from 'zod';
import { SCENE_TARGET, sceneTargetRequired } from '../_targets.js';
import { toInputSchema } from '../../utils/schema.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceables,
} from '../../utils/placeable-format.js';
import { sceneTarget, type PlaceableModuleFactory } from './_module.js';

const CreateSceneNotesSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
  notes: z
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
    sceneIdentifier: sceneTargetRequired.describe(`${SCENE_TARGET} holding the pin.`),
    noteId: z
      .string()
      .min(1)
      .describe('The Note id to update (from create-scene-notes/list-notes).'),
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
  .refine(
    v =>
      v.x !== undefined ||
      v.y !== undefined ||
      v.label !== undefined ||
      v.iconSize !== undefined ||
      v.global !== undefined ||
      v.icon !== undefined ||
      v.journal !== undefined,
    {
      message:
        'Provide at least one field to update (x, y, label, iconSize, global, icon, or journal).',
    }
  );

const DeleteNoteSchema = z.object({
  sceneIdentifier: sceneTargetRequired.describe(`${SCENE_TARGET} holding the pins.`),
  noteIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Note ids to delete (from create-scene-notes/list-notes).'),
});

export const noteToolModule: PlaceableModuleFactory = foundry => ({
  defs: [
    {
      name: 'create-scene-notes',
      description:
        'Place map-note pins, each linked to a JournalEntry (and optionally a page), at canvas-pixel ' +
        'x / y with a label / icon / size. A pin whose journal does not resolve is skipped and ' +
        'reported. Returns the ids. GM-only.',
      inputSchema: toInputSchema(CreateSceneNotesSchema),
    },
    {
      name: 'list-notes',
      description:
        'Every map-note pin on a scene: id, x / y, label, entryId / pageId, icon + size, global, ' +
        'font.',
      inputSchema: toInputSchema(ListNotesSchema),
    },
    {
      name: 'update-note',
      description:
        'Edit one map-note pin by id: position, label, icon, global, or its journal / page. Only ' +
        'the fields passed change. GM-only.',
      inputSchema: toInputSchema(UpdateNoteSchema),
    },
    {
      name: 'delete-note',
      description: 'Remove map-note pins by id; missing ids are reported, never fatal. GM-only.',
      inputSchema: toInputSchema(DeleteNoteSchema),
    },
  ],
  handlers: {
    'create-scene-notes': async args => {
      const { sceneIdentifier, notes } = CreateSceneNotesSchema.parse(args ?? {});
      const result = await foundry.call('createSceneNotes', { sceneIdentifier, items: notes });
      return formatCreatePlaceables(result, 'map-note pin');
    },
    'list-notes': async args => {
      const parsed = ListNotesSchema.parse(args ?? {});
      const result = await foundry.call('listSceneNotes', parsed);
      return formatListPlaceables(result, 'note');
    },
    'update-note': async args => {
      const { sceneIdentifier, noteId, ...fields } = UpdateNoteSchema.parse(args ?? {});
      const result = await foundry.call('updateSceneNotes', {
        sceneIdentifier,
        patches: [{ id: noteId, ...fields }],
      });
      const warns = Array.isArray(result?.warnings) ? result.warnings : [];
      const warnLine = warns.length
        ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
        : '';
      if (result?.notFound) return `Scene not found: "${result.notFound}". Nothing changed.`;
      if ((result?.matched ?? 0) === 0) {
        return `Note not found: "${noteId}". Nothing changed.`;
      }
      if ((result?.updated ?? 0) === 0) {
        // Matched but nothing applied — e.g. the only change was a dropped (404) icon.
        return `No changes applied to note ${noteId} on "${result?.sceneName}" (${result?.sceneId}).${warnLine}`;
      }
      return `Updated note ${noteId} on "${result?.sceneName}" (${result?.sceneId}).${warnLine}`;
    },
    'delete-note': async args => {
      const { sceneIdentifier, noteIds } = DeleteNoteSchema.parse(args ?? {});
      const result = await foundry.call('deleteSceneNotes', { sceneIdentifier, ids: noteIds });
      return formatDeletePlaceables(result, 'note');
    },
  },
});
