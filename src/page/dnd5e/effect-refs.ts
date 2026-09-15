// Page-side: resolve the EFFECT references a behavior points at — the `effects` of a
// `dnd5e.applyActiveEffect` region behavior or an activity `applyActiveEffect` behavior (dnd5e 6.0).
// Both persist a Set of ActiveEffect UUIDs; the behavior creates a fresh COPY of each on entry and
// deletes the copies on exit (apply-active-effect.mjs #getEffectsToCreate: `_stats.compendiumSource`
// for a compendium effect, `duplicateSource` for a world one). So a reference must resolve to an
// effect that lives in a COMPENDIUM or on a WORLD ITEM — never to an effect on an actor (the entering
// actor's own copy would be duplicated on entry, then deleted on exit).
//
// Accepted references (parseEffectRef is pure — unit-tested; the lookup is live):
//   "Poisoned"                                  a NAME: the stock `dnd5e.effects` pack first (the
//                                               design.md §2.3 amendment — mechanics, not content),
//                                               then any world item's effect of that name
//   "Compendium.dnd5e.effects.ActiveEffect.<id>" an ActiveEffect uuid (compendium or world item)
//   "Compendium.dnd-players-handbook.spells.Item.<id>#Web"   an ITEM uuid + "#<effect name>" — the
//                                               effect carried by a premium-pack spell / item (or a
//                                               world item); the "#" part may be omitted when the item
//                                               carries exactly one effect
//   "Flame Tongue#Fiery"                        a world ITEM by name + its effect by name
// SRD content packs are refused by the library policy (compendium-sources.ts); `dnd5e.effects` is
// the one permitted `dnd5e.*` pack.

import { assertNoSrdPacks, EFFECTS_PACK } from '../../utils/compendium-sources.js';

export type EffectRef =
  | { kind: 'effect-uuid'; uuid: string }
  | { kind: 'item-uuid'; uuid: string; effectName?: string }
  | { kind: 'name'; name: string; effectName?: string };

const EFFECT_UUID_RE = /\.ActiveEffect\.[A-Za-z0-9]{16}$/;
const ITEM_UUID_RE = /^(Compendium\..+\.Item|Item)\.[A-Za-z0-9]{16}$/;

/** Classify one authored effect reference (see the module header). Pure. */
export function parseEffectRef(raw: unknown): EffectRef {
  const ref = String(raw ?? '').trim();
  if (!ref) throw new Error('an effect reference must be a name or a uuid (got an empty string).');
  const hash = ref.indexOf('#');
  const head = hash >= 0 ? ref.slice(0, hash).trim() : ref;
  const effectName = hash >= 0 ? ref.slice(hash + 1).trim() : '';
  if (EFFECT_UUID_RE.test(head)) return { kind: 'effect-uuid', uuid: head };
  if (ITEM_UUID_RE.test(head)) {
    return { kind: 'item-uuid', uuid: head, ...(effectName ? { effectName } : {}) };
  }
  if (!head) throw new Error(`effect reference "${ref}" has no name before the "#".`);
  return { kind: 'name', name: head, ...(effectName ? { effectName } : {}) };
}

export interface ResolvedEffect {
  ref: string;
  uuid: string;
  name: string;
  /** Where it lives: the stock pack, another compendium, or a world item. */
  source: 'dnd5e.effects' | 'compendium' | 'world-item';
}

const sameName = (a: unknown, b: string) =>
  typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The parent chain contains an Actor (an embedded-on-actor effect / item). */
function isOnActor(doc: any): boolean {
  let p = doc?.parent;
  while (p) {
    if (p.documentName === 'Actor') return true;
    p = p.parent;
  }
  return false;
}

function packIdOf(doc: any): string | undefined {
  const pack = doc?.pack ?? doc?.compendium?.metadata?.id ?? doc?.parent?.pack;
  return typeof pack === 'string' ? pack : undefined;
}

function acceptEffect(effect: any, ref: string): ResolvedEffect {
  if (isOnActor(effect)) {
    throw new Error(
      `effect "${ref}" lives on an actor — a behavior needs an effect in a compendium or on a WORLD ` +
        'item (it copies the effect onto each token that enters and deletes the copy on exit).'
    );
  }
  const pack = packIdOf(effect);
  if (pack) assertNoSrdPacks(pack, `effect "${ref}"`);
  return {
    ref,
    uuid: effect.uuid,
    name: effect.name,
    source: pack === EFFECTS_PACK ? 'dnd5e.effects' : pack ? 'compendium' : 'world-item',
  };
}

