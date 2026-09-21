import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * update-actor — edit an EXISTING dnd5e actor's own stat-block fields (abilities, saves, skills,
 * HP/AC/init, movement, senses, defenses, languages, details/biography, NPC resources, 2024 habitat/
 * treasure). It does NOT touch embedded items (use update-actor-item / add-feature / manage-activity)
 * or run combat automation. The page layer (updateActor) owns correctness: field paths, NPC-only
 * gating, FormulaField string coercion, Set add/remove read-modify-write, and soft validation.
 */

const ABILITY = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);

// Reusable Set-field shape (damage/condition immunities, languages, treasure). Replace overwrites
// the whole list; add/remove merge against the actor's current list (page reads it live).
// `custom` exists only on the SimpleTraitField traits (di / dr / dv / ci / languages) — the 6.0.1
// npc `details.treasure` schema is { value } alone, so its shape omits it.
const setField = (what: string, supportsCustom = true) =>
  z
    .object({
      mode: z
        .enum(['replace', 'add', 'remove'])
        .default('replace')
        .describe(
          'replace (default) overwrites the whole list; add/remove merge with the current list.'
        ),
      values: z.array(z.string()).default([]).describe(what),
      ...(supportsCustom
        ? {
            custom: z
              .string()
              .optional()
              .describe(
                'Free-text custom entry stored alongside the set (replaces the existing custom string).'
              ),
          }
        : {}),
    })
    .optional();

/** The page handler's arg shape — `updateActor` receives exactly this (a type-only import there). */
export type UpdateActorArgs = z.output<typeof UpdateActorSchema>;

