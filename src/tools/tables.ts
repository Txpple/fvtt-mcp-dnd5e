import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { deletedLine, listLines, warningBlock } from '../utils/lines.js';
import { toInputSchema } from '../utils/schema.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * RollTable tools — the CRUD family as ONE tool, `manage-rolltables` (action create / import / list
 * / get / update / delete; src/tools/_union.ts — M8 of the 3.0 plan), plus `roll-on-table` (a play
 * op, not CRUD). Net-new document type for adventure creation (random encounters, loot, rumours,
 * names). Runs over the bridge against live Foundry documents (page/collections.ts). GM-only for
 * writes.
 */

export interface TableToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export const MANAGE_ROLLTABLES = 'manage-rolltables';

const resultSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .optional()
      .describe('Result text (HTML, enrichers); {{link}} places the `uuid` link inside it.'),
    uuid: z
      .string()
      .min(1)
      .optional()
      .describe('A compendium or world uuid (SRD or unresolvable refused); text and/or uuid.'),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('Label for the uuid link (default the document name).'),
    weight: z.number().int().positive().optional().describe('Relative weight (default 1).'),
    range: z
      .tuple([z.number().int(), z.number().int()])
      .optional()
      .describe('[low, high]; default assigned from the weights.'),
  })
  .refine(
    r =>
      (typeof r.text === 'string' && r.text.trim().length > 0) ||
      (typeof r.uuid === 'string' && r.uuid.trim().length > 0),
    { message: 'each result needs either "text" or "uuid"' }
  );

// Reduce @UUID[uuid]{Label} enricher links to their human label for display (the raw enricher is
// what's stored; this just makes the rolled-result line readable).
function stripUuidEnrichers(text: string): string {
  return (text ?? '').replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, '$1');
}

// Single source of truth for each action's input contract: the member parses with these schemas
// and the advertised JSON Schema is derived from the same zod.
const CreateRollTableSchema = z.object({
  name: z.string().min(1).describe('Table name.'),
  description: z.string().optional(),
  formula: z.string().optional().describe('Roll formula (default 1d<total weight>).'),
  replacement: z.boolean().optional().describe('Draw with replacement (default true).'),
  displayRoll: z.boolean().optional().describe('Show the roll when drawing (default true).'),
  folderName: z.string().optional(),
  results: z.array(resultSchema).min(1).describe('Table entries.'),
});

const ListRollTablesSchema = z.object({});

// One TARGETED per-entry edit: name the entry by `roll` (die face) or `resultId`, then patch only
// the supplied fields. text/uuid/name REBUILD that entry's content with the create action's exact
// semantics (uuid → validated @UUID link, {{link}} placeholder, SRD refused) — they replace the
// entry's current text, so re-send any @UUID enricher you want kept (the get action shows the raw
// stored text to copy from). weight/range write verbatim; nothing rebalances other entries.
const resultEditSchema = z
  .object({
    roll: z
      .number()
      .int()
      .optional()
      .describe('The entry whose range covers this die face (none or several = an error).'),
    resultId: z.string().min(1).optional().describe('The entry by TableResult id.'),
    text: z
      .string()
      .min(1)
      .optional()
      .describe("Replaces the entry's text (HTML, enrichers; {{link}} for the uuid)."),
    uuid: z
      .string()
      .min(1)
      .optional()
      .describe('Re-links the entry (a compendium or world uuid; SRD refused).'),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('Label for the uuid link (default the document name).'),
    weight: z.number().int().positive().optional().describe('New relative weight.'),
    range: z
      .tuple([z.number().int(), z.number().int()])
      .optional()
      .describe('New [low, high] for this entry only (an overlap or gap is warned).'),
  })
  .refine(e => (e.roll !== undefined) !== (e.resultId !== undefined), {
    message: 'target each edit with exactly one of roll or resultId',
  })
  .refine(
    e =>
      e.text !== undefined ||
      e.uuid !== undefined ||
      e.weight !== undefined ||
      e.range !== undefined,
    { message: 'each edit needs at least one of text, uuid, weight, or range' }
  );

