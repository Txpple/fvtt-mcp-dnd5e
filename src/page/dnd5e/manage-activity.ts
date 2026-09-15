// Page-side: dnd5e Activity CRUD — runs INSIDE the headless Foundry page. The live orchestrator that
// adds / edits / removes / lists the rollable "activities" on an item, embedded on an actor or world-
// level. The byte-for-byte activity SHAPES live in the pure ./activities.js builder (unit-tested
// offline); this file owns the live document resolution + mutation, so it touches Foundry globals and
// is covered by the verify scripts, not unit tests (the page convention).
//
// Relocated here from actors.ts: activities are a dnd5e concept, so the orchestrator belongs in the
// dnd5e domain next to its builder — not in the system-agnostic actor reads/writes file. It depends
// only on the shared resolution helpers (_shared) + the pure builder (activities) + the shared cast
// plumbing (cast-spells: premium-only spell-link resolver + cached-copy settler); no actors.ts
// coupling, no import cycle.

import {
  resolveActorFuzzy as resolveActor,
  resolveActorItem,
  resolveWorldItem,
  toDeletionKey,
  toSource,
} from '../_shared.js';
import {
  type ActivityBehaviorOpts,
  behaviorId,
  buildActivity,
  buildActivityBehavior,
  normalizeActivityDuration,
  normalizeActivityTarget,
} from './activities.js';
import { resolveCastSpell, settleCachedSpellCopies } from './cast-spells.js';
import { type ResolvedEffect, resolveEffectRefs } from './effect-refs.js';
import { assertNoSrdPacks, isPremiumBookPack } from '../../utils/compendium-sources.js';

/**
 * Resolve a transform profile's `actor` — an Actor uuid (compendium or world; SRD packs refused) or
 * the exact name of a premium Monster Manual creature — to the uuid the profile stores.
 */
async function resolveTransformActor(ref: string): Promise<{ uuid: string; name: string }> {
  const r = String(ref ?? '').trim();
  if (!r) throw new Error('a transform profile `actor` must be a creature name or an Actor uuid.');
  if (/^(Compendium\..+\.Actor|Actor)\.[A-Za-z0-9]{16}$/.test(r)) {
    const doc = await (globalThis as any).fromUuid(r);
    if (doc?.documentName !== 'Actor') throw new Error(`"${r}" does not resolve to an Actor.`);
    if (doc.pack) assertNoSrdPacks(doc.pack, `transform profile "${r}"`);
    return { uuid: doc.uuid, name: doc.name };
  }
  // Every premium Actor pack is a valid source; when a creature is in several (the DMG ships a few
  // of the MM's beasts), the Monster Manual wins — it is the stat-block library (design.md §6).
  const hits: Array<{ uuid: string; name: string; packId: string }> = [];
  for (const pack of game.packs) {
    if (pack.documentName !== 'Actor' || !isPremiumBookPack(pack.metadata.id)) continue;
    const idx = await pack.getIndex();
    const hit = idx.find((e: any) => e.name === r);
    if (hit) {
      hits.push({
        uuid: `Compendium.${pack.metadata.id}.Actor.${hit._id}`,
        name: hit.name,
        packId: pack.metadata.id,
      });
    }
  }
  const best = hits.find(h => h.packId.startsWith('dnd-monster-manual.')) ?? hits[0];
  if (best) return { uuid: best.uuid, name: best.name };
  throw new Error(
    `transform profile actor "${r}" is not a premium-book creature (searched the MM / premium Actor ` +
      'packs by exact name) — pass an Actor uuid, or check the name with search-compendium-creatures.'
  );
}

/** Resolve Select-Form `forms` (effect names on the ITEM) to the item's effect ids. */
function resolveFormEffects(item: any, forms: unknown): string[] {
  if (!Array.isArray(forms) || forms.length === 0) return [];
  const effects: any[] = Array.from(item?.effects ?? []);
  return forms.map(f => {
    const name = String(f ?? '')
      .trim()
      .toLowerCase();
    const hit = effects.find(
      e =>
        String(e.name ?? '')
          .trim()
          .toLowerCase() === name
    );
    if (!hit) {
      throw new Error(
        `form "${f}" is not an effect on "${item.name}" — it carries: ` +
          `${effects.map(e => `"${e.name}"`).join(', ') || '(none)'}. Author each form as an effect on ` +
          'the item with manage-effect first.'
      );
    }
    return hit.id;
  });
}

/**
 * Resolve the `effects` names / refs of each authored behavior into ActiveEffect uuids (the page's
 * job — see effect-refs.ts), returning the builder-ready opts plus what was resolved for the report.
 */
