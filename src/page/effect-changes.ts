// Pure, offline-tested helpers for dnd5e / Foundry-v14 ActiveEffect `changes[]` + duration mapping.
// Extracted from the live effects.ts orchestrator (mirroring the activities.ts ↔ manage-activity.ts
// split) so the version-coupled field math — the legacy numeric `mode` → v14 string `type`
// migration, the change shape, the v14 duration shape, the 6.0 Filter / rules / expiry vocabularies —
// is unit-tested OFFLINE. A Foundry/dnd5e schema bump that renumbers the modes or moves these fields
// then fails effect-changes.test.ts here, instead of silently mis-authoring effects in a live world
// (which the seam-mocked / verify-script paths would not catch).
//
// Foundry 14.367 / dnd5e 6.0.1 facts (read from the core + system source; locked by the tests):
//  - `changes[]` lives at `effect.system.changes` (core ActiveEffectTypeDataModel). The top-level
//    `effect.changes` is a deprecated read shim / write migration (until v16) — never rely on it.
//  - A change is { key, value, type, phase, priority? }: `type` is a STRING (override/add/subtract/
//    multiply/upgrade/downgrade/custom); the legacy numeric `mode` (CONST.ACTIVE_EFFECT_MODES) is
//    normalized to it. `value` is stored as a string; `phase` defaults to "initial". dnd5e adds
//    per-change `_id` (defaulted), `conditions` (a Filter JSON string) and `replacement`
//    ('' | origin | target).
//  - dnd5e 6.0 RULES changes: type ∈ dnd5e.advantage | dnd5e.bonus | dnd5e.maximum | dnd5e.minimum
//    (CONFIG.DND5E.activeEffectChangeTypes). Their `key` is a roll CATEGORY (attack / check / d20 /
//    save for every type; damage / healing for bonus only — AppliedRules + the wiki), NOT a data
//    path: a core-type change on `key: "attack"` is a pruned write to nowhere, and a rules type on a
//    real data path never fires. They carry `skipConditions: true`, so their per-change `conditions`
//    are evaluated at ROLL time (RulesIterator#filterWith) — the only place `roll.*` keys exist.
//  - Effect-level conditions (`system.conditions`) and per-change conditions are the system's Filter
//    JSON (module/filter.mjs): a comparison { k, v, o? } (o ∈ COMPARISON_FUNCTIONS, default exact),
//    an operator { o: AND|NAND|OR|NOR|XOR, v: Filter[] } / { o: NOT, v: Filter }, or an array
//    (implicit AND). FiltersField extends JSONField (initial "{}") — persisted as a STRING.
//  - Duration is { value, units, expiry? }: units ∈ seconds | minutes | hours | days | months |
//    years | rounds | turns (CONST.ACTIVE_EFFECT_DURATION_UNITS); the 5.x `{ rounds | turns |
//    seconds: N }` keys are translated (core migrates them too).
//    Expiry ∈ core CONST.ACTIVE_EFFECT_EXPIRY_EVENTS (combatStart roundStart turnStart combatEnd
//    roundEnd turnEnd) — a core expiry with no value expires at the first matching event; with a
//    value, at the first matching event after the value elapses (ActiveEffectRegistry#refresh:
//    `durationReached = remaining <= 0 || !Number.isFinite(remaining)`, and `_prepareDuration`
//    yields remaining: Infinity when no value is set) — plus dnd5e's registered shortRest /
//    longRest, and the pseudo sourceStart / sourceEnd / targetStart / targetEnd
//    (ActiveEffect5e.PSEUDO_EXPIRIES) — the last six are DURATION-LESS (the system nulls
//    `duration.value` on create/update), so a value given with them is dropped here.

import {
  ADVANTAGE_VALUES,
  DND5E_EXPIRY_EVENTS,
  EFFECT_REPLACEMENTS,
  EXPIRY_EVENTS,
  FILTER_COMPARISONS,
  FILTER_OPERATORS,
  RULE_KEYS,
  RULE_TYPES,
  type RuleType,
} from '../utils/dnd5e-canonical.js';