const UpdateActorSchema = z.object({
  actorIdentifier: actorTarget,

  // identity
  name: z.string().min(1).optional().describe('Rename the actor.'),
  tokenName: z
    .string()
    .min(1)
    .optional()
    .describe('Prototype nameplate, decoupled from the actor name; placed tokens keep theirs.'),
  img: z.string().optional().describe('Portrait image path or URL.'),
  disposition: z
    .enum(['hostile', 'neutral', 'friendly', 'secret'])
    .optional()
    .describe('Prototype-token disposition.'),
  tokenAutoRotate: z
    .boolean()
    .optional()
    .describe('true = faces its movement (lockRotation off, the default); false = fixed facing.'),
  tokenRing: z
    .boolean()
    .optional()
    .describe('Prototype dynamic ring (default off; true keeps the ring config).'),
  tokenScale: z
    .number()
    .positive()
    .optional()
    .describe(
      'Prototype art scale (texture.scaleX/Y): 1 normal, 2 double; the grid footprint is unchanged.'
    ),
  tokenRotation: z
    .number()
    .optional()
    .describe('Prototype facing, 0–359°; auto-unlocks rotation (tokenAutoRotate) with a warning.'),
  tokenDisplayName: z
    .enum(['none', 'control', 'owner-hover', 'hover', 'owner', 'always'])
    .optional()
    .describe(
      'Prototype nameplate visibility: none · control (selected) · owner-hover · hover · owner · always.'
    ),
  tokenDisplayBars: z
    .enum(['none', 'control', 'owner-hover', 'hover', 'owner', 'always'])
    .optional()
    .describe('Prototype HP-bar visibility, same modes as tokenDisplayName.'),

  // details (most NPC-only)
  size: z
    .enum(['tiny', 'small', 'sm', 'medium', 'med', 'large', 'lg', 'huge', 'gargantuan', 'grg'])
    .optional()
    .describe('Creature size (long name or short code).'),
  cr: z
    .number()
    .min(0)
    .max(30)
    .optional()
    .describe('[NPC] Challenge rating (0.125 / 0.25 / 0.5 allowed).'),
  creatureType: z
    .string()
    .optional()
    .describe('[NPC] Creature type key (humanoid, undead, fiend, …).'),
  creatureSubtype: z
    .string()
    .optional()
    .describe('[NPC] Creature subtype free text (e.g. "Devil").'),
  swarmSize: z
    .enum(['', 'tiny', 'sm', 'med', 'lg', 'huge', 'grg'])
    .optional()
    .describe('[NPC] Swarm member size, or "" if the creature is not a swarm.'),
  alignment: z.string().optional().describe('Alignment free text (e.g. "Lawful Evil").'),
  biography: z.string().optional().describe('Biography / description (HTML).'),
  source: z
    .object({
      book: z.string().optional(),
      page: z.string().optional(),
      rules: z.enum(['2014', '2024']).optional(),
    })
    .optional()
    .describe('[NPC] Source metadata (book / page / rules edition) — system.source.'),

  // abilities / saves / skills
  abilities: z
    .object({
      str: z.number().int().min(1).max(30).optional(),
      dex: z.number().int().min(1).max(30).optional(),
      con: z.number().int().min(1).max(30).optional(),
      int: z.number().int().min(1).max(30).optional(),
      wis: z.number().int().min(1).max(30).optional(),
      cha: z.number().int().min(1).max(30).optional(),
    })
    .optional()
    .describe('Ability scores to set — only the abilities you list change.'),
  savingThrows: z
    .array(ABILITY)
    .optional()
    .describe('Replaces the proficient saving throws with the listed abilities.'),
  skills: z
    .array(
      z.object({
        skill: z.string().describe('Skill full name ("Perception") or key ("prc").'),
        proficiency: z
          .enum(['none', 'proficient', 'expert'])
          .describe('none clears proficiency; proficient = ×1; expert = ×2 (expertise).'),
      })
    )
    .optional()
    .describe('Set skill proficiencies — merge: only the listed skills change.'),
  weaponMasteries: z
    .object({
      mode: z
        .enum(['replace', 'add', 'remove'])
        .default('replace')
        .describe(
          'replace (default) overwrites the whole list; add/remove merge with the current list.'
        ),
      values: z
        .array(z.string())
        .default([])
        .describe('Base weapon kinds ("greatsword", "longbow"), not mastery names.'),
    })
    .optional()
    .describe(
      '[PC] 2024 Weapon Mastery kinds (system.traits.weaponProf.mastery); the count is not enforced.'
    ),

  // vitals
  hp: z
    .object({
      value: z.number().int().optional(),
      max: z.number().int().optional(),
      temp: z.number().int().optional(),
      tempmax: z.number().int().optional(),
      formula: z.string().optional(),
    })
    .optional()
    .describe('Hit points (value / max / temp / tempmax / formula).'),
  ac: z
    .object({
      override: z
        .number()
        .int()
        .min(0)
        .nullable()
        .optional()
        .describe('Fixed AC replacing every calculation; null clears it.'),
      natural: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Natural armor value; sets calcs to ["natural"] and clears any override.'),
      calcs: z
        .array(z.string())
        .optional()
        .describe(
          'Calculations the sheet may use (best wins): unarmored, armored, mage, draconic, ' +
            'unarmoredMonk / Barb / Bard, natural.'
        ),
      formulas: z
        .array(
          z.object({
            formula: z.string().min(1),
            label: z.string().optional(),
            armored: z.boolean().nullable().optional(),
            shielded: z.boolean().nullable().optional(),
          })
        )
        .optional()
        .describe(
          'Custom formulas, e.g. {formula:"13 + @abilities.dex.mod", label:"Mage Armor"}; ' +
            'armored / shielded gate them.'
        ),
      calc: z
        .string()
        .optional()
        .describe('DEPRECATED 5.x alias: flat / natural / default / custom, or a calcs key.'),
      flat: z.number().int().optional().describe('DEPRECATED 5.x alias — see calc.'),
      formula: z.string().optional().describe('DEPRECATED 5.x alias — see calc.'),
    })
    .optional()
    .describe(
      'Armor class: override (fixed), natural, or calcs / formulas the sheet computes from.'
    ),
  initiative: z
    .object({
      bonus: z.number().optional(),
      ability: ABILITY.or(z.literal('')).optional(),
    })
    .optional()
    .describe('Initiative bonus and/or ability override.'),

  // movement / senses
  movement: z
    .object({
      walk: z.number().min(0).optional(),
      fly: z.number().min(0).optional(),
      swim: z.number().min(0).optional(),
      climb: z.number().min(0).optional(),
      burrow: z.number().min(0).optional(),
      jump: z.number().min(0).optional(),
      units: z.string().optional(),
      hover: z.boolean().optional(),
    })
    .optional()
    .describe('Movement speeds (units default feet).'),
  senses: z
    .object({
      darkvision: z.number().min(0).optional(),
      blindsight: z.number().min(0).optional(),
      tremorsense: z.number().min(0).optional(),
      truesight: z.number().min(0).optional(),
      units: z.string().optional(),
      special: z.string().optional(),
    })
    .optional()
    .describe('Senses ranges (feet) plus special-sense free text.'),

  // defenses
  damageImmunities: setField('Damage types (acid, bludgeoning, cold, fire, ...).'),
  damageResistances: setField('Damage types (acid, bludgeoning, cold, fire, ...).'),
  damageVulnerabilities: setField('Damage types (acid, bludgeoning, cold, fire, ...).'),
  conditionImmunities: setField('Conditions (poisoned, charmed, frightened, ...).'),
  languages: setField('Languages (common, infernal, draconic, ...).'),
  telepathy: z
    .object({ value: z.number().int().min(0), units: z.string().default('ft') })
    .optional()
    .describe('Telepathy range (0 = none).'),

  // resources (NPC)
  legendaryActions: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('[NPC] Legendary action points per round (resources.legact.max).'),
  legendaryResistances: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('[NPC] Legendary resistance uses per day (resources.legres.max).'),
  lair: z
    .object({ initiative: z.number().int().optional() })
    .optional()
    .describe('[NPC] Lair initiative count (marks the creature as having a lair).'),

  // spellcasting (NPC)
  spellcasting: z
    .object({
      level: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe(
          'Caster level (attributes.spell.level), which derives the slot pools; 0 = no slots ' +
            '(see add-free-cast).'
        ),
      ability: z
        .union([ABILITY, z.literal('')])
        .optional()
        .describe('Casting ability (drives save DC and attack bonus); "" clears. Unset = +0.'),
    })
    .optional()
    .describe(
      '[NPC] Caster level and/or casting ability (a PC derives both; skipped with a warning).'
    ),

  // 2024 fields (NPC)
  habitat: z
    .array(z.object({ type: z.string(), subtype: z.string().optional() }))
    .optional()
    .describe(
      '[NPC, 2024] Habitats, e.g. [{type:"forest"}, {type:"planar", subtype:"nine hells"}]; replaces.'
    ),
  treasure: setField('[NPC, 2024] Treasure themes (any, arcana, individual, ...).', false),

  // currency (coins) — actor-level, applies to NPCs and PCs
  currency: z
    .object({
      mode: z
        .enum(['set', 'add'])
        .default('set')
        .describe(
          'set (default) overwrites each listed coin; add adjusts (negatives spend, floor 0).'
        ),
      pp: z.number().int().optional().describe('Platinum pieces.'),
      gp: z.number().int().optional().describe('Gold pieces.'),
      ep: z.number().int().optional().describe('Electrum pieces.'),
      sp: z.number().int().optional().describe('Silver pieces.'),
      cp: z.number().int().optional().describe('Copper pieces.'),
    })
    .optional()
    .describe('Carried coins (pp/gp/ep/sp/cp). Only the coins you list change.'),
});

