import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { listLines, warningBlock } from '../utils/lines.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * Macro tools — world Macro documents and user hotbar pins, advertised as ONE tool:
 * `manage-macros`, selected by `action` (src/tools/_union.ts — M8 of the 3.0 plan).
 * - create: author a script/chat macro, grant a player OWNER access, and pin it to their hotbar
 *   in one call — the "hand a player a one-click button" op.
 * - list: the namespace's read — every macro with its type, author, pin count (verbose: each
 *   user hotbar slot it occupies and a command preview), on the design.md §3 line shape.
 * - delete: remove macros and scrub any user hotbar slots that pointed at them.
 */

export const MANAGE_MACROS = 'manage-macros';

const CreateMacroSchema = z
  .object({
    name: z.string().min(1).describe('Macro name.'),
    command: z
      .string()
      .min(1)
      .describe(
        'script: JavaScript, run as the clicking user; chat: the text posted (inline rolls work).'
      ),
    type: z.enum(['script', 'chat']).default('script'),
    img: z
      .string()
      .min(1)
      .optional()
      .describe('Icon path; unresolvable = the stock icon + a warning.'),
    owner: z
      .string()
      .min(1)
      .optional()
      .describe('A further user (id or name) granted OWNER; the hotbarUser always is.'),
    hotbarUser: z
      .string()
      .min(1)
      .optional()
      .describe('User (id or name) whose hotbar gets the button, granted OWNER; omit = unpinned.'),
    hotbarSlot: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Slot 1–50 (default the first free; an occupied slot is replaced with a warning).'),
  })
  .refine(o => o.hotbarSlot === undefined || o.hotbarUser !== undefined, {
    message: 'hotbarSlot requires hotbarUser',
  });

const ListMacrosSchema = z.object({
  nameFilter: z.string().optional().describe('Case-insensitive substring match on macro name.'),
  user: z.string().optional().describe("Only macros on this user's hotbar (id or name)."),
  verbose: z.boolean().optional().describe('Add the hotbar and command columns.'),
});

const DeleteMacrosSchema = z.object({
  macros: z
    .array(z.string().min(1))
    .min(1)
    .describe('Macro ids or exact names (case-insensitive).'),
});

/** The list columns (§3: a fixed, documented order); `verbose` appends the last two. */
const LIST_COLUMNS = ['id', 'name', 'type', 'author', 'pins'] as const;
const VERBOSE_COLUMNS = [...LIST_COLUMNS, 'hotbar', 'command'] as const;

const pinText = (pins: Array<{ userName: string; slot: number }>): string =>
  pins.map(p => `${p.userName} slot ${p.slot}`).join(', ');

export interface MacroToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class MacroTools {
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: MacroToolsOptions) {
    this.logger = logger.child({ component: 'MacroTools' });
    this.union = unionTool({
      name: MANAGE_MACROS,
      description: 'World macros and user hotbar pins. GM-only.',
      discriminators: ['action'],
      members: [
        unionMember({
          select: { action: 'create' },
          description: "Create a script or chat macro, optionally pinned to a user's hotbar.",
          schema: CreateMacroSchema,
          handler: async parsed => {
            const r = await foundry.call('createMacro', parsed);
            const pinned = r?.hotbar
              ? `; pinned to ${r.hotbar.userName}'s slot ${r.hotbar.slot}`
              : '';
            return (
              `Created ${r?.macro?.type} macro "${r?.macro?.name}" (${r?.macro?.id})${pinned}` +
              warningBlock(r?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'list' },
          description:
            'List macros: id, name, type, author, pin count (verbose: pins + command preview).',
          schema: ListMacrosSchema,
          handler: async ({ nameFilter, user, verbose }) => {
            const r = await foundry.call('listMacros', {
              ...(nameFilter !== undefined ? { nameFilter } : {}),
              ...(user !== undefined ? { user } : {}),
            });
            const macros = Array.isArray(r?.macros) ? r.macros : [];
            const records = macros.map(m => {
              const pins = Array.isArray(m.hotbar) ? m.hotbar : [];
              return {
                id: m.id,
                name: m.name,
                type: m.type,
                author: m.author ?? null,
                pins: pins.length,
                hotbar: pins.length ? pinText(pins) : null,
                command: m.commandPreview
                  ? String(m.commandPreview).replace(/\s+/g, ' ').trim()
                  : null,
              };
            });
            return listLines(
              `${records.length} macro(s)`,
              verbose ? VERBOSE_COLUMNS : LIST_COLUMNS,
              records
            );
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Delete macros and the hotbar slots that pointed at them.',
          schema: DeleteMacrosSchema,
          handler: async parsed => {
            const r = await foundry.call('deleteMacros', parsed);
            const deleted = Array.isArray(r?.deleted) ? r.deleted : [];
            const scrubbed = Array.isArray(r?.scrubbedHotbarSlots) ? r.scrubbedHotbarSlots : [];
            const missing = Array.isArray(r?.missing) ? r.missing : [];
            return (
              `Deleted ${deleted.length} macro(s): ` +
              deleted.map(m => `"${m.name}" (${m.id})`).join(', ') +
              (scrubbed.length ? `; hotbar slots scrubbed: ${pinText(scrubbed)}` : '') +
              (missing.length ? ` (${missing.length} not found: ${missing.join(', ')})` : '')
            );
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [this.union.def];
  }

  /** Route one macro tool call to its member (registry-facing). */
  async handle(name: string, args: unknown): Promise<unknown> {
    if (name !== MANAGE_MACROS) throw new Error(`Unknown macro tool: ${name}`);
    return this.union.handle(args);
  }
}
