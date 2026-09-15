import { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import {
  ADVANTAGE_VALUES,
  EFFECT_REPLACEMENTS,
  EXPIRY_EVENTS,
  RULE_KEYS,
  RULE_TYPES,
} from '../../utils/dnd5e-canonical.js';
import { FormattedToolError } from '../../utils/error-handler.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * manage-effect — create / edit / delete / list ActiveEffects on an actor OR an item (embedded on
 * an actor, or a world item). Effects carry `system.changes[]` ({key, value, type}) that modify
 * the target's data (e.g. +1 AC, resist fire) — or, with a dnd5e 6.0 RULES type, modify a roll at
 * roll time (advantage / a bonus / a d20 floor or ceiling on attacks, checks, saves, damage) —
 * plus disabled / transfer / statuses, and 6.0 CONDITIONS (a Filter: the effect, or one change,
 * applies only while the filter holds). Authoring only — it sets effect DATA; it does not run
 * combat (no duration tick-down). The page layer (manageEffect) owns the v14 change shape (string
 * `type`, `phase`), the Filter / rules / expiry validation (effect-changes.ts) + parent resolution.
 */

/**
 * A dnd5e Filter — `{k, v, o?}` (o = a comparison, `exact` when omitted), an operator
 * `{o: AND|OR|NAND|NOR|XOR, v: [filters]}` / `{o: NOT, v: filter}`, a bare array (AND), or the
 * same as a JSON string. The page validates the vocabulary and persists it as the JSON string.
 */
const filter = z
  .union([z.string(), z.record(z.string(), z.any()), z.array(z.record(z.string(), z.any()))])
  .describe(
    'A Filter: {k: "<roll-data path>", v: <value>, o?: "<comparison>"} (exact when o is omitted; ' +
      'comparisons: in has hasany hasall contains icontains startswith endswith empty gt gte lt lte ' +
      'subsetof), an operator {o: "AND"|"OR"|"NAND"|"NOR"|"XOR", v: [filters]} / {o: "NOT", v: filter}, ' +
      'or a bare array (AND). Examples: {k:"statuses.bloodied", v:1} · {k:"item.properties", o:"has", ' +
      'v:"thr"} · {k:"roll.ability", v:"str"} (roll.* keys only on a CHANGE). Also accepts the JSON string.'
  );

const change = z.object({
  key: z
    .string()
    .min(1)
    .describe(
      'Data path to modify, e.g. "system.attributes.ac.bonus" or "system.traits.dr.value" — OR, for a ' +
        `dnd5e.* rules type, a roll CATEGORY: ${RULE_KEYS.join(' | ')} (damage/healing take dnd5e.bonus only).`
    ),
  value: z
    .string()
    .describe(
      'The change value (stored as a string; e.g. "2", "fire"). Rules: dnd5e.bonus = "1d4" / "2" / "@prof" / ' +
        `"1d4[fire]"; dnd5e.advantage = ${ADVANTAGE_VALUES.join(' ')} (+1 add advantage, -1 add ` +
        'disadvantage, =+1/=-1 force, >=0 ignore disadvantage, <=0 ignore advantage); dnd5e.minimum / ' +
        'maximum = a deterministic formula ("10", "@prof") — the d20 floor / ceiling.'
    ),
  type: z
    .enum(['add', 'multiply', 'override', 'upgrade', 'downgrade', 'custom', ...RULE_TYPES])
    .default('add')
    .describe(
      'How the value is applied. Core: add / multiply / override / upgrade / downgrade / custom on a data ' +
        'path. dnd5e 6.0 RULES (evaluated at roll time, key = a roll category): dnd5e.advantage, ' +
        'dnd5e.bonus, dnd5e.minimum, dnd5e.maximum. Default "add".'
    ),
  conditions: filter
    .optional()
    .describe(
      'Per-change Filter — this change applies only while it holds. The only place roll.* keys work ' +
        '(roll.ability, roll.skill, roll.type, roll.attack.type / .mode / .classification, ' +
        'roll.damage.type, roll.proficient, roll.tool …), e.g. {k:"roll.attack.type", v:"ranged"}.'
    ),
  replacement: z
    .enum(EFFECT_REPLACEMENTS)
    .optional()
    .describe(
      'Substitute @attribute strings in the value with static data from the ORIGIN actor (the one ' +
        'applying the effect) or the TARGET actor, instead of evaluating them live. Omit = evaluate live.'
    ),
  priority: z
    .number()
    .optional()
    .describe('Application order (lower first). Omit for the default.'),
});

