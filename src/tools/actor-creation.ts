import { z } from 'zod';
import { actorTargetStrict } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';
import { assertNoSrdPacks } from '../utils/compendium-sources.js';
import { formatUnresolvedScale } from '../utils/format.js';

export interface ActorCreationToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

// Single source of truth for each tool's input contract: the handlers parse with these schemas
// and getToolDefinitions() advertises toInputSchema(...) of the same schema, so the advertised
// and enforced contracts cannot drift.

// create-actor-from-compendium contract (the §6 step-1 + step-2 path): packId/itemId/names ARE
// required because this serves ONLY the compendium-pull path. Single source of truth: the handler
// parses with it and getToolDefinitions() advertises toInputSchema(...) of it.
const CreateActorFromCompendiumSchema = z.object({
  packId: z
    .string()
    .min(1)
    .describe(
      'Compendium pack id, e.g. "dnd-monster-manual.actors"; an SRD pack (dnd5e.*) is refused.'
    ),
  itemId: z.string().min(1).describe('Entry id within the pack (from search-compendium).'),
  names: z.array(z.string().min(1)).min(1).describe('Names for the new actors, one each.'),
  quantity: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe('Copies to create (default names.length).'),
  folder: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Actor folder id or exact name (created if absent); default "Foundry MCP Creatures".'
    ),
  addToScene: z.boolean().default(false).describe('Also place tokens on the active scene.'),
  placement: z
    .object({
      type: z.enum(['random', 'grid', 'center', 'coordinates']).default('grid'),
      coordinates: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .optional()
        .describe('One {x, y} in pixels per token (type "coordinates").'),
    })
    .optional()
    .describe('Token placement when addToScene is true.'),
  disposition: z
    .enum(['friendly', 'neutral', 'hostile', 'secret'])
    .optional()
    .describe(
      'Prototype-token disposition. Default by source: a PC pregen → friendly, else hostile.'
    ),
  modifications: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'update-actor-shaped edits applied to every copy (never the source): cr, hp, ac, abilities, ' +
        'skills, defenses …'
    ),
});

// Foundry ownership permission levels the duplicate-actor `ownershipLevel` enum maps onto
// (mirrors OwnershipLevels in src/tools/ownership.ts; NONE/INHERIT deliberately absent — a
// duplicate is either granted to a user or inherits the source's whole ownership map).
const DUPLICATE_OWNERSHIP_LEVELS = {
  LIMITED: 1,
  OBSERVER: 2,
  OWNER: 3,
} as const;

const DuplicateActorSchema = z
  .object({
    actorIdentifiers: z.array(actorTargetStrict).min(1).describe('The source actors.'),
    newNames: z
      .array(z.string().min(1))
      .optional()
      .describe('Copy names by index; the rest get source name + suffix.'),
    suffix: z
      .string()
      .min(1)
      .optional()
      .describe('Appended to the source name when newNames has no entry (default " (Copy)").'),
    folder: z
      .string()
      .min(1)
      .optional()
      .describe('Actor folder id or exact name (created if absent); default: beside the source.'),
    owner: z
      .string()
      .min(1)
      .optional()
      .describe(
        'User id or name (substring ok) who owns the copies: {default NONE, this user: ownershipLevel}.'
      ),
    ownershipLevel: z
      .enum(['OWNER', 'OBSERVER', 'LIMITED'])
      .default('OWNER')
      .describe('Level for `owner` (default OWNER).'),
  })
  .superRefine((v, ctx) => {
    if (v.newNames && v.newNames.length > v.actorIdentifiers.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'newNames has more entries than actorIdentifiers — align the two by index',
        path: ['newNames'],
      });
    }
  });

const DeleteActorSchema = z.object({
  identifiers: z.array(actorTargetStrict).min(1).describe('The actors to delete.'),
  removeEmptyFolder: z
    .boolean()
    .default(true)
    .describe(
      'Also delete a bridge-created folder this leaves empty (default true); never a user folder.'
    ),
});

const DeleteFolderSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Folder identifier cannot be empty')
    .describe('Exact folder name or ID to delete (e.g., "Foundry MCP Creatures")'),
  type: z
    .string()
    .min(1)
    .default('Actor')
    .describe(
      'Folder document type (default "Actor"). E.g. "Actor", "Item", "JournalEntry", "Scene".'
    ),
  deleteContents: z
    .boolean()
    .default(false)
    .describe(
      'When true, delete the folder and all documents/subfolders inside it. When false (default), only delete the folder if it is already empty.'
    ),
});

