import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { formatDeletionResult } from '../utils/format.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * Organization & batch tools — list-folders (the read/inspect step), create-folder,
 * update-folder, move-documents, bulk-delete. General-purpose document wrangling across
 * every world collection (Actor, Item, JournalEntry, Scene, RollTable, Cards, Playlist,
 * Macro). Runs over the bridge; GM-only for writes. delete-folder lives in actor-creation.ts.
 */

export interface OrganizationToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

const DOC_TYPES = [
  'Actor',
  'Item',
  'JournalEntry',
  'Scene',
  'RollTable',
  'Cards',
  'Playlist',
  'Macro',
] as const;

// Single source of truth for each tool's input contract: the handlers parse with these schemas
// and getToolDefinitions() advertises toInputSchema(...) of the same schema. Descriptions are
// copied verbatim from the previous hand-written JSON Schema; only `.describe()` is added.
const ListFoldersSchema = z.object({
  type: z.enum(DOC_TYPES).optional().describe('One document type; default the whole sidebar.'),
});

const CreateFolderSchema = z.object({
  name: z.string().min(1).describe('Folder name.'),
  type: z.enum(DOC_TYPES).describe('The document type the folder holds.'),
  parentFolder: z.string().optional().describe('Parent folder id or exact name (same type).'),
  color: z.string().optional().describe('Hex color.'),
});

const UpdateFolderSchema = z
  .object({
    identifier: z.string().min(1).describe('Folder id or exact name.'),
    type: z.enum(DOC_TYPES).default('Actor').describe('Resolves a name; default Actor.'),
    name: z.string().min(1).optional().describe('Rename.'),
    color: z.string().optional().describe('Hex color.'),
    parentFolder: z
      .string()
      .optional()
      .describe('Reparent under this folder id or exact name (same type); "" = the root.'),
    sort: z
      .number()
      .int()
      .optional()
      .describe('Persisted, but the v14 sidebar orders sibling folders by name, not by it.'),
  })
  .refine(
    v =>
      v.name !== undefined ||
      v.color !== undefined ||
      v.parentFolder !== undefined ||
      v.sort !== undefined,
    { message: 'Provide at least one of: name, color, parentFolder, sort' }
  );

const MoveDocumentsSchema = z.object({
  documentType: z.enum(DOC_TYPES),
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids or exact names.'),
  targetFolder: z
    .string()
    .optional()
    .describe('Folder id or name (created at the root if missing); "" = the root.'),
});

const BulkDeleteSchema = z.object({
  documentType: z.enum(DOC_TYPES),
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids or exact names.'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Report what would be deleted (and what was not found) without deleting.'),
});

export class OrganizationTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: OrganizationToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'OrganizationTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'list-folders',
        description:
          'The sidebar folder tree (or one document type) in sidebar order (siblings by name): id, ' +
          'depth, path, color, sort, parent, document and subfolder counts.',
        inputSchema: toInputSchema(ListFoldersSchema),
      },
      {
        name: 'create-folder',
        description:
          'Create a sidebar folder, optionally under a parent of the same type. GM-only.',
        inputSchema: toInputSchema(CreateFolderSchema),
      },
      {
        name: 'update-folder',
        description:
          'Rename, recolor, re-sort or reparent a sidebar folder (exact id, or exact name + type). ' +
          'GM-only.',
        inputSchema: toInputSchema(UpdateFolderSchema),
      },
      {
        name: 'move-documents',
        description:
          'Move world documents of one type into a folder (created at the root if absent), or to ' +
          'the root. GM-only.',
        inputSchema: toInputSchema(MoveDocumentsSchema),
      },
      {
        name: 'bulk-delete',
        description:
          'Permanently delete world documents of one type by exact id or exact name; dryRun ' +
          'previews. Folders: delete-folder. GM-only.',
        inputSchema: toInputSchema(BulkDeleteSchema),
      },
    ];
  }

  async handleListFolders(args: any): Promise<string> {
    const parsed = ListFoldersSchema.parse(args ?? {});
    const result: any = await this.foundry.call('listFolders', parsed);
    const folders: any[] = Array.isArray(result?.folders) ? result.folders : [];
    if (folders.length === 0) {
      return parsed.type ? `No ${parsed.type} folders exist.` : 'No folders exist.';
    }
    const types: string[] = Array.isArray(result?.types) ? result.types : [];
    const lines: string[] = [`Folders (${folders.length} across ${types.length} type(s)):`];
    for (const t of types) {
      const ofType = folders.filter(f => f.type === t);
      lines.push(`\n${t} (${ofType.length}):`);
      for (const f of ofType) {
        const bits = [
          f.color ? `${f.color}` : null,
          f.sort ? `sort ${f.sort}` : null,
          `${f.documentCount} doc(s)`,
          f.subfolderCount > 0 ? `${f.subfolderCount} subfolder(s)` : null,
          f.orphaned ? 'ORPHANED (dangling parent)' : null,
        ].filter(Boolean);
        lines.push(`${'  '.repeat(f.depth + 1)}- "${f.name}" (${f.id}) — ${bits.join(', ')}`);
      }
    }
    return lines.join('\n');
  }

  async handleCreateFolder(args: any): Promise<string> {
    const parsed = CreateFolderSchema.parse(args ?? {});
    const result = await this.foundry.call('createFolder', parsed);
    return `Created ${result?.type} folder "${result?.folderName}" (${result?.folderId}).`;
  }

  async handleUpdateFolder(args: any): Promise<string> {
    const parsed = UpdateFolderSchema.parse(args ?? {});
    const result = await this.foundry.call('updateFolder', parsed);
    if (result?.updated === false) {
      return `Folder not found: "${result?.notFound ?? parsed.identifier}" (type ${parsed.type}). Nothing changed.`;
    }
    const sortBit =
      parsed.sort !== undefined ? ` [sort ${result?.folder?.sort ?? parsed.sort}]` : '';
    return `Updated ${result?.folder?.type} folder → "${result?.folder?.name}" (${result?.folder?.id})${sortBit}.`;
  }

  async handleMoveDocuments(args: any): Promise<string> {
    const parsed = MoveDocumentsSchema.parse(args ?? {});
    const result = await this.foundry.call('moveDocuments', parsed);
    const dest = result?.targetFolderName
      ? `"${result.targetFolderName}" (${result.targetFolderId})`
      : 'root';
    const notFound =
      result?.notFound && result.notFound.length > 0
        ? `\n  not found: ${result.notFound.join(', ')}`
        : '';
    return `Moved ${result?.movedCount ?? 0} ${parsed.documentType} document(s) → ${dest}.${notFound}`;
  }

  async handleBulkDelete(args: any): Promise<string> {
    const parsed = BulkDeleteSchema.parse(args ?? {});
    const result: any = await this.foundry.call('bulkDelete', parsed);
    if (result?.dryRun) {
      const would = result.wouldDelete ?? [];
      const lines = would.map((d: any) => `  - ${d.name || '(unnamed)'} (${d.id})`).join('\n');
      const notFound =
        result.notFound && result.notFound.length > 0
          ? `\n  not found: ${result.notFound.join(', ')}`
          : '';
      return would.length
        ? `Dry run — would delete ${would.length} ${parsed.documentType} document(s):\n${lines}${notFound}\n\nRe-run without dryRun to delete them (IRREVERSIBLE).`
        : `Dry run — nothing matched.${notFound}`;
    }
    return formatDeletionResult(result, `${parsed.documentType} document(s)`);
  }
}
