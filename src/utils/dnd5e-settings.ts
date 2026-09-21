// THE single source of truth for the dnd5e 6.0 AUTOMATION settings the configure-dnd5e-settings tool
// may read and set (the owner's 2026-09-15 decision: read + set, allow-listed, GM-only, every write
// reports old → new). Read from the 6.0.1 `module/settings.mjs` + `data/settings/*.mjs`; nothing
// outside this catalogue is reachable — a blob "set any setting" tool would put correctness on the
// caller (see src/page/combat-tracker.ts for the standing rationale).
//
// Intentionally PURE — no imports, no Node or Foundry globals — shared by the Node-side tool (zod
// contract + rendering) and the page-side reader/writer (bundled into dist/page.bundle.js).

export type Dnd5eSettingKind = 'boolean' | 'choice' | 'integer';

export interface Dnd5eSettingSpec {
  /** The tool-facing key. */
  key: string;
  label: string;
  kind: Dnd5eSettingKind;
  /** Fixed choices (kind 'choice'); `liveChoices` names a CONFIG list resolved on the page instead. */
  choices?: readonly string[] | undefined;
  liveChoices?: 'calendars' | undefined;
  /**
   * The choice that means "unset / automatic". It is NOT a storable value: the underlying
   * StringField declares `choices`, which makes core default `blank` to FALSE (foundry.mjs
   * StringField constructor), so writing "" throws `may not be a blank string` through
   * ClientSettings#set's DataModel validation. The page reads an absent/blank source AS this value
   * and, on a write, OMITS the key from the DataModel object instead of writing "".
   */
  omitWhenChoice?: string | undefined;
  /** Where it lives: the registered dnd5e setting, plus a field path for a DataModel setting. */
  setting: string;
  path?: string | undefined;
  /** dnd5e registers it with requiresReload — the change takes effect after clients reload. */
  requiresReload?: boolean | undefined;
  /** Client-scoped (per user) — reported, never written (a write would only touch the bridge user). */
  readOnly?: boolean | undefined;
  hint: string;
}

export const DND5E_SETTINGS: readonly Dnd5eSettingSpec[] = [
  // --- automation ---
  {
    key: 'disableFalling',
    label: 'Disable falling automation',
    kind: 'boolean',
    setting: 'disableFalling',
    hint: 'true turns OFF fall damage / falling from Levels (default false — falling is automated).',
  },
  {
    key: 'tokenSizeSync',
    label: 'Sync token size to creature size',
    kind: 'boolean',
    setting: 'tokenSizeSync',
    requiresReload: true,
    hint: 'A Large creature gets a 2×2 token automatically (default true).',
  },
  {
    key: 'senseVisionSync',
    label: 'Sync senses to token vision',
    kind: 'boolean',
    setting: 'senseVisionSync',
    hint: 'Darkvision / blindsight on the sheet drive the token vision modes (default true).',
  },
  {
    key: 'disableExhaustion',
    label: 'Disable exhaustion automation',
    kind: 'boolean',
    setting: 'disableExhaustion',
    requiresReload: true,
    hint: 'true turns OFF the exhaustion d20 penalties (default false).',
  },
  {
    key: 'movementAutomation',
    label: 'Movement automation',
    kind: 'choice',
    choices: ['full', 'noBlocking', 'none'],
    setting: 'movementAutomation',
    hint: 'full (default — difficult terrain + creature blocking) · noBlocking (terrain only) · none.',
  },
  {
    key: 'disableConcentration',
    label: 'Disable concentration tracking',
    kind: 'boolean',
    setting: 'disableConcentration',
    hint: 'true turns OFF automatic concentration effects + prompts (default false).',
  },
  // --- combat ---
  {
    key: 'initiativeGroupCombatants',
    label: 'Group identical combatants in the tracker',
    kind: 'boolean',
    setting: 'initiativeGroupCombatants',
    hint: 'Six goblins share one tracker row (default true).',
  },
  {
    key: 'initiativeGroupRoll',
    label: 'Roll initiative once per group',
    kind: 'boolean',
    setting: 'initiativeGroupRoll',
    hint: 'A grouped set of combatants rolls one initiative (default true).',
  },
  {
    key: 'autoApplyDowned',
    label: 'Auto-apply Unconscious / Dead at 0 HP',
    kind: 'choice',
    choices: ['none', 'deadOnly', 'npcs', 'all'],
    setting: 'autoApplyDowned',
    hint: 'none (default) · deadOnly (NPCs die at 0) · npcs (NPCs die, PCs go unconscious) · all.',
  },
  {
    key: 'encounterPlacementBehavior',
    label: 'When an encounter is placed on the map',
    kind: 'choice',
    choices: ['none', 'createCombatants', 'rollInitiative'],
    setting: 'encounterPlacementBehavior',
    hint: 'none (default) · createCombatants (add them to the tracker) · rollInitiative (and roll).',
  },
  {
    key: 'bloodied',
    label: 'Who sees the Bloodied status',
    kind: 'choice',
    choices: ['all', 'player', 'none'],
    setting: 'bloodied',
    hint: 'all (every token) · player (default — only tokens the players own/see) · none (off).',
  },
  // --- player permissions ---
  {
    key: 'allowPlayerDamageTray',
    label: 'Players may use the damage tray',
    kind: 'boolean',
    setting: 'allowPlayerDamageTray',
    hint: 'Players apply damage from chat cards to their own tokens (default false).',
  },
  {
    key: 'allowPlayerEffectsTray',
    label: 'Players may use the effects tray',
    kind: 'boolean',
    setting: 'allowPlayerEffectsTray',
    hint: 'Players apply effects from chat cards to their own tokens (default false).',
  },
  {
    key: 'allowPolymorphing',
    label: 'Players may polymorph / transform actors',
    kind: 'boolean',
    setting: 'allowPolymorphing',
    hint: 'Players run the transform flow on actors they own (default false — GM-only).',
  },
  {
    key: 'allowSummoning',
    label: 'Players may summon',
    kind: 'boolean',
    setting: 'allowSummoning',
    hint: 'Players place summons from their own summon activities (default false — GM-only).',
  },
  // --- optional rules ---
  {
    key: 'pietyScore',
    label: 'Piety score (optional rule)',
    kind: 'boolean',
    setting: 'pietyScore',
    hint: 'Adds the Piety score to character sheets (default false; hidden from the settings menu).',
  },
  // --- bastions (a DataModel setting: bastionConfiguration) ---
  {
    key: 'bastionEnabled',
    label: 'Bastion system',
    kind: 'boolean',
    setting: 'bastionConfiguration',
    path: 'enabled',
    hint: 'Turns on bastion turns + the bastion tab (default false).',
  },
  {
    key: 'bastionDuration',
    label: 'Days per bastion turn',
    kind: 'integer',
    setting: 'bastionConfiguration',
    path: 'duration',
    hint: 'How many in-world days make one bastion turn (default 7).',
  },
  // --- calendar (calendarConfig DataModel + the calendar id) ---
  {
    key: 'calendarEnabled',
    label: 'Calendar',
    kind: 'boolean',
    setting: 'calendarConfig',
    path: 'enabled',
    hint: 'Turns on the date/time HUD, dawn / dusk / day recovery and bastion-turn progression (default false).',
  },
  {
    key: 'calendarDailyRecovery',
    label: 'Daily recovery mode',
    kind: 'choice',
    choices: ['auto', 'calendar', 'manual'],
    omitWhenChoice: 'auto',
    setting: 'calendarConfig',
    path: 'dailyRecovery',
    hint: 'auto (default: calendar when enabled, else manual) · calendar (on time advance) · manual ("New Day" in rest dialogs).',
  },
  {
    key: 'calendar',
    label: 'Calendar in use',
    kind: 'choice',
    liveChoices: 'calendars',
    setting: 'calendar',
    requiresReload: true,
    hint: 'gregorian (default) · greyhawk · harptos · khorvaire, or a module calendar (validated live).',
  },
  // --- client-scoped: reported only ---
  {
    key: 'chatCardSummary',
    label: 'Summarize chat cards (this client)',
    kind: 'boolean',
    setting: 'chatCardSummary',
    readOnly: true,
    hint: 'A CLIENT setting (per user) — reported for the bridge user, never written.',
  },
];

