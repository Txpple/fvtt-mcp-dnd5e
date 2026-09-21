import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * Macro tools — world Macro documents and user hotbar pins.
 * - create-macro: author a script/chat macro, grant a player OWNER access, and pin it to their
 *   hotbar in one call — the "hand a player a one-click button" op.
 * - list-macros: the namespace's read — every macro with its type, author, command preview, and
 *   every user hotbar slot it occupies.
 * - delete-macro: remove macros and scrub any user hotbar slots that pointed at them.
 */

const CreateMacroSchema = z
  .object({
    name: z.string().min(1).describe('Macro name.'),
    command: z
      .string()
      .min(1)
      .describe(
        'script: JavaScript, run as the clicking user; chat: the text posted (inline rolls work).'
      ),
    type: z.enum(['script', 'chat']).default('script').describe('Default script.'),
    img: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Icon path or URL; an unresolvable path falls back to the stock icon with a warning.'
      ),
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
  verbose: z.boolean().optional().describe('Each pin (user + slot) and a command preview.'),
});

const DeleteMacroSchema = z.object({
  macros: z
    .array(z.string().min(1))
    .min(1)
    .describe('Macro ids or exact names (case-insensitive) to delete. Find them with list-macros.'),
});

export interface MacroToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class MacroTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: MacroToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'MacroTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'create-macro',
        description:
          "Create a world Macro (script or chat), optionally owned by and pinned to a user's " +
          'hotbar. GM-only.',
        inputSchema: toInputSchema(CreateMacroSchema),
      },
      {
        name: 'list-macros',
        description:
          'Macros: name, id, type, author, pin count (verbose: each pin and a command preview); ' +
          'filtered by name substring or pinning user.',
        inputSchema: toInputSchema(ListMacrosSchema),
      },
      {
        name: 'delete-macro',
        description:
          'Delete world macros by id or exact name, and the hotbar slots that pointed at them. ' +
          'GM-only.',
        inputSchema: toInputSchema(DeleteMacroSchema),
      },
    ];
  }

  async handleCreateMacro(args: any): Promise<string> {
    const parsed = CreateMacroSchema.parse(args ?? {});
    const r = await this.foundry.call('createMacro', parsed);
    const lines = [`✅ Created ${r?.macro?.type} macro "${r?.macro?.name}" (\`${r?.macro?.id}\`)`];
    if (r?.hotbar) {
      lines.push(`**Hotbar:** ${r.hotbar.userName}'s slot ${r.hotbar.slot}`);
    }
    const warns = Array.isArray(r?.warnings) ? r.warnings : [];
    if (warns.length) {
      lines.push('', `⚠️ ${warns.length} warning(s):`, ...warns.map((w: string) => `- ${w}`));
    }
    return lines.join('\n');
  }

  async handleListMacros(args: any): Promise<string> {
    const { nameFilter, user, verbose } = ListMacrosSchema.parse(args ?? {});
    const r = await this.foundry.call('listMacros', {
      ...(nameFilter !== undefined ? { nameFilter } : {}),
      ...(user !== undefined ? { user } : {}),
    });
    const macros = Array.isArray(r?.macros) ? r.macros : [];
    if (macros.length === 0) return 'No macros in this world.';
    const lines = macros.map((m: any) => {
      const pins = Array.isArray(m.hotbar) ? m.hotbar : [];
      const pinText = !pins.length
        ? ''
        : verbose
          ? ` · hotbar: ${pins.map((p: any) => `${p.userName} slot ${p.slot}`).join(', ')}`
          : ` · ${pins.length} pin(s)`;
      const preview =
        verbose && m.commandPreview ? `\n    ${String(m.commandPreview).replace(/\s+/g, ' ')}` : '';
      return `- **${m.name}** (\`${m.id}\`) — ${m.type}${m.author ? ` · by ${m.author}` : ''}${pinText}${preview}`;
    });
    return `${macros.length} macro(s):\n${lines.join('\n')}`;
  }

  async handleDeleteMacros(args: any): Promise<string> {
    const parsed = DeleteMacroSchema.parse(args ?? {});
    const r = await this.foundry.call('deleteMacros', parsed);
    const deleted = Array.isArray(r?.deleted) ? r.deleted : [];
    const lines = [
      `🗑️ Deleted ${deleted.length} macro(s): ${deleted.map((m: any) => `"${m.name}"`).join(', ')}`,
    ];
    const scrubbed = Array.isArray(r?.scrubbedHotbarSlots) ? r.scrubbedHotbarSlots : [];
    if (scrubbed.length) {
      lines.push(
        `**Hotbar slots scrubbed:** ${scrubbed
          .map((s: any) => `${s.userName} slot ${s.slot}`)
          .join(', ')}`
      );
    }
    const missing = Array.isArray(r?.missing) ? r.missing : [];
    if (missing.length) {
      lines.push(`⚠️ Not found (skipped): ${missing.join(', ')}`);
    }
    return lines.join('\n');
  }
}
