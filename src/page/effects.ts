// Page-side: ActiveEffect authoring. Runs inside the headless Foundry page.
//
// manageEffect creates / edits / deletes / lists ActiveEffects on an actor OR an item (embedded on
// an actor, or a world item). It authors effect DATA; it does not run combat (no duration tick-down).
//
// Foundry 14.367 / dnd5e 6.0.1 facts (see effect-changes.ts for the field contract):
//  - changes[] lives at effect.system.changes; the top-level effect.changes is only a deprecated
//    shim (until v16). We write and read system.changes.
//  - A change is { key, value, type, phase }: `type` is a STRING (override/add/multiply/upgrade/
//    downgrade/custom) — the legacy numeric `mode` is still accepted and normalized to `type`.
//    `phase` defaults to "initial". `value` is stored as a string.
//  - duration is { value, units, expiry? }; the 5.x rounds/turns/seconds keys are translated.
//  - `transfer` (item effects) makes the effect apply to the owning actor; default true for items.
//  - An effect created without `type` is dnd5e's "base" type (system.conditions / magical / rider
//    default empty); "condition" effects are the system's own (apply-condition), not authored here.

import { resolveActorFuzzy, resolveActorItem, resolveWorldItem } from './_shared.js';
import {
  normalizeChange,
  normalizeDuration,
  normalizePatch,
  summarizeChanges,
} from './effect-changes.js';

/** An effect's changes off the 6.0 home, tolerating a pre-migration top-level array. */
const changesOf = (e: any): any[] => e?.system?.changes ?? e?.changes ?? [];

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
    if (!actor) throw new Error(`Actor not found: ${params.actorIdentifier}`);
    const item = resolveActorItem(actor, params.itemIdentifier);
    if (!item)
      throw new Error(`Item "${params.itemIdentifier}" not found on actor "${actor.name}"`);
    parent = item;
    kind = 'item';
    parentRef = {
      actor: { id: actor.id, name: actor.name },
      item: { id: item.id, name: item.name, type: item.type },
    };
  } else if (params.actorIdentifier) {
    const actor = resolveActorFuzzy(params.actorIdentifier);
    if (!actor) throw new Error(`Actor not found: ${params.actorIdentifier}`);
    parent = actor;
    kind = 'actor';
    parentRef = { actor: { id: actor.id, name: actor.name } };
  } else if (params.itemIdentifier) {
    const item = resolveWorldItem(params.itemIdentifier);
    if (!item) throw new Error(`World Item "${params.itemIdentifier}" not found`);
    parent = item;
    kind = 'item';
    parentRef = { item: { id: item.id, name: item.name, type: item.type } };
  } else {
    throw new Error('Provide actorIdentifier and/or itemIdentifier.');
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
          duration:
            typeof e.duration?.value === 'number'
              ? { value: e.duration.value, units: e.duration.units ?? 'seconds' }
              : null,
          changes: summarizeChanges(changesOf(e)),
        })),
      };

    case 'create': {
      const eff = params.effect ?? {};
      const data: Record<string, any> = {
        name: eff.name ?? 'Effect',
        img: eff.img ?? 'icons/svg/aura.svg',
        system: { changes: Array.isArray(eff.changes) ? eff.changes.map(normalizeChange) : [] },
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
      if (!id) throw new Error('effectId is required to edit an effect.');
      const eff = parent.effects?.get?.(id);
      if (!eff) throw new Error(`Effect "${id}" not found on "${parent.name}".`);
      const update: Record<string, any> = { _id: id };
      const e = params.effect ?? {};
      if (typeof e.name === 'string') update.name = e.name;
      if (typeof e.disabled === 'boolean') update.disabled = e.disabled;
      if (typeof e.transfer === 'boolean') update.transfer = e.transfer;
      // replace the whole changes list
      if (Array.isArray(e.changes)) update['system.changes'] = e.changes.map(normalizeChange);
      if (Array.isArray(e.statuses)) update.statuses = e.statuses;
      const duration = normalizeDuration(e.duration);
      if (duration) for (const [k, v] of Object.entries(duration)) update[`duration.${k}`] = v;
      for (const [k, v] of Object.entries(normalizePatch(params.patch ?? {}))) update[k] = v;
      if (Object.keys(update).length === 1) {
        throw new Error('Provide effect fields (name/disabled/changes/...) or a patch to edit.');
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
      if (!id) throw new Error('effectId is required to delete an effect.');
      const eff = parent.effects?.get?.(id);
      if (!eff) throw new Error(`Effect "${id}" not found on "${parent.name}".`);
      await parent.deleteEmbeddedDocuments('ActiveEffect', [id]);
      return { ...base, action: 'delete', effectId: id };
    }

    default:
      throw new Error(`Unknown action "${action}". Use create, edit, delete, or list.`);
  }
}
