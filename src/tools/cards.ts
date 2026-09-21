import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { deletedLine, listLines, warningBlock } from '../utils/lines.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * Cards tools — Cards stacks (decks, hands, piles — a deck of many things, tarokka, custom
 * encounter decks) as ONE tool: `manage-cards`, selected by `action` (create / import / list /
 * delete; src/tools/_union.ts — M8 of the 3.0 plan). Runs over the bridge against live Foundry
 * documents (page/collections.ts). GM-only for writes.
 */

export const MANAGE_CARDS = 'manage-cards';

// Single source of truth for each action's input contract: the member parses with these schemas
// and the advertised JSON Schema is derived from the same zod.
const CreateCardsSchema = z.object({
  name: z.string().min(1).describe('Stack name.'),
  type: z.enum(['deck', 'hand', 'pile']).optional().describe('Default deck.'),
  description: z.string().optional(),
  folderName: z.string().optional(),
  cards: z
    .array(
      z.object({
        name: z.string().min(1).describe('Card name.'),
        description: z.string().optional().describe('GM note, not shown on the face.'),
        text: z
          .string()
          .optional()
          .describe('Face text (HTML); text and/or img give the card a face.'),
        img: z.string().optional().describe('Data-relative face image path.'),
      })
    )
    .optional()
    .describe('The initial cards.'),
});

const ListCardsSchema = z.object({});

const ImportCardsSchema = z.object({
  preset: z.string().min(1).describe('Core preset deck key ("pokerDark" / "pokerLight").'),
  name: z.string().min(1).optional().describe('Name for the stack.'),
  folderName: z.string().optional(),
});

const DeleteCardsSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids or exact names.'),
});

/** The list columns (§3: a fixed, documented order). */
const LIST_COLUMNS = ['id', 'name', 'type', 'cards'] as const;

export interface CardsToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class CardsTools {
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: CardsToolsOptions) {
    this.logger = logger.child({ component: 'CardsTools' });
    this.union = unionTool({
      name: MANAGE_CARDS,
      description: 'Cards stacks by exact id or name: create / import / list / delete. GM-only.',
      discriminators: ['action'],
      shared: { folderName: z.string().describe('Folder (created if absent).') },
      members: [
        unionMember({
          select: { action: 'create' },
          description: 'Create a stack with its cards.',
          schema: CreateCardsSchema,
          handler: async parsed => {
            const r = await foundry.call('createCards', parsed);
            return (
              `Created ${r?.type} "${r?.cardsName}" (${r?.cardsId}) with ${r?.cardCount} card(s)` +
              warningBlock(r?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'import' },
          description: 'Create a stack from a core preset deck.',
          schema: ImportCardsSchema,
          handler: async parsed => {
            const r = await foundry.call('importCardsPreset', parsed);
            return (
              `Imported ${r?.type} "${r?.cardsName}" (${r?.cardsId}) from preset "${r?.preset}": ` +
              `${r?.cardCount} card(s)`
            );
          },
        }),
        unionMember({
          select: { action: 'list' },
          description: 'Stacks: id, name, type, card count.',
          schema: ListCardsSchema,
          handler: async () => {
            const stacks = await foundry.call('listCards');
            const records = (Array.isArray(stacks) ? stacks : []).map(c => ({
              id: c.id,
              name: c.name,
              type: c.type,
              cards: c.cardCount,
            }));
            return listLines(`${records.length} stack(s)`, LIST_COLUMNS, records);
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Permanently delete stacks.',
          schema: DeleteCardsSchema,
          handler: async ({ identifiers }) => {
            const r = await foundry.call('deleteCards', { identifiers });
            return deletedLine(r, 'stack');
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [this.union.def];
  }

  /** Route one cards tool call to its member (registry-facing). */
  async handle(name: string, args: unknown): Promise<unknown> {
    if (name !== MANAGE_CARDS) throw new Error(`Unknown cards tool: ${name}`);
    return this.union.handle(args);
  }
}
