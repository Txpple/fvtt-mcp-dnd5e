// Page-side: actor / character READS. Runs INSIDE the headless Foundry page. Pure against the
// game.* collections: the list, the compact sheet, the full export, one entity, the item search,
// the fuzzy find. (F45: the reads third of the old src/page/actors.ts.)

import {
  resolveActorFuzzy as resolveActor,
  toSource,
  unmaskedName,
  sanitizeDocData as sanitize,
} from '../_shared.js';
import { describeRule, parseConditions, projectDuration } from '../effect-changes.js';
import { invalid, notFound as notFoundError } from '../errors.js';

// ---------------------------------------------------------------------------
// Local helpers (kept in-file; cross-domain candidates listed in the handoff).
// ---------------------------------------------------------------------------

// dnd5e spell targeting / slot extraction --------------------------------------

/** The spell's range / target / area as the compact sheet prints them (pure; exported for its test). */
export function extractDnd5eSpellTargeting(spellSystem: any): {
  range?: string | undefined;
  target?: string | undefined;
  area?: string | undefined;
} {
  const result: {
    range?: string | undefined;
    target?: string | undefined;
    area?: string | undefined;
  } = {};

  const rangeValue = spellSystem?.range?.value;
  const rangeUnits = spellSystem?.range?.units;
  if (rangeUnits === 'self') {
    result.range = 'Self';
  } else if (rangeUnits === 'touch') {
    result.range = 'Touch';
  } else if (rangeUnits === 'spec') {
    result.range = spellSystem?.range?.special || 'Special';
  } else if (rangeValue && rangeUnits) {
    result.range = `${rangeValue} ${rangeUnits}`;
  }

  const targetType = spellSystem?.target?.type;
  const targetValue = spellSystem?.target?.value;
  if (targetType === 'self') {
    result.target = 'self';
  } else if (targetType === 'creature' || targetType === 'ally' || targetType === 'enemy') {
    result.target = targetValue
      ? `${targetValue} ${targetType}${targetValue > 1 ? 's' : ''}`
      : targetType;
  } else if (targetType === 'object') {
    result.target = targetValue ? `${targetValue} object${targetValue > 1 ? 's' : ''}` : 'object';
  } else if (targetType === 'space' || targetType === 'point') {
    result.target = 'point';
  } else if (targetType) {
    result.target = targetType;
  }

  const areaType = spellSystem?.target?.template?.type;
  const areaSize = spellSystem?.target?.template?.size;
  const areaUnits = spellSystem?.target?.template?.units || 'ft';
  if (areaType && areaSize) {
    result.area = `${areaSize}-${areaUnits} ${areaType}`;
    if (!result.target || result.target === 'point') {
      result.target = 'area';
    }
  }

  return result;
}

// NOTE: this READ surface keys slots `level1..level9` (+ `pact`), whereas the WRITE side
// (dnd5e/spells.ts setActorSpellcasting) reports them as `spell1..spell9` (+ `pact`). The two
// are intentionally different output contracts, each matching its own consumer/oracle — don't
// "unify" one to the other without updating that consumer.
/** Slot pools keyed level1..level9 (+ pact), only the non-empty ones (pure; exported for its test). */
export function extractDnd5eSpellSlots(
  spellsData: any
): Record<string, { value: number; max: number }> | undefined {
  const slots: Record<string, { value: number; max: number }> = {};

  for (let level = 1; level <= 9; level++) {
    const slotData = spellsData?.[`spell${level}`];
    if (slotData && (slotData.max > 0 || slotData.value > 0)) {
      slots[`level${level}`] = {
        value: slotData.value ?? 0,
        max: slotData.max ?? 0,
      };
    }
  }

  const pactSlot = spellsData?.pact;
  if (pactSlot && (pactSlot.max > 0 || pactSlot.value > 0)) {
    slots.pact = {
      value: pactSlot.value ?? 0,
      max: pactSlot.max ?? 0,
    };
  }

  return Object.keys(slots).length > 0 ? slots : undefined;
}

