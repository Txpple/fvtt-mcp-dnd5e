import { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import {
  ACTIVITY_BEHAVIOR_TYPES,
  ACTIVITY_DURATION_UNITS,
  ACTOR_SIZES,
  AREA_TEMPLATE_TYPES,
  CREATURE_TYPE_KEYS,
  DIFFICULT_TERRAIN_TYPES,
  EXPIRY_EVENTS,
  TARGET_AFFECTS_TYPES,
} from '../../utils/dnd5e-canonical.js';
import { FormattedToolError } from '../../utils/error-handler.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * manage-activity — add / edit / remove / list dnd5e Activities (the rollable things on an item:
 * attack, damage, save, heal, check, utility, cast) on an item embedded on an actor OR a world item.
 * This is what authors a Multiattack (a feat with a utility activity), a heal/check activity, or a
 * `cast` activity that LINKS a real compendium spell (a wand/staff that casts Fireball, pulling the
 * spell's measured template + save/attack for free — the page resolves & validates the spellUuid).
 * The page layer (manageActivity) + the shared buildActivity own the activity shapes; this tool is
 * the friendly surface. Authoring only — it edits document data, it does not run combat.
 */

const ABILITY = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const damagePart = z.object({
  number: z.number().int().min(1).describe('Number of dice (e.g. 2).'),
  denomination: z.literal([4, 6, 8, 10, 12, 20, 100]).describe('Die size.'),
  type: z.string().min(1).describe('Damage type (e.g. "fire", "slashing").'),
});

const ManageActivitySchema = z.object({
  action: z
    .enum(['add', 'edit', 'remove', 'list'])
    .describe(
      'add a new activity, edit/remove an existing one (by activityId), or list activities.'
    ),
  itemIdentifier: z
    .string()
    .min(1)
    .describe(
      'Item to operate on (id or name). On an actor when actorIdentifier is set, else a world item.'
    ),
  actorIdentifier: z
    .string()
    .optional()
    .describe(
      'If set, the item is embedded on this actor; omit to target a world (sidebar) item. Also accepts ' +
        "a placed TOKEN id (from list-tokens) — the activity edit then lands on that token INSTANCE's " +
        'own delta, not the base actor.'
    ),
  activityId: z
    .string()
    .optional()
    .describe(
      'Activity id — required for edit/remove. Get it from action "list" or get-actor-entity.'
    ),

  // add — activity definition
  type: z
    .enum(['attack', 'damage', 'save', 'heal', 'check', 'utility', 'cast'])
    .optional()
    .describe(
      'Activity type. Required for add. "utility" = descriptive action (e.g. Multiattack). ' +
        '"cast" = link & cast a real compendium spell (e.g. a wand/staff) — see spellUuid.'
    ),
  name: z
    .string()
    .optional()
    .describe('Activity name (e.g. "Multiattack"). Used by add and edit (rename).'),
  activationType: z
    .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
    .optional()
    .describe('Action economy. Default "action".'),
  damageParts: z
    .array(damagePart)
    .optional()
    .describe('Damage dice — for attack (extra parts), damage, and save activities.'),
  // attack
  attackType: z.enum(['melee', 'ranged']).optional().describe('Attack activity: melee or ranged.'),
  attackBonus: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe(
      'Attack activity: flat to-hit bonus. Cast activity: pins a FIXED spell-attack ' +
        'bonus (else the cast defers the attack to the casting actor).'
    ),
  ability: ABILITY.optional().describe('Attack ability override (attack activity).'),
  includeBase: z
    .boolean()
    .optional()
    .describe('Attack: also roll the item base damage (default true).'),
  // save
  saveAbility: ABILITY.optional().describe('Save activity: the saving-throw ability.'),
  saveDC: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe(
      'Save activity: the DC. Cast activity: pins a FIXED save DC for the linked spell ' +
        '(else the cast defers the DC to the casting actor).'
    ),
  onSave: z
    .enum(['half', 'none'])
    .optional()
    .describe('Save activity: damage on a successful save.'),
  // heal
  healAmount: z
    .object({
      number: z.number().int().min(1),
      denomination: z.literal([4, 6, 8, 10, 12, 20, 100]),
      type: z.enum(['healing', 'temphp']).optional(),
    })
    .optional()
    .describe('Heal activity: healing dice (type "healing" or "temphp").'),
  // check
  checkAbility: ABILITY.optional().describe('Check activity: the ability rolled.'),
  checkDC: z.number().int().min(1).max(30).optional().describe('Check activity: the DC.'),
  skills: z
    .array(z.string())
    .optional()
    .describe('Check activity: associated skill keys (e.g. ["acr","ath"]).'),

  // cast — link a real compendium spell (the activity casts it, pulling its template/save/attack)
  spellUuid: z
    .string()
    .optional()
    .describe(
      'Cast activity (REQUIRED): the Compendium uuid of the spell to LINK, e.g. ' +
        '"Compendium.dnd-players-handbook.spells.Item.phbsplFireball00". The activity CASTS this ' +
        'spell — its measured template (fireball sphere, lightning line…), save/attack, and effects ' +
        'come for free. The spell must be a real premium-book spell (off-book/SRD is refused — if it ' +
        'is not in the books, STOP and ASK; do not hand-roll a fake save/damage activity).'
    ),
  castLevel: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe("Cast activity: level to cast at (0 = cantrip). Defaults to the spell's base level."),
  charges: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Cast activity: uses per cast. On an item with its own uses pool (a wand) this many charges ' +
        'are consumed FROM that pool per cast; on an item WITHOUT one (e.g. a feature) a pool of ' +
        'this size is created ON the activity (recovering per recoveryPeriod), one use per cast. ' +
        'Omit for an at-will cast.'
    ),
  recoveryPeriod: z
    .enum(['lr', 'sr', 'day', 'dawn', 'dusk'])
    .optional()
    .describe(
      'Cast activity with charges on a poolless item: when the activity-side pool recovers. ' +
        'Default "lr" (long rest).'
    ),

  // duration (add + edit) — dnd5e 6.0: the effects an activity applies inherit it, incl. expiry
  duration: z
    .object({
      value: z
        .union([z.number().min(0), z.string()])
        .optional()
        .describe('Amount for a scalar unit — a number or a deterministic formula ("@prof").'),
      units: z
        .enum(ACTIVITY_DURATION_UNITS)
        .optional()
        .describe(
          'Time period: inst (instantaneous) · spec (special) · turn round minute hour day week month ' +
            'year (scalar — give value) · disp / dstr (until dispelled / dispelled or triggered) · perm.'
        ),
      expiry: z
        .enum(EXPIRY_EVENTS)
        .nullable()
        .optional()
        .describe(
          'When the effects this activity applies lapse: core combat events (turnStart / turnEnd / ' +
            'roundEnd …, need a scalar duration too), shortRest / longRest, or the source/target turn ' +
            'pseudo-expiries — "until the end of the target\'s next turn" = targetEnd, "until the start ' +
            'of your next turn" = sourceStart. null clears.'
        ),
      concentration: z.boolean().optional().describe('Requires concentration.'),
    })
    .optional()
    .describe(
      "Duration OVERRIDE for the activity (sets duration.override so it beats the item's). dnd5e 6.0: " +
        'effects the activity applies inherit it, including `expiry` — e.g. {value: 1, units: "minute"} ' +
        'or {expiry: "targetEnd"} for "until the end of the target\'s next turn".'
    ),

  // area (add + edit) — a measured template + who it affects; behaviors ride on the template
  template: z
    .object({
      type: z
        .enum(AREA_TEMPLATE_TYPES)
        .describe('Shape: sphere / cube / cone / line / cylinder / radius (emanation) / wall / …'),
      size: z
        .union([z.number().min(0), z.string()])
        .describe(
          'Primary size in units — radius (sphere/cylinder), length (cone/line), width (cube).'
        ),
      width: z
        .union([z.number().min(0), z.string()])
        .optional()
        .describe('line / wall width.'),
      height: z
        .union([z.number().min(0), z.string()])
        .optional()
        .describe('cylinder / wall height.'),
      units: z.string().optional().describe('Default "ft".'),
      count: z
        .union([z.number().int().min(1), z.string()])
        .optional()
        .describe('Templates placed.'),
    })
    .optional()
    .describe(
      'Area template the activity places (sets target.override). Required for any `behaviors` — ' +
        'e.g. Web = {type: "cube", size: 20}, Spike Growth = {type: "sphere", size: 20}.'
    ),
  affects: z
    .object({
      type: z
        .enum(TARGET_AFFECTS_TYPES)
        .optional()
        .describe(
          'Who the activity affects: creature (default for areas) / ally / enemy / … — ' +
            'applyActiveEffect / difficultTerrain behaviors honour ally / enemy as a disposition filter.'
        ),
      count: z.union([z.number().int().min(1), z.string()]).optional(),
      choice: z.boolean().optional().describe('The user picks which targets inside the area.'),
    })
    .optional()
    .describe('Target affects (with or without a template).'),
  behaviors: z
    .array(
      z.object({
        type: z
          .enum(ACTIVITY_BEHAVIOR_TYPES)
          .describe(
            'applyActiveEffect — the area applies `effects` to tokens inside it (and removes them on ' +
              'exit); difficultTerrain — the area is difficult terrain while the template stands.'
          ),
        name: z.string().optional().describe('Behavior label.'),
        level: z
          .object({
            min: z.number().int().min(0).optional(),
            max: z.number().int().min(0).optional(),
          })
          .optional()
          .describe('Only active when the item / cast level is within [min, max] (upcast tiers).'),
        effects: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'applyActiveEffect (required): effect NAMES from the stock dnd5e.effects pack ("Restrained", ' +
              '"Poisoned", "Prone" …) or a world item\'s effects, ActiveEffect uuids, or an Item uuid + ' +
              '"#<effect name>" (a premium-pack spell\'s effect). Resolved and echoed back.'
          ),
        sizes: z
          .array(z.enum(ACTOR_SIZES))
          .optional()
          .describe('applyActiveEffect: only these sizes.'),
        creatureTypes: z
          .array(z.enum(CREATURE_TYPE_KEYS))
          .optional()
          .describe('applyActiveEffect: only these creature types.'),
        terrainTypes: z
          .array(z.enum(DIFFICULT_TERRAIN_TYPES))
          .optional()
          .describe(
            'difficultTerrain: the terrain kind(s) — web, plants, ice, mud … (some creatures ignore some).'
          ),
      })
    )
    .optional()
    .describe(
      'dnd5e 6.0 area behaviors carried by the template (needs `template`). On edit this REPLACES the ' +
        'list. E.g. an authored Web: type "save", template {type:"cube", size:20}, behaviors ' +
        '[{type:"applyActiveEffect", effects:["Restrained"]}, {type:"difficultTerrain", terrainTypes:["web"]}].'
    ),

  // edit
  patch: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Edit: dot-paths RELATIVE to the activity root, e.g. {"attack.bonus":"3"}, ' +
        '{"save.dc.formula":"16"}, {"damage.onSave":"half"}.'
    ),
});