/** The keys a caller may SET (world-scoped only). */
export const DND5E_SETTABLE_KEYS = DND5E_SETTINGS.filter(s => !s.readOnly).map(s => s.key);

export interface Dnd5eSettingChange {
  key: string;
  previous: unknown;
  next: unknown;
  requiresReload: boolean;
}

/**
 * PURE: validate the requested values against the catalogue (+ live choice lists) and fold them
 * over the current values. Returns only the keys that actually change (re-applying the current
 * value is a clean no-op). Throws on an unknown key, a read-only key, a wrong kind, or a value
 * outside the choices.
 */
export function planDnd5eSettingChanges(
  current: Record<string, unknown>,
  requested: Record<string, unknown>,
  liveChoices: Partial<Record<NonNullable<Dnd5eSettingSpec['liveChoices']>, readonly string[]>> = {}
): Dnd5eSettingChange[] {
  const changes: Dnd5eSettingChange[] = [];
  for (const [key, value] of Object.entries(requested ?? {})) {
    if (value === undefined) continue;
    const spec = DND5E_SETTINGS.find(s => s.key === key);
    if (!spec) {
      throw new Error(
        `"${key}" is not a configurable dnd5e setting. Allowed: ${DND5E_SETTABLE_KEYS.join(', ')}.`
      );
    }
    if (spec.readOnly) throw new Error(`"${key}" is client-scoped — reported only, never written.`);
    if (spec.kind === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`"${key}" takes true / false.`);
    }
    if (spec.kind === 'integer' && !(Number.isInteger(value) && (value as number) >= 1)) {
      throw new Error(`"${key}" takes a positive whole number.`);
    }
    if (spec.kind === 'choice') {
      const choices =
        spec.choices ?? (spec.liveChoices ? (liveChoices[spec.liveChoices] ?? []) : []);
      if (typeof value !== 'string' || !choices.includes(value)) {
        throw new Error(
          `"${key}" must be one of ${choices.map(c => (c === '' ? '""' : c)).join(' | ')} (got "${String(value)}").`
        );
      }
    }
    if (current[key] === value) continue;
    changes.push({
      key,
      previous: current[key],
      next: value,
      requiresReload: !!spec.requiresReload,
    });
  }
  return changes;
}
