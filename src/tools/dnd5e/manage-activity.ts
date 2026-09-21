import { z } from 'zod';
import { ACTOR_TARGET, ITEM_TARGET, actorTarget, itemTarget } from '../_targets.js';
import type { FoundryBridge, PageArgs } from '../../foundry.js';
import { Logger } from '../../logger.js';
import {
  ACTIVITY_BEHAVIOR_TYPES,
  ACTIVITY_DURATION_UNITS,
  ACTOR_SIZES,
  AREA_TEMPLATE_TYPES,
  CREATURE_TYPE_KEYS,
  DIFFICULT_TERRAIN_TYPES,
  EXPIRY_EVENTS,
  MOVEMENT_TYPES,
  TARGET_AFFECTS_TYPES,
  TRANSFORM_EFFECT_KEYS,
  TRANSFORM_KEEP_KEYS,
  TRANSFORM_MERGE_KEYS,
  TRANSFORM_MODES,
  TRANSFORM_PRESETS,
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
  action: z.enum(['add', 'edit', 'remove', 'list']).describe('edit / remove take activityId.'),
  itemIdentifier: itemTarget.describe(`${ITEM_TARGET}; on the actor, else a world item.`),
  actorIdentifier: actorTarget.optional().describe(`${ACTOR_TARGET} Omit: a world item.`),
  activityId: z
    .string()
    .optional()
    .describe('Required for edit / remove (from "list" or manage-actors get-entity).'),

  // add — activity definition
  type: z
    .enum(['attack', 'damage', 'save', 'heal', 'check', 'utility', 'cast', 'teleport', 'transform'])
    .optional()
    .describe(
      'Required for add. utility = descriptive (Multiattack); cast links a spell (spellUuid); ' +
        'teleport / transform: own fields.'
    ),
  name: z.string().optional().describe('Activity name (add; edit renames).'),
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
      "Attack: flat to-hit bonus. Cast: pins a fixed spell-attack bonus (else the caster's)."
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
    .describe("Save: the DC. Cast: pins a fixed DC for the linked spell (else the caster's)."),
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
      'Cast (required): compendium uuid of the spell to link ("Compendium.<pack>.Item.<id>"); a ' +
        'non-premium spell is refused.'
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
      "Cast: uses per cast, from the item's own pool (a wand), else a pool this size on the " +
        'activity. Omit = at-will.'
    ),
  recoveryPeriod: z
    .enum(['lr', 'sr', 'day', 'dawn', 'dusk'])
    .optional()
    .describe('Cast: when the activity-side pool recovers (default lr).'),

  // teleport (dnd5e 6.0)
  teleportDistance: z
    .union([z.number().min(0), z.string()])
    .optional()
    .describe(
      'Teleport: max feet (number or formula "@prof * 10"); omit = any. Targets default to self ' +
        '(see affects).'
    ),

  // transform (dnd5e 6.0)
  transformMode: z
    .enum(TRANSFORM_MODES)
    .optional()
    .describe(
      'cr (default): creatures up to a CR; direct: the listed creatures (both via profiles); ' +
        'form: effects on the item (forms).'
    ),
  transformPreset: z
    .enum(TRANSFORM_PRESETS)
    .optional()
    .describe(
      'cr / direct: wildshape (keep mental, merge features), polymorph (full replacement), ' +
        'polymorphSelf (appearance).'
    ),
  formless: z.boolean().optional().describe('form mode: the prompt may revert to no form.'),
  transformSettings: z
    .object({
      keep: z
        .array(z.enum(TRANSFORM_KEEP_KEYS))
        .optional()
        .describe('What the transformed actor keeps of its original self.'),
      merge: z
        .array(z.enum(TRANSFORM_MERGE_KEYS))
        .optional()
        .describe('Proficiencies merged (best of both): saves, skills.'),
      effects: z
        .array(z.enum(TRANSFORM_EFFECT_KEYS))
        .optional()
        .describe("Which of the original's effects carry over."),
      minimumAC: z.string().optional().describe('Deterministic formula floor for the new AC.'),
      tempFormula: z
        .string()
        .optional()
        .describe('Deterministic formula for temp HP on transforming.'),
      transformTokens: z
        .boolean()
        .optional()
        .describe('Also swap the token art/size (default true).'),
      spellLists: z
        .array(z.string())
        .optional()
        .describe('Spell lists the form keeps (e.g. "subclass:moon").'),
    })
    .optional()
    .describe('cr / direct: custom settings over the preset (sets customize); not in form mode.'),
  profiles: z
    .array(
      z.object({
        name: z.string().optional().describe('Display name in the transform prompt.'),
        cr: z
          .union([z.number().min(0), z.string()])
          .optional()
          .describe('cr mode: the maximum challenge rating (e.g. 0.25, 1, or a formula).'),
        actor: z
          .string()
          .optional()
          .describe('direct mode: an exact compendium actor name or an Actor uuid.'),
        sizes: z.array(z.enum(ACTOR_SIZES)).optional().describe('cr mode: allowed sizes.'),
        creatureTypes: z
          .array(z.enum(CREATURE_TYPE_KEYS))
          .optional()
          .describe('cr mode: allowed creature types (e.g. ["beast"]).'),
        restrictMovement: z
          .array(z.enum(MOVEMENT_TYPES))
          .optional()
          .describe('cr mode: creatures with these movement types are excluded.'),
        level: z
          .object({
            min: z.number().int().min(0).optional(),
            max: z.number().int().min(0).optional(),
          })
          .optional()
          .describe('Offered only when the class (else character) level is within [min, max].'),
      })
    )
    .optional()
    .describe(
      'cr / direct: the profiles offered, e.g. {cr: 0.25, creatureTypes: ["beast"], level: ' +
        '{max: 3}}.'
    ),
  forms: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'form mode: names of effects on this item, one per form (manage-effect authors them).'
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
          'inst · spec · a scalar unit (turn … year; give value) · disp / dstr (until dispelled) · perm.'
        ),
      expiry: z
        .enum(EXPIRY_EVENTS)
        .nullable()
        .optional()
        .describe(
          'When applied effects lapse: a combat event (with a scalar duration), a rest, or ' +
            'targetEnd / sourceStart; null clears.'
        ),
      concentration: z.boolean().optional().describe('Requires concentration.'),
    })
    .optional()
    .describe(
      "Duration override (beats the item's); the effects this activity applies inherit it, expiry " +
        'included.'
    ),

  // applied effects (add + edit) — dnd5e 6.0 activity.effects[] (AppliedEffectField)
  appliesEffects: z
    .array(
      z.object({
        ref: z
          .string()
          .min(1)
          .describe(
            'An effect on this item by name, a stock dnd5e.effects name ("Poisoned"), an effect ' +
              'uuid, or "<Item uuid>#<effect>".'
          ),
        onSave: z
          .boolean()
          .optional()
          .describe('Save activities: still applied on a successful save (default false).'),
        level: z
          .object({
            min: z.number().int().min(0).optional(),
            max: z.number().int().min(0).optional(),
          })
          .optional()
          .describe('Only applied when the cast / item level is within [min, max] (upcast tiers).'),
      })
    )
    .optional()
    .describe(
      'Effects applied to the targets; they inherit duration / expiry. Replaces the list on edit; ' +
        'not for transform.'
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
      'Area template (target.override), required for behaviors; e.g. {type: "cube", size: 20}.'
    ),
  affects: z
    .object({
      type: z
        .enum(TARGET_AFFECTS_TYPES)
        .optional()
        .describe('Who is affected (creature is the area default); behaviors honour ally / enemy.'),
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
            'applyActiveEffect applies `effects` inside the area (removed on exit); difficultTerrain ' +
              'while the template stands.'
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
            'applyActiveEffect (required): stock dnd5e.effects names ("Restrained"), ActiveEffect ' +
              'uuids, or "<Item uuid>#<effect>".'
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
          .describe('difficultTerrain: the terrain kinds.'),
      })
    )
    .optional()
    .describe('Area behaviors on the template (needs `template`); replaces the list on edit.'),

  // edit
  patch: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Edit: dot-paths relative to the activity, e.g. {"attack.bonus":"3"}, {"damage.onSave":"half"}.'
    ),
});