const ManageEffectSchema = z.object({
  action: z
    .enum(['create', 'edit', 'delete', 'list'])
    .describe('create a new effect, edit/delete one by effectId, or list effects.'),
  actorIdentifier: z
    .string()
    .optional()
    .describe(
      'Actor that owns the effects (or owns the item when itemIdentifier is also set). Also accepts a ' +
        "placed TOKEN id (from list-tokens) — the effect then lands on that token INSTANCE's own delta, " +
        'not the base actor.'
    ),
  itemIdentifier: z
    .string()
    .optional()
    .describe(
      'Item to target: embedded on the actor (with actorIdentifier) or a world item (alone). ' +
        'Omit to target the actor itself.'
    ),
  effectId: z
    .string()
    .optional()
    .describe('Effect id — required for edit/delete. Get it from action "list".'),

  // create/edit
  name: z.string().optional().describe('Effect name. Required (create); optional rename (edit).'),
  changes: z
    .array(change)
    .optional()
    .describe('The effect changes. On edit this REPLACES the whole changes list.'),
  conditions: filter
    .nullable()
    .optional()
    .describe(
      'Effect-level Filter — the WHOLE effect is suppressed while it is false, e.g. ' +
        '{k:"statuses.bloodied", v:1} ("while Bloodied") or, on an enchantment, ' +
        '{o:"OR", v:[{k:"item.type.value", o:"in", v:["simpleR","martialR"]}, {k:"item.properties", ' +
        'o:"has", v:"thr"}]}. roll.* keys are NOT available here (use a change condition). On edit, ' +
        'pass null / {} to clear.'
    ),
  magical: z
    .boolean()
    .optional()
    .describe('dnd5e 6.0: mark the effect as magical (e.g. a magic-item or spell effect).'),
  disabled: z.boolean().optional().describe('Whether the effect is disabled (inactive).'),
  transfer: z
    .boolean()
    .optional()
    .describe(
      'Item effects: whether the effect transfers to the owning actor. Default true for items.'
    ),
  statuses: z
    .array(z.string())
    .optional()
    .describe('Status/condition ids this effect confers (e.g. ["prone"]).'),
  description: z.string().optional().describe('Effect description (HTML).'),
  duration: z
    .object({
      value: z.number().min(0).optional().describe('How long, in `units`.'),
      units: z
        .enum(['seconds', 'minutes', 'hours', 'days', 'rounds', 'turns'])
        .optional()
        .describe('Foundry v14 duration units (rounds/turns count in combat).'),
      expiry: z
        .enum(EXPIRY_EVENTS)
        .nullable()
        .optional()
        .describe(
          'When the effect lapses. Core combat events (combatStart roundStart turnStart combatEnd ' +
            'roundEnd turnEnd) fire once the value+units have ALSO elapsed — give both. dnd5e ' +
            'duration-less events need no value: shortRest / longRest, and the source/target turn ' +
            'pseudo-expiries: "until the end of the target\'s next turn" = targetEnd, "until the start ' +
            'of your next turn" = sourceStart. Omit for the default; null clears.'
        ),
      // 5.x aliases, translated to value + units
      rounds: z
        .number()
        .min(0)
        .optional()
        .describe('DEPRECATED 5.x alias for value + units "rounds".'),
      turns: z
        .number()
        .min(0)
        .optional()
        .describe('DEPRECATED 5.x alias for value + units "turns".'),
      seconds: z
        .number()
        .min(0)
        .optional()
        .describe('DEPRECATED 5.x alias for value + units "seconds".'),
    })
    .optional()
    .describe('Effect duration ({value, units, expiry?}); omit for a permanent/passive effect.'),

  // edit escape hatch
  patch: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Edit: extra dot-paths relative to the effect, e.g. {"duration.value": 10, "duration.units": ' +
        '"rounds"} or {"tint": "#ff0000"}. Changes live at "system.changes".'
    ),
});

