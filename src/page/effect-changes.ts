// Pure, offline-tested helpers for dnd5e / Foundry-v14 ActiveEffect `changes[]` + duration mapping.
// Extracted from the live effects.ts orchestrator (mirroring the activities.ts ↔ manage-activity.ts
// split) so the version-coupled field math — the legacy numeric `mode` → v14 string `type`
// migration, the change shape, the v14 duration shape — is unit-tested OFFLINE. A Foundry/dnd5e
// schema bump that renumbers the modes or moves these fields then fails effect-changes.test.ts
// here, instead of silently mis-authoring effects in a live world (which the seam-mocked /
// verify-script paths would not catch).
//
// Foundry 14.367 / dnd5e 6.0.1 facts (read from the core + system source; locked by the tests):
//  - `changes[]` lives at `effect.system.changes` (core ActiveEffectTypeDataModel). The top-level
//    `effect.changes` is a deprecated read shim / write migration (until v16) — never rely on it.
//  - A change is { key, value, type, phase, priority? }: `type` is a STRING (override/add/subtract/
//    multiply/upgrade/downgrade/custom); the legacy numeric `mode` (CONST.ACTIVE_EFFECT_MODES) is
//    normalized to it. `value` is stored as a string; `phase` defaults to "initial". dnd5e adds
//    per-change `_id` / `conditions` / `replacement` with defaults — nothing to author.
//  - Duration is { value, units, expiry? }: units ∈ seconds | minutes | hours | days | rounds |
//    turns; the 5.x `{ rounds | turns | seconds: N }` keys are translated (core migrates them too).

/** Legacy numeric ActiveEffect mode → v14 string type (CONST.ACTIVE_EFFECT_MODES). */
const MODE_NUM_TO_TYPE: Record<number, string> = {
  0: 'custom',
  1: 'multiply',
  2: 'add',
  3: 'downgrade',
  4: 'upgrade',
  5: 'override',
};

/** Normalize an authored change to the v14 { key, value(string), type, phase } shape. */
export function normalizeChange(c: any): Record<string, unknown> {
  const type =
    typeof c?.type === 'string'
      ? c.type
      : typeof c?.mode === 'number'
        ? (MODE_NUM_TO_TYPE[c.mode] ?? 'add')
        : 'add';
  return {
    key: String(c?.key ?? ''),
    value: c?.value === undefined || c?.value === null ? '' : String(c.value),
    type,
    phase: typeof c?.phase === 'string' ? c.phase : 'initial',
  };
}

/** Summarize an effect's changes for list/read output (surfacing type from legacy mode if needed). */
export function summarizeChanges(changes: any[]): Array<Record<string, unknown>> {
  return (changes ?? []).map((c: any) => ({
    key: c?.key,
    value: c?.value,
    type: typeof c?.type === 'string' ? c.type : (MODE_NUM_TO_TYPE[c?.mode] ?? undefined),
  }));
}

/** v14 duration units (CONST.ACTIVE_EFFECT_DURATION_UNITS) accepted as `duration.units`. */
const DURATION_UNITS = new Set(['seconds', 'minutes', 'hours', 'days', 'rounds', 'turns']);

/**
 * Normalize an authored duration to the v14 { value, units[, expiry] } shape. Accepts the native
 * shape as-is (unknown keys pass through) and translates the 5.x { rounds | turns | seconds: N }
 * keys — first one wins, matching core's own #migrateDuration. Returns undefined when nothing
 * usable was given.
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
    delete out.units; // let the field default (seconds) stand rather than fail validation
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
