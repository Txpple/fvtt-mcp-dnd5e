// Page-side: ActiveEffect authoring. Runs inside the headless Foundry page.
//
// manageEffect creates / edits / deletes / lists ActiveEffects on an actor OR an item (embedded on
// an actor, or a world item). It authors effect DATA; it does not run combat (no duration tick-down).
//
// Foundry 14.367 / dnd5e 6.0.1 facts (see effect-changes.ts for the field contract):
//  - changes[] lives at effect.system.changes; the top-level effect.changes is only a deprecated
//    shim (until v16). We write and read system.changes.
//  - A change is { key, value, type, phase }: `type` is a STRING (override/add/multiply/upgrade/
//    downgrade/custom, or a 6.0 rules type dnd5e.advantage/bonus/minimum/maximum whose key is a roll
//    category) — the legacy numeric `mode` is still accepted and normalized to `type`. `phase`
//    defaults to "initial". `value` is stored as a string. A change may carry `conditions` (Filter
//    JSON string, roll.* allowed) and `replacement` (origin | target).
//  - system.conditions (effect-level Filter JSON string) suppresses the whole effect while false;
//    system.magical marks a magical effect. On a PREPARED document both `system.conditions` and a
//    change's `conditions` are `Filter` instances — read them from the SOURCE (toObject), never
//    the live document.
//  - duration is { value, units, expiry? }; the 5.x rounds/turns/seconds keys are translated and
//    `expiry` is validated against the core + dnd5e event vocabulary.
//  - `transfer` (item effects) makes the effect apply to the owning actor; default true for items.
//  - An effect created without `type` is dnd5e's "base" type; "condition" effects are the system's
//    own (apply-condition) and "enchantment" effects belong to enchant activities — not authored here.

import { resolveActorFuzzy, resolveActorItem, resolveWorldItem, toSource } from './_shared.js';
import {
  EMPTY_CONDITIONS,
  normalizeChange,
  normalizeConditions,
  normalizeDuration,
  normalizePatch,
  parseConditions,
  projectDuration,
  summarizeChanges,
} from './effect-changes.js';
import { invalid, notFound } from './errors.js';

/** An effect's SOURCE changes off the 6.0 home, tolerating a pre-migration top-level array. */
const changesOf = (e: any): any[] => {
  const src = toSource(e);
  return src?.system?.changes ?? src?.changes ?? [];
};

/** The 6.0 read-back extras of one effect (from its source): type, conditions, magical, riders. */
function effectExtras(e: any): Record<string, unknown> {
  const src = toSource(e);
  const conditions = parseConditions(src?.system?.conditions);
  const riders = src?.system?.rider?.statuses;
  return {
    type: typeof e?.type === 'string' ? e.type : 'base',
    ...(conditions ? { conditions } : {}),
    ...(src?.system?.magical === true ? { magical: true } : {}),
    ...(Array.isArray(riders) && riders.length > 0 ? { riderStatuses: riders } : {}),
  };
}