export interface DnD5eManageActivityToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eManageActivityTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eManageActivityToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eManageActivityTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-activity',
        description:
          '[D&D 5e only] Add / edit / remove / list Activities on an item — the rollable things ' +
          '(attack, damage, save, heal, check, utility, cast). Target an item on an actor (set ' +
          'actorIdentifier) or a world item (omit it). This authors actions like a Multiattack ' +
          '(action="add", type="utility", name="Multiattack"), a heal, an ability-check, a ' +
          'saving-throw activity, OR a spell-casting item (action="add", type="cast", spellUuid=…, ' +
          'charges=…, saveDC/attackBonus=… to pin a fixed challenge) — the cast LINKS a real ' +
          'compendium spell so its measured template + save/attack fire for free. Use action="list" ' +
          '(or get-actor-entity) to find activityIds, then edit/remove by id; edit takes a `patch` of ' +
          'dot-paths relative to the activity. Authoring only — it does not run combat.',
        inputSchema: toInputSchema(ManageActivitySchema),
      },
    ];
  }

  async handleManageActivity(args: any): Promise<any> {
    const parsed = ManageActivitySchema.parse(args ?? {});

    // Cross-field guards: throw FormattedToolError so the message surfaces verbatim (the central
    // error mapper would otherwise flatten a plain Error to a generic "unexpected error").
    if (parsed.behaviors?.length && !parsed.template && parsed.action === 'add') {
      throw new FormattedToolError(
        'behaviors ride on an area template — pass `template` ({type, size}) with them.'
      );
    }
    if (parsed.action === 'add') {
      if (!parsed.type) {
        throw new FormattedToolError(
          'action "add" requires `type` (attack/damage/save/heal/check/utility).'
        );
      }
      // Per-type required mechanics — without these the built activity would be malformed
      // (e.g. a save with no ability writes save.ability:[undefined]) or empty/useless.
      if (parsed.type === 'save' && (!parsed.saveAbility || parsed.saveDC === undefined)) {
        throw new FormattedToolError('activity type "save" requires saveAbility and saveDC.');
      }
      if (parsed.type === 'heal' && !parsed.healAmount) {
        throw new FormattedToolError('activity type "heal" requires healAmount.');
      }
      if (parsed.type === 'damage' && !parsed.damageParts?.length) {
        throw new FormattedToolError(
          'activity type "damage" requires at least one damageParts entry.'
        );
      }
      if (parsed.type === 'cast') {
        if (!parsed.spellUuid) {
          throw new FormattedToolError(
            'activity type "cast" requires `spellUuid` — the Compendium uuid of the spell to link ' +
              '(e.g. "Compendium.dnd-players-handbook.spells.Item.phbsplFireball00").'
          );
        }
        if (parsed.saveDC !== undefined && parsed.attackBonus !== undefined) {
          throw new FormattedToolError(
            'activity type "cast": provide saveDC OR attackBonus (a spell uses one challenge), not both.'
          );
        }
      }
    }
    if ((parsed.action === 'edit' || parsed.action === 'remove') && !parsed.activityId) {
      throw new FormattedToolError(`action "${parsed.action}" requires \`activityId\`.`);
    }

    await assertDnd5e(this.foundry, this.logger, 'manage-activity');

    const fwd: Record<string, any> = {
      action: parsed.action,
      itemIdentifier: parsed.itemIdentifier,
    };
    if (parsed.actorIdentifier) fwd.actorIdentifier = parsed.actorIdentifier;
    if (parsed.activityId) fwd.activityId = parsed.activityId;
    if (parsed.patch) fwd.patch = parsed.patch;
    // The page builder reads `activity.{type,name,...}` (and maps healAmount -> healing here).
    fwd.activity = {
      type: parsed.type,
      name: parsed.name,
      activationType: parsed.activationType,
      damageParts: parsed.damageParts,
      attackType: parsed.attackType,
      attackBonus: parsed.attackBonus,
      ability: parsed.ability,
      includeBase: parsed.includeBase,
      saveAbility: parsed.saveAbility,
      saveDC: parsed.saveDC,
      onSave: parsed.onSave,
      healing: parsed.healAmount,
      checkAbility: parsed.checkAbility,
      checkDC: parsed.checkDC,
      skills: parsed.skills,
      // cast — the page resolves spellUuid -> level default + V/S/M components + name +
      // activation, and decides item-pool vs activity-pool consumption from the parent's uses.
      spellUuid: parsed.spellUuid,
      level: parsed.castLevel,
      charges: parsed.charges,
      recoveryPeriod: parsed.recoveryPeriod,
      duration: parsed.duration,
      template: parsed.template,
      affects: parsed.affects,
      behaviors: parsed.behaviors,
    };

    this.logger.info('manage-activity', {
      action: parsed.action,
      itemIdentifier: parsed.itemIdentifier,
      type: parsed.type,
    });
    const result = await this.foundry.call('manageActivity', fwd);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const where = result?.actor
      ? `${result.actor.name} → ${result.item?.name}`
      : result?.item?.name;
    let summary: string;
    if (result?.activities) {
      const list = result.activities
        .map((a: any) => `${a.type}${a.name ? ` "${a.name}"` : ''} (\`${a.id}\`)`)
        .join(', ');
      summary = `📋 ${where} activities: ${list || '(none)'}`;
    } else if (result?.action === 'add') {
      const spellNote = result.spell ? ` linking spell \`${result.spell}\`` : '';
      summary = `✅ Added ${result.type} activity${spellNote} to "${where}" (id: \`${result.activityId}\`)`;
    } else if (result?.action === 'edit') {
      summary = `✅ Edited activity \`${result.activityId}\` on "${where}" (${(result.editedKeys ?? []).join(', ')})`;
    } else {
      summary = `✅ Removed activity \`${result?.activityId}\` from "${where}"`;
    }
    for (const e of (result?.effects ?? []) as any[]) {
      summary += `\n    ✦ effect "${e.name}" (${e.source}) → ${e.uuid}`;
    }
    for (const w of (result?.warnings ?? []) as string[]) summary += `\n    ⚠ ${w}`;
    return { summary, success: true, ...result, message: summary };
  }
}
