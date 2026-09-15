// Page-side: dnd5e condition (status-effect) authoring. Runs inside the headless Foundry page.
//
// applyCondition toggles dnd5e conditions on/off via the core Actor#toggleStatusEffect API (the
// supported way to add/remove a status effect by id). It is authoring-only: it sets a creature's
// condition state, it does NOT run combat automation (no duration tick-down, no save-ends loop).
//
// dnd5e 6.0.1 / Foundry 14.367 facts (read from the system source, docs/dnd5e-6.0-compat-review.md):
//  - Valid ids are CONFIG.DND5E.conditionTypes keys (the 26 D&D conditions) plus the broader
//    CONFIG.statusEffects ids (cover, concentrating, dead, ...). We validate against their union.
//    ⚠️ dnd5e 6.0 builds CONFIG.statusEffects as a plain OBJECT keyed by id (5.x built an array;
//    core v14's own value is an array-proxy that also answers keyed reads) — read it with
//    Object.values, never .map.
//  - Exhaustion is the one LEVELED condition. Its effect is an ActiveEffect of type "condition"
//    with `system.type: "exhaustion"` and the level in `system.level` (the 5.x
//    `flags.dnd5e.exhaustionLevel` flag is gone), stored under the static id
//    dnd5e.utils.staticID("dnd5eexhaustion"). `system.attributes.exhaustion` is PERSISTED and
//    Actor5e#_onUpdateExhaustion syncs the effect by delta (create / increase / decrease / delete)
//    when it changes — that is the lever. toggleStatusEffect must NOT be used for it: in 6.0 a
//    leveled status routes to ConditionData._applyDelta(+1) regardless of `active`, so a
//    "remove" call would ADD a level.

import { resolveActorFuzzy } from '../_shared.js';

/** dnd5e's static effect id for the exhaustion condition (`staticID("dnd5eexhaustion")`). */
const EXHAUSTION_STATIC_KEY = 'dnd5eexhaustion';

/**
 * The status-effect ids a world advertises: CONFIG.DND5E.conditionTypes keys ∪ CONFIG.statusEffects
 * ids. Pure — tolerates the 6.0 object form, the 5.x array form, and an absent config.
 */
export function collectStatusIds(config: {
  DND5E?: { conditionTypes?: Record<string, unknown> };
  statusEffects?: Record<string, { id?: string }> | Array<{ id?: string }>;
}): Set<string> {
  const ids = new Set<string>(Object.keys(config?.DND5E?.conditionTypes ?? {}));
  for (const s of Object.values(config?.statusEffects ?? {})) {
    if (s && typeof s.id === 'string' && s.id) ids.add(s.id);
  }
  return ids;
}

/** Resolve the requested exhaustion level: explicit 0–6, else 1 when applying / 0 when removing. */
export function resolveExhaustionLevel(requested: number | undefined, active: boolean): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.max(0, Math.min(6, Math.round(requested)));
  }
  return active ? 1 : 0;
}

/** Read a condition effect's level: 6.0 `system.level`, 5.x flag as a fallback, else 1. */
export function readExhaustionLevel(effect: any): number {
  const v = effect?.system?.level ?? effect?.flags?.dnd5e?.exhaustionLevel;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/** Locate the actor's exhaustion effect by dnd5e's static id, falling back to its status. */
function findExhaustionEffect(actor: any): any {
  const staticId = (globalThis as any).dnd5e?.utils?.staticID?.(EXHAUSTION_STATIC_KEY);
  return (
    (staticId ? actor.effects?.get?.(staticId) : undefined) ??
    actor.effects?.find?.((e: any) => e.statuses?.has?.('exhaustion'))
  );
}

const sleep = (ms: number) => new Promise(r => (globalThis as any).setTimeout(r, ms));

/**
 * Set an actor's exhaustion to `lvl` (0 removes). Drives the persisted `system.attributes.exhaustion`
 * field so dnd5e's own delta sync creates/removes the condition effect; an EXISTING effect's level is
 * set directly (deterministic, no dependence on the un-awaited sync).
 */
async function setExhaustion(actor: any, lvl: number, warnings: string[]): Promise<void> {
  const sourceLevel = Number(actor._source?.system?.attributes?.exhaustion ?? 0) || 0;
  let eff = findExhaustionEffect(actor);

  if (lvl <= 0) {
    // Deleting the effect makes dnd5e write attributes.exhaustion = 0 itself; a stale source value
    // with no effect behind it is cleared directly.
    if (eff) await eff.delete();
    else if (sourceLevel !== 0) await actor.update({ 'system.attributes.exhaustion': 0 });
    return;
  }

  if (eff) {
    if (readExhaustionLevel(eff) !== lvl) await eff.update({ 'system.level': lvl });
    // Keep the persisted field in step. dnd5e's delta sync compares against the DERIVED level
    // (already lvl), so this is a pure bookkeeping write with no second effect change.
    if (sourceLevel !== lvl) await actor.update({ 'system.attributes.exhaustion': lvl });
    return;
  }

  // No effect yet: a change to attributes.exhaustion makes dnd5e create it at `lvl`. If the source
  // already says lvl (stale), there would be no diff and no sync — reset first.
  if (sourceLevel === lvl) await actor.update({ 'system.attributes.exhaustion': 0 });
  await actor.update({ 'system.attributes.exhaustion': lvl });
  // Actor5e#_onUpdate fires the effect creation WITHOUT awaiting it — give it a moment to land.
  for (let attempt = 0; attempt < 20 && !eff; attempt++) {
    await sleep(50);
    eff = findExhaustionEffect(actor);
  }
  if (!eff) {
    warnings.push(
      'Exhaustion level was written to the actor, but dnd5e did not create the condition effect ' +
        '(check the sheet).'
    );
  } else if (readExhaustionLevel(eff) !== lvl) {
    await eff.update({ 'system.level': lvl });
  }
}

export async function applyCondition(args: {
  actorIdentifier: string;
  conditions: string[];
  active?: boolean;
  exhaustionLevel?: number;
}): Promise<unknown> {
  const actor = resolveActorFuzzy(args?.actorIdentifier);
  if (!actor) throw new Error(`Actor not found: ${args?.actorIdentifier}`);
  if (typeof actor.toggleStatusEffect !== 'function') {
    throw new Error('This Foundry version does not support Actor#toggleStatusEffect.');
  }
  const conditions = Array.isArray(args.conditions) ? args.conditions : [];
  if (conditions.length === 0) throw new Error('Provide at least one condition.');
  const active = args.active !== false;

  const validIds = collectStatusIds((globalThis as any).CONFIG ?? {});

  const applied: string[] = [];
  const removed: string[] = [];
  const warnings: string[] = [];

  for (const raw of conditions) {
    const id = String(raw).trim().toLowerCase();
    if (!validIds.has(id)) {
      warnings.push(
        `Unknown condition "${raw}" — verify it matches dnd5e conditionTypes / statusEffects`
      );
      continue;
    }
    if (id === 'exhaustion') {
      const lvl = resolveExhaustionLevel(args.exhaustionLevel, active);
      await setExhaustion(actor, lvl, warnings);
      if (lvl > 0) applied.push(`exhaustion ${lvl}`);
      else removed.push('exhaustion');
      continue;
    }
    await actor.toggleStatusEffect(id, { active });
    (active ? applied : removed).push(id);
  }

  return {
    success: true,
    actor: { id: actor.id, name: actor.name, type: actor.type },
    applied,
    removed,
    warnings,
    statuses: Array.from(actor.statuses ?? []),
  };
}