export class ActorCreationTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: ActorCreationToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ActorCreationTools' });
  }

  /**
   * Tool definitions for actor creation operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'create-actor-from-compendium',
        description:
          'Copy one or more actors from a compendium entry (packId + itemId, from search-compendium) ' +
          'under names[]. `modifications` (update-actor-shaped: cr / hp / ac / abilities / skills / ' +
          'defenses / biography / currency) are applied to each world copy, never the source; ' +
          '`folder` files them. Premium packs only: an SRD pack is refused.',
        inputSchema: toInputSchema(CreateActorFromCompendiumSchema),
      },
      {
        name: 'duplicate-actor',
        description:
          'Clone world actors as full copies (system, items, effects, prototype token). Names: ' +
          'newNames[] by index, else source name + suffix (default " (Copy)"). folder files them ' +
          'together (default: beside the source). owner (+ ownershipLevel) sets each copy to ' +
          '{default NONE, that user}; omitted, the source ownership is copied. A missing source is ' +
          'reported, not fatal. GM-only.',
        inputSchema: toInputSchema(DuplicateActorSchema),
      },
      {
        name: 'delete-actor',
        description:
          'Permanently delete world actors (no undo). A bridge-created folder left empty is removed ' +
          'too unless removeEmptyFolder:false. GM-only.',
        inputSchema: toInputSchema(DeleteActorSchema),
      },
      {
        name: 'delete-folder',
        description:
          'Permanently delete a folder by exact name or ID. GM-only, IRREVERSIBLE. By default refuses ' +
          'to delete a folder that still contains documents or subfolders (safe for cleaning up empty ' +
          'leftover folders). Pass deleteContents:true to delete the folder AND everything inside it. ' +
          'Defaults to Actor folders; set type for other document folders.',
        inputSchema: toInputSchema(DeleteFolderSchema),
      },
    ];
  }

  /**
   * Handle actor creation from specific compendium entry
   */
  async handleCreateActorFromCompendium(args: any): Promise<any> {
    const {
      packId,
      itemId,
      names,
      quantity,
      folder,
      addToScene,
      placement,
      modifications,
      disposition,
    } = CreateActorFromCompendiumSchema.parse(args);
    assertNoSrdPacks(packId, 'create-actor-from-compendium');
    const finalQuantity = quantity || names.length;

    this.logger.info('Creating actors from specific compendium entry', {
      packId,
      itemId,
      names,
      quantity: finalQuantity,
      addToScene,
    });

    // Ensure we have enough names for the quantity
    const customNames = [...names];
    while (customNames.length < finalQuantity) {
      const baseName = names[0] || 'Unnamed';
      customNames.push(`${baseName} ${customNames.length + 1}`);
    }

    // Create the actors page-side (foundry.call) using exact pack/item IDs
    const result = await this.foundry.call('createActorFromCompendium', {
      packId,
      itemId,
      customNames: customNames.slice(0, finalQuantity),
      quantity: finalQuantity,
      addToScene,
      placement: placement
        ? {
            type: placement.type,
            coordinates: placement.coordinates,
          }
        : undefined,
      // Prefab-as-base: layer these edits onto the world copy (never the compendium source).
      ...(modifications ? { modifications } : {}),
      ...(disposition ? { disposition } : {}),
      ...(folder ? { folder } : {}),
    });

    this.logger.info('Actor creation completed', {
      totalCreated: result.totalCreated,
      totalRequested: result.totalRequested,
      tokensPlaced: result.tokensPlaced || 0,
      hasErrors: !!result.errors,
    });

    // Format response for Claude
    return this.formatSimpleActorCreationResponse(
      result,
      packId,
      itemId,
      customNames.slice(0, finalQuantity)
    );
  }

  /**
   * Handle duplication of one or more world actors (toObject clone → rename →
   * folder → ownership → Actor.create; per-actor error isolation page-side)
   */
  async handleDuplicateActor(args: any): Promise<any> {
    const { actorIdentifiers, newNames, suffix, folder, owner, ownershipLevel } =
      DuplicateActorSchema.parse(args);

    this.logger.info('Duplicating actor(s)', {
      actorIdentifiers,
      folder,
      owner,
      ownershipLevel,
    });

    const result = await this.foundry.call('duplicateActor', {
      actorIdentifiers,
      ...(newNames ? { newNames } : {}),
      ...(suffix ? { suffix } : {}),
      ...(folder ? { folder } : {}),
      // ownershipLevel only travels alongside owner — without a user to grant it
      // to, the page copies the source's ownership map unchanged.
      ...(owner ? { owner, ownershipLevel: DUPLICATE_OWNERSHIP_LEVELS[ownershipLevel] } : {}),
    });

    this.logger.info('Actor duplication completed', {
      totalCreated: result.totalCreated,
      totalRequested: result.totalRequested,
      notFound: result.notFound?.length || 0,
      hasErrors: !!result.errors,
    });

    return this.formatDuplicateActorResponse(result, ownershipLevel);
  }

  /**
   * Format actor duplication response
   */
  private formatDuplicateActorResponse(result: any, ownershipLevel: string): any {
    const created = result.totalCreated || 0;
    const requested = result.totalRequested || 0;
    const summary = `✅ Duplicated ${created} of ${requested} actor${requested === 1 ? '' : 's'}`;

    const rows = (result.actors || [])
      .map(
        (a: any) =>
          `• **${a.name}** (${a.id}) ← ${a.sourceName}${a.folderName ? ` — 📁 ${a.folderName}` : ''}`
      )
      .join('\n');

    const ownerInfo = result.owner
      ? `\n🔐 Copies owned by **${result.owner.name}** (${ownershipLevel}); everyone else inherits NONE`
      : '';

    const notFoundInfo =
      result.notFound?.length > 0
        ? `\n⚠️ Not found (nothing duplicated): ${result.notFound.join(', ')}`
        : '';

    const warningsInfo = result.warnings?.length > 0 ? `\n⚠️ ${result.warnings.join('; ')}` : '';

    const errorInfo = result.errors?.length > 0 ? `\n⚠️ Issues: ${result.errors.join(', ')}` : '';

    return {
      summary,
      success: result.success,
      details: {
        actors: result.actors || [],
        ...(result.owner ? { owner: result.owner } : {}),
        notFound: result.notFound,
        warnings: result.warnings,
        errors: result.errors,
      },
      message:
        summary + (rows ? `\n\n${rows}` : '') + ownerInfo + notFoundInfo + warningsInfo + errorInfo,
    };
  }

  /**
   * Handle permanent deletion of one or more world actors
   */
  async handleDeleteActor(args: any): Promise<any> {
    const { identifiers, removeEmptyFolder } = DeleteActorSchema.parse(args);

    this.logger.info('Deleting actor(s)', { identifiers, removeEmptyFolder });

    const result = await this.foundry.call('deleteActor', {
      identifiers,
      removeEmptyFolder,
    });

    this.logger.info('Actor deletion completed', {
      deletedCount: result.deletedCount,
      notFound: result.notFound?.length || 0,
      removedFolders: result.removedFolders?.length || 0,
    });

    return this.formatDeleteActorResponse(result);
  }

  /**
   * Format actor deletion response
   */
  private formatDeleteActorResponse(result: any): any {
    const count = result.deletedCount || 0;
    const summary = `🗑️ Deleted ${count} actor${count === 1 ? '' : 's'}`;

    const deletedList = (result.deleted || [])
      .map((actor: any) => `• **${actor.name}** (${actor.id})`)
      .join('\n');

    const notFoundInfo =
      result.notFound?.length > 0
        ? `\n⚠️ Not found (nothing deleted): ${result.notFound.join(', ')}`
        : '';

    const foldersInfo =
      result.removedFolders?.length > 0
        ? `\n📁 Also removed emptied folder(s): ${result.removedFolders.map((f: any) => f.name).join(', ')}`
        : '';

    return {
      summary,
      success: result.success,
      details: {
        deleted: result.deleted || [],
        notFound: result.notFound,
        removedFolders: result.removedFolders,
      },
      message: summary + (deletedList ? `\n\n${deletedList}` : '') + notFoundInfo + foldersInfo,
    };
  }

  /**
   * Handle permanent deletion of a folder
   */
  async handleDeleteFolder(args: any): Promise<any> {
    const { identifier, type, deleteContents } = DeleteFolderSchema.parse(args);

    this.logger.info('Deleting folder', { identifier, type, deleteContents });

    const result = await this.foundry.call('deleteFolder', {
      identifier,
      type,
      deleteContents,
    });

    this.logger.info('Folder deletion completed', {
      deleted: result.deleted,
      notFound: result.notFound || null,
      deletedContents: result.deletedContents || false,
    });

    return this.formatDeleteFolderResponse(result, identifier);
  }

  /**
   * Format folder deletion response
   */
  private formatDeleteFolderResponse(result: any, identifier: string): any {
    if (!result.deleted) {
      const summary = `⚠️ Folder not found: ${result.notFound ?? identifier}`;
      return {
        summary,
        success: result.success,
        details: { deleted: false, notFound: result.notFound ?? identifier },
        message: summary,
      };
    }

    const f = result.folder || {};
    const summary = `🗑️ Deleted folder **${f.name}**`;
    const contentsInfo = result.deletedContents
      ? `\n⚠️ Also deleted ${result.removedDocuments} document(s) and ${result.removedSubfolders} subfolder(s) inside it`
      : '\n(was empty)';

    return {
      summary,
      success: result.success,
      details: {
        deleted: true,
        folder: f,
        deletedContents: result.deletedContents || false,
        removedDocuments: result.removedDocuments || 0,
        removedSubfolders: result.removedSubfolders || 0,
      },
      message: `${summary} (${f.id})${contentsInfo}`,
    };
  }

  /**
   * Format simplified actor creation response
   */
  private formatSimpleActorCreationResponse(
    result: any,
    packId: string,
    itemId: string,
    _customNames: string[]
  ): any {
    const summary = `✅ Created ${result.totalCreated} of ${result.totalRequested} requested actors`;

    const details = result.actors
      .map((actor: any) => `• **${actor.name}** (from ${packId})`)
      .join('\n');

    // Echo where the copies were filed (the page resolves/creates the folder and reports it back).
    const folderInfo = result.folder?.name ? `\n📁 Filed under **${result.folder.name}**` : '';

    const sceneInfo =
      result.tokensPlaced > 0
        ? `\n🎯 Added ${result.tokensPlaced} tokens to the current scene`
        : '';

    const errorInfo = result.errors?.length > 0 ? `\n⚠️ Issues: ${result.errors.join(', ')}` : '';

    // Prefab-as-base: report which stat edits were layered onto the world copy (same on every copy),
    // plus any soft-validation warnings update-actor raised. Confirms the bridge touched the COPY.
    const firstMod = (result.actors ?? []).find((a: any) => a.modifications)?.modifications;
    const modApplied: string[] = firstMod?.applied ?? [];
    const modWarnings: string[] = Array.from(
      new Set((result.actors ?? []).flatMap((a: any) => a.modifications?.warnings ?? []))
    );
    const modInfo =
      modApplied.length > 0
        ? `\n🔧 Layered onto the copy: ${modApplied.join(', ')}` +
          (modWarnings.length > 0 ? `\n⚠️ Modification warnings: ${modWarnings.join('; ')}` : '')
        : '';

    // A pure MM prefab copy is clean, but a humanoid built from PC class/racial features carries
    // @scale tokens that dangle on an NPC — the page reports them per created actor/item. Surface
    // them so the skill sets explicit dice on the world copy (the tool never picks the value).
    const unresolvedScale = (result.actors ?? []).flatMap((a: any) =>
      (a.unresolvedScale ?? []).map((t: any) => ({
        label: `${a.name} → ${t.itemName}`,
        path: t.path,
        formula: t.formula,
      }))
    );

    // Rule 7 — surface the copied creature's attack damage types. If the agent reskinned this base to
    // a new theme (a rename / modifications), it must SEE the off-theme damage and replace those
    // abilities with real ones — not reflavor in prose. The tool removes the "didn't notice" excuse.
    const damageTypes: string[] = Array.from(
      new Set<string>((result.actors ?? []).flatMap((a: any) => a.damageProfile?.damageTypes ?? []))
    ).sort();
    const damageInfo =
      damageTypes.length > 0
        ? `\n⚔️ Base attacks deal: **${damageTypes.join(', ')}**. If you reskinned this creature to a ` +
          'different theme, REPLACE each off-theme attack/ability with a real one of the new damage ' +
          'type (rule 7) — never reflavor it in prose.'
        : '';

    return {
      summary,
      success: result.success,
      details: {
        actors: result.actors,
        sourceEntry: {
          packId,
          itemId,
        },
        tokensPlaced: result.tokensPlaced || 0,
        errors: result.errors,
        ...(result.folder ? { folder: result.folder } : {}),
        ...(modApplied.length > 0
          ? { modifications: { applied: modApplied, warnings: modWarnings } }
          : {}),
        ...(damageTypes.length > 0 ? { damageTypes } : {}),
        ...(unresolvedScale.length > 0 ? { unresolvedScale } : {}),
      },
      message: `${summary}\n\n${details}${folderInfo}${modInfo}${sceneInfo}${errorInfo}${damageInfo}${formatUnresolvedScale(unresolvedScale)}`,
    };
  }
}