export async function manageEffect(params: {
  action: 'create' | 'edit' | 'delete' | 'list';
  actorIdentifier?: string;
  itemIdentifier?: string;
  effectId?: string;
  effect?: Record<string, any>;
  patch?: Record<string, any>;
}): Promise<unknown> {
  const { action } = params ?? ({} as any);

  // Resolve the parent document (actor, embedded item, or world item) that owns the effects.
  let parent: any;
  let parentRef: Record<string, any>;
  let kind: 'actor' | 'item';
  if (params.actorIdentifier && params.itemIdentifier) {
    const actor = resolveActorFuzzy(params.actorIdentifier);
    if (!actor) throw notFound(`Actor not found: ${params.actorIdentifier}`);
    const item = resolveActorItem(actor, params.itemIdentifier);
    if (!item) throw notFound(`Item "${params.itemIdentifier}" not found on actor "${actor.name}"`);
    parent = item;
    kind = 'item';
    parentRef = {
      actor: { id: actor.id, name: actor.name },
      item: { id: item.id, name: item.name, type: item.type },
    };
  } else if (params.actorIdentifier) {
    const actor = resolveActorFuzzy(params.actorIdentifier);
    if (!actor) throw notFound(`Actor not found: ${params.actorIdentifier}`);
    parent = actor;
    kind = 'actor';
    parentRef = { actor: { id: actor.id, name: actor.name } };
  } else if (params.itemIdentifier) {
    const item = resolveWorldItem(params.itemIdentifier);
    if (!item) throw notFound(`World Item "${params.itemIdentifier}" not found`);
    parent = item;
    kind = 'item';
    parentRef = { item: { id: item.id, name: item.name, type: item.type } };
  } else {
    throw invalid('Provide actorIdentifier and/or itemIdentifier.');
  }

  const effectsList = Array.from(parent.effects ?? []);
  const base = { success: true, ...parentRef };

  switch (action) {
    case 'list':
      return {
        ...base,
        effects: effectsList.map((e: any) => ({
          id: e.id,
          name: e.name,
          disabled: e.disabled,
          transfer: e.transfer,
          statuses: Array.from(e.statuses ?? []),
          duration: projectDuration(e.duration),
          ...effectExtras(e),
          changes: summarizeChanges(changesOf(e)),
        })),
      };

    case 'create': {
      const eff = params.effect ?? {};
      const conditions = normalizeConditions(eff.conditions, 'effect');
      const data: Record<string, any> = {
        name: eff.name ?? 'Effect',
        img: eff.img ?? 'icons/svg/aura.svg',
        system: {
          changes: Array.isArray(eff.changes) ? eff.changes.map(normalizeChange) : [],
          ...(conditions !== EMPTY_CONDITIONS ? { conditions } : {}),
          ...(typeof eff.magical === 'boolean' ? { magical: eff.magical } : {}),
        },
        disabled: eff.disabled ?? false,
        // Item effects must transfer to apply to the owning actor; actor effects apply directly.
        transfer: eff.transfer ?? kind === 'item',
      };
      if (Array.isArray(eff.statuses)) data.statuses = eff.statuses;
      if (typeof eff.description === 'string') data.description = eff.description;
      const duration = normalizeDuration(eff.duration);
      if (duration) data.duration = duration;
      const [created] = (await parent.createEmbeddedDocuments('ActiveEffect', [data])) as any[];
      if (!created) throw new Error('Failed to create the ActiveEffect.');
      return { ...base, action: 'create', effectId: created.id, name: created.name };
    }

    case 'edit': {
      const id = params.effectId;
      if (!id) throw invalid('effectId is required to edit an effect.');
      const eff = parent.effects?.get?.(id);
      if (!eff) throw notFound(`Effect "${id}" not found on "${parent.name}".`);
      const update: Record<string, any> = { _id: id };
      const e = params.effect ?? {};
      if (typeof e.name === 'string') update.name = e.name;
      if (typeof e.disabled === 'boolean') update.disabled = e.disabled;
      if (typeof e.transfer === 'boolean') update.transfer = e.transfer;
      // replace the whole changes list
      if (Array.isArray(e.changes)) update['system.changes'] = e.changes.map(normalizeChange);
      // an explicit null / {} / "" CLEARS the effect-level conditions (writes the "{}" initial)
      if (e.conditions !== undefined) {
        update['system.conditions'] = normalizeConditions(e.conditions, 'effect');
      }
      if (typeof e.magical === 'boolean') update['system.magical'] = e.magical;
      if (Array.isArray(e.statuses)) update.statuses = e.statuses;
      const duration = normalizeDuration(e.duration);
      if (duration) for (const [k, v] of Object.entries(duration)) update[`duration.${k}`] = v;
      for (const [k, v] of Object.entries(normalizePatch(params.patch ?? {}))) update[k] = v;
      if (Object.keys(update).length === 1) {
        throw invalid('Provide effect fields (name/disabled/changes/...) or a patch to edit.');
      }
      await parent.updateEmbeddedDocuments('ActiveEffect', [update]);
      return {
        ...base,
        action: 'edit',
        effectId: id,
        editedKeys: Object.keys(update).filter(k => k !== '_id'),
      };
    }

    case 'delete': {
      const id = params.effectId;
      if (!id) throw invalid('effectId is required to delete an effect.');
      const eff = parent.effects?.get?.(id);
      if (!eff) throw notFound(`Effect "${id}" not found on "${parent.name}".`);
      await parent.deleteEmbeddedDocuments('ActiveEffect', [id]);
      return { ...base, action: 'delete', effectId: id };
    }

    default:
      throw invalid(`Unknown action "${action}". Use create, edit, delete, or list.`);
  }
}
