// Page-side: the SINGLE dnd5e 5.3.3 Activity builder. Runs inside the headless Foundry page, but is
// pure (no Foundry globals) so it unit-tests offline.
//
// dnd5e "activities" are the rollable things on an item (attack / damage / save / heal / check /
// utility / ...), stored as system.activities keyed by id. buildActivity(type, opts) produces ONE
// such activity object. The attack/save shapes are reproduced byte-for-byte from the live-verified
// inline objects in attacks.ts, so addAttackToActor / addAttackWithSaveToActor route through this one
// builder with no behavioral change (activities.test.ts pins the equivalence). The heal/check/utility/
// damage shapes are lean — dnd5e's DataModel fills every other field on create (live-spiked).

import {
  ACTIVITY_BEHAVIOR_TYPES,
  ACTIVITY_DURATION_SCALAR_UNITS,
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

export interface RawDamagePart {
  number: number;
  denomination: number;
  type: string;
}

/** Map a raw damage part to the dnd5e activity-part object shape. */
export function damagePartToActivity(p: RawDamagePart): Record<string, unknown> {
  return {
    types: [p.type],
    number: p.number,
    denomination: p.denomination,
    bonus: '',
    scaling: { mode: '', number: 1 },
    custom: { enabled: false },
  };
}

/** An authored activity duration (dnd5e 6.0 DurationField: value formula, units, expiry). */
export interface ActivityDurationOpts {
  /** Amount for a scalar unit — a number or a deterministic formula ("@prof"). */
  value?: number | string;
  units?: string;
  /** Effect expiry the activity's applied effects inherit (6.0): core combat / rest / source-target. */
  expiry?: string | null;
  concentration?: boolean;
}

/** An authored area template (dnd5e TargetField.template). */
export interface ActivityTemplateOpts {
  type: string;
  /** Primary size in `units` (radius / length / width per shape) — a number or deterministic formula. */
  size: number | string;
  width?: number | string;
  height?: number | string;
  units?: string;
  /** Number of templates placed (e.g. Fire Bolt-style multi-placement). */
  count?: number | string;
}

/** Who the activity affects (dnd5e TargetField.affects). */
export interface ActivityAffectsOpts {
  type?: string;
  count?: number | string;
  choice?: boolean;
}

/**
 * An authored area BEHAVIOR (dnd5e 6.0 `activity.behaviors[]`): a region behavior the activity's
 * measured template carries while it stands. `effectUuids` are ALREADY-RESOLVED ActiveEffect uuids
 * (the page orchestrator resolves names / item refs first — see effect-refs.ts).
 */
export interface ActivityBehaviorOpts {
  type: string;
  name?: string;
  level?: { min?: number; max?: number };
  effectUuids?: string[];
  sizes?: string[];
  creatureTypes?: string[];
  terrainTypes?: string[];
}

/** Custom transformation settings (TransformationSetting): what carries over from the original self. */
export interface TransformSettingsOpts {
  keep?: string[];
  merge?: string[];
  effects?: string[];
  /** Deterministic formula for a floor on the new form's AC (Moon druid: "(13 + @abilities.wis.mod)"). */
  minimumAC?: string;
  /** Deterministic formula for temp HP granted on transforming ("@classes.druid.levels"). */
  tempFormula?: string;
  transformTokens?: boolean;
  /** Spell lists the form keeps access to (dnd5e registry keys, e.g. "subclass:moon"). */
  spellLists?: string[];
}

/**
 * One entry of `activity.effects[]` (dnd5e 6.0 AppliedEffectField) — an ActiveEffect the activity
 * applies to its targets. EITHER `_id` (an effect that lives ON THE ITEM) or `uuid` (a stock
 * `dnd5e.effects` / compendium / world-item effect); the page resolves the authored ref to one or the
 * other (see effect-refs.ts). `onSave` only exists on a SAVE activity's field (save-data.mjs).
 */
export interface AppliedEffectOpts {
  _id?: string;
  uuid?: string;
  onSave?: boolean;
  level?: { min?: number; max?: number };
}

/** A transform profile (direct link: `actorUuid`; by CR: `cr` + the filters). */
export interface TransformProfileOpts {
  name?: string;
  cr?: number | string;
  sizes?: string[];
  creatureTypes?: string[];
  /** Movement types the chosen creature must NOT have (e.g. ['fly'] for low-level Wild Shape). */
  restrictMovement?: string[];
  level?: { min?: number; max?: number };
  actorUuid?: string;
}

export interface BuildActivityOpts {
  /** Activity id (caller generates via foundry.utils.randomID(16)). */
  id: string;
  name?: string;
  activationType?: string;
  sort?: number;
  /**
   * Duration OVERRIDE for the activity (6.0: effects it applies inherit it, incl. `expiry`). When
   * given, `override: true` is set so the activity's own duration wins over the item's.
   */
  duration?: ActivityDurationOpts;
  /** Area template + who it affects — sets `target.override: true` so the activity's own target wins. */
  template?: ActivityTemplateOpts;
  affects?: ActivityAffectsOpts;
  /** Area behaviors the template carries (needs a template to ever fire). */
  behaviors?: ActivityBehaviorOpts[];
  // teleport (dnd5e 6.0): how far the target may be moved; omit for any distance
  teleportDistance?: number | string;
  teleportUnits?: string;
  // transform (dnd5e 6.0)
  transformMode?: string;
  transformPreset?: string;
  /** form mode: may the actor revert to "no form" from the prompt. */
  formless?: boolean;
  /** direct / cr profiles — `actorUuid` ALREADY resolved by the page orchestrator. */
  profiles?: TransformProfileOpts[];
  /** form mode: the ITEM's own effect ids, one per form — resolved by name by the orchestrator. */
  formEffectIds?: string[];
  /** cr / direct: custom transformation settings (sets transform.customize) instead of the bare preset. */
  transformSettings?: TransformSettingsOpts;
  /**
   * The PRESET's own settings, read from `CONFIG.DND5E.transformation.presets[preset].settings` by the
   * page (Sets → arrays) — the base `transformSettings` merges over. dnd5e's own transform sheet seeds
   * a customised settings object the same way (transform-sheet.mjs #_processSubmitData), and
   * transform-data.mjs uses a `customize: true` settings object VERBATIM, so without this base a
   * customised transform silently loses the preset's minimumAC / tempFormula / spellLists / keep /
   * merge / effects. Omit (or {}) when there is no preset.
   */
  transformPresetSettings?: Record<string, unknown>;
  /**
   * Applied effects (`activity.effects[]`): the ActiveEffects the activity puts on its targets. Refs
   * are ALREADY resolved by the page to an on-item `_id` or a compendium / world-item `uuid`.
   */
  appliedEffects?: AppliedEffectOpts[];
  // attack
  attackType?: 'melee' | 'ranged';
  attackBonus?: number;
  /** Attack ability override (the dnd5e 2024 attack.ability field). Omit to leave it ''. */
  ability?: string;
  /** Attack classification ('' for 2024, 'weapon' for 2014). */
  classification?: string;
  includeBase?: boolean;
  /** RAW activity damage parts (caller handles the weapon base part separately). */
  damageParts?: RawDamagePart[];
  // save
  saveAbility?: string;
  saveDC?: number;
  onSave?: 'half' | 'none';
  // heal
  healing?: { number: number; denomination: number; type?: string };
  // check
  checkAbility?: string;
  checkDC?: number;
  skills?: string[];
  // cast (link a real compendium spell — the activity casts it, pulling its measured template / save /
  // attack / effects). The page orchestrator resolves the spell from spellUuid and fills level/
  // spellProperties before calling this pure builder; saveDC/attackBonus drive the challenge override.
  spellUuid?: string;
  /** Cast level (e.g. 3 for Fireball). Resolved from the spell's base level when omitted. */
  level?: number;
  /** The spell's V/S/M components (['vocal','somatic','material']) — resolved from the linked spell. */
  spellProperties?: string[];
  /**
   * Cast consumption. usesOn 'item' (default — the wand pattern): `charges` are consumed FROM the
   * parent item's own pool per cast. usesOn 'activity' (the feature-granted free-cast pattern —
   * required when the parent has no pool): a pool of `charges` uses (number or formula, e.g.
   * "@scale.ranger.favored-enemy") lives ON the activity, recovering per `recoveryPeriod`, and one
   * use is consumed per cast. Omit charges for an at-will cast (no consumption either way).
   */
  charges?: number | string;
  usesOn?: 'item' | 'activity';
  /** Activity-pool recovery (usesOn 'activity' only): lr / sr / day / dawn / dusk. Default 'lr'. */
  recoveryPeriod?: string;
}

/**
 * Normalize an authored activity duration to the dnd5e DurationField shape { value (string formula),
 * units, expiry, concentration }. Validates units (CONFIG.DND5E.timePeriods) and expiry (the core +
 * dnd5e effect expiry events); a scalar unit needs a value, a special / permanent unit drops it.
 * Returns undefined when nothing was given.
 */
export function normalizeActivityDuration(
  d: ActivityDurationOpts | undefined
): Record<string, unknown> | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  if (d.units !== undefined) {
    if (!(ACTIVITY_DURATION_UNITS as readonly string[]).includes(d.units)) {
      throw new Error(
        `duration.units "${d.units}" is not a dnd5e time period. Use one of: ${ACTIVITY_DURATION_UNITS.join(' ')}.`
      );
    }
    out.units = d.units;
  }
  const scalar =
    typeof out.units === 'string' &&
    (ACTIVITY_DURATION_SCALAR_UNITS as readonly string[]).includes(out.units);
  if (d.value !== undefined && d.value !== null && String(d.value).trim() !== '') {
    if (typeof out.units === 'string' && !scalar) {
      // inst / spec / perm … carry no amount; the system would null it anyway
    } else {
      out.value = String(d.value).trim();
    }
  }
  if (scalar && out.value === undefined) {
    throw new Error(
      `duration.units "${out.units}" needs a duration.value (e.g. 1 for "1 ${out.units}").`
    );
  }
  if (d.expiry !== undefined) {
    if (d.expiry !== null && !(EXPIRY_EVENTS as readonly string[]).includes(d.expiry)) {
      throw new Error(
        `duration.expiry "${d.expiry}" is not an expiry event. Use one of: ${EXPIRY_EVENTS.join(' ')}.`
      );
    }
    out.expiry = d.expiry;
  }
  if (typeof d.concentration === 'boolean') out.concentration = d.concentration;
  return Object.keys(out).length > 0 ? out : undefined;
}

