// Page-side: the actor's own stat-block edit (updateActor) and the embedded-item dot-path patch
// (updateActorItem). Runs INSIDE the headless Foundry page. (F45: the update third of the old
// src/page/actors.ts.)

import {
  resolveActorFuzzy as resolveActor,
  resolveActorItem,
  toDeletionKey,
  unmaskedName,
} from '../_shared.js';
import {
  ABILITIES,
  buildAcUpdate,
  CONDITION_TYPES,
  CREATURE_TYPES,
  DAMAGE_TYPES,
  normalizeCR,
  normalizeSize,
  normalizeSkill,
  SKILL_ABILITY,
} from '../dnd5e/actor-fields.js';
import { normalizeRarities } from '../dnd5e/items.js';
import { imgResolves, badAssetWarning } from '../img-resolve.js';
import { resolveCreatureIcon, GENERIC_ICON } from '../dnd5e/icons.js';
import { resolveDisposition, TOKEN_DISPOSITION } from '../dnd5e/token-defaults.js';
import { invalid, notFound as notFoundError } from '../errors.js';
import type { UpdateActorArgs } from '../../tools/dnd5e/update-actor.js';

// Nameplate / resource-bar visibility keys → CONST.TOKEN_DISPLAY_MODES numbers. Mirrors the same
// map in src/page/placeables/token.ts (update-token, for placed tokens) — keep the two in step so a
// prototype token and a dropped token speak the same visibility modes.
const TOKEN_DISPLAY_MODES: Record<string, number> = {
  none: 0,
  control: 10,
  'owner-hover': 20,
  hover: 30,
  owner: 40,
  always: 50,
};

/**
 * Edit an existing actor's own system data (the stat-block fields — NOT its embedded items, which
 * are handled by updateActorItem / add-feature). Resolves the actor fuzzily, then builds ONE
 * `actor.update()` patch from whichever field groups the caller supplied:
 *
 *  - identity:   name, tokenName (prototype nameplate ≠ actor name), img, disposition,
 *                tokenAutoRotate (= !lockRotation), tokenRing (ring.enabled), tokenScale,
 *                tokenRotation, tokenDisplayName / tokenDisplayBars (nameplate / HP-bar visibility)
 *  - details:    size, cr*, creatureType*, creatureSubtype*, swarmSize*, alignment, biography, source
 *  - abilities:  abilities.<ab>, savingThrows (replace), skills (merge)
 *  - vitals:     hp, ac, initiative
 *  - movement / senses (senses uses the modern `senses.ranges.*` path)
 *  - defenses:   damageImmunities / damageResistances / damageVulnerabilities / conditionImmunities
 *                (Set fields with mode replace|add|remove via read-modify-write), languages, telepathy
 *  - resources*: legendaryActions, legendaryResistances, lair
 *  - spellcasting*: {level, ability} — caster level (attributes.spell.level, what slot pools derive
 *                from) + casting ability (attributes.spellcasting, what save DC / attack derive from)
 *  - 2024*:      habitat, treasure
 *
 * Fields marked * are NPC-only; on a non-NPC actor they are skipped with a warning (we don't grow PC
 * class-progression logic here). Movement values are FormulaField strings, so numbers are coerced.
 * Set fields are replace-whole in dnd5e, so add/remove are done by reading the live Set first.
 * Unknown enum-ish values (damage/condition/creatureType/AC-calc/size/skill) warn but never block.
 * Returns { success, actor:{id,name,type}, applied:[...field names], warnings }.
 */
