// THE single source of truth for canonical dnd5e enum sets (read from the 6.0.1 source) used in
// validation across the authoring surface. Previously each tool/page file kept its own copy, which
// drifted; the lists here are locked against the source by unit tests.
//
// Intentionally PURE — no imports, no Node or Foundry globals — so it can be shared by BOTH bundles:
// the Node-side tools (add-feature / add-item / npc) and the page-side library (bundled into
// dist/page.bundle.js by esbuild). Same sanctioned-exception rationale as utils/compendium-sources.ts.

/** CONFIG.DND5E.damageTypes (dnd5e 6.0.1 `config.mjs`) — the 13 real damage types. */
export const DAMAGE_TYPES = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

/** CONFIG.DND5E.validProperties.weapon (dnd5e 5.3.3) — the 17 weapon property codes. */
export const WEAPON_PROPERTIES = new Set([
  'ada',
  'amm',
  'fin',
  'fir',
  'foc',
  'hvy',
  'lgt',
  'lod',
  'mgc',
  'rch',
  'rel',
  'ret',
  'sil',
  'spc',
  'thr',
  'two',
  'ver',
]);

/** The 15 dnd5e conditions (status effects). */
export const CONDITIONS = new Set([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

// ---------------------------------------------------------------------------------------------
// dnd5e 6.0.1 ActiveEffect vocabularies — HARD validation (a wrong value here is a silent no-op
// in the live world). Read from the 6.0.1 source; effect-changes.test.ts locks them.
// ---------------------------------------------------------------------------------------------

/** Filter operator functions (`module/filter.mjs` OPERATOR_FUNCTIONS): `v` is a filter list (NOT: one). */
export const FILTER_OPERATORS = ['AND', 'NAND', 'OR', 'NOR', 'XOR', 'NOT'] as const;

/** Filter comparison functions (COMPARISON_FUNCTIONS); `exact` when `o` is omitted. */
export const FILTER_COMPARISONS = [
  'exact',
  'contains',
  'icontains',
  'startswith',
  'istartswith',
  'endswith',
  'iendswith',
  'empty',
  'has',
  'hasany',
  'hasall',
  'subsetof',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;

/** Rules-type change types (CONFIG.DND5E.activeEffectChangeTypes) — evaluated at roll time. */
export const RULE_TYPES = [
  'dnd5e.advantage',
  'dnd5e.bonus',
  'dnd5e.maximum',
  'dnd5e.minimum',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** Roll categories a rules change targets via `key` (AppliedRules / wiki *Active-Effect-Rules*). */
export const RULE_KEYS = ['attack', 'check', 'd20', 'save', 'damage', 'healing'] as const;

/** `dnd5e.advantage` values (RulesIterator#toAdvantageCounts; `1` / `=1` are accepted aliases). */
export const ADVANTAGE_VALUES = ['+1', '-1', '=+1', '=-1', '>=0', '<=0'] as const;

/** Per-change `replacement` (ActiveEffectDataModel): substitute the origin's / target's roll data. */
export const EFFECT_REPLACEMENTS = ['origin', 'target'] as const;

/**
 * Core combat expiry events (CONST.ACTIVE_EFFECT_EXPIRY_EVENTS): a core expiry with no value
 * expires at the first matching event; with a value, at the first matching event after the value
 * elapses.
 */
export const CORE_EXPIRY_EVENTS = [
  'combatStart',
  'roundStart',
  'turnStart',
  'combatEnd',
  'roundEnd',
  'turnEnd',
] as const;

/**
 * dnd5e expiry events: registered shortRest / longRest (CONFIG.DND5E.expiryEvents) + the pseudo
 * source/target-turn expiries (ActiveEffect5e.PSEUDO_EXPIRIES). All six are duration-less — the
 * system nulls `duration.value` for them on create/update.
 */
export const DND5E_EXPIRY_EVENTS = [
  'shortRest',
  'longRest',
  'sourceStart',
  'sourceEnd',
  'targetStart',
  'targetEnd',
] as const;

/** Every `duration.expiry` an effect (or an activity's applied effect) may carry. */
export const EXPIRY_EVENTS = [...CORE_EXPIRY_EVENTS, ...DND5E_EXPIRY_EVENTS] as const;

/**
 * Activity / item `duration.units` (CONFIG.DND5E.timePeriods): the SCALAR units take a value
 * (`second` and `week` are `option: false` in `timeUnits`, so dnd5e nulls a value given with them);
 * the special (inst spec) and permanent (disp dstr perm) ones take none.
 */
export const ACTIVITY_DURATION_SCALAR_UNITS = [
  'turn',
  'round',
  'minute',
  'hour',
  'day',
  'month',
  'year',
] as const;
export const ACTIVITY_DURATION_UNITS = [
  'inst',
  'spec',
  ...ACTIVITY_DURATION_SCALAR_UNITS,
  'disp',
  'dstr',
  'perm',
] as const;

// ---------------------------------------------------------------------------------------------
// dnd5e 6.0.1 area + behavior vocabularies (CONFIG.DND5E.*; read from the 6.0.1 source)
// ---------------------------------------------------------------------------------------------

/** Behaviors an activity's area template can carry (CONFIG.DND5E.activityBehaviorTypes). */
export const ACTIVITY_BEHAVIOR_TYPES = ['applyActiveEffect', 'difficultTerrain'] as const;

/** Creature sizes (CONFIG.DND5E.actorSizes keys). */
export const ACTOR_SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'] as const;

/** Creature types (CONFIG.DND5E.creatureTypes keys). */
export const CREATURE_TYPE_KEYS = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;

/** Difficult-terrain kinds (CONFIG.DND5E.difficultTerrainTypes) — a creature may ignore some. */
export const DIFFICULT_TERRAIN_TYPES = [
  'ice',
  'liquid',
  'mud',
  'plants',
  'rocks',
  'sand',
  'slope',
  'snow',
  'web',
] as const;

/** Area template shapes (CONFIG.DND5E.areaTargetTypes keys). */
export const AREA_TEMPLATE_TYPES = [
  'circle',
  'cone',
  'cube',
  'cylinder',
  'line',
  'radius',
  'ring',
  'sphere',
  'square',
  'wall',
] as const;

/** Who an activity affects (CONFIG.DND5E.individualTargetTypes keys). */
export const TARGET_AFFECTS_TYPES = [
  'self',
  'ally',
  'enemy',
  'creature',
  'object',
  'space',
  'creatureOrObject',
  'any',
  'willing',
] as const;

/** Token dispositions a region behavior filters on (CONST.TOKEN_DISPOSITIONS minus SECRET). */
export const BEHAVIOR_DISPOSITIONS = ['hostile', 'neutral', 'friendly'] as const;

/** Transform activity profile modes (transform-sheet.mjs): direct link '' · by CR 'cr' · select form 'form'. */
export const TRANSFORM_MODES = ['direct', 'cr', 'form'] as const;

/** Transform settings presets (CONFIG.DND5E.transformation.presets). */
export const TRANSFORM_PRESETS = ['wildshape', 'polymorph', 'polymorphSelf'] as const;

/** Movement types a CR-mode transform profile can restrict (CONFIG.DND5E.movementTypes keys). */
export const MOVEMENT_TYPES = ['walk', 'burrow', 'climb', 'fly', 'jump', 'swim'] as const;

/** Transform custom settings — what the transformed actor KEEPS from its original self (CONFIG.DND5E.transformation.keep). */
export const TRANSFORM_KEEP_KEYS = [
  'physical',
  'mental',
  'saves',
  'skills',
  'gearProf',
  'languages',
  'class',
  'feats',
  'items',
  'spells',
  'bio',
  'type',
  'hp',
  'tempHP',
  'resistances',
  'vision',
  'self',
] as const;

/** Transform custom settings — proficiencies MERGED (best of both) (CONFIG.DND5E.transformation.merge). */
export const TRANSFORM_MERGE_KEYS = ['saves', 'skills'] as const;

/** Transform custom settings — which of the original's effects carry over (CONFIG.DND5E.transformation.effects). */
export const TRANSFORM_EFFECT_KEYS = [
  'all',
  'origin',
  'otherOrigin',
  'background',
  'class',
  'feat',
  'equipment',
  'spell',
] as const;

/** dnd5e.rotateArea: which way the area turns to reach the next stop (RotateAreaRegionBehaviorType.DIRECTION_MODES). */
export const ROTATE_DIRECTIONS = ['short', 'long', 'cw', 'ccw'] as const;

/** dnd5e.rotateArea: fixed = the whole turn takes `timeMs`; variable = `timeMs` per 90° (SPEED_MODES). */
export const ROTATE_SPEED_MODES = ['fixed', 'variable'] as const;
