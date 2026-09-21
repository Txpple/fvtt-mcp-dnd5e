import { z } from 'zod';
import { actorTarget } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { deletedLine, listLines, warningBlock } from '../utils/lines.js';
import { toInputSchema } from '../utils/schema.js';
import { IMPORT_ITEM_DESCRIPTION, ImportItemSchema, importItem } from './dnd5e/import-item.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

// ItemTools — the world-item building block as a first-class tool family (design.md §5: items are a
// content building block, not an actor sub-concern). The world-Item lifecycle is ONE tool,
// `manage-items` (action create / list / get / update / delete / import; src/tools/_union.ts — M8
// of the 3.0 plan), plus `remove-from-actor` (an actor-side op) and the un-advertised add-to-actor
// action add-feature mode "items" rides. Actor reads/authoring live in ActorTools
// (src/tools/actor.ts); embedded-item editing has its own dnd5e tools (update-actor-item,
// manage-activity, manage-effect).
//
// Single source of truth for each action's input contract: the member parses with these schemas
// and the advertised JSON Schema is derived from the same zod, so the advertised and enforced
// contracts cannot drift.

export const MANAGE_ITEMS = 'manage-items';

const CreateItemSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z
          .string()
          .min(1)
          .describe('dnd5e item type (weapon, equipment, consumable, feat, spell …).'),
        img: z.string().optional().describe('Icon path.'),
        system: z.record(z.string(), z.any()).optional().describe('System data, as-is.'),
        effects: z.array(z.record(z.string(), z.any())).optional(),
        flags: z.record(z.string(), z.any()).optional(),
      })
    )
    .min(1, 'At least one item is required')
    .describe('The items to create.'),
  folder: z.string().optional(),
});

const ListItemsSchema = z.object({
  type: z.string().optional().describe('Item type ("weapon", "spell").'),
  folder: z.string().optional(),
  nameFilter: z.string().optional().describe('Case-insensitive substring match on item name.'),
});

const GetItemSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Item identifier cannot be empty')
    .describe('World Item id, exact name, or case-insensitive name.'),
});

const UpdateItemSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().min(1).describe('World Item id.'),
        name: z.string().optional(),
        img: z.string().optional(),
        system: z.record(z.string(), z.any()).optional().describe('Merged into the system data.'),
        folder: z.string().optional().describe('Folder name or id (created if absent).'),
      })
    )
    .min(1)
    .describe('The patches, each an id plus the fields to change.'),
});

const DeleteItemSchema = z.object({
  identifiers: z
    .array(z.string().min(1))
    .min(1, 'At least one identifier is required')
    .describe('Exact ids or exact names.'),
});

const RemoveFromActorSchema = z
  .object({
    actorIdentifier: actorTarget,
    itemIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Ids of items on the actor to delete (most reliable; manage-actors get lists them).'
      ),
    itemNames: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Names of items on the actor to delete (case-insensitive). Combine with "type" to disambiguate.'
      ),
    type: z.string().optional().describe('Constrain itemNames to this item type.'),
  })
  .refine(v => (v.itemIds?.length ?? 0) + (v.itemNames?.length ?? 0) > 0, {
    message: 'Provide itemIds and/or itemNames identifying the items to remove',
  });

// The item array for placing items on an actor. Exported because it is the CANONICAL source for
// add-feature's mode "items" too (composed by buildAddFeatureTool) — so the advertised add-feature
// contract is generated from the same zod this handler enforces, never a hand-written duplicate.
export const AddToActorItemsSchema = z
  .array(
    z.object({
      name: z.string().min(1),
      type: z.string().min(1).describe('dnd5e item type (weapon, equipment, …).'),
      img: z.string().optional().describe('Icon path.'),
      system: z.record(z.string(), z.any()).optional().describe('System data, as-is.'),
    })
  )
  .min(1, 'At least one item is required');

// add-to-actor is reached via handleAddActorItems (add-feature mode "items"), not advertised as
// its own tool — so this is a parse-only contract.
const AddToActorSchema = z.object({
  actorIdentifier: z.string().min(1, 'Actor identifier cannot be empty'),
  items: AddToActorItemsSchema,
});

/** The list columns (§3: a fixed, documented order); `trueName` is appended when any row has one. */
const LIST_COLUMNS = ['id', 'name', 'type', 'folder'] as const;

/** `"name" (id, type)` — with the true name when an unidentified mask hides it. */
const itemRef = (d: { id?: string; name?: string; trueName?: string; type?: string }): string =>
  `"${d.name}" (${d.id}, ${d.type}${d.trueName ? `, true "${d.trueName}"` : ''})`;

