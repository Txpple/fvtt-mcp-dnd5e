import { z } from 'zod';
import { ACTOR_TARGET, actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { assertNoSrdPacks } from '../../utils/compendium-sources.js';
import { formatUnresolvedScale } from '../../utils/format.js';

/**
 * manage-items `import` — COPY a physical item from a compendium pack onto an actor (or into the
 * world Items sidebar), preserving its art, system data, and activities. This is the
 * compendium-first counterpart to add-item (which authors from scratch): the project policy is to
 * grab the real PHB/DMG 2024 entry and tweak it, rather than rebuild gear by hand. Find the packId
 * + itemId with search-compendium / get-compendium-entry first, then copy here; afterward refine
 * the copy with update-actor-item, manage-activity, or manage-effect (e.g. bump a base shield to
 * +1 and rename it for a custom item). The member rides the items union (src/tools/items.ts,
 * M8 of the 3.0 plan); this file owns its contract, its dnd5e / SRD guards and its confirmation.
 */
export type ImportItemArgs = z.output<typeof ImportItemSchema>;

export const ImportItemSchema = z.object({
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
  folder: z.string().optional(),
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

export const IMPORT_ITEM_DESCRIPTION =
  '[D&D 5e] Copy a compendium item onto an actor or into the sidebar with its art, system data ' +
  'and activities; premium packs only.';

/** The import member's handler: the guards, the page call, the one-line confirmation. */
export async function importItem(
  foundry: FoundryBridge,
  logger: Logger,
  parsed: ImportItemArgs
): Promise<string> {
  assertNoSrdPacks(parsed.packId, 'manage-items import');
  await assertDnd5e(foundry, logger, 'manage-items import');

  logger.info('Copying item from compendium', {
    packId: parsed.packId,
    itemId: parsed.itemId,
    target: parsed.actorIdentifier ?? 'world',
    rename: parsed.name,
  });

  const result = await foundry.call('importItemFromCompendium', parsed);
  const item = result?.item ?? {};
  const src = result?.source ?? {};
  const target =
    result?.target?.type === 'actor'
      ? `actor "${result.target.name}"`
      : `world Items${result?.target?.folderName ? ` (folder "${result.target.folderName}")` : ''}`;
  const renamed = src.name && item.name && src.name !== item.name ? ` (from "${src.name}")` : '';
  const loot = result?.lootCopy;
  // The page reports any unresolved @scale tokens the copy carries (rare for gear, but a magic-item
  // feature rider can); surface them so the skill sets the die.
  const unresolvedScale = (result?.unresolvedScale ?? []).map((t: any) => ({
    label: item.name ?? '?',
    path: t.path,
    formula: t.formula,
  }));
  return (
    `Copied "${item.name ?? '?'}"${renamed} onto ${target}: id ${item.id ?? '?'}, type ${item.type ?? '?'}` +
    (loot
      ? `; loot copy "${loot.name}" (${loot.id}) in folder "${loot.folderName ?? 'Loot'}"`
      : '') +
    formatUnresolvedScale(unresolvedScale)
  );
}
