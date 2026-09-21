import { z } from 'zod';
import { actorTarget } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

// ItemTools — the world-item building block as a first-class tool family (design.md §5: items are a
// content building block, not an actor sub-concern). It owns the whole world-Item lifecycle: CRUD on
// sidebar Items (create/list/get/update/delete) plus placing items on / removing them from an actor
// (add-to-actor / remove-from-actor). Actor reads/authoring live in ActorTools (src/tools/actor.ts);
// embedded-item editing has its own dnd5e tools (update-actor-item, manage-activity, manage-effect).
//
// Single source of truth for each tool's input contract: the handler parses with these schemas and
// getToolDefinitions() advertises toInputSchema(...) of the same schema, so the advertised and
// enforced contracts cannot drift.

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
  folder: z.string().optional().describe('Folder name or id (created if absent).'),
});

const ListItemsSchema = z.object({
  type: z.string().optional().describe('Item type ("weapon", "spell").'),
  folder: z.string().optional().describe('Only items in this folder (name or id).'),
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
    .describe('Exact ids (preferred) or exact names of world Items to delete.'),
});

const RemoveFromActorSchema = z
  .object({
    actorIdentifier: actorTarget,
    itemIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Ids of items on the actor to delete (most reliable; get them from get-actor).'),
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

// add-to-actor is reached via the handleManageWorldItems dispatcher (and add-feature mode "items"),
// not advertised as its own tool — so this is a parse-only contract.
const AddToActorSchema = z.object({
  actorIdentifier: z.string().min(1, 'Actor identifier cannot be empty'),
  items: AddToActorItemsSchema,
});

/**
 * Surface page-side asset warnings (e.g. a bad img path that was substituted with a real floor icon)
 * onto the tool result. Leaves the result untouched when there are none, so the common path keeps its
 * exact shape; otherwise appends a human-readable block to a `message` field for the caller to see.
 */
function surfaceWarnings(result: any): any {
  const warns = Array.isArray(result?.warnings) ? result.warnings : [];
  if (warns.length === 0) return result;
  const warnSection = `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`;
  return { ...result, message: (result?.message ?? '') + warnSection };
}

export interface ItemToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class ItemTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: ItemToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ItemTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'create-item',
        description:
          'Create world Items (the Items sidebar) from raw data. GM-only. Items on an actor: ' +
          'import-item / add-item / add-feature.',
        inputSchema: toInputSchema(CreateItemSchema),
      },
      {
        name: 'list-items',
        description: 'World Items, filtered by type, name substring or folder.',
        inputSchema: toInputSchema(ListItemsSchema),
      },
      {
        name: 'get-item',
        description:
          'One world Item in full: system data, effects, flags, description. An unidentified item ' +
          'answers its mask as `name` and its real name as `trueName`.',
        inputSchema: toInputSchema(GetItemSchema),
      },
      {
        name: 'update-item',
        description:
          'Update world Items by id: name, img, system data, folder. A rename on an unidentified item ' +
          'changes the true name (echoed as `trueName`). GM-only.',
        inputSchema: toInputSchema(UpdateItemSchema),
      },
      {
        name: 'delete-item',
        description:
          'Permanently delete world Items by exact id or exact name. GM-only. Items on an actor: ' +
          'remove-from-actor.',
        inputSchema: toInputSchema(DeleteItemSchema),
      },
      {
        name: 'remove-from-actor',
        description:
          'Delete items already on an actor, identified by itemIds and/or itemNames (optionally constrained by type). GM-only. Use get-actor to find item ids.',
        inputSchema: toInputSchema(RemoveFromActorSchema),
      },
    ];
  }

  // Dispatcher: the six world-item tool names route through here (registry wires each to a
  // pre-stamped `action`); add-feature mode "items" reuses the 'add-to-actor' action.
  async handleManageWorldItems(args: any): Promise<any> {
    const { action } = z
      .object({
        action: z.enum([
          'create',
          'list',
          'get',
          'update',
          'delete',
          'add-to-actor',
          'remove-from-actor',
        ]),
      })
      .parse(args);

    switch (action) {
      case 'create':
        return this.handleCreateWorldItems(args);
      case 'list':
        return this.handleListWorldItems(args);
      case 'get':
        return this.handleGetWorldItem(args);
      case 'update':
        return this.handleUpdateWorldItems(args);
      case 'delete':
        return this.handleDeleteWorldItems(args);
      case 'add-to-actor':
        return this.handleAddActorItems(args);
      case 'remove-from-actor':
        return this.handleRemoveActorItems(args);
    }
  }

  async handleCreateWorldItems(args: any): Promise<any> {
    const { items, folder } = CreateItemSchema.parse(args);

    this.logger.info('Creating world items', {
      count: items.length,
      folder: folder ?? null,
      types: items.map(i => i.type),
    });

    const result = await this.foundry.call('createWorldItems', {
      items,
      folder,
    });

    this.logger.debug('Successfully created world items', {
      folderId: result.folderId,
      created: result.created?.length ?? 0,
    });

    return surfaceWarnings(result);
  }

  async handleListWorldItems(args: any): Promise<any> {
    const { type, folder, nameFilter } = ListItemsSchema.parse(args);

    this.logger.info('Listing world items', {
      type: type ?? null,
      folder: folder ?? null,
      nameFilter: nameFilter ?? null,
    });

    const items = await this.foundry.call('listWorldItems', {
      ...(type !== undefined ? { type } : {}),
      ...(folder !== undefined ? { folder } : {}),
      ...(nameFilter !== undefined ? { nameFilter } : {}),
    });

    this.logger.debug('Successfully listed world items', { count: items?.length ?? 0 });

    return {
      items: items ?? [],
      total: items?.length ?? 0,
    };
  }

  async handleGetWorldItem(args: any): Promise<any> {
    const { identifier } = GetItemSchema.parse(args);

    this.logger.info('Getting world item', { identifier });

    const item = await this.foundry.call('getWorldItem', {
      identifier,
    });

    this.logger.debug('Successfully retrieved world item', { id: item?.id, name: item?.name });

    return item;
  }

  async handleUpdateWorldItems(args: any): Promise<any> {
    const { updates } = UpdateItemSchema.parse(args);

    this.logger.info('Updating world items', {
      count: updates.length,
      ids: updates.map(u => u.id),
    });

    const result = await this.foundry.call('updateWorldItems', {
      updates,
    });

    this.logger.debug('Successfully updated world items', { count: result.updated?.length ?? 0 });

    return surfaceWarnings(result);
  }

  async handleDeleteWorldItems(args: any): Promise<any> {
    const { identifiers } = DeleteItemSchema.parse(args);

    this.logger.info('Deleting world items', { count: identifiers.length });

    const result = await this.foundry.call('deleteWorldItems', {
      identifiers,
    });

    this.logger.debug('Successfully deleted world items', {
      deleted: result?.deletedCount ?? 0,
    });

    return result;
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