export async function updateActor(params: UpdateActorArgs) {
  const identifier = params?.actorIdentifier;
  if (!identifier) throw invalid('actorIdentifier is required');
  const actor = resolveActor(identifier);
  if (!actor) throw notFoundError(`Actor not found: ${identifier}`);

  const isNpc = actor.type === 'npc';
  const update: Record<string, any> = {};
  const warnings: string[] = [];
  const applied: string[] = [];

  const warnUnknown = (label: string, value: string, set: Set<string>) => {
    if (!set.has(value)) {
      warnings.push(`Unknown ${label} "${value}" — verify it matches dnd5e system values`);
    }
  };
  // NPC-only gate: returns true (apply) only for npc actors; otherwise warns + skips.
  const npcOnly = (field: string): boolean => {
    if (!isNpc) {
      warnings.push(`"${field}" is an NPC-only field — skipped on ${actor.type} "${actor.name}"`);
      return false;
    }
    return true;
  };

  // --- identity ---
  if (typeof params.name === 'string' && params.name.trim()) {
    update.name = params.name.trim();
    // Keep the prototype token's name in lockstep with the actor — a renamed actor should read the
    // same on any token dragged from it (and in the combat tracker), not the pre-rename name.
    update['prototypeToken.name'] = params.name.trim();
    applied.push('name');
  }
  if (typeof params.tokenName === 'string' && params.tokenName.trim()) {
    // Decouple the prototype nameplate from the actor name (e.g. actor "Morgash the Gravemaker",
    // tokens just "Morgash"). Deliberately after the `name` lockstep write so tokenName wins when
    // both are passed.
    update['prototypeToken.name'] = params.tokenName.trim();
    applied.push('tokenName');
  }
  if (typeof params.img === 'string' && params.img.trim()) {
    // Rule 8 — never write a broken (404) portrait. A supplied path is honored only if it resolves on
    // the static server; otherwise warn and substitute a real creatureType-keyed floor icon.
    let img = params.img.trim();
    if (!(await imgResolves(img))) {
      warnings.push(badAssetWarning('img', img, true));
      const ct =
        actor.type === 'npc' ? actor.system?.details?.type?.value || 'humanoid' : 'humanoid';
      img = resolveCreatureIcon(ct);
    }
    update.img = img;
    applied.push('img');
  }
  if (params.disposition !== undefined && params.disposition !== null) {
    // Flip friend/foe on the prototype token — e.g. mark a captured or turned NPC friendly. Combat and
    // targeting read disposition, so this is a real state change, not cosmetic.
    update['prototypeToken.disposition'] = resolveDisposition(
      params.disposition,
      TOKEN_DISPOSITION.hostile
    );
    applied.push('disposition');
  }
  if (typeof params.tokenAutoRotate === 'boolean') {
    // Auto-rotate = the inverse of Foundry's lockRotation. House rule 10 wants this ON; the
    // 2024-book prototype tokens ship it locked.
    update['prototypeToken.lockRotation'] = !params.tokenAutoRotate;
    applied.push('tokenAutoRotate');
  }
  if (typeof params.tokenRing === 'boolean') {
    // Only the enabled flag — the ring's colors/subject config is preserved for a later re-enable.
    update['prototypeToken.ring.enabled'] = params.tokenRing;
    applied.push('tokenRing');
  }
  if (typeof params.tokenScale === 'number' && params.tokenScale > 0) {
    // Prototype-token art scale — the "Scale (Ratio)" slider on the token's Appearance tab. Sets
    // texture.scaleX and scaleY together so the art grows/shrinks within its grid footprint; the
    // token's size (grid spaces) is untouched.
    update['prototypeToken.texture.scaleX'] = params.tokenScale;
    update['prototypeToken.texture.scaleY'] = params.tokenScale;
    applied.push('tokenScale');
  }
  // Rotation — the prototype's default facing, matching update-token for placed tokens. (elevation /
  // hidden / x / y are DELIBERATELY not here: Foundry's PrototypeToken schema excludes them — they only
  // exist on a placed TokenDocument, so update-token owns those.) The lockRotation gotcha below mirrors
  // buildTokenUpdate (src/page/placeables/token.ts) — keep the two in step.
  if (typeof params.tokenRotation === 'number') {
    update['prototypeToken.rotation'] = params.tokenRotation;
    applied.push('tokenRotation');
    // A lock-rotation prototype hides a set facing. If the caller isn't also setting tokenAutoRotate,
    // auto-unlock so the angle shows (the same rule update-token applies to placed tokens).
    const settingAutoRotate = typeof params.tokenAutoRotate === 'boolean';
    const willBeLocked = settingAutoRotate
      ? params.tokenAutoRotate === false
      : actor.prototypeToken?.lockRotation === true;
    if (willBeLocked && settingAutoRotate) {
      warnings.push(
        'prototype token: rotation set but tokenAutoRotate:false (lockRotation) will hide it visually.'
      );
    } else if (willBeLocked) {
      update['prototypeToken.lockRotation'] = false;
      warnings.push(
        'prototype token: auto-unlocked rotation (lockRotation was true, which would have hidden the facing).'
      );
    }
  }
  // Prototype-token nameplate / HP-bar visibility (map friendly key → CONST.TOKEN_DISPLAY_MODES
  // number), matching update-token for placed tokens. "none" hides the name / health bar on every
  // token dragged from this actor — the window-dressing default for background NPCs.
  if (typeof params.tokenDisplayName === 'string') {
    const m = TOKEN_DISPLAY_MODES[params.tokenDisplayName];
    if (m === undefined) {
      warnings.push(`prototype token: unknown tokenDisplayName mode "${params.tokenDisplayName}".`);
    } else {
      update['prototypeToken.displayName'] = m;
      applied.push('tokenDisplayName');
    }
  }
  if (typeof params.tokenDisplayBars === 'string') {
    const m = TOKEN_DISPLAY_MODES[params.tokenDisplayBars];
    if (m === undefined) {
      warnings.push(`prototype token: unknown tokenDisplayBars mode "${params.tokenDisplayBars}".`);
    } else {
      update['prototypeToken.displayBars'] = m;
      applied.push('tokenDisplayBars');
    }
  }

  // --- details ---
  if (params.size !== undefined) {
    const sz = normalizeSize(String(params.size));
    if (sz) {
      update['system.traits.size'] = sz;
      applied.push('size');
    } else {
      warnings.push(`Unknown size "${params.size}" — left unchanged`);
    }
  }
  if (params.cr !== undefined && npcOnly('cr')) {
    update['system.details.cr'] = normalizeCR(params.cr);
    applied.push('cr');
  }
  if (params.creatureType !== undefined && npcOnly('creatureType')) {
    warnUnknown('creature type', String(params.creatureType), CREATURE_TYPES);
    update['system.details.type.value'] = params.creatureType;
    applied.push('creatureType');
  }
  if (params.creatureSubtype !== undefined && npcOnly('creatureSubtype')) {
    update['system.details.type.subtype'] = params.creatureSubtype;
    applied.push('creatureSubtype');
  }
  if (params.swarmSize !== undefined && npcOnly('swarmSize')) {
    if (params.swarmSize === '') {
      update['system.details.type.swarm'] = '';
      applied.push('swarmSize');
    } else {
      const sz = normalizeSize(String(params.swarmSize));
      if (sz) {
        update['system.details.type.swarm'] = sz;
        applied.push('swarmSize');
      } else {
        warnings.push(`Unknown swarm size "${params.swarmSize}" — left unchanged`);
      }
    }
  }
  if (typeof params.alignment === 'string') {
    update['system.details.alignment'] = params.alignment;
    applied.push('alignment');
  }
  if (typeof params.biography === 'string') {
    update['system.details.biography.value'] = params.biography;
    applied.push('biography');
  }
  // system.source exists on npc (and vehicle) data only — a character has no source stamp, so the
  // write would be pruned silently; gate it like the other NPC-only fields.
  if (params.source && typeof params.source === 'object' && npcOnly('source')) {
    let touched = false;
    for (const k of ['book', 'page', 'rules'] as const) {
      if (typeof params.source[k] === 'string') {
        update[`system.source.${k}`] = params.source[k];
        touched = true;
      }
    }
    if (touched) applied.push('source');
  }

  // --- abilities / saves / skills ---
  if (params.abilities && typeof params.abilities === 'object') {
    let touched = false;
    for (const ab of ABILITIES) {
      if (typeof params.abilities[ab] === 'number') {
        update[`system.abilities.${ab}.value`] = params.abilities[ab];
        touched = true;
      }
    }
    if (touched) applied.push('abilities');
  }
  if (Array.isArray(params.savingThrows)) {
    const set = new Set(params.savingThrows.map(String));
    for (const ab of ABILITIES) {
      update[`system.abilities.${ab}.proficient`] = set.has(ab) ? 1 : 0;
    }
    applied.push('savingThrows');
  }
  if (Array.isArray(params.skills)) {
    let touched = false;
    for (const s of params.skills) {
      const key = normalizeSkill(String(s?.skill ?? ''));
      if (!key) {
        warnings.push(`Unknown skill "${s?.skill}" — skipped`);
        continue;
      }
      update[`system.skills.${key}.value`] =
        s.proficiency === 'expert' ? 2 : s.proficiency === 'proficient' ? 1 : 0;
      // Also pin the governing ability: an authored NPC's skill may have been created
      // without it (older builds), which silently drops the ability mod from the total.
      update[`system.skills.${key}.ability`] = SKILL_ABILITY[key];
      touched = true;
    }
    if (touched) applied.push('skills');
  }

  // --- vitals ---
  if (params.hp && typeof params.hp === 'object') {
    for (const k of ['value', 'max', 'temp', 'tempmax'] as const) {
      if (typeof params.hp[k] === 'number') update[`system.attributes.hp.${k}`] = params.hp[k];
    }
    if (typeof params.hp.formula === 'string')
      update['system.attributes.hp.formula'] = params.hp.formula;
    applied.push('hp');
  }
  if (params.ac && typeof params.ac === 'object') {
    // dnd5e 6.0 AC model (calcs / flat / formulas / override); the 5.x calc/flat/formula aliases
    // are translated, never written raw (`calc` and `formula` are non-persisted and get pruned).
    const ac = buildAcUpdate(params.ac);
    Object.assign(update, ac.update);
    warnings.push(...ac.warnings);
    if (Object.keys(ac.update).length > 0) applied.push('ac');
  }
  if (params.initiative && typeof params.initiative === 'object') {
    if (typeof params.initiative.bonus === 'number') {
      // dnd5e 6.0: `attributes.init.bonus` is a GETTER-ONLY shim (common.mjs #BONUS_FIELD_PATHS +
      // shimBonusData) — a write there is pruned from the source. The real field is init.roll.bonus.
      update['system.attributes.init.roll.bonus'] = String(params.initiative.bonus);
    }
    if (typeof params.initiative.ability === 'string') {
      update['system.attributes.init.ability'] = params.initiative.ability;
    }
    applied.push('initiative');
  }

  // --- movement (dnd5e 6.0 movement.speeds.* FormulaField strings) / senses (ranges.* ints) ---
  if (params.movement && typeof params.movement === 'object') {
    for (const k of ['walk', 'fly', 'swim', 'climb', 'burrow', 'jump'] as const) {
      const v = params.movement[k];
      if (v !== undefined && v !== null)
        update[`system.attributes.movement.speeds.${k}`] = String(v);
    }
    if (typeof params.movement.units === 'string') {
      update['system.attributes.movement.units'] = params.movement.units;
    }
    if (typeof params.movement.hover === 'boolean') {
      update['system.attributes.movement.hover'] = params.movement.hover;
    }
    applied.push('movement');
  }
  if (params.senses && typeof params.senses === 'object') {
    for (const k of ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const) {
      if (typeof params.senses[k] === 'number') {
        update[`system.attributes.senses.ranges.${k}`] = params.senses[k];
      }
    }
    if (typeof params.senses.units === 'string') {
      update['system.attributes.senses.units'] = params.senses.units;
    }
    if (typeof params.senses.special === 'string') {
      update['system.attributes.senses.special'] = params.senses.special;
    }
    applied.push('senses');
  }

  // --- defenses (Set fields: replace-whole, so add/remove read the live Set first) ---
  // `supportsCustom` — only a SimpleTraitField (di / dr / dv / ci / languages) carries a `custom`
  // string. The 6.0.1 npc `details.treasure` and character `traits.weaponProf.mastery` schemas are
  // { value } / { value, bonus }: a `.custom` write there is pruned, so warn instead of writing it.
  const applySet = (
    path: string,
    current: any,
    field: any,
    validSet: Set<string> | null,
    label: string,
    name: string,
    supportsCustom = true
  ) => {
    const values: string[] = Array.isArray(field.values) ? field.values.map(String) : [];
    if (validSet) for (const v of values) warnUnknown(label, v, validSet);
    const mode = field.mode ?? 'replace';
    if (mode === 'replace') {
      update[`${path}.value`] = values;
    } else {
      const cur = Array.from((current ?? []) as Iterable<string>).map(String);
      update[`${path}.value`] =
        mode === 'add'
          ? Array.from(new Set([...cur, ...values]))
          : cur.filter(x => !values.includes(x));
    }
    if (typeof field.custom === 'string') {
      if (supportsCustom) update[`${path}.custom`] = field.custom;
      else warnings.push(`"${name}" has no custom field in dnd5e 6.0 — "custom" ignored`);
    }
    applied.push(name);
  };

  const traits = actor.system?.traits ?? {};
  if (params.damageImmunities) {
    applySet(
      'system.traits.di',
      traits.di?.value,
      params.damageImmunities,
      DAMAGE_TYPES,
      'damage type',
      'damageImmunities'
    );
  }
  if (params.damageResistances) {
    applySet(
      'system.traits.dr',
      traits.dr?.value,
      params.damageResistances,
      DAMAGE_TYPES,
      'damage type',
      'damageResistances'
    );
  }
  if (params.damageVulnerabilities) {
    applySet(
      'system.traits.dv',
      traits.dv?.value,
      params.damageVulnerabilities,
      DAMAGE_TYPES,
      'damage type',
      'damageVulnerabilities'
    );
  }
  if (params.conditionImmunities) {
    applySet(
      'system.traits.ci',
      traits.ci?.value,
      params.conditionImmunities,
      CONDITION_TYPES,
      'condition',
      'conditionImmunities'
    );
  }
  if (params.languages) {
    applySet(
      'system.traits.languages',
      traits.languages?.value,
      params.languages,
      null,
      'language',
      'languages'
    );
  }
  if (
    params.telepathy &&
    typeof params.telepathy === 'object' &&
    typeof params.telepathy.value === 'number'
  ) {
    update['system.traits.languages.communication.telepathy'] = {
      value: params.telepathy.value,
      units: params.telepathy.units ?? 'ft',
    };
    applied.push('telepathy');
  }

  // --- weapon mastery (PC, 2024) ---
  if (params.weaponMasteries) {
    if (actor.type !== 'character') {
      warnings.push(
        `"weaponMasteries" is a PC-only field — skipped on ${actor.type} "${actor.name}"`
      );
    } else {
      // Values are base weapon KINDS (CONFIG.DND5E.weaponIds keys: "greatsword", "handcrossbow",
      // ...), NOT mastery names — the mastery property (graze/vex/...) lives on the weapon item.
      // Normalize friendly forms ("Hand Crossbow") to the id shape and soft-validate against the
      // live CONFIG, so a typo warns instead of silently never matching any weapon.
      const weaponIds = new Set(
        Object.keys((globalThis as any).CONFIG?.DND5E?.weaponIds ?? {}).map(k => k.toLowerCase())
      );
      const normalized = {
        mode: params.weaponMasteries.mode,
        values: (params.weaponMasteries.values ?? []).map((v: any) =>
          String(v)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
        ),
      };
      applySet(
        'system.traits.weaponProf.mastery',
        traits.weaponProf?.mastery?.value,
        normalized,
        weaponIds.size > 0 ? weaponIds : null,
        'weapon kind',
        'weaponMasteries',
        false
      );
    }
  }

  // --- resources (NPC) ---
  if (typeof params.legendaryActions === 'number' && npcOnly('legendaryActions')) {
    update['system.resources.legact.max'] = params.legendaryActions;
    applied.push('legendaryActions');
  }
  if (typeof params.legendaryResistances === 'number' && npcOnly('legendaryResistances')) {
    update['system.resources.legres.max'] = params.legendaryResistances;
    applied.push('legendaryResistances');
  }
  if (params.lair && typeof params.lair === 'object' && npcOnly('lair')) {
    // Providing a lair object marks the creature as having lair actions; initiative is optional.
    update['system.resources.lair.value'] = true;
    if (typeof params.lair.initiative === 'number') {
      update['system.resources.lair.initiative'] = params.lair.initiative;
    }
    applied.push('lair');
  }

  // --- spellcasting (NPC) ---
  // `attributes.spell.level` is the NPC sheet's "Spellcasting Level" (migrated from the legacy
  // details.spellLevel). It is the field slot pools DERIVE from: dnd5e recomputes
  // system.spells.spellN.max every prepareDerivedData cycle, so writing .max directly does NOT
  // stick — a slot pool written that way reads back as "<value>/0" and a long rest restores it to
  // 0. Setting the caster level here is what makes the derived max real. PCs derive both this and
  // the casting ability from class advancement, so the whole group is NPC-gated.
  if (params.spellcasting && typeof params.spellcasting === 'object') {
    const sc = params.spellcasting;
    if (typeof sc.level === 'number' && npcOnly('spellcasting.level')) {
      update['system.attributes.spell.level'] = sc.level;
      applied.push('spellcasting.level');
    }
    if (typeof sc.ability === 'string' && npcOnly('spellcasting.ability')) {
      update['system.attributes.spellcasting'] = sc.ability;
      applied.push('spellcasting.ability');
    }
  }

  // --- 2024 fields (NPC) ---
  if (Array.isArray(params.habitat) && npcOnly('habitat')) {
    update['system.details.habitat.value'] = params.habitat.map((h: any) =>
      h?.subtype ? { type: h.type, subtype: h.subtype } : { type: h.type }
    );
    applied.push('habitat');
  }
  if (params.treasure && npcOnly('treasure')) {
    applySet(
      'system.details.treasure',
      actor.system?.details?.treasure?.value,
      params.treasure,
      null,
      'treasure',
      'treasure',
      false
    );
  }

  // --- currency (coins; actor-level, applies to NPCs and PCs alike) ---
  if (params.currency && typeof params.currency === 'object') {
    const mode = params.currency.mode === 'add' ? 'add' : 'set';
    const live = actor.system?.currency ?? {};
    let touched = false;
    for (const coin of ['pp', 'gp', 'ep', 'sp', 'cp'] as const) {
      const v = params.currency[coin];
      if (typeof v === 'number' && Number.isFinite(v)) {
        // 'add' adjusts the live pile (negatives spend, clamped at 0); 'set' overwrites.
        const base = mode === 'add' ? Number(live[coin] ?? 0) : 0;
        update[`system.currency.${coin}`] = Math.max(0, Math.round(base + v));
        touched = true;
      }
    }
    if (touched) applied.push('currency');
  }

  if (Object.keys(update).length === 0) {
    const extra = warnings.length ? ` (${warnings.join('; ')})` : '';
    throw invalid(`No applicable fields to update.${extra}`);
  }

  await actor.update(update);

  // Changing the caster level re-derives every slot pool's max, but `value` (the REMAINING slots)
  // is stored and does not follow it — drop a level-3 caster to 0 and the sheet is left reading
  // "4/0", the same broken shape a raw `.max` write produces. Clamp each pool to its freshly
  // derived max in a second pass (the first update had to land before the max was recomputed).
  // Only ever clamps DOWN, so a partially-spent pool keeps its remaining slots.
  if (applied.includes('spellcasting.level')) {
    const clamp: Record<string, number> = {};
    const live = actor.system?.spells ?? {};
    for (const key of [...Array.from({ length: 9 }, (_, i) => `spell${i + 1}`), 'pact']) {
      const pool = live[key];
      if (!pool) continue;
      const max = Number(pool.max ?? 0);
      const value = Number(pool.value ?? 0);
      if (Number.isFinite(max) && Number.isFinite(value) && value > max) {
        clamp[`system.spells.${key}.value`] = max;
      }
    }
    if (Object.keys(clamp).length > 0) {
      await actor.update(clamp);
      applied.push('spellcasting.slotClamp');
    }
  }

  return {
    success: true,
    actor: { id: actor.id, name: actor.name, type: actor.type },
    applied,
    warnings,
  };
}