const formula = (v: number | string | undefined): string | undefined =>
  v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim();

/**
 * Normalize an authored area template + affects to the dnd5e TargetField shape. Validates the
 * template type (CONFIG.DND5E.areaTargetTypes) and the affects type (individualTargetTypes).
 * Returns undefined when neither was given.
 */
export function normalizeActivityTarget(
  template: ActivityTemplateOpts | undefined,
  affects: ActivityAffectsOpts | undefined
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (template) {
    if (!(AREA_TEMPLATE_TYPES as readonly string[]).includes(template.type)) {
      throw new Error(
        `template.type "${template.type}" is not an area shape. Use one of: ${AREA_TEMPLATE_TYPES.join(' ')}.`
      );
    }
    const size = formula(template.size);
    if (size === undefined)
      throw new Error('template.size is required (in template.units, default ft).');
    const t: Record<string, unknown> = { type: template.type, size, units: template.units ?? 'ft' };
    const width = formula(template.width);
    const height = formula(template.height);
    const count = formula(template.count);
    if (width !== undefined) t.width = width;
    if (height !== undefined) t.height = height;
    if (count !== undefined) t.count = count;
    out.template = t;
  }
  if (affects) {
    const a: Record<string, unknown> = {};
    if (affects.type !== undefined) {
      if (
        affects.type !== '' &&
        !(TARGET_AFFECTS_TYPES as readonly string[]).includes(affects.type)
      ) {
        throw new Error(
          `affects.type "${affects.type}" is not a target type. Use one of: ${TARGET_AFFECTS_TYPES.join(' ')}.`
        );
      }
      a.type = affects.type;
    }
    const count = formula(affects.count);
    if (count !== undefined) a.count = count;
    if (typeof affects.choice === 'boolean') a.choice = affects.choice;
    if (Object.keys(a).length > 0) out.affects = a;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const assertKeys = (values: string[] | undefined, vocab: readonly string[], label: string) => {
  for (const v of values ?? []) {
    if (!vocab.includes(v))
      throw new Error(`${label} "${v}" is unknown. Use one of: ${vocab.join(' ')}.`);
  }
};

/**
 * Build one persisted `activity.behaviors[]` entry (AppliedBehaviorField): `{ _id, type, name,
 * level, config }` where `config` is the TypeDataField keyed by `type` — written TOGETHER with the
 * type, or the clean step drops it. applyActiveEffect config = { effects, sizes, types };
 * difficultTerrain config = { types }. Validates the vocabularies; requires an effect for
 * applyActiveEffect.
 */
export function buildActivityBehavior(b: ActivityBehaviorOpts, id: string): Record<string, any> {
  if (!(ACTIVITY_BEHAVIOR_TYPES as readonly string[]).includes(b.type)) {
    throw new Error(
      `behavior type "${b.type}" is unknown. Use one of: ${ACTIVITY_BEHAVIOR_TYPES.join(' ')}.`
    );
  }
  const level: Record<string, number> = {};
  if (typeof b.level?.min === 'number') level.min = b.level.min;
  if (typeof b.level?.max === 'number') level.max = b.level.max;
  let config: Record<string, unknown>;
  if (b.type === 'applyActiveEffect') {
    if (!b.effectUuids?.length) {
      throw new Error('an applyActiveEffect behavior needs at least one effect.');
    }
    assertKeys(b.sizes, ACTOR_SIZES, 'size');
    assertKeys(b.creatureTypes, CREATURE_TYPE_KEYS, 'creature type');
    config = { effects: [...b.effectUuids], sizes: b.sizes ?? [], types: b.creatureTypes ?? [] };
  } else {
    assertKeys(b.terrainTypes, DIFFICULT_TERRAIN_TYPES, 'terrain type');
    config = { types: b.terrainTypes ?? [] };
  }
  return { _id: id, type: b.type, name: b.name ?? '', level, config };
}

/**
 * Build one `activity.effects[]` entry (AppliedEffectField: `{_id, uuid, level:{min,max}}`, plus
 * `onSave` on a save activity). Exactly one of `_id` / `uuid` identifies the effect.
 */
export function buildAppliedEffect(e: AppliedEffectOpts, type: string): Record<string, any> {
  if (!e?._id && !e?.uuid) {
    throw new Error('an applied effect must resolve to an effect on the item (_id) or a uuid.');
  }
  if (typeof e.onSave === 'boolean' && type !== 'save') {
    throw new Error(
      `appliesEffects[].onSave only exists on a SAVE activity (this is a "${type}" activity).`
    );
  }
  const level: Record<string, number> = {};
  if (typeof e.level?.min === 'number') level.min = e.level.min;
  if (typeof e.level?.max === 'number') level.max = e.level.max;
  return {
    ...(e._id ? { _id: e._id } : {}),
    ...(e.uuid ? { uuid: e.uuid } : {}),
    level,
    ...(typeof e.onSave === 'boolean' ? { onSave: e.onSave } : {}),
  };
}

/**
 * The typed activity fields `manage-activity edit` does NOT understand. The page edit branch only
 * applies name / duration / template / affects / behaviors / appliesEffects / patch; anything else
 * used to be forwarded, ignored, and reported as a success. Throws naming the offenders.
 */
export const EDIT_UNSUPPORTED_ACTIVITY_KEYS = [
  'activationType',
  'damageParts',
  'attackType',
  'attackBonus',
  'ability',
  'includeBase',
  'saveAbility',
  'saveDC',
  'onSave',
  'healing',
  'checkAbility',
  'checkDC',
  'skills',
  'spellUuid',
  'level',
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

/** Throw if an edit carries a typed field the edit branch would silently drop. */
export function assertEditableActivityFields(activity: Record<string, any> | undefined): void {
  const offenders = EDIT_UNSUPPORTED_ACTIVITY_KEYS.filter(
    k => activity?.[k] !== undefined && activity?.[k] !== null
  );
  if (offenders.length === 0) return;
  throw new Error(
    `manage-activity edit cannot change ${offenders.join(', ')}. Edit supports name, duration, ` +
      'template, affects, behaviors and appliesEffects; change anything else with `patch` (dot-paths ' +
      'relative to the activity root, e.g. {"attack.bonus":"3"}, {"save.dc.formula":"16"}) or remove ' +
      'the activity and add it again.'
  );
}

/** Build one dnd5e activity object of the given type. */
export function buildActivity(type: string, opts: BuildActivityOpts): Record<string, any> {
  const act = buildActivityOfType(type, opts);
  const duration = normalizeActivityDuration(opts.duration);
  if (duration) act.duration = { ...(act.duration ?? {}), ...duration, override: true };
  const target = normalizeActivityTarget(opts.template, opts.affects);
  if (target) {
    const prior = act.target ?? {};
    act.target = {
      ...prior,
      ...(target.template
        ? { template: { ...(prior.template ?? {}), ...(target.template as object) } }
        : {}),
      ...(target.affects
        ? { affects: { ...(prior.affects ?? {}), ...(target.affects as object) } }
        : {}),
      override: true,
    };
  }
  if (opts.behaviors?.length) {
    if (!act.target?.template?.type) {
      throw new Error(
        'behaviors ride on an AREA TEMPLATE — give `template` ({type, size}) too, or the behavior never fires.'
      );
    }
    act.behaviors = opts.behaviors.map((b, i) => buildActivityBehavior(b, behaviorId(opts.id, i)));
  }
  if (opts.appliedEffects?.length) {
    if (type === 'transform') {
      throw new Error(
        "a transform activity's effects[] ARE its forms (Select-Form mode) — use `forms`, not " +
          '`appliesEffects`.'
      );
    }
    act.effects = opts.appliedEffects.map(e => buildAppliedEffect(e, type));
  }
  return act;
}

/** A deterministic 16-char id for the i-th behavior of an activity (ids must be 16 alphanumerics). */
export function behaviorId(activityId: string, i: number): string {
  const base = `${activityId}`
    .replace(/[^A-Za-z0-9]/g, '')
    .padEnd(16, 'b')
    .slice(0, 13);
  return `${base}b${String(i).padStart(2, '0')}`.slice(0, 16);
}

function buildActivityOfType(type: string, opts: BuildActivityOpts): Record<string, any> {
  switch (type) {
    case 'attack':
      return buildAttackActivity(opts);
    case 'save':
      return buildSaveActivity(opts);
    case 'damage':
      return buildDamageActivity(opts);
    case 'heal':
      return buildHealActivity(opts);
    case 'check':
      return buildCheckActivity(opts);
    case 'utility':
      return buildUtilityActivity(opts);
    case 'cast':
      return buildCastActivity(opts);
    case 'teleport':
      return buildTeleportActivity(opts);
    case 'transform':
      return buildTransformActivity(opts);
    default:
      throw new Error(
        `Unknown activity type "${type}". Use attack, damage, save, heal, check, utility, cast, teleport, or transform.`
      );
  }
}

// --- teleport (dnd5e 6.0) ------------------------------------------------------
// BaseTeleportActivityData: `teleport: { override, units, value }` — with override:false the distance
// FOLLOWS the range (a "self" range → 0 = cannot teleport), so the builder always overrides with an
// explicit distance; a blank value = any distance (prepareFinalData: "" → Infinity). `value` is a
// deterministic FormulaField — a STRING ("30"). Targets default to self (Misty Step); pass `affects`
// for "you and one willing creature" (Dimension Door → {type: "willing", count: 1}).
function buildTeleportActivity(opts: BuildActivityOpts): Record<string, any> {
  const distance =
    opts.teleportDistance === undefined || opts.teleportDistance === null
      ? ''
      : String(opts.teleportDistance).trim();
  if (distance !== '' && !/^[\d@+\-*/(). a-zA-Z]+$/.test(distance)) {
    throw new Error(
      `teleportDistance "${distance}" is not a deterministic formula (e.g. 30 or "@prof * 10").`
    );
  }
  return {
    _id: opts.id,
    type: 'teleport',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
    range: { units: 'self', override: false },
    target: { affects: { type: 'self', count: '' }, override: true },
    teleport: { override: true, units: opts.teleportUnits ?? 'ft', value: distance },
  };
}

// --- transform (dnd5e 6.0) -----------------------------------------------------
// BaseTransformActivityData: `transform.mode` '' (direct link — profiles carry actor uuids) | 'cr'
// (profiles carry a max CR + size / type / movement filters) | 'form' (Select Form — the ITEM's own
// effects are the forms, referenced through `effects[]` by their ids; no profiles, no settings tab);
// `transform.preset` picks the transformation settings (customize:false ⇒ the preset's settings).
export function buildTransformProfile(
  p: TransformProfileOpts,
  id: string,
  mode: string
): Record<string, any> {
  const level: Record<string, number> = {};
  if (typeof p.level?.min === 'number') level.min = p.level.min;
  if (typeof p.level?.max === 'number') level.max = p.level.max;
  assertKeys(p.sizes, ACTOR_SIZES, 'size');
  assertKeys(p.creatureTypes, CREATURE_TYPE_KEYS, 'creature type');
  assertKeys(p.restrictMovement, MOVEMENT_TYPES, 'movement type');
  if (mode === 'direct' && !p.actorUuid) {
    throw new Error(
      'a direct-link transform profile needs an `actor` (a Monster Manual creature).'
    );
  }
  if (mode === 'cr' && (p.cr === undefined || p.cr === null || String(p.cr).trim() === '')) {
    throw new Error(
      'a by-CR transform profile needs a `cr` (the maximum challenge rating, e.g. 0.25 or "@prof / 3").'
    );
  }
  return {
    _id: id,
    name: p.name ?? '',
    cr: p.cr === undefined || p.cr === null ? '' : String(p.cr).trim(),
    level,
    movement: [...(p.restrictMovement ?? [])],
    sizes: [...(p.sizes ?? [])],
    types: [...(p.creatureTypes ?? [])],
    uuid: p.actorUuid ?? null,
  };
}

function buildTransformActivity(opts: BuildActivityOpts): Record<string, any> {
  const mode = opts.transformMode ?? 'cr';
  if (!(TRANSFORM_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `transformMode "${mode}" is unknown. Use one of: ${TRANSFORM_MODES.join(' ')}.`
    );
  }
  const preset = opts.transformPreset ?? '';
  if (preset !== '' && !(TRANSFORM_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(
      `transformPreset "${preset}" is unknown. Use one of: ${TRANSFORM_PRESETS.join(' ')}.`
    );
  }
  const act: Record<string, any> = {
    _id: opts.id,
    type: 'transform',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
    transform: {
      mode: mode === 'direct' ? '' : mode,
      preset,
      customize: false,
      formless: mode === 'form' ? !!opts.formless : false,
    },
    profiles: [],
    effects: [],
  };
  if (opts.transformSettings) {
    if (mode === 'form') {
      throw new Error(
        "transformSettings are not available in Select-Form mode — the forms' effects ARE the transformation."
      );
    }
    const ts = opts.transformSettings;
    assertKeys(ts.keep, TRANSFORM_KEEP_KEYS, 'transformSettings.keep');
    assertKeys(ts.merge, TRANSFORM_MERGE_KEYS, 'transformSettings.merge');
    assertKeys(ts.effects, TRANSFORM_EFFECT_KEYS, 'transformSettings.effects');
    act.transform.customize = true;
    // Seed from the PRESET's own settings (resolved by the page) exactly as dnd5e's transform sheet
    // does — mergeObject({...preset.settings, preset}, submitted) — so an override of one category
    // (say `keep`) REPLACES only that list and the rest of the preset (minimumAC / tempFormula /
    // spellLists / merge / effects) is inherited instead of silently lost.
    act.settings = {
      ...(opts.transformPresetSettings ?? {}),
      preset: preset || null,
      ...(ts.keep ? { keep: [...ts.keep] } : {}),
      ...(ts.merge ? { merge: [...ts.merge] } : {}),
      ...(ts.effects ? { effects: [...ts.effects] } : {}),
      ...(ts.minimumAC !== undefined ? { minimumAC: String(ts.minimumAC) } : {}),
      ...(ts.tempFormula !== undefined ? { tempFormula: String(ts.tempFormula) } : {}),
      ...(typeof ts.transformTokens === 'boolean' ? { transformTokens: ts.transformTokens } : {}),
      ...(ts.spellLists ? { spellLists: [...ts.spellLists] } : {}),
    };
  }
  if (mode === 'form') {
    if (!opts.formEffectIds?.length) {
      throw new Error(
        'a Select-Form transform needs `forms` — the names of effects on the item, one per form ' +
          '(author them with manage-effect on the item first).'
      );
    }
    act.effects = opts.formEffectIds.map(id => ({ _id: id, level: {} }));
  } else {
    if (!opts.profiles?.length) {
      throw new Error(
        `a ${mode === 'cr' ? 'by-CR' : 'direct-link'} transform needs at least one profile.`
      );
    }
    act.profiles = opts.profiles.map((p, i) =>
      buildTransformProfile(p, behaviorId(opts.id, i), mode)
    );
  }
  return act;
}

// --- attack (byte-for-byte the addAttackToActor inline shape) -----------------
function buildAttackActivity(opts: BuildActivityOpts): Record<string, any> {
  const activationType = opts.activationType ?? 'action';
  return {
    _id: opts.id,
    type: 'attack',
    name: opts.name ?? '',
    img: '',
    sort: opts.sort ?? 0,
    description: {},
    activation: { type: activationType, value: 1, condition: '', override: false },
    duration: { units: '', value: '', override: false },
    target: {
      template: {
        count: '',
        contiguous: false,
        type: '',
        size: '',
        width: '',
        height: '',
        units: '',
      },
      affects: { count: '', type: '', choice: false, special: '' },
      prompt: true,
      override: false,
    },
    range: { units: 'self', override: false },
    uses: { spent: 0, max: '', recovery: [] },
    consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
    attack: {
      ability: '',
      bonus: (opts.attackBonus ?? 0) > 0 ? String(opts.attackBonus) : '',
      critical: { threshold: null },
      flat: false,
      type: { value: opts.attackType ?? 'melee', classification: opts.classification ?? '' },
      ...(opts.ability !== undefined ? { ability: opts.ability } : {}),
    },
    damage: {
      critical: { bonus: '' },
      includeBase: opts.includeBase ?? true,
      parts: (opts.damageParts ?? []).map(damagePartToActivity),
    },
    effects: [],
    save: { ability: '', dc: { formula: '', calculation: '' } },
  };
}

// --- save (byte-for-byte the addAttackWithSaveToActor save shape) -------------
function buildSaveActivity(opts: BuildActivityOpts): Record<string, any> {
  const activationType = opts.activationType ?? 'action';
  return {
    _id: opts.id,
    type: 'save',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    description: {},
    activation: { type: activationType, value: 1, override: false },
    duration: { units: 'inst', concentration: false, override: false },
    effects: [],
    range: { units: 'self', override: false },
    uses: { spent: 0, recovery: [] },
    consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
    target: {
      template: {
        count: '',
        contiguous: false,
        type: '',
        size: '',
        width: '',
        height: '',
        units: '',
      },
      affects: { count: '1', type: 'creature', choice: false, special: '' },
      override: false,
      prompt: true,
    },
    damage: {
      onSave: opts.onSave ?? 'none',
      parts: (opts.damageParts ?? []).map(damagePartToActivity),
    },
    save: {
      // Guard against a malformed [undefined] entry if a caller omits the ability (the tool layer
      // requires it, but keep the page defensive). addAttackWithSaveToActor always supplies it.
      ability: opts.saveAbility ? [opts.saveAbility] : [],
      dc: { calculation: '', formula: opts.saveDC !== undefined ? String(opts.saveDC) : '' },
    },
  };
}

// --- damage (lean; dnd5e fills defaults) --------------------------------------
function buildDamageActivity(opts: BuildActivityOpts): Record<string, any> {
  return {
    _id: opts.id,
    type: 'damage',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
    damage: { parts: (opts.damageParts ?? []).map(damagePartToActivity) },
  };
}

// --- heal (lean) --------------------------------------------------------------
function buildHealActivity(opts: BuildActivityOpts): Record<string, any> {
  const h = opts.healing ?? { number: 1, denomination: 4 };
  return {
    _id: opts.id,
    type: 'heal',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
    healing: {
      number: h.number,
      denomination: h.denomination,
      types: [h.type ?? 'healing'],
      bonus: '',
      custom: { enabled: false },
      scaling: { mode: '', number: 1 },
    },
  };
}

// --- check (lean) -------------------------------------------------------------
function buildCheckActivity(opts: BuildActivityOpts): Record<string, any> {
  return {
    _id: opts.id,
    type: 'check',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
    check: {
      associated: opts.skills ?? [],
      ability: opts.checkAbility ?? '',
      dc: { calculation: '', formula: opts.checkDC !== undefined ? String(opts.checkDC) : '' },
    },
  };
}

// --- utility (lean; e.g. Multiattack) -----------------------------------------
function buildUtilityActivity(opts: BuildActivityOpts): Record<string, any> {
  return {
    _id: opts.id,
    type: 'utility',
    name: opts.name ?? '',
    sort: opts.sort ?? 0,
    activation: { type: opts.activationType ?? 'action', value: 1, override: false },
  };
}

// --- cast (link a real compendium spell) --------------------------------------
// Mirrors the live DMG Wand of Fireballs / our verified Staff of Minor Bolts cast activity. The
// activity LINKS a spell by uuid (spell.uuid); casting it pulls that spell's measured template
// (fireball sphere, lightning line…), save/attack, and effects FOR FREE — which is why target.template
// stays MINIMAL here (the spell owns the real template; a full override would suppress it).
//
//   challenge: saveDC -> {save:"15", attack:"", override:true} (fixed DC, e.g. the Wand of Fireballs)
//              attackBonus -> {attack:N, override:true}      (fixed spell-attack, e.g. a Witch Bolt staff)
//              neither -> {attack:null, override:false}       (defer DC/attack to the casting actor)
// The page sanitizer strips `save` tree-wide, so a fixed save DC is correct-but-invisible on read-back.
//
//   consumption: spellSlot:false (an item never eats the holder's spell slots) + either an itemUses
//                target of `charges` per cast (usesOn 'item', the wand pattern) or a self-contained
//                pool of `charges` uses ON the activity with one activityUses consumed per cast
//                (usesOn 'activity', the feature free-cast pattern — the sheet's "Additional Spells"
//                row counter reads this pool). Omit charges for an at-will cast (empty targets).
function buildCastActivity(opts: BuildActivityOpts): Record<string, any> {
  // dnd5e 6.0: spell.challenge.save / .attack are FormulaFields (strings; "" = unset), so the
  // fixed values are written as the strings the schema stores.
  const challenge =
    opts.saveDC !== undefined
      ? { save: String(opts.saveDC), attack: '', override: true }
      : opts.attackBonus !== undefined
        ? { attack: String(opts.attackBonus), save: '', override: true }
        : { attack: '', save: '', override: false };
  const hasCharges = opts.charges !== undefined && opts.charges !== null;
  const pooled = hasCharges && opts.usesOn === 'activity';
  const targets = pooled
    ? [{ type: 'activityUses', value: '1', target: '', scaling: { mode: '', formula: '' } }]
    : hasCharges
      ? [
          {
            type: 'itemUses',
            value: String(opts.charges),
            target: '',
            scaling: { mode: '', formula: '' },
          },
        ]
      : [];
  const uses = pooled
    ? {
        spent: 0,
        max: String(opts.charges),
        recovery: [{ period: opts.recoveryPeriod ?? 'lr', type: 'recoverAll' }],
      }
    : { spent: 0, recovery: [], max: '' };
  return {
    _id: opts.id,
    type: 'cast',
    name: opts.name ?? '',
    img: '',
    sort: opts.sort ?? 0,
    spell: {
      uuid: opts.spellUuid ?? '',
      challenge,
      level: opts.level ?? 0,
      properties: opts.spellProperties ?? [],
      spellbook: true,
    },
    activation: { type: opts.activationType ?? 'action', value: null, override: false },
    consumption: { scaling: { allowed: false, max: '' }, spellSlot: false, targets },
    description: { chatFlavor: '' },
    duration: { units: 'inst', concentration: false, override: false },
    range: { override: false, units: 'self' },
    target: {
      template: { contiguous: false, units: 'ft', stationary: false },
      affects: { choice: false },
      override: false,
      prompt: true,
    },
    uses,
    flags: {},
    visibility: {
      level: {},
      requireAttunement: false,
      requireIdentification: false,
      requireMagic: false,
    },
  };
}