const UpdateRollTableSchema = z
  .object({
    identifier: z.string().min(1),
    name: z.string().min(1).optional().describe('New table name.'),
    description: z.string().optional().describe('New description.'),
    formula: z.string().min(1).optional().describe('New roll formula.'),
    replacement: z.boolean().optional().describe('Draw with replacement.'),
    displayRoll: z.boolean().optional().describe('Show the roll when drawing.'),
    results: z
      .array(resultSchema)
      .optional()
      .describe('Replaces every result (ranges reassigned); one entry: editResults.'),
    editResults: z
      .array(resultEditSchema)
      .min(1)
      .optional()
      .describe('Per-entry edits in place; the other entries are untouched. Not with results.'),
  })
  .refine(v => !(v.results && v.editResults), {
    message: 'provide results (replace the whole set) OR editResults (targeted edits), not both',
  });

const RollOnTableSchema = z.object({
  identifier: z.string().min(1).describe('Table id or exact name.'),
});

const GetRollTableSchema = z.object({
  identifier: z.string().min(1),
});

const DeleteRollTableSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids or exact names.'),
});

const ImportRollTableSchema = z.object({
  packId: z.string().min(1).describe('Compendium pack id, e.g. dnd-dungeon-masters-guide.tables.'),
  itemId: z.string().min(1).describe('The RollTable id within the pack.'),
  folderName: z.string().optional(),
});

/** The list columns (§3: a fixed, documented order). */
const LIST_COLUMNS = ['id', 'name', 'formula', 'results'] as const;

// A function declaration (not a const arrow): TypeScript's control-flow narrowing after a
// never-returning call needs an explicitly typed declaration.
function tableMiss(notFound: unknown, identifier: string, tail: string): never {
  throw new FormattedToolError(`Roll table not found: "${notFound ?? identifier}". ${tail}`);
}

