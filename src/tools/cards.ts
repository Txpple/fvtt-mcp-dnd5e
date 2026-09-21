import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { formatDeletionResult } from '../utils/format.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * Cards tools — create / list / delete. Net-new document type for adventure
 * creation (decks, hands, piles — e.g. a deck of many things, tarokka, custom
 * encounter decks). Runs over the bridge against live Foundry documents, so the
 * world must be loaded and the headless Foundry client connected. GM-only for writes.
 */

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.
const CreateCardsSchema = z.object({
  name: z.string().min(1).describe('Cards stack name.'),
  type: z.enum(['deck', 'hand', 'pile']).optional().describe('Stack type (default "deck").'),
  description: z.string().optional(),
  folderName: z.string().optional().describe('Folder (created if absent).'),
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
  folderName: z.string().optional().describe('Folder (created if absent).'),
});

const DeleteCardsSchema = z.object({
  identifiers: z
    .array(z.string().min(1))
    .min(1)
    .describe('Exact ids (preferred) or exact names of Cards stacks to delete.'),
});

export interface CardsToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class CardsTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: CardsToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'CardsTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'create-cards',
        description:
          'Create a Cards stack (deck, hand or pile) with its cards (name, face text and/or image, a ' +
          'GM note). GM-only.',
        inputSchema: toInputSchema(CreateCardsSchema),
      },
      {
        name: 'import-cards',
        description: 'Create a stack from a core preset deck (a standard 52-card deck). GM-only.',
        inputSchema: toInputSchema(ImportCardsSchema),
      },
      {
        name: 'list-cards',
        description: 'List Cards stacks with id, name, type (deck/hand/pile), and card count.',
        inputSchema: toInputSchema(ListCardsSchema),
      },
      {
        name: 'delete-cards',
        description: 'Permanently delete Cards stacks by exact id or exact name. GM-only.',
        inputSchema: toInputSchema(DeleteCardsSchema),
      },
    ];
  }

  async handleCreateCards(args: any): Promise<string> {
    const parsed = CreateCardsSchema.parse(args ?? {});
    const result = await this.foundry.call('createCards', parsed);
    let out =
      `Created ${result?.type} "${result?.cardsName}" (${result?.cardsId}) with ` +
      `${result?.cardCount} card(s).`;
    const warns = Array.isArray(result?.warnings) ? result.warnings : [];
    if (warns.length) {
      out += `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`;
    }
    return out;
  }

  async handleImportCards(args: any): Promise<string> {
    const parsed = ImportCardsSchema.parse(args ?? {});
    const result = await this.foundry.call('importCardsPreset', parsed);
    return (
      `Imported ${result?.type} "${result?.cardsName}" (${result?.cardsId}) from preset ` +
      `"${result?.preset}" — ${result?.cardCount} card(s).`
    );
  }

  async handleListCards(_args: any): Promise<string> {
    const stacks = (await this.foundry.call('listCards')) ?? [];
    if (!Array.isArray(stacks) || stacks.length === 0) return 'No card stacks found.';
    const lines = stacks.map(
      (c: any) => `  - "${c.name}" (${c.id}) — ${c.type}, ${c.cardCount} card(s)`
    );
    return `Card stacks (${stacks.length}):\n${lines.join('\n')}`;
  }

  async handleDeleteCards(args: any): Promise<string> {
    const { identifiers } = DeleteCardsSchema.parse(args ?? {});
    const result = await this.foundry.call('deleteCards', { identifiers });
    return formatDeletionResult(result, 'card stack(s)');
  }
}