function pickItemEffect(item: any, effectName: string | undefined, ref: string): any {
  const effects: any[] = Array.from(item?.effects ?? []);
  if (effects.length === 0) throw new Error(`item "${item?.name ?? ref}" carries no effects.`);
  if (effectName) {
    const hit = effects.find(e => sameName(e.name, effectName));
    if (!hit) {
      throw new Error(
        `item "${item.name}" has no effect named "${effectName}" — it carries: ` +
          `${effects.map(e => `"${e.name}"`).join(', ')}.`
      );
    }
    return hit;
  }
  if (effects.length > 1) {
    throw new Error(
      `item "${item.name}" carries ${effects.length} effects — name one with "#": ` +
        `${effects.map(e => `"${e.name}"`).join(', ')}.`
    );
  }
  return effects[0];
}

let effectsIndex: Promise<any[]> | null = null;
/** The stock effects pack index (name + _id), fetched once per page session. */
function stockEffectsIndex(): Promise<any[]> {
  if (!effectsIndex) {
    effectsIndex = (async () => {
      const pack = (globalThis as any).game?.packs?.get?.(EFFECTS_PACK);
      if (!pack) return [];
      const idx = await pack.getIndex();
      return Array.from(idx ?? []);
    })();
  }
  return effectsIndex;
}

/**
 * Resolve every reference to an ActiveEffect uuid a behavior can carry. Throws on the first
 * reference that cannot be resolved (with what it tried), so a behavior is never written with a
 * silently-dropped effect. Duplicate-name hits (the stock pack ships two "Silenced") take the
 * first and add a warning naming the alternatives.
 */
export async function resolveEffectRefs(
  refs: readonly unknown[]
): Promise<{ uuids: string[]; resolved: ResolvedEffect[]; warnings: string[] }> {
  const resolved: ResolvedEffect[] = [];
  const warnings: string[] = [];
  const fromUuid = (globalThis as any).fromUuid as (u: string) => Promise<any>;
  for (const raw of refs) {
    const ref = String(raw ?? '').trim();
    const parsed = parseEffectRef(ref);
    if (parsed.kind === 'effect-uuid') {
      const doc = await fromUuid(parsed.uuid);
      if (doc?.documentName !== 'ActiveEffect') {
        throw new Error(`"${ref}" does not resolve to an ActiveEffect.`);
      }
      resolved.push(acceptEffect(doc, ref));
      continue;
    }
    if (parsed.kind === 'item-uuid') {
      const item = await fromUuid(parsed.uuid);
      if (item?.documentName !== 'Item') {
        throw new Error(`"${parsed.uuid}" does not resolve to an Item.`);
      }
      if (isOnActor(item)) {
        throw new Error(
          `"${parsed.uuid}" is an item on an actor — reference the compendium or world item instead.`
        );
      }
      const pack = packIdOf(item);
      if (pack) assertNoSrdPacks(pack, `item "${ref}"`);
      resolved.push(acceptEffect(pickItemEffect(item, parsed.effectName, ref), ref));
      continue;
    }
    // a NAME — a world item by name + "#effect", else the stock pack, else any world item's effect
    if (parsed.effectName) {
      const item = (globalThis as any).game?.items?.find?.((i: any) =>
        sameName(i.name, parsed.name)
      );
      if (!item) throw new Error(`no world item named "${parsed.name}" (for "${ref}").`);
      resolved.push(acceptEffect(pickItemEffect(item, parsed.effectName, ref), ref));
      continue;
    }
    const stock = (await stockEffectsIndex()).filter(e => sameName(e.name, parsed.name));
    if (stock.length > 0) {
      const uuid = `Compendium.${EFFECTS_PACK}.ActiveEffect.${stock[0]._id}`;
      if (stock.length > 1) {
        warnings.push(
          `"${parsed.name}" matches ${stock.length} stock effects — using ${uuid}; the others: ` +
            stock
              .slice(1)
              .map(e => `Compendium.${EFFECTS_PACK}.ActiveEffect.${e._id}`)
              .join(', ')
        );
      }
      resolved.push({ ref, uuid, name: stock[0].name, source: 'dnd5e.effects' });
      continue;
    }
    const worldHits: any[] = [];
    for (const item of (globalThis as any).game?.items ?? []) {
      for (const e of item.effects ?? []) if (sameName(e.name, parsed.name)) worldHits.push(e);
    }
    if (worldHits.length > 0) {
      if (worldHits.length > 1) {
        warnings.push(
          `"${parsed.name}" matches ${worldHits.length} world-item effects — using ${worldHits[0].uuid} ` +
            `(on "${worldHits[0].parent?.name}"); the others: ${worldHits
              .slice(1)
              .map(e => `${e.uuid} (on "${e.parent?.name}")`)
              .join(', ')}`
        );
      }
      resolved.push(acceptEffect(worldHits[0], ref));
      continue;
    }
    throw new Error(
      `effect "${parsed.name}" not found in the stock ${EFFECTS_PACK} pack or on any world item. ` +
        'Pass an ActiveEffect uuid, an Item uuid + "#<effect name>" (a premium-pack spell/item), or ' +
        'author the effect on a world item with manage-effect first.'
    );
  }
  return { uuids: resolved.map(r => r.uuid), resolved, warnings };
}
