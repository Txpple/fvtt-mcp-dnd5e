import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { formatDeletionResult } from '../utils/format.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * RollTable tools — create / list / update / roll / delete. Net-new document
 * type for adventure creation (random encounters, loot, rumours, names). Runs
 * over the bridge against live Foundry documents, so the world must be loaded
 * and the headless Foundry client connected. GM-only for writes.
 */

export interface TableToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

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
      .describe(
        'A compendium or world uuid rendered as a @UUID link; an SRD or unresolvable ref is refused. ' +
          'text and/or uuid.'
      ),
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

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.
const CreateRollTableSchema = z.object({
  name: z.string().min(1).describe('Table name.'),
  description: z.string().optional(),
  formula: z.string().optional().describe('Roll formula (default 1d<total weight>).'),
  replacement: z.boolean().optional().describe('Draw with replacement (default true).'),
  displayRoll: z.boolean().optional().describe('Show the roll when drawing (default true).'),
  folderName: z.string().optional().describe('Folder (created if absent).'),
  results: z.array(resultSchema).min(1).describe('Table entries.'),
});

const ListRollTablesSchema = z.object({});

// One TARGETED per-entry edit: name the entry by `roll` (die face) or `resultId`, then patch only
// the supplied fields. text/uuid/name REBUILD that entry's content with create-rolltable's exact
// semantics (uuid → validated @UUID link, {{link}} placeholder, SRD refused) — they replace the
// entry's current text, so re-send any @UUID enricher you want kept (get-rolltable shows the raw
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
    identifier: z.string().min(1).describe('Table id or exact name.'),
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
  identifier: z.string().min(1).describe('Table id or exact name.'),
});

const DeleteRollTableSchema = z.object({
  identifiers: z
    .array(z.string().min(1))
    .min(1)
    .describe('Exact ids (preferred) or exact names of tables to delete.'),
});

const ImportRollTableSchema = z.object({
  packId: z.string().min(1).describe('Compendium pack id, e.g. dnd-dungeon-masters-guide.tables.'),
  itemId: z.string().min(1).describe('The RollTable id within the pack.'),
  folderName: z.string().optional().describe('Folder (created if absent).'),
});

export class TableTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: TableToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'TableTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'create-rolltable',
        description:
          'Create a RollTable from results of text and/or a uuid (rendered as a @UUID link; an SRD ' +
          'ref is refused). Ranges come from the weights and the formula defaults to 1d<total ' +
          'weight> unless given. GM-only.',
        inputSchema: toInputSchema(CreateRollTableSchema),
      },
      {
        name: 'import-rolltable',
        description:
          'Copy a RollTable from a compendium pack into the world, results and @UUID links intact ' +
          '(roll-on-table takes world tables only). An SRD pack is refused. GM-only.',
        inputSchema: toInputSchema(ImportRollTableSchema),
      },
      {
        name: 'list-rolltables',
        description:
          'List RollTable documents with id, name, formula, result count, and description.',
        inputSchema: toInputSchema(ListRollTablesSchema),
      },
      {
        name: 'update-rolltable',
        description:
          "Update a RollTable's fields and/or its entries: editResults patches named entries (by " +
          'roll face or resultId) in place, results replaces the whole set. Bad edits are isolated ' +
          'and reported; a range overlap or gap is warned. GM-only.',
        inputSchema: toInputSchema(UpdateRollTableSchema),
      },
      {
        name: 'roll-on-table',
        description:
          'Roll on a world RollTable: the drawn results, with any @UUID links as uuid + label. ' +
          'Nothing is marked drawn or posted to chat.',
        inputSchema: toInputSchema(RollOnTableSchema),
      },
      {
        name: 'get-rolltable',
        description:
          "A RollTable's every entry, low to high: range, weight, drawn flag, text (enrichers " +
          'intact), linked uuid + label.',
        inputSchema: toInputSchema(GetRollTableSchema),
      },
      {
        name: 'delete-rolltable',
        description: 'Permanently delete roll tables by exact id or exact name. GM-only.',
        inputSchema: toInputSchema(DeleteRollTableSchema),
      },
    ];
  }

  async handleCreateRollTable(args: any): Promise<string> {
    const parsed = CreateRollTableSchema.parse(args ?? {});
    const result = await this.foundry.call('createRollTable', parsed);
    return (
      `Created roll table "${result?.tableName}" (${result?.tableId}) — formula ${result?.formula}, ` +
      `${result?.resultCount} result(s).`
    );
  }

  async handleImportRollTable(args: any): Promise<string> {
    const parsed = ImportRollTableSchema.parse(args ?? {});
    const result = await this.foundry.call('importRollTable', parsed);
    return (
      `Imported roll table "${result?.tableName}" (${result?.tableId}) — formula ${result?.formula}, ` +
      `${result?.resultCount} result(s). Roll it with roll-on-table.`
    );
  }

  async handleListRollTables(_args: any): Promise<string> {
    const tables = (await this.foundry.call('listRollTables')) ?? [];
    if (!Array.isArray(tables) || tables.length === 0) return 'No roll tables found.';
    const lines = tables.map(
      (t: any) => `  - "${t.name}" (${t.id}) — ${t.formula}, ${t.resultCount} result(s)`
    );
    return `Roll tables (${tables.length}):\n${lines.join('\n')}`;
  }

  async handleUpdateRollTable(args: any): Promise<string> {
    const parsed = UpdateRollTableSchema.parse(args ?? {});
    const result = await this.foundry.call('updateRollTable', parsed);
    if (result?.updated === false) {
      return `Roll table not found: "${result?.notFound ?? parsed.identifier}". Nothing changed.`;
    }
    let out = `Updated roll table "${result?.tableName}" (${result?.tableId}) — ${result?.resultCount} result(s)`;
    if (typeof result?.edited === 'number') {
      out += `, ${result.edited} entr${result.edited === 1 ? 'y' : 'ies'} edited in place`;
    }
    out += '.';
    const errs = Array.isArray(result?.errors) ? result.errors : [];
    if (errs.length > 0) out += errs.map((e: string) => `\n  ⚠ ${e}`).join('');
    const warns = Array.isArray(result?.warnings) ? result.warnings : [];
    if (warns.length > 0) {
      out += `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`;
    }
    return out;
  }

  async handleRollOnTable(args: any): Promise<string> {
    const { identifier } = RollOnTableSchema.parse(args ?? {});
    const result = await this.foundry.call('rollOnTable', { identifier });
    if (result?.rolled === false) {
      return `Roll table not found: "${result?.notFound ?? identifier}".`;
    }
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

  async handleGetRollTable(args: any): Promise<string> {
    const { identifier } = GetRollTableSchema.parse(args ?? {});
    const t: any = await this.foundry.call('getRollTable', { identifier });
    if (!t || t.found === false) {
      return `Roll table not found: "${t?.notFound ?? identifier}".`;
    }
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
  }

  async handleDeleteRollTable(args: any): Promise<string> {
    const { identifiers } = DeleteRollTableSchema.parse(args ?? {});
    const result = await this.foundry.call('deleteRollTables', { identifiers });
    return formatDeletionResult(result, 'roll table(s)');
  }
}