async function resolveBehaviors(
  behaviors: any[] | undefined
): Promise<{ opts: ActivityBehaviorOpts[]; resolved: ResolvedEffect[]; warnings: string[] }> {
  const opts: ActivityBehaviorOpts[] = [];
  const resolved: ResolvedEffect[] = [];
  const warnings: string[] = [];
  for (const b of behaviors ?? []) {
    const { effects, ...rest } = b ?? {};
    const o: ActivityBehaviorOpts = { ...rest };
    if (Array.isArray(effects) && effects.length > 0) {
      const r = await resolveEffectRefs(effects);
      o.effectUuids = r.uuids;
      resolved.push(...r.resolved);
      warnings.push(...r.warnings);
    }
    opts.push(o);
  }
  return { opts, resolved, warnings };
}

/**
 * Add / edit / remove / list dnd5e Activities on an item — embedded on an actor (pass
 * actorIdentifier) OR a world Item (omit it). Activities live in system.activities keyed by id.
 *  - list:   return [{ id, type, name }]
 *  - add:    build the activity via the shared buildActivity(type, opts) and set it under a fresh id
 *  - edit:   apply a dot-path `patch` (relative to the activity root) and/or rename it
 *  - remove: delete the activity by id (via the `-=` form)
 * This is the dnd5e-aware activity authoring keystone (e.g. a Multiattack = a feat with a utility
 * activity). It edits document data; it does not run combat.
 */
