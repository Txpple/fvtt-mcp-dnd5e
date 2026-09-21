import { z } from 'zod';
import { ACTOR_TARGET, actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';
import { assertNoSrdPacks } from '../../utils/compendium-sources.js';
import { formatUnresolvedScale } from '../../utils/format.js';

/**
 * import-item — COPY a physical item from a compendium pack onto an actor (or into the world Items
 * sidebar), preserving its art, system data, and activities. This is the compendium-first counterpart
 * to add-item (which authors from scratch): the project policy is to grab the real PHB/DMG 2024 entry
 * and tweak it, rather than rebuild gear by hand. Find the packId + itemId with search-compendium /
 * get-compendium-entry first, then copy here; afterward refine the copy with update-actor-item,
 * manage-activity, or manage-effect (e.g. bump a base shield to +1 and rename it for a custom item).
 */
export type ImportItemArgs = z.output<typeof ImportItemSchema>;

const ImportItemSchema = z.object({
  packId: z
    .string()
    .min(1, 'packId cannot be empty')
    .describe(
      'Compendium pack id, e.g. "dnd-players-handbook.equipment"; an SRD pack (dnd5e.*) is refused.'
    ),
  itemId: z
    .string()
    .min(1, 'itemId cannot be empty')
    .describe('Entry id within the pack (from search-compendium).'),
  actorIdentifier: actorTarget.optional().describe(`${ACTOR_TARGET} Omit: a world Item.`),
  name: z.string().min(1).optional().describe('Rename the copy.'),
  quantity: z.number().int().min(0).optional().describe('Stack count on the copy.'),
  equipped: z.boolean().optional().describe('Equipped state (equippable items only).'),
  identified: z.boolean().optional().describe('false = unidentified loot.'),
  container: z
    .string()
    .optional()
    .describe('An existing container on the same target (id or name) to nest inside.'),
  folder: z.string().optional().describe('World Item: its folder.'),
  lootCopy: z
    .boolean()
    .optional()
    .describe(
      '[actor] Also mint a world Item as loot: default on for magic items (rarity or "mgc"); ' +
        'true forces, false suppresses.'
    ),
  lootCopyFolder: z
    .string()
    .optional()
    .describe('Folder for the loot copy (created if absent). Default "Loot".'),
});

export interface DnD5eImportItemToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eImportItemTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eImportItemToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eImportItemTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'import-item',
        description:
          '[D&D 5e] Copy a compendium item (packId + itemId, from search-compendium) onto an actor or ' +
          'into the world Items sidebar with its art, system data and activities; name / quantity / ' +
          'equipped / identified / container are applied to the copy. Premium packs only: an SRD ' +
          'pack is refused.',
        inputSchema: toInputSchema(ImportItemSchema),
      },
    ];
  }

  async handleImportItem(args: any): Promise<any> {
    const parsed = ImportItemSchema.parse(args ?? {});
    assertNoSrdPacks(parsed.packId, 'import-item');
    await assertDnd5e(this.foundry, this.logger, 'import-item');

    this.logger.info('Copying item from compendium', {
      packId: parsed.packId,
      itemId: parsed.itemId,
      target: parsed.actorIdentifier ?? 'world',
      rename: parsed.name,
    });

    const result = await this.foundry.call('importItemFromCompendium', parsed);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const item = result?.item ?? {};
    const src = result?.source ?? {};
    const target =
      result?.target?.type === 'actor'
        ? `actor "${result.target.name}"`
        : `world Items${result?.target?.folderName ? ` (folder "${result.target.folderName}")` : ''}`;
    const renamed = src.name && item.name && src.name !== item.name ? ` (from "${src.name}")` : '';
    const loot = result?.lootCopy;
    const summary = `✅ Copied "${item.name ?? '?'}"${renamed} onto ${target}`;
    const details = [
      `**Item:** ${item.name ?? '?'} (id: \`${item.id ?? '?'}\`, type: ${item.type ?? '?'})`,
      `**Source:** \`${src.packId ?? '?'}\` / \`${src.itemId ?? '?'}\``,
      `**Target:** ${target}`,
      loot
        ? `**Loot copy:** "${loot.name}" (id: \`${loot.id}\`) in folder "${loot.folderName ?? 'Loot'}" — a lootable world Item (rule 9)`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    // The page reports any unresolved @scale tokens the copy carries (rare for gear, but a magic-item
    // feature rider can); surface them so the skill sets the die.
    const unresolvedScale = (result?.unresolvedScale ?? []).map((t: any) => ({
      label: item.name ?? '?',
      path: t.path,
      formula: t.formula,
    }));
    return {
      summary,
      success: true,
      item,
      source: result?.source,
      target: result?.target,
      ...(loot ? { lootCopy: loot } : {}),
      ...(unresolvedScale.length > 0 ? { unresolvedScale } : {}),
      message: `${summary}\n\n${details}${formatUnresolvedScale(unresolvedScale)}`,
    };
  }
}
