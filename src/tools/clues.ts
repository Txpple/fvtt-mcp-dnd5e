import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { listLines } from '../utils/lines.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * manage-clues — the party's clues, through house module fvtt-mod-clueboard (Open Roll 5e: Clue
 * Board). A Clue is the module's own Item type, made with manage-items create
 * (`type: "fvtt-mod-clueboard.clue"`); this tool puts it on a party's record (list / collect /
 * uncollect), through the module's API (page/clues.ts). GM-only for writes.
 */

export const MANAGE_CLUES = 'manage-clues';

// The leaves the members share are described once at the root (src/tools/_union.ts).
const clues = z.array(z.string().min(1)).min(1).describe('World Clues by exact id or name.');
const party = z.string().optional().describe('Group actor id or name; omit for the primary party.');

const ListCluesSchema = z.object({ party });
const CollectCluesSchema = z.object({
  clues,
  party,
  stamp: z
    .boolean()
    .optional()
    .describe('false: no scene or date in the stamp, for a clue found earlier (Clue Board 1.2+).'),
});
const UncollectCluesSchema = z.object({ clues, party });

/** The list columns (§3: a fixed, documented order). */
const ENTRY_COLUMNS = ['id', 'name', 'kind', 'scene', 'readers', 'revision'] as const;
const names = (list: string[]): string => list.map(n => `"${n}"`).join(', ');

export interface CluesToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class CluesTools {
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: CluesToolsOptions) {
    this.logger = logger.child({ component: 'CluesTools' });
    this.union = unionTool({
      name: MANAGE_CLUES,
      description:
        "The party's Clue Board record: list / collect / uncollect world Clues (Items of type " +
        '"fvtt-mod-clueboard.clue", made with manage-items). Needs the module. GM-only.',
      discriminators: ['action'],
      shared: { clues, party },
      members: [
        unionMember({
          select: { action: 'list' },
          description: "The party's clues, then the world Clues not collected.",
          schema: ListCluesSchema,
          handler: async parsed => {
            const r = await foundry.call('listClues', parsed);
            const entries = Array.isArray(r?.entries) ? r.entries : [];
            const rest = Array.isArray(r?.uncollected) ? r.uncollected : [];
            const body = listLines(
              `${entries.length} clue(s) on "${r?.party?.name}"`,
              ENTRY_COLUMNS,
              entries
            );
            return rest.length
              ? `${body}\n${listLines(`${rest.length} uncollected`, ['id', 'name', 'kind'] as const, rest)}`
              : body;
          },
        }),
        unionMember({
          select: { action: 'collect' },
          description: 'Collect world Clues on the party; one already there is skipped.',
          schema: CollectCluesSchema,
          handler: async parsed => {
            const r = await foundry.call('collectClues', parsed);
            const got: string[] = (r?.collected ?? []).map((e: any) => `"${e.name}" (${e.id})`);
            return (
              `Collected ${got.length} clue(s) on "${r?.party?.name}"${got.length ? `: ${got.join(', ')}` : ''}` +
              (r?.already?.length ? `; already there: ${names(r.already)}` : '') +
              `. ${r?.entries} on the record.`
            );
          },
        }),
        unionMember({
          select: { action: 'uncollect' },
          description: "Take Clues off the party's record, readers and note too; the Clue stays.",
          schema: UncollectCluesSchema,
          handler: async parsed => {
            const r = await foundry.call('uncollectClues', parsed);
            return (
              `Took ${r?.removed?.length ?? 0} clue(s) off "${r?.party?.name}"` +
              (r?.removed?.length ? `: ${names(r.removed)}` : '') +
              (r?.notOnRecord?.length ? `; not on the record: ${names(r.notOnRecord)}` : '') +
              `. ${r?.entries} on the record.`
            );
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [this.union.def];
  }

  /** Route one clues tool call to its member (registry-facing). */
  async handle(name: string, args: unknown): Promise<unknown> {
    if (name !== MANAGE_CLUES) throw new Error(`Unknown clues tool: ${name}`);
    return this.union.handle(args);
  }
}