/** Legacy numeric ActiveEffect mode → v14 string type (CONST.ACTIVE_EFFECT_MODES). */
const MODE_NUM_TO_TYPE: Record<number, string> = {
  0: 'custom',
  1: 'multiply',
  2: 'add',
  3: 'downgrade',
  4: 'upgrade',
  5: 'override',
};

/** Core change types (CONST.ACTIVE_EFFECT_CHANGE_TYPES). */
const CORE_CHANGE_TYPES = new Set([
  'custom',
  'multiply',
  'add',
  'subtract',
  'downgrade',
  'upgrade',
  'override',
]);

/** Core change phases (CONST.ACTIVE_EFFECT_CHANGE_PHASES). */
const CHANGE_PHASES = new Set(['initial', 'final']);

// ---------------------------------------------------------------------------------------------
// Filters (dnd5e 6.0 `module/filter.mjs`) — the condition vocabulary
// ---------------------------------------------------------------------------------------------

/** Comparisons whose `v` must be a list. */
const LIST_COMPARISONS = new Set(['in', 'hasany', 'hasall', 'subsetof']);
/** Comparisons whose `v` must be a number. */
const NUMERIC_COMPARISONS = new Set(['gt', 'gte', 'lt', 'lte']);

/** Where a Filter is being authored — `roll.*` keys only exist at roll time (change scope). */
export type FilterScope = 'effect' | 'change';

/** The persisted form of "no conditions" (FiltersField initial). */
export const EMPTY_CONDITIONS = '{}';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate + normalize an authored Filter (object, array, or JSON string) into the persisted JSON
 * string. `null` / `undefined` / `''` / `{}` / `[]` mean "no conditions" → "{}". Throws a message
 * naming the offending node for an unknown operator/comparison, a comparison without a key, an
 * operator with the wrong `v` shape, a list/number comparison with the wrong value type, or a
 * `roll.*` key in effect scope. Only `k` / `o` / `v` survive normalization.
 */
export function normalizeConditions(input: unknown, scope: FilterScope): string {
  let def: unknown = input;
  if (typeof def === 'string') {
    const trimmed = def.trim();
    if (trimmed === '') return EMPTY_CONDITIONS;
    try {
      def = JSON.parse(trimmed);
    } catch {
      throw new Error(`conditions is not valid Filter JSON: ${trimmed.slice(0, 80)}`);
    }
  }
  if (def === undefined || def === null) return EMPTY_CONDITIONS;
  if (Array.isArray(def) && def.length === 0) return EMPTY_CONDITIONS;
  if (isPlainObject(def) && Object.keys(def).length === 0) return EMPTY_CONDITIONS;
  return JSON.stringify(normalizeFilterNode(def, scope, 'conditions'));
}

function normalizeFilterNode(node: unknown, scope: FilterScope, path: string): unknown {
  if (Array.isArray(node)) {
    if (node.length === 0) throw new Error(`${path}: an empty filter list matches nothing useful.`);
    return node.map((n, i) => normalizeFilterNode(n, scope, `${path}[${i}]`));
  }
  if (!isPlainObject(node)) {
    throw new Error(`${path}: a filter must be an object { k, v, o? } or an operator { o, v }.`);
  }
  const o = node.o;
  if (o !== undefined && typeof o !== 'string') {
    throw new Error(`${path}.o: must be a string (operator or comparison name).`);
  }
  if (o !== undefined && (FILTER_OPERATORS as readonly string[]).includes(o)) {
    if (o === 'NOT') {
      if (!isPlainObject(node.v)) {
        throw new Error(`${path}: NOT takes a single filter object as v.`);
      }
      return { o, v: normalizeFilterNode(node.v, scope, `${path}.v`) };
    }
    if (!Array.isArray(node.v) || node.v.length === 0) {
      throw new Error(`${path}: ${o} takes a non-empty array of filters as v.`);
    }
    return { o, v: node.v.map((n, i) => normalizeFilterNode(n, scope, `${path}.v[${i}]`)) };
  }
  const op = o ?? 'exact';
  if (!(FILTER_COMPARISONS as readonly string[]).includes(op)) {
    throw new Error(
      `${path}.o: unknown operator "${op}". Comparisons: ${FILTER_COMPARISONS.join(' ')}; ` +
        `operators: ${FILTER_OPERATORS.join(' ')}.`
    );
  }
  const k = node.k;
  if (typeof k !== 'string' || k.trim() === '') {
    throw new Error(`${path}.k: a comparison needs a key path (e.g. "statuses.bloodied").`);
  }
  if (scope === 'effect' && /^roll\./.test(k)) {
    throw new Error(
      `${path}.k: "${k}" — roll.* keys are only available on the conditions of a RULES-type change ` +
        `(${RULE_TYPES.join(' / ')}), which alone are evaluated at roll time; an effect-level ` +
        'condition (or a core-type change, evaluated at data preparation) cannot see the roll.'
    );
  }
  let v = node.v;
  if (op === 'empty') {
    if (v === undefined) v = true;
    else if (typeof v !== 'boolean') throw new Error(`${path}.v: "empty" takes true/false.`);
  } else if (v === undefined) {
    throw new Error(`${path}.v: a "${op}" comparison needs a value.`);
  }
  if (LIST_COMPARISONS.has(op) && !Array.isArray(v)) {
    throw new Error(`${path}.v: "${op}" takes a list of values.`);
  }
  if (NUMERIC_COMPARISONS.has(op) && typeof v !== 'number') {
    throw new Error(`${path}.v: "${op}" takes a number.`);
  }
  if (op === 'has' && isPlainObject(v)) v = normalizeFilterNode(v, scope, `${path}.v`);
  const out: Record<string, unknown> = { k: k.trim() };
  if (o !== undefined) out.o = op;
  out.v = v;
  return out;
}

