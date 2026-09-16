import { describe, expect, it } from 'vitest';
import { DND5E_SETTABLE_KEYS, DND5E_SETTINGS, planDnd5eSettingChanges } from './dnd5e-settings.js';

// The allow-list IS the contract (owner 2026-09-15: read + set, allow-listed). These lock the
// catalogue against the 6.0.1 registrations and the planner's validation.

describe('DND5E_SETTINGS catalogue', () => {
  it('names the 6.0 automation switches, the bastion + calendar fields, and the client-only summary', () => {
    expect(DND5E_SETTINGS.map(s => s.key)).toEqual([
      'disableFalling',
      'tokenSizeSync',
      'senseVisionSync',
      'disableExhaustion',
      'movementAutomation',
      'disableConcentration',
      'initiativeGroupCombatants',
      'initiativeGroupRoll',
      'autoApplyDowned',
      'encounterPlacementBehavior',
      'bloodied',
      'allowPlayerDamageTray',
      'allowPlayerEffectsTray',
      'allowPolymorphing',
      'allowSummoning',
      'pietyScore',
      'bastionEnabled',
      'bastionDuration',
      'calendarEnabled',
      'calendarDailyRecovery',
      'calendar',
      'chatCardSummary',
    ]);
    expect(DND5E_SETTINGS).toHaveLength(22);
    expect(DND5E_SETTABLE_KEYS).toHaveLength(21);
    expect(DND5E_SETTABLE_KEYS).not.toContain('chatCardSummary');
    expect(DND5E_SETTINGS.filter(s => s.requiresReload).map(s => s.key)).toEqual([
      'tokenSizeSync',
      'disableExhaustion',
      'calendar',
    ]);
    // DataModel-backed fields carry a path; plain settings don't
    expect(DND5E_SETTINGS.find(s => s.key === 'bastionEnabled')).toMatchObject({
      setting: 'bastionConfiguration',
      path: 'enabled',
    });
    // "auto" (never "") is the unset spelling — the stored StringField declares choices, so core
    // defaults its `blank` to false and rejects "" on write.
    expect(DND5E_SETTINGS.find(s => s.key === 'calendarDailyRecovery')).toMatchObject({
      setting: 'calendarConfig',
      path: 'dailyRecovery',
      choices: ['auto', 'calendar', 'manual'],
      omitWhenChoice: 'auto',
    });
    expect(DND5E_SETTINGS.some(s => s.choices?.includes(''))).toBe(false);
    expect(DND5E_SETTINGS.filter(s => s.omitWhenChoice !== undefined).map(s => s.key)).toEqual([
      'calendarDailyRecovery',
    ]);
    expect(DND5E_SETTINGS.find(s => s.key === 'autoApplyDowned')?.choices).toEqual([
      'none',
      'deadOnly',
      'npcs',
      'all',
    ]);
  });

  it('locks the kind / choices of the 6.0 keys added for the new shapes (settings.mjs)', () => {
    const byKey = Object.fromEntries(DND5E_SETTINGS.map(s => [s.key, s]));
    // all six are scope:"world" in 6.0.1 settings.mjs — settable, not readOnly like chatCardSummary
    for (const key of [
      'movementAutomation',
      'bloodied',
      'allowPolymorphing',
      'allowSummoning',
      'disableConcentration',
      'pietyScore',
    ]) {
      expect(byKey[key], key).toBeDefined();
      expect(byKey[key]?.readOnly, key).toBeUndefined();
      expect(byKey[key]?.requiresReload, key).toBeUndefined();
      expect(byKey[key]?.path, key).toBeUndefined();
      expect(byKey[key]?.setting, key).toBe(key);
      expect(DND5E_SETTABLE_KEYS).toContain(key);
    }
    expect(byKey.movementAutomation?.kind).toBe('choice');
    expect(byKey.movementAutomation?.choices).toEqual(['full', 'noBlocking', 'none']);
    expect(byKey.bloodied?.kind).toBe('choice');
    expect(byKey.bloodied?.choices).toEqual(['all', 'player', 'none']);
    for (const key of [
      'allowPolymorphing',
      'allowSummoning',
      'disableConcentration',
      'pietyScore',
    ]) {
      expect(byKey[key]?.kind, key).toBe('boolean');
      expect(byKey[key]?.choices, key).toBeUndefined();
    }
    // chatCardSummary stays the ONE client-scoped, read-only entry
    expect(DND5E_SETTINGS.filter(s => s.readOnly).map(s => s.key)).toEqual(['chatCardSummary']);
  });
});