/**
 * Tool-side names of the typed mechanics `edit` cannot apply (the page's edit branch only writes
 * name / duration / template / affects / behaviors / effects / patch). Mirrors the page's
 * EDIT_UNSUPPORTED_ACTIVITY_KEYS so the refusal lands before the bridge call.
 */
const EDIT_UNSUPPORTED_ARGS = [
  'activationType',
  'damageParts',
  'attackType',
  'attackBonus',
  'ability',
  'includeBase',
  'saveAbility',
  'saveDC',
  'onSave',
  'healAmount',
  'checkAbility',
  'checkDC',
  'skills',
  'spellUuid',
  'castLevel',
  'charges',
  'recoveryPeriod',
  'teleportDistance',
  'transformMode',
  'transformPreset',
  'formless',
  'profiles',
  'forms',
  'transformSettings',
] as const;

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
          '[D&D 5e] Add / edit / remove / list the activities on an item (embedded on an actor, or ' +
          'a world item). A cast activity links a compendium spell (template, save / attack, ' +
          'effects). `appliesEffects` puts ActiveEffects on the targets; they inherit the activity ' +
          'duration / expiry. edit writes name, duration, template, affects, behaviors, ' +
          'appliesEffects and `patch`; anything else is remove + add.',
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
          'action "add" requires `type` (attack/damage/save/heal/check/utility/cast/teleport/transform).'
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
      if (parsed.type === 'transform') {
        const mode = parsed.transformMode ?? 'cr';
        if (mode === 'form' && !parsed.forms?.length) {
          throw new FormattedToolError(
            'activity type "transform" in form mode requires `forms` (effect names on the item).'
          );
        }
        if (mode !== 'form' && !parsed.profiles?.length) {
          throw new FormattedToolError(
            `activity type "transform" in ${mode} mode requires at least one profiles[] entry.`
          );
        }
        if (mode === 'direct' && parsed.profiles?.some(p => !p.actor)) {
          throw new FormattedToolError('direct-mode transform profiles each need an `actor`.');
        }
        if (mode === 'cr' && parsed.profiles?.some(p => p.cr === undefined)) {
          throw new FormattedToolError('cr-mode transform profiles each need a `cr`.');
        }
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
    if (parsed.action === 'edit') {
      // edit applies name / duration / template / affects / behaviors / appliesEffects / patch — a
      // typed mechanic passed here used to be forwarded, dropped, and reported as a success.
      const offenders = EDIT_UNSUPPORTED_ARGS.filter(
        k => (parsed as any)[k] !== undefined && (parsed as any)[k] !== null
      );
      if (offenders.length > 0) {
        throw new FormattedToolError(
          `action "edit" cannot change ${offenders.join(', ')}. Edit supports name, duration, ` +
            'template, affects, behaviors and appliesEffects; change anything else with `patch` ' +
            '(dot-paths relative to the activity root, e.g. {"attack.bonus":"3"}, ' +
            '{"save.dc.formula":"16"}, {"damage.onSave":"half"}), or remove the activity and add it again.'
        );
      }
    }

    await assertDnd5e(this.foundry, this.logger, 'manage-activity');

    const fwd: PageArgs<'manageActivity'>[0] = {
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
      // dnd5e 6.0 activity.effects[] — the page resolves each ref to an on-item id or a uuid
      appliesEffects: parsed.appliesEffects,
      // teleport / transform (dnd5e 6.0)
      teleportDistance: parsed.teleportDistance,
      transformMode: parsed.transformMode,
      transformPreset: parsed.transformPreset,
      formless: parsed.formless,
      profiles: parsed.profiles,
      forms: parsed.forms,
      transformSettings: parsed.transformSettings,
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
    for (const a of (result?.transformActors ?? []) as any[]) {
      summary += `\n    ✦ form "${a.name}" → ${a.uuid}`;
    }
    for (const w of (result?.warnings ?? []) as string[]) summary += `\n    ⚠ ${w}`;
    return { summary, success: true, ...result, message: summary };
  }
}