interface SpellInfo {
  id: string;
  name: string;
  level: number;
  prepared?: boolean | undefined;
  /** dnd5e 5.x casting method: atwill / innate / ritual / pact / spell. */
  method?: string | undefined;
  traits?: string[] | undefined;
  actionCost?: string | undefined;
  range?: string | undefined;
  target?: string | undefined;
  area?: string | undefined;
}

/**
 * Coerce a dnd5e 5.x spell `system.prepared` (0/1/2) — or legacy boolean — to a boolean.
 * Absent → true (the historical default: a spell with no preparation flag reads as prepared).
 */
function coerceSpellPrepared(v: any): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'number') return v > 0;
  return !!v;
}

interface SpellcastingEntry {
  id: string;
  name: string;
  type: string;
  ability?: string | undefined;
  slots?: Record<string, { value: number; max: number }> | undefined;
  spells: SpellInfo[];
}

/**
 * Build dnd5e spellcasting entries grouped by spellcasting class (with a general
 * fallback when no class-based entry can be derived but spells exist).
 */
function extractSpellcastingData(actor: any): SpellcastingEntry[] {
  const entries: SpellcastingEntry[] = [];
  const systemId = game.system?.id;
  if (systemId !== 'dnd5e') return entries;

  const spellItems = actor.items.filter((item: any) => item.type === 'spell');
  const classes = actor.items.filter((item: any) => item.type === 'class');
  const spellSlots = actor.system?.spells || {};

  const spellsByClass: Record<string, SpellInfo[]> = {};

  for (const spell of spellItems) {
    const spellSystem = spell.system;
    const spellRaw = spell._source?.system || spellSystem;
    const sourceItem = spellSystem?.sourceItem;
    const sourceClass =
      (sourceItem
        ? typeof sourceItem === 'string'
          ? sourceItem
          : sourceItem.identifier || sourceItem.id
        : spellRaw?.sourceClass) || 'general';

    if (!spellsByClass[sourceClass]) {
      spellsByClass[sourceClass] = [];
    }

    const targeting = extractDnd5eSpellTargeting(spellSystem);
    spellsByClass[sourceClass].push({
      id: spell.id || '',
      name: spell.name || '',
      level: spellSystem?.level || 0,
      prepared: coerceSpellPrepared(spellSystem?.prepared),
      method: spellSystem?.method,
      traits: [],
      actionCost: spellSystem?.activation?.type || undefined,
      range: targeting.range,
      target: targeting.target,
      area: targeting.area,
    });
  }

  for (const classItem of classes) {
    const classSystem = classItem.system;
    if (classSystem?.spellcasting?.progression && classSystem.spellcasting.progression !== 'none') {
      const className = classItem.name || 'Unknown';
      const classSpells =
        spellsByClass[classItem.id || ''] || spellsByClass[className.toLowerCase()] || [];

      entries.push({
        id: classItem.id || '',
        name: `${className} Spellcasting`,
        type: classSystem?.spellcasting?.type || 'prepared',
        ability: classSystem?.spellcasting?.ability || undefined,
        slots: extractDnd5eSpellSlots(spellSlots),
        spells: classSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      });
    }
  }

  if (entries.length === 0 && spellItems.length > 0) {
    const allSpells: SpellInfo[] = [];
    for (const spell of spellItems) {
      const spellSystem = spell.system;
      const targeting = extractDnd5eSpellTargeting(spellSystem);
      allSpells.push({
        id: spell.id || '',
        name: spell.name || '',
        level: spellSystem?.level || 0,
        prepared: coerceSpellPrepared(spellSystem?.prepared),
        method: spellSystem?.method,
        actionCost: spellSystem?.activation?.type || undefined,
        range: targeting.range,
        target: targeting.target,
        area: targeting.area,
      });
    }

    entries.push({
      id: 'spellcasting',
      name: 'Spellcasting',
      type: 'prepared',
      slots: extractDnd5eSpellSlots(spellSlots),
      spells: allSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Exported page API.
// ---------------------------------------------------------------------------

/**
 * List world actors as { id, name, type, img? }, optionally filtered by type.
 * (The old module filtered in the query handler; we fold that filter in here.)
 */
export function listActors(args?: { type?: string | undefined; nameFilter?: string | undefined }) {
  const type = args?.type;
  const nameLower = args?.nameFilter ? args.nameFilter.toLowerCase() : null;
  return Array.from(game.actors ?? [])
    .filter((actor: any) => !type || actor.type === type)
    .filter((actor: any) => !nameLower || (actor.name ?? '').toLowerCase().includes(nameLower))
    .map((actor: any) => ({
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
    }));
}

/**
 * dnd5e 5.x saving throws. The derived total per ability lives at `abilities.<ab>.save.value`
 * (in 5.x `save` is an object field, not the legacy numeric getter). Read it directly off the
 * LIVE actor here — the sanitizer strips the `save` key tree-wide (the legacy getter is
 * deprecated), and reading the authoritative derived value avoids reimplementing dnd5e's save
 * math node-side. `proficient` is 0 / 0.5 / 1 (none / half / proficient).
 */
function extractSaves(
  actor: any
): Record<string, { value: number; proficient: number }> | undefined {
  const abilities = actor?.system?.abilities;
  if (!abilities || typeof abilities !== 'object') return undefined;
  const saves: Record<string, { value: number; proficient: number }> = {};
  for (const [key, ability] of Object.entries(abilities)) {
    const ab = ability as any;
    const value = ab?.save?.value; // 5.x derived total save bonus
    if (typeof value === 'number') {
      saves[key] = { value, proficient: ab.proficient ?? 0 };
    }
  }
  return Object.keys(saves).length > 0 ? saves : undefined;
}

/**
 * dnd5e DERIVED values, read off the LIVE actor (NOT toObject()). The get-actor system blob is
 * sanitized from `toObject().system`, which is the SOURCE data and so omits every prepared/derived
 * field: ability `.mod`, skill `.total`/`.passive`/`.mod`, `attributes.ac.value`,
 * `attributes.init.total`, the available-legendary-actions `legact.value` (= max − spent), and the
 * CR-derived `details.xp.value`, and a PC's `attributes.hp.max` (class hit dice + CON; the source
 * holds null — an NPC's is authored). Reading them here (the same way extractSaves reads save
 * totals) lets the Node extractor surface real modifiers instead of zeros. Returns undefined when
 * there is nothing derived to report.
 */
function extractDerived(actor: any): Record<string, any> | undefined {
  const system = actor?.system;
  if (!system || typeof system !== 'object') return undefined;
  const out: Record<string, any> = {};

  if (system.abilities && typeof system.abilities === 'object') {
    const abilities: Record<string, { mod: number }> = {};
    for (const [key, ab] of Object.entries(system.abilities)) {
      const mod = (ab as any)?.mod;
      if (typeof mod === 'number') abilities[key] = { mod };
    }
    if (Object.keys(abilities).length > 0) out.abilities = abilities;
  }

  if (system.skills && typeof system.skills === 'object') {
    const skills: Record<string, { total: number; passive: number; mod: number }> = {};
    for (const [key, sk] of Object.entries(system.skills)) {
      const s = sk as any;
      if (typeof s?.total === 'number') {
        skills[key] = { total: s.total, passive: s.passive ?? 0, mod: s.mod ?? s.total };
      }
    }
    if (Object.keys(skills).length > 0) out.skills = skills;
  }

  const ac = system.attributes?.ac;
  if (typeof ac?.value === 'number') {
    // dnd5e 6.0: `calcs` is the Set of qualifying base calculations, `formulas` the custom ones
    // (prep prepends the base calcs as type "base" — report only the authored ones), `override` a
    // fixed AC, `calc`/`label` the calculation that actually won.
    const sourceFormulas = actor?._source?.system?.attributes?.ac?.formulas;
    out.ac = {
      value: ac.value,
      ...(ac.calcs ? { calcs: Array.from(ac.calcs) } : {}),
      ...(typeof ac.flat === 'number' ? { flat: ac.flat } : {}),
      ...(typeof ac.override === 'number' ? { override: ac.override } : {}),
      ...(Array.isArray(sourceFormulas) && sourceFormulas.length > 0
        ? { formulas: sourceFormulas.map((f: any) => ({ formula: f.formula, label: f.label })) }
        : {}),
      ...(typeof ac.calc === 'string' && ac.calc ? { calc: ac.calc } : {}),
      ...(typeof ac.label === 'string' && ac.label ? { label: ac.label } : {}),
    };
  }

  const initTotal = system.attributes?.init?.total;
  if (typeof initTotal === 'number') out.init = { total: initTotal };

  // `effectiveMax` = max + tempmax (dnd5e's own field); reported so a consumer never re-adds it.
  const hp = system.attributes?.hp;
  if (hp && typeof hp.max === 'number') {
    out.hp = {
      value: hp.value ?? 0,
      max: hp.max,
      effectiveMax:
        typeof hp.effectiveMax === 'number' ? hp.effectiveMax : hp.max + (hp.tempmax ?? 0),
      temp: hp.temp ?? 0,
      tempmax: hp.tempmax ?? 0,
    };
  }

  const legact = system.resources?.legact;
  if (legact && typeof legact.value === 'number') {
    out.legact = { value: legact.value, max: legact.max ?? 0 };
  }

  const xpValue = system.details?.xp?.value;
  if (typeof xpValue === 'number') out.xp = { value: xpValue };

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Detailed character info for one actor, resolved via the shared fuzzy resolver
 * (exact id, exact name, substring, then PLACED-TOKEN id → that token's
 * ActorDelta-backed actor — the same path searchCharacterItems already had; the
 * ad-hoc game.actors-only lookup here was why get-actor/get-actor-entity threw
 * "Character not found" on the token ids their descriptions advertise).
 * Payload mirrors the bridge query: { characterName?, characterId? }.
 * Returns the full CharacterInfo shape the Node character tool consumes:
 * id/name/type, optional img, sanitized system, sanitized items (each with its
 * module `flags` when present — the item-piles NaN forensic read path), effects,
 * and (when present) dnd5e spellcasting.
 */
export function getCharacterInfo(args: {
  characterName?: string | undefined;
  characterId?: string | undefined;
}) {
  const identifier = args?.characterName || args?.characterId;
  if (!identifier) {
    throw invalid('characterName or characterId is required');
  }

  const actor: any = resolveActor(identifier);
  if (!actor) {
    throw notFoundError(`Character not found: ${identifier}`);
  }

  const characterData: Record<string, any> = {
    id: actor.id || '',
    name: actor.name || '',
    type: actor.type,
    ...(actor.img ? { img: actor.img } : {}),
    // Sanitize toObject() source, not the live document: in dnd5e 5.x system.activities is a Map,
    // and Object.keys() on a Map returns [] — so sanitizing the live `system` silently empties
    // activities (attacks/saves/damage) to {}. toObject() flattens Maps/Collections to plain data.
    system: sanitize(toSource(actor).system),
    items: actor.items.map((item: any) => {
      const flags = sanitize(toSource(item).flags);
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        ...(item.img ? { img: item.img } : {}),
        system: sanitize(toSource(item).system),
        // Module flags (dnd5e riders, item-piles transfer residue, …) — surfaced by
        // get-actor-entity for flag forensics; get-actor's minimal projection drops them.
        ...(flags && Object.keys(flags).length > 0 ? { flags } : {}),
      };
    }),
    effects: actor.effects.map((effect: any) => {
      const duration = projectDuration(effect.duration);
      // Foundry v14: changes live at system.changes (plain data { key, value, type, phase }); the
      // top-level `changes` is only a deprecated shim. Surface them so effects are inspectable
      // from get-actor (the shared sanitizer also preserves changes[].key — see R2). dnd5e 6.0
      // extras ride along from the SOURCE (on the prepared doc `conditions` is a Filter instance):
      // the effect `type` (base | condition | enchantment), `magical`, effect-level `conditions`
      // (parsed), rider statuses, and per change its parsed `conditions` + a readable `rule` for
      // the roll-time rules types (dnd5e.advantage / bonus / minimum / maximum).
      const source = toSource(effect);
      const rawChanges = source?.system?.changes ?? source?.changes;
      const changes = Array.isArray(rawChanges)
        ? rawChanges.map((c: any) => {
            const { _id: _ignored, conditions: rawConditions, replacement, ...rest } = c ?? {};
            const conditions = parseConditions(rawConditions);
            const rule = describeRule(c ?? {});
            return {
              ...rest,
              ...(conditions ? { conditions } : {}),
              ...(typeof replacement === 'string' && replacement ? { replacement } : {}),
              ...(rule ? { rule } : {}),
            };
          })
        : [];
      const conditions = parseConditions(source?.system?.conditions);
      const riders = source?.system?.rider?.statuses;
      return {
        id: effect.id,
        name: effect.name || effect.label || 'Unknown Effect',
        ...(effect.img ? { icon: effect.img } : {}),
        disabled: effect.disabled,
        type: typeof effect.type === 'string' ? effect.type : 'base',
        ...(source?.system?.magical === true ? { magical: true } : {}),
        ...(conditions ? { conditions } : {}),
        ...(Array.isArray(riders) && riders.length > 0 ? { riderStatuses: riders } : {}),
        ...(changes.length > 0 ? { changes } : {}),
        // v14 shape: { value, units, expiry?, remaining? }, or { expiry, remaining? } for a
        // value-less expiry (which still expires at the first matching event).
        ...(duration ? { duration } : {}),
      };
    }),
  };

  const spellcastingEntries = extractSpellcastingData(actor);
  if (spellcastingEntries.length > 0) {
    characterData.spellcasting = spellcastingEntries;
  }

  // Saving throws — derived totals read from the live actor (the sanitizer drops `save`).
  const saves = extractSaves(actor);
  if (saves) {
    characterData.saves = saves;
  }

  // Derived values (ability/skill modifiers, AC, init, legendary actions, xp) — read from the
  // LIVE actor because the sanitized `system` blob comes from toObject() (source data) and omits
  // every prepared field. The Node extractor prefers this block over the (absent) source values.
  const derived = extractDerived(actor);
  if (derived) {
    characterData.derived = derived;
  }

  return characterData;
}

/**
 * Full-fidelity actor export — the native "Export Data" payload, headless.
 * toObject() is the COMPLETE source document (system, embedded items with their
 * uses/charges and flags, effects, prototypeToken, ownership, folder, _stats) —
 * no sanitizer, no projection: this is the backup/restore path, so nothing may
 * be dropped. The exportSource flag matches ClientDocument#exportToJSON, so the
 * file round-trips through the sheet's Import Data button. Resolves placed-token
 * ids to the token-instance actor (ActorDelta truth), same as the other reads.
 */
export function exportActorData(args: { identifier?: string | undefined }) {
  const identifier = args?.identifier;
  if (!identifier) {
    throw invalid('identifier is required');
  }

  const actor: any = resolveActor(identifier);
  if (!actor) {
    throw notFoundError(`Character not found: ${identifier}`);
  }

  const data: any = actor.toObject();
  // v14 pre-defines toObject().flags.exportSource as a getter-only NON-ENUMERABLE accessor, so
  // plain assignment throws in strict mode (proven live on 14.364). Rebuild flags as plain data
  // — spread skips the non-enumerable getter — and stamp the same envelope exportToJSON writes.
  data.flags = {
    ...(data.flags ?? {}),
    exportSource: {
      world: (game as any).world?.id,
      system: game.system?.id,
      coreVersion: (game as any).version,
      systemVersion: game.system?.version,
    },
  };

  return {
    id: actor.id,
    name: actor.name,
    type: actor.type,
    itemCount: Array.isArray(data.items) ? data.items.length : 0,
    effectCount: Array.isArray(data.effects) ? data.effects.length : 0,
    data,
  };
}

/**
 * Fetch a single entity (item, action, or effect) from a character.
 * Payload: { characterIdentifier, entityIdentifier }. Returns a tagged result
 * { success, entityType, entity } whose entity shape varies by type.
 */
export function getCharacterEntity(args: {
  characterIdentifier: string;
  entityIdentifier: string;
}) {
  const { characterIdentifier, entityIdentifier } = args;

  const character = Array.from(game.actors ?? []).find(
    (actor: any) =>
      actor.id === characterIdentifier ||
      actor.name?.toLowerCase() === characterIdentifier.toLowerCase()
  );

  if (!character) {
    throw notFoundError(`Character not found: "${characterIdentifier}"`);
  }

  // 1. Items (by id or name).
  const items = (character as any).items?.contents ?? [];
  let entity = items.find(
    (item: any) =>
      item.id === entityIdentifier || item.name?.toLowerCase() === entityIdentifier.toLowerCase()
  );

  if (entity) {
    const entityTrueName = unmaskedName(entity);
    return {
      success: true,
      entityType: 'item',
      entity: {
        id: entity.id,
        name: entity.name,
        ...(entityTrueName !== undefined ? { trueName: entityTrueName } : {}),
        type: entity.type,
        img: entity.img,
        description: entity.system?.description?.value || entity.system?.description || '',
        // toObject() source so dnd5e activity Maps survive serialization (see toSource).
        system: toSource(entity).system,
      },
    };
  }

  // 2. Actions (systems that surface actions as a separate collection).
  if ((character as any).system?.actions) {
    const actions = Array.isArray((character as any).system.actions)
      ? (character as any).system.actions
      : Object.values((character as any).system.actions || {});

    entity = actions.find(
      (action: any) =>
        action.id === entityIdentifier ||
        action.name?.toLowerCase() === entityIdentifier.toLowerCase()
    );

    if (entity) {
      return {
        success: true,
        entityType: 'action',
        entity,
      };
    }
  }

  // 3. Effects (by id or name).
  const effects = (character as any).effects?.contents ?? [];
  entity = effects.find(
    (effect: any) =>
      effect.id === entityIdentifier ||
      effect.name?.toLowerCase() === entityIdentifier.toLowerCase()
  );

  if (entity) {
    return {
      success: true,
      entityType: 'effect',
      entity: {
        id: entity.id,
        name: entity.name || entity.label,
        icon: entity.img ?? entity.icon,
        disabled: entity.disabled,
        duration: entity.duration,
        // v14: system.changes (the top-level getter is a deprecated shim)
        changes: entity.system?.changes ?? entity.changes,
      },
    };
  }

  throw notFoundError(
    `Entity not found: "${entityIdentifier}" in character "${(character as any).name}"`
  );
}

/**
 * Token-efficient search within a character's items, spells, actions, effects.
 * Payload: { characterIdentifier, query?, type?, category?, limit? } (limit 20).
 * Returns { characterId, characterName, query?, type?, category?, matches, totalMatches }.
 */
export function searchCharacterItems(args: {
  characterIdentifier: string;
  query?: string | undefined;
  type?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
}) {
  const { characterIdentifier, query, type, category, limit = 20 } = args;

  const actor = resolveActor(characterIdentifier);
  if (!actor) {
    throw notFoundError(`Character not found: ${characterIdentifier}`);
  }

  const systemId = game.system?.id;
  const matches: any[] = [];

  const searchQuery = query?.toLowerCase().trim();
  const searchType = type?.toLowerCase().trim();
  const searchCategory = category?.toLowerCase().trim();

  const matchesQuery = (text: unknown): boolean => {
    if (!searchQuery) return true;
    if (typeof text !== 'string') return false;
    return text.toLowerCase().includes(searchQuery);
  };

  const matchesType = (itemType: string): boolean => {
    if (!searchType) return true;
    return itemType.toLowerCase() === searchType;
  };

  // Items / spells / equipment.
  for (const item of actor.items) {
    const itemSystem = item.system;

    if (!matchesType(item.type)) continue;

    let description = itemSystem?.description?.value || itemSystem?.description;
    if (typeof description !== 'string') description = '';
    if (!matchesQuery(item.name) && !matchesQuery(description)) continue;

    const result: any = {
      id: item.id,
      name: item.name,
      type: item.type,
    };

    if (description) {
      const plainText = description.replace(/<[^>]*>/g, '').trim();
      result.description = plainText.length > 300 ? `${plainText.substring(0, 300)}...` : plainText;
    }

    if (item.type === 'spell') {
      result.level = itemSystem?.level?.value ?? itemSystem?.level ?? itemSystem?.rank ?? 0;
      // dnd5e 5.x: spell preparation is system.prepared (0/1/2) + system.method; the legacy
      // system.preparation.prepared shape is gone.
      result.prepared = itemSystem?.prepared ?? itemSystem?.location?.prepared;
      result.method = itemSystem?.method;
      result.expended = itemSystem?.location?.expended;

      if (systemId === 'dnd5e') {
        const targeting = extractDnd5eSpellTargeting(itemSystem);
        if (targeting.range) result.range = targeting.range;
        if (targeting.target) result.target = targeting.target;
        if (targeting.area) result.area = targeting.area;
        result.actionCost = itemSystem?.activation?.type;
      }

      if (searchCategory) {
        const spellLevel = result.level || 0;
        // dnd5e 5.x system.prepared is 0/1/2 (a number); treat >0 as prepared. (Legacy boolean data
        // still works via the !== false fallback.)
        const isPrepared =
          typeof result.prepared === 'number' ? result.prepared > 0 : result.prepared !== false;
        const isCantrip = spellLevel === 0;

        if (searchCategory === 'cantrip' && !isCantrip) continue;
        if (searchCategory === 'prepared' && !isPrepared) continue;
      }
    }

    if (['weapon', 'armor', 'equipment', 'consumable', 'backpack', 'loot'].includes(item.type)) {
      result.quantity = itemSystem?.quantity ?? 1;
      result.equipped = itemSystem?.equipped ?? false;
      result.invested = itemSystem?.equipped?.invested ?? itemSystem?.invested ?? undefined;

      if (searchCategory) {
        if (searchCategory === 'equipped' && !result.equipped) continue;
        if (searchCategory === 'invested' && !result.invested) continue;
      }
    }

    matches.push(result);

    if (matches.length >= limit) break;
  }

  // Actions (system actions or action-typed items).
  if (!searchType || searchType === 'action') {
    const actions =
      actor.system?.actions || actor.items?.filter((i: any) => i.type === 'action') || [];
    for (const action of actions) {
      if (matches.length >= limit) break;

      const actionName = action.name || action.label || '';
      if (!matchesQuery(actionName)) continue;

      matches.push({
        id: action.id || action.slug || actionName,
        name: actionName,
        type: 'action',
        actionType: action.type || action.actionType || 'action',
      });
    }
  }

  // Effects.
  if (!searchType || searchType === 'effect') {
    const effects = actor.effects || [];
    for (const effect of effects) {
      if (matches.length >= limit) break;

      if (!matchesQuery(effect.name || effect.label)) continue;

      matches.push({
        id: effect.id,
        name: effect.name || effect.label,
        type: 'effect',
        description: effect.description || undefined,
      });
    }
  }

  const result: Record<string, any> = {
    characterId: actor.id || '',
    characterName: actor.name || '',
    matches,
    totalMatches: matches.length,
  };

  if (query) result.query = query;
  if (type) result.type = type;
  if (category) result.category = category;

  return result;
}

/**
 * Resolve an actor by free-text identifier, returning { id, name } or null.
 * Payload: { identifier }.
 */
export function findActor(args: { identifier: string }) {
  try {
    const actor = resolveActor(args.identifier);
    return actor ? { id: actor.id, name: actor.name } : null;
  } catch (error) {
    console.error('Error finding actor:', error);
    return null;
  }
}