export class TableTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: TableToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'TableTools' });
    this.union = unionTool({
      name: MANAGE_ROLLTABLES,
      description:
        'RollTables by exact id or name: create / import / list / get / update / delete. A result ' +
        'is text and/or a uuid rendered as a @UUID link (an SRD ref is refused). GM-only.',
      discriminators: ['action'],
      shared: {
        identifier: z.string().describe('Table id or exact name.'),
        folderName: z.string().describe('Folder (created if absent).'),
      },
      members: [
        unionMember({
          select: { action: 'create' },
          description:
            'Create a RollTable; ranges come from the weights and the formula defaults to ' +
            '1d<total weight>.',
          schema: CreateRollTableSchema,
          handler: async parsed => {
            const r = await foundry.call('createRollTable', parsed);
            return (
              `Created roll table "${r?.tableName}" (${r?.tableId}): formula ${r?.formula}, ` +
              `${r?.resultCount} result(s)`
            );
          },
        }),
        unionMember({
          select: { action: 'import' },
          description:
            'Copy a RollTable from a compendium pack into the world, results and @UUID links ' +
            'intact (roll-on-table takes world tables only); an SRD pack is refused.',
          schema: ImportRollTableSchema,
          handler: async parsed => {
            const r = await foundry.call('importRollTable', parsed);
            return (
              `Imported roll table "${r?.tableName}" (${r?.tableId}): formula ${r?.formula}, ` +
              `${r?.resultCount} result(s)`
            );
          },
        }),
        unionMember({
          select: { action: 'list' },
          description: 'Tables: id, name, formula, result count.',
          schema: ListRollTablesSchema,
          handler: async () => {
            const tables = await foundry.call('listRollTables');
            const records = (Array.isArray(tables) ? tables : []).map(t => ({
              id: t.id,
              name: t.name,
              formula: t.formula,
              results: t.resultCount,
            }));
            return listLines(`${records.length} table(s)`, LIST_COLUMNS, records);
          },
        }),
        unionMember({
          select: { action: 'get' },
          description:
            "A table's every entry, low to high: range, weight, drawn flag, text (enrichers " +
            'intact), linked uuid + label.',
          schema: GetRollTableSchema,
          handler: async ({ identifier }) => {
            const t = await foundry.call('getRollTable', { identifier });
            if (!t || t.found === false) tableMiss(t?.notFound, identifier, 'Nothing read.');
            const results = Array.isArray(t.results) ? t.results : [];
            const meta =
              `[replacement ${t.replacement === false ? 'off' : 'on'}, ` +
              `displayRoll ${t.displayRoll === false ? 'off' : 'on'}]`;
            let out = `Roll table "${t.name}" (${t.id}) — ${t.formula}, ${results.length} result(s) ${meta}`;
            const desc = stripUuidEnrichers(t.description ?? '').trim();
            if (desc) out += `\n${desc}`;
            for (const r of results) {
              const lo = r?.range?.[0];
              const hi = r?.range?.[1];
              const label = lo === hi ? `${lo}` : `${lo}-${hi}`;
              out += `\n  [${label}] ${stripUuidEnrichers(r?.text ?? '')}`;
              const links = Array.isArray(r?.links) ? r.links : [];
              if (links.length > 0) {
                out += `\n      → ${links.map((l: any) => `${l.label} [${l.uuid}]`).join('; ')}`;
              }
            }
            return out;
          },
        }),
        unionMember({
          select: { action: 'update' },
          description:
            "Update a table's fields and/or its entries (editResults in place, results the whole " +
            'set); bad edits are isolated and reported, a range overlap or gap is warned.',
          schema: UpdateRollTableSchema,
          handler: async parsed => {
            const r = await foundry.call('updateRollTable', parsed);
            if (r?.updated === false) tableMiss(r?.notFound, parsed.identifier, 'Nothing changed.');
            let out = `Updated roll table "${r?.tableName}" (${r?.tableId}): ${r?.resultCount} result(s)`;
            if (typeof r?.edited === 'number') {
              out += `, ${r.edited} entr${r.edited === 1 ? 'y' : 'ies'} edited in place`;
            }
            const errs = Array.isArray(r?.errors) ? r.errors : [];
            if (errs.length > 0) out += errs.map((e: string) => `\n  ⚠ ${e}`).join('');
            return out + warningBlock(r?.warnings);
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Permanently delete tables.',
          schema: DeleteRollTableSchema,
          handler: async ({ identifiers }) => {
            const r = await foundry.call('deleteRollTables', { identifiers });
            return deletedLine(r, 'roll table');
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [
      this.union.def,
      {
        name: 'roll-on-table',
        description:
          'Roll on a world RollTable: the drawn results, with any @UUID links as uuid + label. ' +
          'Nothing is marked drawn or posted to chat.',
        inputSchema: toInputSchema(RollOnTableSchema),
      },
    ];
  }

  /** The CRUD union (registry-facing). */
  async handleManageRollTables(args: unknown): Promise<unknown> {
    return this.union.handle(args);
  }

  async handleRollOnTable(args: any): Promise<string> {
    const { identifier } = RollOnTableSchema.parse(args ?? {});
    const result = await this.foundry.call('rollOnTable', { identifier });
    if (result?.rolled === false) tableMiss(result?.notFound, identifier, 'Nothing rolled.');
    const drawn = result?.results ?? [];
    const texts = drawn
      .map((r: any) => `"${stripUuidEnrichers(r.text ?? r.description ?? '')}"`)
      .join(', ');
    const links = drawn.flatMap((r: any) => r.links ?? []);
    let out = `Rolled ${result?.total} on "${result?.tableName}" → ${texts || '(no result matched)'}`;
    if (links.length > 0) {
      out += `\n  importable: ${links.map((l: any) => `${l.label} [${l.uuid}]`).join('; ')}`;
    }
    return out;
  }
}