describe('planDnd5eSettingChanges (pure)', () => {
  const current = {
    disableFalling: false,
    autoApplyDowned: 'none',
    bastionDuration: 7,
    calendar: 'gregorian',
    chatCardSummary: true,
  };

  it('returns only the keys that change, with previous → next and the reload flag', () => {
    expect(
      planDnd5eSettingChanges(
        current,
        {
          disableFalling: true,
          autoApplyDowned: 'none', // unchanged → dropped
          bastionDuration: 10,
          calendar: 'harptos',
        },
        { calendars: ['gregorian', 'harptos'] }
      )
    ).toEqual([
      { key: 'disableFalling', previous: false, next: true, requiresReload: false },
      { key: 'bastionDuration', previous: 7, next: 10, requiresReload: false },
      { key: 'calendar', previous: 'gregorian', next: 'harptos', requiresReload: true },
    ]);
    expect(planDnd5eSettingChanges(current, {})).toEqual([]);
    expect(planDnd5eSettingChanges(current, { disableFalling: undefined })).toEqual([]);
  });

  it('rejects an unknown key, a read-only key, a wrong kind, and a value outside the choices', () => {
    expect(() => planDnd5eSettingChanges(current, { disableFalls: true })).toThrow(
      /not a configurable dnd5e setting/
    );
    expect(() => planDnd5eSettingChanges(current, { chatCardSummary: false })).toThrow(
      /client-scoped/
    );
    expect(() => planDnd5eSettingChanges(current, { disableFalling: 'yes' })).toThrow(
      /takes true \/ false/
    );
    expect(() => planDnd5eSettingChanges(current, { bastionDuration: 0 })).toThrow(
      /positive whole number/
    );
    expect(() => planDnd5eSettingChanges(current, { autoApplyDowned: 'everyone' })).toThrow(
      /must be one of none \| deadOnly \| npcs \| all/
    );
    expect(() =>
      planDnd5eSettingChanges(current, { calendar: 'lunar' }, { calendars: ['gregorian'] })
    ).toThrow(/must be one of gregorian/);
  });

  it('plans calendarDailyRecovery in terms of auto, and refuses the old blank spelling', () => {
    expect(
      planDnd5eSettingChanges(
        { calendarDailyRecovery: 'auto' },
        { calendarDailyRecovery: 'manual' }
      )
    ).toEqual([
      { key: 'calendarDailyRecovery', previous: 'auto', next: 'manual', requiresReload: false },
    ]);
    expect(
      planDnd5eSettingChanges(
        { calendarDailyRecovery: 'manual' },
        { calendarDailyRecovery: 'auto' }
      )
    ).toEqual([
      { key: 'calendarDailyRecovery', previous: 'manual', next: 'auto', requiresReload: false },
    ]);
    expect(
      planDnd5eSettingChanges({ calendarDailyRecovery: 'auto' }, { calendarDailyRecovery: 'auto' })
    ).toEqual([]);
    expect(() =>
      planDnd5eSettingChanges({ calendarDailyRecovery: 'auto' }, { calendarDailyRecovery: '' })
    ).toThrow(/must be one of auto \| calendar \| manual/);
  });

  it('accepts the new 6.0 keys and bounds their choices', () => {
    const now = { movementAutomation: 'full', bloodied: 'player', pietyScore: false };
    expect(
      planDnd5eSettingChanges(now, {
        movementAutomation: 'noBlocking',
        bloodied: 'none',
        pietyScore: true,
      })
    ).toEqual([
      { key: 'movementAutomation', previous: 'full', next: 'noBlocking', requiresReload: false },
      { key: 'bloodied', previous: 'player', next: 'none', requiresReload: false },
      { key: 'pietyScore', previous: false, next: true, requiresReload: false },
    ]);
    expect(() => planDnd5eSettingChanges(now, { movementAutomation: 'partial' })).toThrow(
      /must be one of full \| noBlocking \| none/
    );
    expect(() => planDnd5eSettingChanges(now, { bloodied: 'players' })).toThrow(
      /must be one of all \| player \| none/
    );
    expect(() => planDnd5eSettingChanges(now, { allowSummoning: 'yes' })).toThrow(
      /takes true \/ false/
    );
  });
});