/** Parse a persisted Filter JSON string for read-back; null when absent, empty, or unparseable. */
export function parseConditions(json: unknown): unknown | null {
  if (json === undefined || json === null) return null;
  if (typeof json !== 'string') return isEmptyFilter(json) ? null : json;
  const trimmed = json.trim();
  if (trimmed === '' || trimmed === EMPTY_CONDITIONS) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isEmptyFilter(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

const isEmptyFilter = (v: unknown): boolean =>
  (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);

const COMPARISON_WORDS: Record<string, string> = {
  exact: '=',
  contains: 'contains',
  icontains: 'contains (any case)',
  startswith: 'starts with',
  istartswith: 'starts with (any case)',
  endswith: 'ends with',
  iendswith: 'ends with (any case)',
  has: 'has',
  hasany: 'has any of',
  hasall: 'has all of',
  subsetof: 'is a subset of',
  in: 'in',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

/** Render a Filter (parsed) as a short human-readable clause, e.g. `roll.ability = str`. */
export function describeFilter(node: unknown): string {
  if (Array.isArray(node)) {
    const parts = node.map(describeFilter);
    return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
  }
  if (!isPlainObject(node)) return String(node);
  const o = typeof node.o === 'string' ? node.o : 'exact';
  if ((FILTER_OPERATORS as readonly string[]).includes(o)) {
    if (o === 'NOT') return `NOT ${describeFilter(node.v)}`;
    const parts = Array.isArray(node.v) ? node.v.map(describeFilter) : [];
    return `(${parts.join(` ${o} `)})`;
  }
  const k = String(node.k ?? '?');
  if (o === 'empty') return node.v === false ? `${k} is not empty` : `${k} is empty`;
  return `${k} ${COMPARISON_WORDS[o] ?? o} ${describeFilterValue(node.v)}`;
}

function describeFilterValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(describeFilterValue).join(', ')}]`;
  if (isPlainObject(v)) return describeFilter(v);
  return String(v);
}

// ---------------------------------------------------------------------------------------------
// Rules-type changes (dnd5e 6.0 CONFIG.DND5E.activeEffectChangeTypes)
// ---------------------------------------------------------------------------------------------

/** Categories that accept every rule type; damage / healing accept `dnd5e.bonus` only. */
const D20_RULE_KEYS = new Set(['attack', 'check', 'd20', 'save']);

const ADVANTAGE_ALIASES: Record<string, string> = { '1': '+1', '=1': '=+1' };

export const isRuleType = (type: unknown): type is RuleType =>
  typeof type === 'string' && (RULE_TYPES as readonly string[]).includes(type);

const CATEGORY_LABEL: Record<string, string> = {
  attack: 'attack rolls',
  check: 'ability checks',
  d20: 'd20 tests',
  save: 'saving throws',
  damage: 'damage rolls',
  healing: 'healing rolls',
};

/** A dice term (`1d4`, `d20`, `2d6[fire]`) — not allowed in a deterministic min/max formula. */
const DICE_TERM = /\d*d(\d+|%)/i;

/**
 * Validate a rules change's key × type × value. Returns the normalized value (advantage aliases
 * folded to the canonical spelling). Throws on a non-category key, a damage/healing key with a
 * non-bonus type, an unknown advantage value, an empty bonus, or a dice term in a min/max.
 */
export function validateRuleChange(type: RuleType, key: string, value: string): string {
  if (!(RULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(
      `change type "${type}" is a rule: its key must be a roll category (${RULE_KEYS.join(' ')}), ` +
        `not "${key}".`
    );
  }
  if (!D20_RULE_KEYS.has(key) && type !== 'dnd5e.bonus') {
    throw new Error(
      `key "${key}" only supports dnd5e.bonus (advantage / minimum / maximum are d20-only).`
    );
  }
  const v = value.trim();
  if (type === 'dnd5e.advantage') {
    const canon = ADVANTAGE_ALIASES[v] ?? v;
    if (!(ADVANTAGE_VALUES as readonly string[]).includes(canon)) {
      throw new Error(
        `dnd5e.advantage value must be one of ${ADVANTAGE_VALUES.join(' ')} (got "${value}").`
      );
    }
    return canon;
  }
  if (v === '') throw new Error(`change type "${type}" needs a value (e.g. "1d4", "2", "@prof").`);
  if ((type === 'dnd5e.minimum' || type === 'dnd5e.maximum') && DICE_TERM.test(v)) {
    throw new Error(
      `${type} takes a deterministic formula (a number or @prof), not dice ("${value}").`
    );
  }
  return v;
}

/** True when any comparison in a (parsed) Filter tree keys off `roll.*`. */
function referencesRollData(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(referencesRollData);
  if (!isPlainObject(node)) return false;
  if (typeof node.k === 'string' && /^roll\./.test(node.k)) return true;
  return referencesRollData(node.v);
}

/**
 * Why a PERSISTED change is a dead rule — a rules type on a non-category key / a damage-healing
 * key with a non-bonus type / an advantage value outside the vocabulary, a core type on a roll
 * category (a write to nowhere), or a core type whose conditions key off `roll.*` (R1-012: only a
 * rules change is evaluated at roll time; a core change's conditions run at data preparation with
 * no roll data, so such a condition never holds). Undefined when the change is fine. Used by
 * content-audit.
 */
export function ruleChangeProblem(c: {
  type?: unknown;
  mode?: unknown;
  key?: unknown;
  value?: unknown;
  conditions?: unknown;
}): string | undefined {
  const type =
    typeof c?.type === 'string'
      ? c.type
      : typeof c?.mode === 'number'
        ? (MODE_NUM_TO_TYPE[c.mode] ?? 'add')
        : 'add';
  const key = String(c?.key ?? '');
  if (isRuleType(type)) {
    try {
      validateRuleChange(type, key, String(c?.value ?? ''));
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return undefined;
  }
  if ((RULE_KEYS as readonly string[]).includes(key)) {
    return (
      `key "${key}" is a roll category but type "${type}" is a core change type — it writes to ` +
      `nowhere; use ${RULE_TYPES.join(' / ')}.`
    );
  }
  if (referencesRollData(parseConditions(c?.conditions))) {
    return (
      `type "${type}" is a core change type but its conditions key off roll.* — a core change is ` +
      'evaluated at data preparation, where there is no roll data, so the condition never holds; ' +
      `use a rules type (${RULE_TYPES.join(' / ')}) on a roll category.`
    );
  }
  return undefined;
}

/** Human-readable rendering of a rules change (+ its condition clause), for read-back. */
export function describeRule(c: {
  type?: unknown;
  key?: unknown;
  value?: unknown;
  conditions?: unknown;
}): string | undefined {
  if (!isRuleType(c.type)) return undefined;
  const on = CATEGORY_LABEL[String(c.key)] ?? `${String(c.key)} rolls`;
  const v = String(c.value ?? '').trim();
  let text: string;
  switch (c.type) {
    case 'dnd5e.advantage': {
      const canon = ADVANTAGE_ALIASES[v] ?? v;
      const words: Record<string, string> = {
        '+1': 'advantage',
        '-1': 'disadvantage',
        '=+1': 'forced advantage',
        '=-1': 'forced disadvantage',
        '>=0': 'immune to disadvantage',
        '<=0': 'immune to advantage',
      };
      text = `${words[canon] ?? `advantage mode ${v}`} on ${on}`;
      break;
    }
    case 'dnd5e.bonus':
      text = `${v.startsWith('-') ? v : `+${v}`} to ${on}`;
      break;
    case 'dnd5e.minimum':
      text = `d20 minimum ${v} on ${on}`;
      break;
    default:
      text = `d20 maximum ${v} on ${on}`;
  }
  const cond = parseConditions(c.conditions);
  return cond ? `${text} when ${describeFilter(cond)}` : text;
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

const REPLACEMENTS = new Set<string>(['', ...EFFECT_REPLACEMENTS]);

/**
 * Normalize an authored change to the v14 { key, value(string), type, phase } shape, plus the
 * dnd5e 6.0 extras when given: `conditions` (validated Filter → JSON string — change scope, so
 * `roll.*` is available, ONLY for a rules type; effect scope otherwise), `replacement`
 * (origin | target), `priority`. Rules types are validated (key × type × value).
 */
export function normalizeChange(c: any): Record<string, unknown> {
  const type =
    typeof c?.type === 'string'
      ? c.type
      : typeof c?.mode === 'number'
        ? (MODE_NUM_TO_TYPE[c.mode] ?? 'add')
        : 'add';
  if (!CORE_CHANGE_TYPES.has(type) && !isRuleType(type)) {
    throw new Error(
      `change.type "${type}" is not a change type. Core: ${[...CORE_CHANGE_TYPES].join(' ')}; ` +
        `dnd5e rules: ${RULE_TYPES.join(' ')}.`
    );
  }
  const key = String(c?.key ?? '');
  let value = c?.value === undefined || c?.value === null ? '' : String(c.value);
  if (isRuleType(type)) {
    value = validateRuleChange(type, key, value);
  } else if ((RULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(
      `key "${key}" is a roll category — it only works with a rules change type ` +
        `(${RULE_TYPES.join(' ')}), not "${type}" (which writes to a data path).`
    );
  }
  let phase = 'initial';
  if (typeof c?.phase === 'string' && c.phase !== '') {
    if (!CHANGE_PHASES.has(c.phase)) {
      throw new Error(`change.phase must be "initial" or "final" (got "${c.phase}").`);
    }
    phase = c.phase;
  }
  const out: Record<string, unknown> = { key, value, type, phase };
  if (typeof c?.priority === 'number' && Number.isFinite(c.priority)) out.priority = c.priority;
  if (c?.conditions !== undefined) {
    // R1-012: only a RULES-type change is evaluated at roll time (skipConditions: true), so only
    // there do `roll.*` keys exist. A core-type change's conditions are evaluated at data-prep with
    // no roll data — validate those in 'effect' scope so roll.* is refused with a naming message.
    const conditions = normalizeConditions(c.conditions, isRuleType(type) ? 'change' : 'effect');
    if (conditions !== EMPTY_CONDITIONS) out.conditions = conditions;
  }
  if (c?.replacement !== undefined && c?.replacement !== null) {
    const r = String(c.replacement);
    if (!REPLACEMENTS.has(r)) {
      throw new Error(`change.replacement must be "origin" or "target" (got "${r}").`);
    }
    if (r !== '') out.replacement = r;
  }
  return out;
}

/**
 * Summarize an effect's changes for list/read output (surfacing type from legacy mode if needed).
 * dnd5e 6.0 extras appear only when present: parsed `conditions`, `replacement`, and for a rules
 * change a readable `rule` ("+1d4 to attack rolls when roll.attack.type = ranged").
 */
export function summarizeChanges(changes: any[]): Array<Record<string, unknown>> {
  return (changes ?? []).map((c: any) => {
    const type = typeof c?.type === 'string' ? c.type : (MODE_NUM_TO_TYPE[c?.mode] ?? undefined);
    const out: Record<string, unknown> = { key: c?.key, value: c?.value, type };
    const conditions = parseConditions(c?.conditions);
    if (conditions) out.conditions = conditions;
    if (typeof c?.replacement === 'string' && c.replacement !== '') out.replacement = c.replacement;
    const rule = describeRule({ ...c, type });
    if (rule) out.rule = rule;
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// Duration + expiry
// ---------------------------------------------------------------------------------------------

/** v14 duration units (CONST.ACTIVE_EFFECT_DURATION_UNITS) accepted as `duration.units`. */
const DURATION_UNITS = new Set([
  'seconds',
  'minutes',
  'hours',
  'days',
  'months',
  'years',
  'rounds',
  'turns',
]);

/** The dnd5e rest / source / target expiries carry no duration (the system nulls the value). */
const DURATIONLESS_EXPIRIES = new Set<string>(DND5E_EXPIRY_EVENTS);

/**
 * Normalize an authored duration to the v14 { value, units[, expiry] } shape. Accepts the native
 * shape as-is (unknown keys pass through) and translates the 5.x { rounds | turns | seconds: N }
 * keys — first one wins, matching core's own #migrateDuration. Throws on an unknown `units`.
 * Validates `expiry` against the 6.0 vocabulary: a core expiry with no value expires at the first
 * matching event, with a value at the first matching event after the value elapses; the dnd5e rest
 * / source / target expiries are duration-less, so any value given with them is dropped (the
 * system nulls it anyway). Returns undefined when nothing usable was given.
 */
export function normalizeDuration(d: any): Record<string, unknown> | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'seconds' || k === 'turns' || k === 'rounds') continue;
    out[k] = v;
  }
  if (typeof out.value !== 'number') {
    for (const unit of ['seconds', 'turns', 'rounds'] as const) {
      const v = d[unit];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.value = v;
        if (typeof out.units !== 'string') out.units = unit;
        break;
      }
    }
  }
  if (typeof out.units === 'string' && !DURATION_UNITS.has(out.units)) {
    throw new Error(
      `duration.units "${out.units}" is not a Foundry duration unit. Use one of: ` +
        `${[...DURATION_UNITS].join(' ')}.`
    );
  }
  if (out.expiry !== undefined && out.expiry !== null) {
    const expiry = String(out.expiry);
    if (!(EXPIRY_EVENTS as readonly string[]).includes(expiry)) {
      throw new Error(
        `duration.expiry "${expiry}" is not an expiry event. Use one of: ${EXPIRY_EVENTS.join(' ')}.`
      );
    }
    if (DURATIONLESS_EXPIRIES.has(expiry)) {
      delete out.value;
      delete out.units;
    }
    out.expiry = expiry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Project a (live or source) effect duration into the shape the tool layer reads back: the v14
 * `{ value, units, expiry?, remaining? }` when a finite value is set, `{ expiry, remaining? }` for
 * a value-less expiry (which still expires at the first matching event), and null for a permanent
 * / passive effect. `remaining` is only included when it is a finite number — a duration-less
 * effect's prepared `remaining` is Infinity, which does not survive JSON.
 */
export function projectDuration(dur: any): Record<string, unknown> | null {
  if (!dur || typeof dur !== 'object') return null;
  const remaining =
    typeof dur.remaining === 'number' && Number.isFinite(dur.remaining)
      ? { remaining: dur.remaining }
      : {};
  if (typeof dur.value === 'number' && Number.isFinite(dur.value)) {
    return {
      value: dur.value,
      units: typeof dur.units === 'string' ? dur.units : 'seconds',
      ...(dur.expiry ? { expiry: dur.expiry } : {}),
      ...remaining,
    };
  }
  return dur.expiry ? { expiry: dur.expiry, ...remaining } : null;
}

/**
 * Translate a patch's dot-paths: the 5.x `duration.rounds|turns|seconds` keys become
 * `duration.value` + `duration.units`; everything else passes through unchanged.
 */
export function normalizePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    const m = /^duration\.(rounds|turns|seconds)$/.exec(k);
    if (m && typeof v === 'number') {
      out['duration.value'] = v;
      out['duration.units'] = m[1];
    } else {
      out[k] = v;
    }
  }
  return out;
}