export async function manageActivity(params: {
  action: 'add' | 'edit' | 'remove' | 'list';
  itemIdentifier: string;
  actorIdentifier?: string;
  activityId?: string;
  activity?: Record<string, any>;
  patch?: Record<string, any>;
}): Promise<unknown> {
  const { action, itemIdentifier } = params ?? ({} as any);
  if (!itemIdentifier) throw new Error('itemIdentifier is required');

  // Resolve the item (embedded on an actor, or world-level) + the matching write path.
  let item: any;
  let actorDoc: any = null;
  let actorRef: { id: string; name: string } | null = null;
  let applyUpdate: (data: Record<string, any>) => Promise<any>;
  if (params.actorIdentifier) {
    const actor = resolveActor(params.actorIdentifier);
    if (!actor) throw new Error(`Actor not found: ${params.actorIdentifier}`);
    item = resolveActorItem(actor, itemIdentifier);
    if (!item) throw new Error(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
    actorDoc = actor;
    actorRef = { id: actor.id, name: actor.name };
    applyUpdate = data => actor.updateEmbeddedDocuments('Item', [{ _id: item.id, ...data }]);
  } else {
    item = resolveWorldItem(itemIdentifier);
    if (!item) throw new Error(`World Item "${itemIdentifier}" not found`);
    applyUpdate = data => item.update(data);
  }

  const activities: Record<string, any> = toSource(item).system?.activities ?? {};
  const itemRef = { id: item.id, name: item.name, type: item.type };
  const base = { success: true, item: itemRef, ...(actorRef ? { actor: actorRef } : {}) };

  switch (action) {
    case 'list':
      return {
        ...base,
        activities: Object.values(activities).map((a: any) => ({
          id: a._id,
          type: a.type,
          name: a.name ?? '',
          ...(a.target?.template?.type
            ? {
                template: {
                  type: a.target.template.type,
                  size: a.target.template.size,
                  units: a.target.template.units,
                },
              }
            : {}),
          ...(Array.isArray(a.behaviors) && a.behaviors.length > 0
            ? {
                behaviors: a.behaviors.map((b: any) => ({
                  type: b.type,
                  ...(b.name ? { name: b.name } : {}),
                  ...(b.config?.effects?.length ? { effects: b.config.effects } : {}),
                  ...(b.config?.types?.length ? { types: b.config.types } : {}),
                  ...(b.config?.sizes?.length ? { sizes: b.config.sizes } : {}),
                })),
              }
            : {}),
        })),
      };

    case 'add': {
      const type = params.activity?.type;
      if (!type) throw new Error('activity.type is required to add an activity.');
      const id = foundry.utils.randomID(16);
      const { type: _t, ...rest } = params.activity ?? {};
      // A cast activity LINKS a real compendium spell: resolve+validate it (off-book/SRD throws),
      // then fill the facts the pure builder needs (cast level default, V/S/M components, name,
      // the spell's own casting time). With charges on an item that has NO uses pool of its own
      // (e.g. a feature), the pool goes ON the activity — an itemUses target pointing at an empty
      // pool would silently never cast.
      if (type === 'cast') {
        const spell = await resolveCastSpell(rest.spellUuid);
        if (rest.level === undefined || rest.level === null) rest.level = spell.level;
        rest.spellProperties = spell.properties;
        if (!rest.name) rest.name = `Cast ${spell.name}`;
        if (!rest.activationType) rest.activationType = spell.activationType;
        if (rest.charges !== undefined && rest.charges !== null && !rest.usesOn) {
          const parentMax = toSource(item).system?.uses?.max;
          rest.usesOn = typeof parentMax === 'string' && parentMax !== '' ? 'item' : 'activity';
        }
      }
      // Area behaviors name their effects; resolve them to uuids before the pure build.
      const behaviors = await resolveBehaviors(rest.behaviors);
      if (rest.behaviors) rest.behaviors = behaviors.opts;
      // Transform: profile actors (MM name / uuid) → uuids; Select-Form `forms` → the item's effect ids.
      const transformActors: Array<{ name: string; uuid: string }> = [];
      if (type === 'transform') {
        if (Array.isArray(rest.profiles)) {
          rest.profiles = await Promise.all(
            rest.profiles.map(async (p: any) => {
              const { actor, ...profile } = p ?? {};
              if (actor === undefined || actor === null || actor === '') return profile;
              const resolved = await resolveTransformActor(actor);
              transformActors.push(resolved);
              return { ...profile, actorUuid: resolved.uuid, name: profile.name ?? resolved.name };
            })
          );
        }
        if (rest.forms !== undefined) {
          rest.formEffectIds = resolveFormEffects(item, rest.forms);
          rest.forms = undefined;
        }
      }
      const act = buildActivity(type, { id, ...rest });
      await applyUpdate({ [`system.activities.${id}`]: act });
      // Embedded cast: dnd5e async-mints the "Additional Spells" cached copy (and multi-mints
      // under v14) — settle it to exactly one deterministically.
      let cachedSpell: unknown;
      if (type === 'cast' && actorDoc) {
        const liveItem = actorDoc.items?.get?.(item.id) ?? item;
        cachedSpell = await settleCachedSpellCopies(actorDoc, liveItem, id);
      }
      return {
        ...base,
        action: 'add',
        activityId: id,
        type,
        ...(type === 'cast' ? { spell: rest.spellUuid } : {}),
        ...(cachedSpell ? { cachedSpell } : {}),
        ...(behaviors.resolved.length > 0 ? { effects: behaviors.resolved } : {}),
        ...(behaviors.warnings.length > 0 ? { warnings: behaviors.warnings } : {}),
        ...(transformActors.length > 0 ? { transformActors } : {}),
      };
    }

    case 'edit': {
      const id = params.activityId;
      if (!id) throw new Error('activityId is required to edit an activity.');
      if (!activities[id]) throw new Error(`Activity "${id}" not found on item "${item.name}".`);
      const data: Record<string, any> = {};
      if (typeof params.activity?.name === 'string') {
        data[`system.activities.${id}.name`] = params.activity.name;
      }
      // a duration override (6.0: applied effects inherit it, incl. expiry) — validated shape
      const duration = normalizeActivityDuration(params.activity?.duration);
      if (duration) {
        for (const [k, v] of Object.entries(duration))
          data[`system.activities.${id}.duration.${k}`] = v;
        data[`system.activities.${id}.duration.override`] = true;
      }
      // an area template / affects override
      const target = normalizeActivityTarget(params.activity?.template, params.activity?.affects);
      if (target) {
        for (const [group, fields] of Object.entries(target)) {
          for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
            data[`system.activities.${id}.target.${group}.${k}`] = v;
          }
        }
        data[`system.activities.${id}.target.override`] = true;
      }
      // behaviors REPLACE the list (like an effect's changes); effects resolved by name first
      const behaviors = await resolveBehaviors(params.activity?.behaviors);
      if (Array.isArray(params.activity?.behaviors)) {
        const hasTemplate =
          target?.template !== undefined || !!activities[id]?.target?.template?.type;
        if (behaviors.opts.length > 0 && !hasTemplate) {
          throw new Error(
            'behaviors ride on an AREA TEMPLATE — this activity has none; pass `template` ({type, size}) too.'
          );
        }
        data[`system.activities.${id}.behaviors`] = behaviors.opts.map((b, i) =>
          buildActivityBehavior(b, behaviorId(id, i))
        );
      }
      for (const [k, v] of Object.entries(params.patch ?? {})) {
        data[`system.activities.${id}.${k}`] = v;
      }
      if (Object.keys(data).length === 0) {
        throw new Error(
          'Provide a `patch`, a `duration`, a `template`/`affects`, `behaviors`, and/or activity.name to edit.'
        );
      }
      await applyUpdate(data);
      return {
        ...base,
        action: 'edit',
        activityId: id,
        editedKeys: Object.keys(data),
        ...(behaviors.resolved.length > 0 ? { effects: behaviors.resolved } : {}),
        ...(behaviors.warnings.length > 0 ? { warnings: behaviors.warnings } : {}),
      };
    }

    case 'remove': {
      const id = params.activityId;
      if (!id) throw new Error('activityId is required to remove an activity.');
      if (!activities[id]) throw new Error(`Activity "${id}" not found on item "${item.name}".`);
      await applyUpdate({ [toDeletionKey(`system.activities.${id}`)]: null });
      return { ...base, action: 'remove', activityId: id };
    }

    default:
      throw new Error(`Unknown action "${action}". Use add, edit, remove, or list.`);
  }
}