export interface ItemToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class ItemTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: ItemToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ItemTools' });
    const log = this.logger;
    this.union = unionTool({
      name: MANAGE_ITEMS,
      description:
        'World Items (the sidebar): create / list / get / update / delete / import; an ' +
        'unidentified item answers its mask as name and its real name as trueName. GM-only. ' +
        'Items on an actor: add-item / add-feature / remove-from-actor.',
      discriminators: ['action'],
      shared: {
        folder: z
          .string()
          .describe('Folder name or id (created if absent); list: only items in it.'),
      },
      members: [
        unionMember({
          select: { action: 'create' },
          description: 'Create world Items from raw data.',
          schema: CreateItemSchema,
          handler: async ({ items, folder }) => {
            log.info('Creating world items', {
              count: items.length,
              folder: folder ?? null,
              types: items.map(i => i.type),
            });
            const r = await foundry.call('createWorldItems', { items, folder });
            const created = Array.isArray(r?.created) ? r.created : [];
            const where = r?.folderId ? ` in folder "${r.folderName}" (${r.folderId})` : '';
            return (
              `Created ${created.length} world item(s)${where}: ${created.map(itemRef).join(', ')}` +
              warningBlock(r?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'list' },
          description: 'World Items: id, name, type, folder; filtered by type, name, folder.',
          schema: ListItemsSchema,
          handler: async ({ type, folder, nameFilter }) => {
            const items = await foundry.call('listWorldItems', {
              ...(type !== undefined ? { type } : {}),
              ...(folder !== undefined ? { folder } : {}),
              ...(nameFilter !== undefined ? { nameFilter } : {}),
            });
            const records = (Array.isArray(items) ? items : []).map(i => ({
              id: i.id,
              name: i.name,
              type: i.type,
              folder: i.folderName ?? null,
              ...(i.trueName ? { trueName: i.trueName } : {}),
            }));
            const columns = records.some(r => 'trueName' in r)
              ? [...LIST_COLUMNS, 'trueName']
              : [...LIST_COLUMNS];
            return listLines(`${records.length} item(s)`, columns, records);
          },
        }),
        unionMember({
          select: { action: 'get' },
          description: 'One world Item in full: system data, effects, flags, description.',
          schema: GetItemSchema,
          handler: async ({ identifier }) => {
            log.info('Getting world item', { identifier });
            return foundry.call('getWorldItem', { identifier });
          },
        }),
        unionMember({
          select: { action: 'update' },
          description:
            'Update world Items by id: name, img, system data, folder. A rename on an ' +
            'unidentified item changes the true name.',
          schema: UpdateItemSchema,
          handler: async ({ updates }) => {
            log.info('Updating world items', {
              count: updates.length,
              ids: updates.map(u => u.id),
            });
            const r = await foundry.call('updateWorldItems', { updates });
            const updated = Array.isArray(r?.updated) ? r.updated : [];
            return (
              `Updated ${updated.length} world item(s): ${updated.map(itemRef).join(', ')}` +
              warningBlock(r?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Permanently delete world Items.',
          schema: DeleteItemSchema,
          handler: async ({ identifiers }) => {
            log.info('Deleting world items', { count: identifiers.length });
            const r = await foundry.call('deleteWorldItems', { identifiers });
            return deletedLine(r, 'world item');
          },
        }),
        unionMember({
          select: { action: 'import' },
          description: IMPORT_ITEM_DESCRIPTION,
          schema: ImportItemSchema,
          handler: parsed => importItem(foundry, log, parsed),
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [
      this.union.def,
      {
        name: 'remove-from-actor',
        description:
          'Delete items already on an actor, identified by itemIds and/or itemNames (optionally constrained by type). GM-only.',
        inputSchema: toInputSchema(RemoveFromActorSchema),
      },
    ];
  }

  /** The world-item union (registry-facing). */
  async handleManageItems(args: unknown): Promise<unknown> {
    return this.union.handle(args);
  }

  async handleAddActorItems(args: any): Promise<any> {
    const { actorIdentifier, items } = AddToActorSchema.parse(args);

    this.logger.info('Adding items to actor', {
      actorIdentifier,
      count: items.length,
      types: items.map(i => i.type),
    });

    const result = await this.foundry.call('addActorItems', {
      actorIdentifier,
      items,
    });

    this.logger.debug('Successfully added actor items', {
      actorName: result.actorName,
      created: result.created?.length ?? 0,
    });

    return result;
  }

  async handleRemoveActorItems(args: any): Promise<any> {
    const { actorIdentifier, itemIds, itemNames, type } = RemoveFromActorSchema.parse(args);

    this.logger.info('Removing items from actor', {
      actorIdentifier,
      ids: itemIds?.length ?? 0,
      names: itemNames?.length ?? 0,
      type: type ?? null,
    });

    const result = await this.foundry.call('removeActorItems', {
      actorIdentifier,
      ...(itemIds !== undefined ? { itemIds } : {}),
      ...(itemNames !== undefined ? { itemNames } : {}),
      ...(type !== undefined ? { type } : {}),
    });

    this.logger.debug('Successfully removed actor items', {
      actorName: result.actorName,
      removed: result.removed?.length ?? 0,
    });

    return result;
  }
}
