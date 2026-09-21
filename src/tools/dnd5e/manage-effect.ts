import { z } from 'zod';
import { ACTOR_TARGET, ITEM_TARGET, actorTarget, itemTarget } from '../_targets.js';
import type { FoundryBridge, PageArgs } from '../../foundry.js';
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
    'Filter: {k, v, o?} (o = a comparison; exact if omitted), {o: "AND"|"OR"|"NOT"…, v: [filters]}, ' +
      'or a bare array (AND).'
  );

const change = z.object({
  key: z
    .string()
    .min(1)
    .describe(`Data path, or (dnd5e.* type) a roll category: ${RULE_KEYS.join(' | ')}.`),
  value: z
    .string()
    .describe(
      `String. dnd5e.bonus "1d4" / "@prof" / "1d4[fire]"; dnd5e.advantage ${ADVANTAGE_VALUES.join(' ')}; ` +
        'minimum / maximum a formula.'
    ),
  type: z
    .enum([
      'add',
      'subtract',
      'multiply',
      'override',
      'upgrade',
      'downgrade',
      'custom',
      ...RULE_TYPES,
    ])
    .default('add')
    .describe(
      'Core types write a data path at data prep; dnd5e.* rules types act on a roll category at ' +
        'roll time.'
    ),
  phase: z
    .enum(['initial', 'final'])
    .optional()
    .describe('Data-preparation phase: initial (default, before derived data) or final.'),
  conditions: filter
    .optional()
    .describe(
      'Per-change Filter; roll.* keys (roll.ability, roll.skill, roll.attack.type, roll.damage.type …) ' +
        'only on a rules type.'
    ),
  replacement: z
    .enum(EFFECT_REPLACEMENTS)
    .optional()
    .describe(
      'Resolve @attribute in the value from the origin or target actor statically, not live.'
    ),
  priority: z.number().optional().describe('Application order (lower first).'),
});

const ManageEffectSchema = z.object({
  action: z.enum(['create', 'edit', 'delete', 'list']).describe('edit / delete take effectId.'),
  actorIdentifier: actorTarget.optional().describe(`${ACTOR_TARGET} Owns the effects / the item.`),
  itemIdentifier: itemTarget
    .optional()
    .describe(`${ITEM_TARGET}; on the actor, else a world item. Omit: the actor itself.`),
  effectId: z.string().optional().describe('Required for edit / delete (from "list").'),

  // create/edit
  name: z.string().optional().describe('Effect name. Required (create); optional rename (edit).'),
  changes: z.array(change).optional().describe('The changes; replaces the list on edit.'),
  conditions: filter
    .nullable()
    .optional()
    .describe(
      'Effect-level Filter; the whole effect is suppressed while false (no roll.* keys). Edit: null ' +
        'clears.'
    ),
  magical: z.boolean().optional().describe('Mark the effect magical.'),
  disabled: z.boolean().optional().describe('Whether the effect is disabled (inactive).'),
  transfer: z
    .boolean()
    .optional()
    .describe('Item effects: transfers to the owning actor (default true).'),
  statuses: z
    .array(z.string())
    .optional()
    .describe('Status/condition ids this effect confers (e.g. ["prone"]).'),
  description: z.string().optional().describe('Effect description (HTML).'),
  duration: z
    .object({
      value: z.number().min(0).optional().describe('How long, in `units`.'),
      units: z
        .enum(['seconds', 'minutes', 'hours', 'days', 'months', 'years', 'rounds', 'turns'])
        .optional()
        .describe('rounds / turns count in combat.'),
      expiry: z
        .enum(EXPIRY_EVENTS)
        .nullable()
        .optional()
        .describe(
          'When it lapses: a combat event (the first one, or after value + units), a rest, or ' +
            'targetEnd / sourceStart; null clears.'
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
    .describe('Omit for a permanent effect.'),

  // edit escape hatch
  patch: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Edit: dot-paths relative to the effect, e.g. {"tint": "#ff0000"}; changes live at system.changes.'
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
          '[D&D 5e] Create / edit / delete / list ActiveEffects on an actor, an embedded item ' +
          '(actorIdentifier + itemIdentifier) or a world item (itemIdentifier alone). `changes` are ' +
          '{key, value, type}: a data path with a core type, or a roll category with a dnd5e 6.0 ' +
          'rules type. `conditions` (a Filter) gate the effect or one change; `duration.expiry` ' +
          'takes combat, rest and turn events. Authoring only.',
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

    const fwd: PageArgs<'manageEffect'>[0] = { action: parsed.action };
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
