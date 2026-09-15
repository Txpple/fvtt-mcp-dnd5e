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
      'initiativeGroupCombatants',
      'initiativeGroupRoll',
      'autoApplyDowned',
      'encounterPlacementBehavior',
      'allowPlayerDamageTray',
      'allowPlayerEffectsTray',
      'bastionEnabled',
      'bastionDuration',
      'calendarEnabled',
      'calendarDailyRecovery',
      'calendar',
      'chatCardSummary',
    ]);
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
    expect(DND5E_SETTINGS.find(s => s.key === 'calendarDailyRecovery')).toMatchObject({
      setting: 'calendarConfig',
      path: 'dailyRecovery',
      choices: ['', 'calendar', 'manual'],
    });
    expect(DND5E_SETTINGS.find(s => s.key === 'autoApplyDowned')?.choices).toEqual([
      'none',
      'deadOnly',
      'npcs',
      'all',
    ]);
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
});