export interface DnD5eUpdateActorToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eUpdateActorTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eUpdateActorToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eUpdateActorTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'update-actor',
        description:
          "[D&D 5e] Edit an actor's own sheet: identity + prototype token, details, abilities / " +
          'saves / skills, weapon masteries, HP / AC / initiative, movement, senses, defenses, NPC ' +
          'resources and spellcasting, habitat / treasure, coins. Only the groups passed change; ' +
          '[NPC] fields warn on a PC. Embedded items: update-actor-item / add-feature / ' +
          'manage-activity; placed tokens: manage-placeables.',
        inputSchema: toInputSchema(UpdateActorSchema),
      },
    ];
  }

  async handleUpdateActor(args: any): Promise<any> {
    const parsed = UpdateActorSchema.parse(args ?? {});
    this.logger.info('Updating dnd5e actor', { actorIdentifier: parsed.actorIdentifier });

    await assertDnd5e(this.foundry, this.logger, 'update-actor');
    const result = await this.foundry.call('updateActor', parsed);

    this.logger.info('Actor updated', {
      actorId: result?.actor?.id,
      applied: result?.applied?.length,
      warnings: result?.warnings?.length,
    });
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const applied: string[] = result?.applied ?? [];
    const warnings: string[] = result?.warnings ?? [];
    const summary = `✅ Updated "${result?.actor?.name}" — ${applied.length ? applied.join(', ') : 'no changes'}`;
    const details = [
      `**Actor:** ${result?.actor?.name} (id: \`${result?.actor?.id}\`, type: ${result?.actor?.type})`,
      `**Applied:** ${applied.length ? applied.join(', ') : '(none)'}`,
    ].join('\n');
    const warningSection =
      warnings.length > 0
        ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      actor: result?.actor,
      applied,
      warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }
}