/**
 * Edit an embedded Item on an actor by applying a dot-path `patch` (and/or `deletePaths`, and/or a
 * name/img change) via actor.updateEmbeddedDocuments('Item', ...). This is the generic embedded-doc
 * editor: `patch` keys are Foundry dot-paths (e.g. "system.damage.base.number",
 * "system.activities.<id>.attack.bonus") applied as-is — arrays REPLACE whole (dnd5e Sets/arrays are
 * replace-whole). `deletePaths` remove keys via the `-=` form (e.g. to drop an activity by id).
 * Resolves the actor fuzzily and the item by id/name. Returns the item identity + the applied keys.
 */
export async function updateActorItem(params: {
  actorIdentifier: string;
  itemIdentifier: string;
  type?: string | undefined;
  name?: string | undefined;
  img?: string | undefined;
  patch?: Record<string, any> | undefined;
  deletePaths?: string[] | undefined;
}) {
  const { actorIdentifier, itemIdentifier } = params ?? ({} as any);
  if (!actorIdentifier) throw invalid('actorIdentifier is required');
  if (!itemIdentifier) throw invalid('itemIdentifier is required');

  const actor = resolveActor(actorIdentifier);
  if (!actor) throw notFoundError(`Actor not found: ${actorIdentifier}`);
  const item = resolveActorItem(actor, itemIdentifier, params.type);
  if (!item) {
    throw notFoundError(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
  }

  const warnings: string[] = [];
  const update: Record<string, any> = { _id: item.id };
  if (typeof params.name === 'string' && params.name.trim()) update.name = params.name.trim();
  if (typeof params.img === 'string' && params.img.trim()) {
    // Rule 8 — never write a broken (404) item icon. Honor a supplied path only if it resolves on the
    // static server; otherwise warn and substitute the neutral real floor icon.
    let img = params.img.trim();
    if (!(await imgResolves(img))) {
      warnings.push(badAssetWarning('img', img, true));
      img = GENERIC_ICON;
    }
    update.img = img;
  }
  if (params.patch && typeof params.patch === 'object') {
    for (const [k, v] of Object.entries(params.patch)) {
      // dnd5e 6.0: the 5.x `system.rarity` string is a migrated shim of the `system.rarities` Set —
      // write the native field (a string becomes a one-entry list; a list passes through).
      if (k === 'system.rarity' || k === 'system.rarities') {
        update['system.rarities'] = normalizeRarities(v as string | string[]);
        continue;
      }
      update[k] = v;
    }
  }
  if (Array.isArray(params.deletePaths)) {
    for (const p of params.deletePaths) {
      if (typeof p === 'string' && p.length > 0) update[toDeletionKey(p)] = null;
    }
  }

  const appliedKeys = Object.keys(update).filter(k => k !== '_id');
  if (appliedKeys.length === 0) {
    throw invalid('Provide name, img, patch, or deletePaths to change.');
  }

  await actor.updateEmbeddedDocuments('Item', [update]);

  const updated = actor.items?.get?.(item.id) ?? item;
  const updatedTrueName = unmaskedName(updated);
  return {
    success: true,
    actor: { id: actor.id, name: actor.name },
    item: {
      id: updated.id,
      name: updated.name,
      ...(updatedTrueName !== undefined ? { trueName: updatedTrueName } : {}),
      type: updated.type,
    },
    appliedKeys,
    ...(warnings.length ? { warnings } : {}),
  };
}