export interface DnD5eManageEffectToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eManageEffectTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eManageEffectToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eManageEffectTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-effect',
        description:
          '[D&D 5e] Create / edit / delete / list ActiveEffects on an actor or an item. Effects carry ' +
          '`changes` ({key, value, type}) that modify the target — e.g. +1 AC ' +
          '({key:"system.attributes.ac.bonus", value:"1", type:"add"}) or resist fire — or, with a ' +
          'dnd5e 6.0 RULES type, modify a ROLL: type "dnd5e.advantage" | "dnd5e.bonus" | ' +
          '"dnd5e.minimum" | "dnd5e.maximum" on key "attack" | "check" | "d20" | "save" (damage / ' +
          'healing: bonus only), e.g. +1d4 on History checks = {key:"check", value:"1d4", ' +
          'type:"dnd5e.bonus", conditions:{k:"roll.skill", v:"his"}}, disadvantage on STR d20 tests = ' +
          '{key:"d20", value:"-1", type:"dnd5e.advantage", conditions:{k:"roll.ability", v:"str"}}. ' +
          '6.0 `conditions` (a Filter) gate the whole effect ("while Bloodied") or one change; ' +
          '`duration.expiry` takes the combat / rest / source-target turn events. Target the actor ' +
          '(actorIdentifier), an embedded item (actorIdentifier + itemIdentifier), or a world item ' +
          '(itemIdentifier alone). Use action="list" to find effectIds (it reads conditions + rules back). ' +
          'Item effects transfer to the owning actor by default. Authoring only — it sets effect data, ' +
          'it does not run combat.',
        inputSchema: toInputSchema(ManageEffectSchema),
      },
    ];
  }

  async handleManageEffect(args: any): Promise<any> {
    const parsed = ManageEffectSchema.parse(args ?? {});

    if (!parsed.actorIdentifier && !parsed.itemIdentifier) {
      throw new FormattedToolError('Provide actorIdentifier and/or itemIdentifier.');
    }
    if (parsed.action === 'create' && (!parsed.name || !parsed.changes?.length)) {
      throw new FormattedToolError(
        'action "create" requires `name` and at least one `changes` entry.'
      );
    }
    if ((parsed.action === 'edit' || parsed.action === 'delete') && !parsed.effectId) {
      throw new FormattedToolError(`action "${parsed.action}" requires \`effectId\`.`);
    }

    await assertDnd5e(this.foundry, this.logger, 'manage-effect');

    const fwd: Record<string, any> = { action: parsed.action };
    if (parsed.actorIdentifier) fwd.actorIdentifier = parsed.actorIdentifier;
    if (parsed.itemIdentifier) fwd.itemIdentifier = parsed.itemIdentifier;
    if (parsed.effectId) fwd.effectId = parsed.effectId;
    if (parsed.patch) fwd.patch = parsed.patch;
    fwd.effect = {
      name: parsed.name,
      changes: parsed.changes,
      conditions: parsed.conditions,
      magical: parsed.magical,
      disabled: parsed.disabled,
      transfer: parsed.transfer,
      statuses: parsed.statuses,
      description: parsed.description,
      duration: parsed.duration,
    };
    this.logger.info('manage-effect', { action: parsed.action, effectId: parsed.effectId });
    const result = await this.foundry.call('manageEffect', fwd);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const where = result?.item
      ? result?.actor
        ? `${result.actor.name} → ${result.item.name}`
        : result.item.name
      : result?.actor?.name;
    let summary: string;
    if (result?.effects) {
      const list = result.effects
        .map((e: any) => {
          const rules = (e.changes ?? [])
            .map((c: any) => c.rule)
            .filter((r: unknown) => typeof r === 'string');
          const tags = [
            e.disabled ? 'disabled' : '',
            e.conditions ? 'conditional' : '',
            ...rules,
          ].filter(Boolean);
          return `"${e.name}"${tags.length ? ` (${tags.join('; ')})` : ''} (\`${e.id}\`)`;
        })
        .join(', ');
      summary = `📋 ${where} effects: ${list || '(none)'}`;
    } else if (result?.action === 'create') {
      summary = `✅ Created effect "${result.name}" on "${where}" (id: \`${result.effectId}\`)`;
    } else if (result?.action === 'edit') {
      summary = `✅ Edited effect \`${result.effectId}\` on "${where}" (${(result.editedKeys ?? []).join(', ')})`;
    } else {
      summary = `✅ Deleted effect \`${result?.effectId}\` from "${where}"`;
    }
    return { summary, success: true, ...result, message: summary };
  }
}
