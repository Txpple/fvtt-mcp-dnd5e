import { z } from 'zod';
import { ACTOR_TARGET, actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';
import { DAMAGE_TYPES, WEAPON_PROPERTIES } from '../../utils/dnd5e-canonical.js';

/**
 * add-item — the structured dnd5e physical-item (loot/gear) builder. The inventory counterpart to
 * add-feature: where add-feature authors features/attacks/spells, add-item authors weapons, armor,
 * shields, wondrous items, consumables, tools, generic loot, and containers, with named params +
 * soft-validation for the fields a GM expects (price, weight, quantity, rarity, attunement, equipped,
 * identified, magical +N bonus). It targets an actor's embedded inventory OR the world Items sidebar.
 * The page layer (addItem / buildPhysicalItemData) owns the dnd5e 5.3.3 field shapes.
 */

const ABILITY = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const DENOMINATION = z.enum(['pp', 'gp', 'ep', 'sp', 'cp']);
const RARITY = z.enum(['', 'common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact']);
const ATTUNEMENT = z.enum(['', 'required', 'optional']);

// dnd5e 5.3.3 damage types + weapon property codes — soft validation (warn, never block).
// Single-sourced in utils/dnd5e-canonical.ts (shared with add-feature / npc / the page layer).
const DAMAGE_CANONICAL = DAMAGE_TYPES;
const PROPERTY_CANONICAL = WEAPON_PROPERTIES;

const damageShape = z
  .object({
    number: z.number().int().min(1).describe('Number of dice (e.g. 1).'),
    denomination: z.literal([4, 6, 8, 10, 12, 20, 100]).describe('Die size.'),
    types: z
      .array(z.string().min(1))
      .min(1)
      .describe('Damage type(s), e.g. ["slashing"]. Multiple = the weapon deals each.'),
  })
  .describe("Base damage (weapon base die, or an ammo round's added damage).");

export type AddItemArgs = z.output<typeof AddItemSchema>;

const AddItemSchema = z.object({
  // ── Discriminator ─────────────────────────────────────────────────
  itemType: z
    .enum(['weapon', 'armor', 'shield', 'wondrous', 'consumable', 'tool', 'loot', 'container'])
    .describe(
      'armor / shield / wondrous are dnd5e "equipment"; loot is gems / trade goods / junk.'
    ),

  // ── Target ────────────────────────────────────────────────────────
  actorIdentifier: actorTarget.optional().describe(`${ACTOR_TARGET} Omit: a world Item.`),
  folder: z.string().optional().describe('World Item: its folder (created if absent).'),

  // ── Loot twin (rule 9 — NPC magic gear is lootable) ───────────────
  lootCopy: z
    .boolean()
    .optional()
    .describe(
      '[actor] Also mint a world Item as loot: default on for magic items (rarity, "mgc", a +N); ' +
        'true forces, false suppresses.'
    ),
  lootCopyFolder: z
    .string()
    .optional()
    .describe('Folder for the loot copy (created if absent). Default "Loot".'),

  // ── Identity ──────────────────────────────────────────────────────
  name: z.string().min(1, 'name cannot be empty').describe('Item name.'),
  img: z
    .string()
    .optional()
    .describe('Icon path; omitted or unresolvable, a real icon is auto-filled (with a warning).'),
  description: z.string().default('').describe('HTML description.'),

  // ── Cross-cutting physical fields (PhysicalItemTemplate) ──────────
  quantity: z.number().int().min(0).optional().describe('Stack count (e.g. 20 arrows). Default 1.'),
  price: z
    .object({
      value: z.number().min(0).default(0).describe('Price amount.'),
      denomination: DENOMINATION.default('gp').describe('Coin (pp/gp/ep/sp/cp).'),
    })
    .optional()
    .describe('Item price.'),
  weight: z
    .object({
      value: z.number().min(0).default(0),
      units: z.string().default('lb'),
    })
    .optional()
    .describe('Item weight.'),
  rarity: z
    .union([RARITY, z.array(RARITY)])
    .optional()
    .describe('Rarity ("" = mundane), or a list for a "Rarity Varies" item (system.rarities).'),
  identified: z.boolean().optional().describe('Default true.'),
  container: z
    .string()
    .optional()
    .describe('An existing container item on the same target (id or name) to nest inside.'),

  // ── Equippable + magical (weapon/equipment/consumable/tool) ───────
  equipped: z.boolean().optional().describe('Worn / wielded (default true on an NPC).'),
  attunement: ATTUNEMENT.optional().describe('"" none, required, or optional.'),
  attuned: z.boolean().optional().describe('Currently attuned by its owner.'),
  magical: z.boolean().optional().describe('Adds the "mgc" property; implied by magicalBonus.'),
  magicalBonus: z
    .number()
    .int()
    .optional()
    .describe('The +N (attack and damage on a weapon, AC on armor).'),
  properties: z
    .array(z.string())
    .default([])
    .describe('dnd5e property codes, e.g. ["fin", "lgt"]; "mgc" marks magical.'),

  // ── Weapon ────────────────────────────────────────────────────────
  weaponClass: z
    .enum(['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'])
    .optional()
    .describe('[weapon] Default natural (monster attacks).'),
  baseItem: z
    .string()
    .optional()
    .describe('[weapon/armor/tool] Specific base-item key (e.g. "longsword", "plate", "smith").'),
  damage: damageShape
    .optional()
    .describe('[weapon] Base damage die. [consumable ammo] Added damage.'),
  versatile: damageShape
    .optional()
    .describe('[weapon] Two-handed (versatile) damage (needs the "ver" property).'),
  withAttack: z
    .boolean()
    .optional()
    .describe(
      '[weapon] Build an attack activity from damage + attackType (default: true when damage is given).'
    ),
  attackType: z
    .enum(['melee', 'ranged'])
    .optional()
    .describe('[weapon] Attack kind. Default "melee".'),
  attackBonus: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe('[weapon] Flat bonus to the attack roll only (separate from magicalBonus).'),
  reachFt: z.number().int().min(5).optional().describe('[weapon, melee] Reach in feet. Default 5.'),
  rangeFt: z.number().int().min(1).optional().describe('[weapon, ranged] Normal range in feet.'),
  longRangeFt: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('[weapon, ranged] Long (disadvantage) range.'),
  abilityModifier: ABILITY.optional().describe('[weapon, 2024] Attack/damage ability override.'),
  proficient: z
    .number()
    .optional()
    .describe('[weapon/armor/tool] Proficiency (weapon/armor 0|1; tool 0|0.5|1|2). Omit to infer.'),
  sourceRules: z
    .enum(['2014', '2024'])
    .default('2024')
    .describe('[weapon] Rules edition of the attack activity.'),

  // ── Armor / shield ────────────────────────────────────────────────
  armorType: z
    .enum(['light', 'medium', 'heavy'])
    .optional()
    .describe('[armor] Armor weight class. Default "medium".'),
  armorValue: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('[armor] Base AC (shield = AC bonus, default 2).'),
  dex: z
    .number()
    .int()
    .optional()
    .describe('[armor] Max Dex bonus to AC (omit = unlimited/light; 2 = medium; 0 = heavy).'),
  strength: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('[armor] Min Strength to wear without a speed penalty.'),
  equipmentType: z
    .string()
    .optional()
    .describe('[wondrous] Equipment subtype (clothing / ring / rod / wand …). Default trinket.'),
  wireAc: z
    .boolean()
    .default(false)
    .describe('[body armor on an actor] Also switch the actor to armor-derived AC.'),

  // ── Consumable ────────────────────────────────────────────────────
  consumableType: z
    .enum(['potion', 'scroll', 'ammo', 'poison', 'food', 'wand', 'rod', 'trinket'])
    .optional()
    .describe('[consumable] Category. Default "potion".'),
  subtype: z.string().optional().describe('[consumable/loot] Finer subtype (e.g. ammo "arrow").'),
  uses: z
    .object({
      max: z
        .union([z.number().int().min(0), z.string()])
        .optional()
        .describe('Max charges/uses.'),
      spent: z.number().int().min(0).optional().describe('Charges already used (default 0).'),
      recovery: z
        .array(z.object({ period: z.string(), type: z.string(), formula: z.string().optional() }))
        .optional()
        .describe('Recovery profiles, e.g. [{period:"dawn",type:"formula",formula:"1d6+1"}].'),
      autoDestroy: z.boolean().optional().describe('Destroy when uses hit 0 (potions/scrolls).'),
    })
    .optional()
    .describe('[consumable] Limited uses / charges.'),
  ammoReplace: z
    .boolean()
    .optional()
    .describe('[ammo] Damage replaces the weapon base instead of adding.'),

  // ── Tool ──────────────────────────────────────────────────────────
  toolType: z.string().optional().describe('[tool] Category key (art/game/music/…).'),
  ability: ABILITY.optional().describe('[tool] Default ability for the tool check.'),
  toolBonus: z.string().optional().describe('[tool] Flat bonus formula added to the check.'),

  // ── Loot ──────────────────────────────────────────────────────────
  lootType: z
    .enum(['art', 'gear', 'gem', 'junk', 'material', 'resource', 'trade', 'treasure'])
    .optional()
    .describe('[loot] Loot category. Default "gear".'),

  // ── Container ─────────────────────────────────────────────────────
  capacity: z
    .object({
      count: z.number().int().min(0).optional().describe('Max distinct items.'),
      weight: z.object({ value: z.number().min(0), units: z.string().default('lb') }).optional(),
      volume: z.object({ value: z.number().min(0), units: z.string().default('ft') }).optional(),
    })
    .optional()
    .describe('[container] Carrying capacity.'),
  currency: z
    .object({
      pp: z.number().int().min(0).optional(),
      gp: z.number().int().min(0).optional(),
      ep: z.number().int().min(0).optional(),
      sp: z.number().int().min(0).optional(),
      cp: z.number().int().min(0).optional(),
    })
    .optional()
    .describe('[container] Coins stored inside the container.'),
});

export interface DnD5eAddItemToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eAddItemTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eAddItemToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eAddItemTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'add-item',
        description:
          '[D&D 5e] Author a physical item (weapon, armor / shield, wondrous, consumable, tool, loot, ' +
          'container) on an actor or as a world Item; the leaves are tagged by itemType and the rest ' +
          'default. magicalBonus / magical add "mgc" (the +N lands on weapons, body armor and magic ' +
          'ammo; wondrous / potion have none). A duplicate name is not refused. Copying a compendium ' +
          'item is import-item.',
        inputSchema: toInputSchema(AddItemSchema),
      },
    ];
  }

  async handleAddItem(args: any): Promise<any> {
    const parsed = AddItemSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'add-item');

    // Soft validation — warn, never block (mirrors add-feature).
    const warnings: string[] = [];
    const checkDamage = (d?: { types: string[] }) => {
      for (const t of d?.types ?? []) {
        if (!DAMAGE_CANONICAL.has(t)) {
          warnings.push(`Unknown damage type "${t}" — verify it matches dnd5e system values`);
        }
      }
    };
    checkDamage(parsed.damage);
    checkDamage(parsed.versatile);
    for (const p of parsed.properties) {
      if (!PROPERTY_CANONICAL.has(p)) {
        warnings.push(`Unknown weapon property "${p}" — verify it matches dnd5e system values`);
      }
    }
    if (parsed.attuned && (parsed.attunement ?? '') === '') {
      warnings.push('attuned is true but attunement is "" (none) — the item cannot be attuned.');
    }
    if (
      (parsed.itemType === 'armor' || parsed.itemType === 'shield') &&
      parsed.armorValue === undefined
    ) {
      const def =
        parsed.itemType === 'shield'
          ? '+2'
          : String({ light: 11, medium: 14, heavy: 16 }[parsed.armorType ?? 'medium'] ?? 14);
      warnings.push(
        `No armorValue given for ${parsed.itemType} — defaulting (${def}); set armorValue for the real AC.`
      );
    }
    // A numeric +N has no home on a wondrous (plain equipment) item or a non-ammo consumable in
    // dnd5e 5.3.3 — only the 'mgc' flag is set; the bonus must come from an ActiveEffect.
    if (parsed.magicalBonus != null && parsed.magicalBonus !== 0) {
      if (parsed.itemType === 'wondrous') {
        warnings.push(
          'magicalBonus has no numeric field on a wondrous item — only the "mgc" flag is set; apply the +N via manage-effect (ActiveEffect).'
        );
      } else if (parsed.itemType === 'consumable' && parsed.consumableType !== 'ammo') {
        warnings.push(
          'magicalBonus only applies to ammunition consumables; for a magic potion/scroll the +N is not stored — use magical:true plus manage-effect for any bonus.'
        );
      }
    }
    // attunement/attuned/equipped don't exist on loot/container items — they're silently dropped.
    if (
      (parsed.itemType === 'loot' || parsed.itemType === 'container') &&
      ((parsed.attunement ?? '') !== '' || parsed.attuned === true || parsed.equipped !== undefined)
    ) {
      warnings.push(
        `attunement/attuned/equipped are ignored for ${parsed.itemType} items — use itemType "wondrous" for an attunable magic item.`
      );
    }
    // Ranged weapon needs a range; without rangeFt system.range.value is null and the attack has none.
    if (
      parsed.itemType === 'weapon' &&
      parsed.attackType === 'ranged' &&
      parsed.rangeFt === undefined &&
      parsed.withAttack !== false
    ) {
      warnings.push(
        'Ranged weapon has no rangeFt — system.range.value will be null and the attack has no defined range. Set rangeFt.'
      );
    }
    if (
      parsed.longRangeFt !== undefined &&
      parsed.rangeFt !== undefined &&
      parsed.longRangeFt <= parsed.rangeFt
    ) {
      warnings.push(
        `longRangeFt (${parsed.longRangeFt}) should be greater than rangeFt (${parsed.rangeFt}).`
      );
    }
    if (parsed.itemType === 'weapon' && parsed.withAttack === true && parsed.damage === undefined) {
      warnings.push(
        'withAttack:true but no damage given — no attack activity was created; supply damage to get a rollable attack.'
      );
    }
    if (parsed.versatile !== undefined && !(parsed.properties ?? []).includes('ver')) {
      warnings.push(
        'versatile damage given but the "ver" property is missing — add "ver" to properties for the two-handed die to apply.'
      );
    }
    if (parsed.itemType === 'weapon' && parsed.abilityModifier && parsed.sourceRules !== '2024') {
      warnings.push(
        `abilityModifier "${parsed.abilityModifier}" only applies under 2024 rules; on 2014 weapons the ability is auto-derived from weapon properties.`
      );
    }
    if (parsed.uses && parsed.itemType !== 'consumable') {
      warnings.push(`uses is ignored for itemType "${parsed.itemType}" (consumable only).`);
    }
    if (parsed.wireAc && !parsed.actorIdentifier) {
      warnings.push('wireAc only applies when attaching to an actor; ignored for a world item.');
    }
    if ((parsed.lootCopy || parsed.lootCopyFolder) && !parsed.actorIdentifier) {
      warnings.push(
        'lootCopy applies when attaching to an actor; a world item is already lootable — ignored.'
      );
    }

    // withAttack defaults to true for a weapon that has damage.
    const withAttack =
      parsed.itemType === 'weapon' ? (parsed.withAttack ?? parsed.damage !== undefined) : false;

    this.logger.info('Authoring physical item', {
      itemType: parsed.itemType,
      name: parsed.name,
      target: parsed.actorIdentifier ?? 'world',
      warnings: warnings.length,
    });

    const result = await this.foundry.call('addItem', { ...parsed, withAttack });
    return this.formatResponse(result, parsed, warnings);
  }

  private formatResponse(result: any, params: any, warnings: string[]): any {
    // Merge tool-side soft-validation warnings with any the page raised (e.g. a 404 img substitution).
    const mergedWarnings = [
      ...warnings,
      ...(Array.isArray(result?.warnings) ? result.warnings : []),
    ];
    const target =
      result?.target?.type === 'actor'
        ? `actor "${result.target.name}"`
        : `world Items${result?.target?.folderName ? ` (folder "${result.target.folderName}")` : ''}`;
    const item = result?.item ?? {};
    // loot/container can't hold attunement (the page drops it), so don't claim it in the summary.
    const equippable = !['loot', 'container'].includes(params.itemType);
    const bits = [
      Array.isArray(params.rarity)
        ? params.rarity.filter((r: string) => r !== '').join(' / ') || null
        : params.rarity && params.rarity !== ''
          ? params.rarity
          : null,
      params.magicalBonus ? `+${params.magicalBonus}` : null,
      equippable && params.attunement && params.attunement !== ''
        ? `attunement ${params.attunement}`
        : null,
      params.quantity && params.quantity !== 1 ? `×${params.quantity}` : null,
    ].filter(Boolean);
    const loot = result?.lootCopy;
    const summary = `✅ Created ${params.itemType} "${item.name ?? params.name}" on ${target}`;
    const details = [
      `**Item:** ${item.name ?? params.name} (id: \`${item.id ?? '?'}\`, type: ${item.type ?? '?'})`,
      `**Target:** ${target}`,
      bits.length ? `**Properties:** ${bits.join(', ')}` : null,
      loot
        ? `**Loot copy:** "${loot.name}" (id: \`${loot.id}\`) in folder "${loot.folderName ?? 'Loot'}" — a lootable world Item (rule 9)`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    const warningSection =
      mergedWarnings.length > 0
        ? `\n\n⚠️ **Warnings (${mergedWarnings.length}):**\n${mergedWarnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      item,
      target: result?.target,
      ...(loot ? { lootCopy: loot } : {}),
      warnings: mergedWarnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }
}
