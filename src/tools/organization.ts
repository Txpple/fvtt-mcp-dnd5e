import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { formatDeletionResult } from '../utils/format.js';
import { listLines } from '../utils/lines.js';
import { toInputSchema } from '../utils/schema.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * Organization & batch tools — the sidebar folders as ONE tool, `manage-folders` (action create /
 * list / update / delete; src/tools/_union.ts — M8 of the 3.0 plan), plus move-documents and
 * bulk-delete. General-purpose document wrangling across every world collection (Actor, Item,
 * JournalEntry, Scene, RollTable, Cards, Playlist, Macro). Runs over the bridge; GM-only for
 * writes. Folder resolution is STRICT: exact id, or exact name within the document type.
 */

export interface OrganizationToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export const MANAGE_FOLDERS = 'manage-folders';

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
// and the advertised JSON Schema is derived from the same zod.
const ListFoldersSchema = z.object({
  type: z.enum(DOC_TYPES).optional(),
});

const CreateFolderSchema = z.object({
  name: z.string().min(1).describe('Folder name.'),
  type: z.enum(DOC_TYPES),
  parentFolder: z.string().optional().describe('Parent folder id or exact name (same type).'),
  color: z.string().optional().describe('Hex color.'),
});

const UpdateFolderSchema = z
  .object({
    identifier: z.string().min(1).describe('Folder id or exact name.'),
    type: z.enum(DOC_TYPES).default('Actor'),
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

const DeleteFolderSchema = z.object({
  identifier: z.string().min(1).describe('Folder id or exact name.'),
  type: z.enum(DOC_TYPES).default('Actor'),
  deleteContents: z
    .boolean()
    .default(false)
    .describe('Also delete everything inside; default refuses a non-empty folder.'),
});

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

/** The list columns (§3: a fixed, documented order); `orphaned` is appended when any row carries it. */
const FOLDER_COLUMNS = [
  'id',
  'name',
  'type',
  'depth',
  'path',
  'color',
  'sort',
  'parent',
  'docs',
  'subfolders',
] as const;

export class OrganizationTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private folders: UnionTool;

  constructor({ foundry, logger }: OrganizationToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'OrganizationTools' });
    this.folders = unionTool({
      name: MANAGE_FOLDERS,
      description:
        'Sidebar folders of any world document type: action create / list / update / delete. ' +
        'A folder resolves by exact id, or exact name within its type; a miss is an error. ' +
        'GM-only.',
      discriminators: ['action'],
      shared: {
        type: z
          .enum(DOC_TYPES)
          .describe(
            'The document type: create requires it; list omitted = every type; update / delete ' +
              'default Actor.'
          ),
      },
      members: [
        unionMember({
          select: { action: 'create' },
          description: 'Create a folder, optionally under a parent of the same type.',
          schema: CreateFolderSchema,
          handler: async parsed => {
            const result = await foundry.call('createFolder', parsed);
            return `Created ${result?.type} folder "${result?.folderName}" (${result?.folderId})`;
          },
        }),
        unionMember({
          select: { action: 'list' },
          description:
            'The folder tree in sidebar order (siblings by name): id, name, type, depth, path, ' +
            'color, sort, parent, document and subfolder counts.',
          schema: ListFoldersSchema,
          handler: async parsed => {
            const result = await foundry.call('listFolders', parsed);
            const folders = Array.isArray(result?.folders) ? result.folders : [];
            const records = folders.map(f => ({
              id: f.id,
              name: f.name,
              type: f.type,
              depth: f.depth,
              path: f.path,
              color: f.color ?? null,
              sort: f.sort ?? 0,
              parent: f.parentId ?? null,
              docs: f.documentCount,
              subfolders: f.subfolderCount,
              ...(f.orphaned ? { orphaned: true } : {}),
            }));
            const columns = records.some(r => 'orphaned' in r)
              ? [...FOLDER_COLUMNS, 'orphaned']
              : [...FOLDER_COLUMNS];
            const noun = parsed.type ? `${parsed.type} folder(s)` : 'folder(s)';
            return listLines(`${records.length} ${noun}`, columns, records);
          },
        }),
        unionMember({
          select: { action: 'update' },
          description: 'Rename, recolor, re-sort or reparent a folder.',
          schema: UpdateFolderSchema,
          handler: async parsed => {
            const result = await foundry.call('updateFolder', parsed);
            if (result?.updated === false) {
              throw new FormattedToolError(
                `Folder not found: "${result?.notFound ?? parsed.identifier}" (type ${parsed.type}). Nothing changed.`
              );
            }
            const sortBit =
              parsed.sort !== undefined ? ` [sort ${result?.folder?.sort ?? parsed.sort}]` : '';
            return `Updated ${result?.folder?.type} folder → "${result?.folder?.name}" (${result?.folder?.id})${sortBit}`;
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description:
            'Permanently delete a folder; a non-empty one is refused unless deleteContents:true.',
          schema: DeleteFolderSchema,
          handler: async parsed => {
            const result = await foundry.call('deleteFolder', parsed);
            if (!result?.deleted) {
              throw new FormattedToolError(
                `Folder not found: "${result?.notFound ?? parsed.identifier}" (type ${parsed.type}). Nothing deleted.`
              );
            }
            const f = result.folder;
            const contents = result.deletedContents
              ? `; also ${result.removedDocuments} document(s) and ${result.removedSubfolders} subfolder(s) inside it`
              : ' (was empty)';
            return `Deleted ${f.type} folder "${f.name}" (${f.id})${contents}`;
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [
      this.folders.def,
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
          'previews. Folders: manage-folders. GM-only.',
        inputSchema: toInputSchema(BulkDeleteSchema),
      },
    ];
  }

  /** The folder union (registry-facing). */
  async handleManageFolders(args: unknown): Promise<unknown> {
    return this.folders.handle(args);
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
