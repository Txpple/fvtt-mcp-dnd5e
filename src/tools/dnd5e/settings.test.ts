/**
 * Unit tests for configure-dnd5e-settings + manage-calendar: the generated contracts, forwarding,
 * and response shaping. The bridge seam is mocked; the live settings / game.time writes are covered
 * by scripts/verify-settings-calendar.mjs.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearSystemCache } from '../../utils/system-detection.js';
import { makeFoundry, makeLogger } from '../test-helpers.js';
import { DnD5eCalendarTool } from './calendar.js';
import { DnD5eSettingsTool } from './settings.js';

beforeEach(() => clearSystemCache());

function settingsTool(response: any = {}) {
  const { foundry, calls } = makeFoundry((name: string) =>
    name === 'getWorldInfo' ? { system: 'dnd5e' } : response
  );
  return { tool: new DnD5eSettingsTool({ foundry, logger: makeLogger() }), calls };
}
function calendarTool(response: any = {}) {
  const { foundry, calls } = makeFoundry((name: string) =>
    name === 'getWorldInfo' ? { system: 'dnd5e' } : response
  );
  return { tool: new DnD5eCalendarTool({ foundry, logger: makeLogger() }), calls };
}

describe('configure-dnd5e-settings', () => {
  it('advertises every settable key (never the client-only one) with its enum / type', () => {
    const { tool } = settingsTool();
    const def = tool.getToolDefinitions()[0];
    expect(def.name).toBe('configure-dnd5e-settings');
    const props: any = (def.inputSchema as any).properties;
    expect(Object.keys(props)).toContain('disableFalling');
    expect(Object.keys(props)).toContain('calendarEnabled');
    expect(Object.keys(props)).not.toContain('chatCardSummary');
    expect(props.autoApplyDowned.enum).toEqual(['none', 'deadOnly', 'npcs', 'all']);
    // the unset spelling is 'auto' — "" is not offered because the field cannot store it
    expect(props.calendarDailyRecovery.enum).toEqual(['auto', 'calendar', 'manual']);
    expect(props.movementAutomation.enum).toEqual(['full', 'noBlocking', 'none']);
    expect(props.bloodied.enum).toEqual(['all', 'player', 'none']);
    expect(props.pietyScore.type).toBe('boolean');
    expect(props.bastionDuration.type).toBe('integer');
    expect(props.calendar.type).toBe('string');
    expect((def.inputSchema as any).required).toEqual([]);
  });

  it('reads with no args and renders every switch', async () => {
    const { tool, calls } = settingsTool({
      success: true,
      settings: {
        disableFalling: false,
        autoApplyDowned: 'npcs',
        calendar: 'harptos',
        chatCardSummary: true,
      },
      calendars: ['gregorian', 'harptos'],
    });
    const out = await tool.handleConfigureDnd5eSettings({});
    expect(calls.find(([n]) => n === 'configureDnd5eSettings')?.[1]).toEqual({});
    expect(out).toContain('**dnd5e automation settings**');
    expect(out).toContain('`autoApplyDowned`): `npcs`');
    expect(out).toContain('(client — read-only)');
    expect(out).toContain('Calendars available:** `gregorian`, `harptos`');
  });

  it('forwards only the given keys and renders previous → new + the reload note', async () => {
    const { tool, calls } = settingsTool({
      success: true,
      applied: [
        { key: 'disableFalling', previous: false, next: true, requiresReload: false },
        { key: 'calendar', previous: 'gregorian', next: 'harptos', requiresReload: true },
      ],
      reloadRequired: ['calendar'],
      settings: { disableFalling: true, calendar: 'harptos' },
      calendars: ['gregorian', 'harptos'],
    });
    const out = await tool.handleConfigureDnd5eSettings({
      disableFalling: true,
      calendar: 'harptos',
    });
    expect(calls.find(([n]) => n === 'configureDnd5eSettings')?.[1]).toEqual({
      disableFalling: true,
      calendar: 'harptos',
    });
    expect(out).toContain('updated (2 change(s))');
    expect(out).toContain('disableFalling: `false` → `true`');
    expect(out).toContain('Takes effect after clients reload: `calendar`');
  });

  it('rejects a value outside an enum at the contract', async () => {
    const { tool } = settingsTool();
    await expect(
      tool.handleConfigureDnd5eSettings({ autoApplyDowned: 'everyone' })
    ).rejects.toThrow();
    await expect(tool.handleConfigureDnd5eSettings({ bastionDuration: 0 })).rejects.toThrow();
  });
});

describe('manage-calendar', () => {
  it('advertises read / advance / set with the date + delta fields', () => {
    const { tool } = calendarTool();
    const def = tool.getToolDefinitions()[0];
    expect(def.name).toBe('manage-calendar');
    const props: any = (def.inputSchema as any).properties;
    expect(props.action.enum).toEqual(['read', 'advance', 'set']);
    for (const k of [
      'rounds',
      'minutes',
      'hours',
      'days',
      'year',
      'month',
      'day',
      'hour',
      'minute',
    ]) {
      expect(props[k]).toBeDefined();
    }
  });

  it('read renders the calendar + the date', async () => {
    const { tool, calls } = calendarTool({
      success: true,
      enabled: true,
      calendar: 'harptos',
      calendarName: 'Calendar of Harptos',
      dailyRecovery: 'auto',
      worldTime: 123456,
      year: 1492,
      month: { index: 4, number: 5, name: 'Mirtul' },
      day: 3,
      weekday: null,
      hour: 9,
      minute: 5,
      second: 0,
      formatted: { date: '3 Mirtul, 1492', time: '09:05', approximate: 'Morning' },
      months: [{ index: 0, number: 1, name: 'Hammer', days: 30 }],
    });
    const out = await tool.handleManageCalendar({});
    expect(calls.find(([n]) => n === 'manageCalendar')?.[1].action).toBe('read');
    expect(out).toContain('Calendar of Harptos');
    expect(out).toContain('3 Mirtul, 1492 09:05 (Morning)');
    expect(out).toContain('automatic');
  });

  it('advance / set forward the fields and render before → after; the contract bounds the clock', async () => {
    const { tool, calls } = calendarTool({
      success: true,
      action: 'advance',
      deltaSeconds: 28800,
      before: {
        year: 1492,
        month: { number: 5 },
        day: 3,
        hour: 9,
        minute: 5,
        formatted: { date: '3 Mirtul, 1492', time: '09:05' },
      },
      after: {
        year: 1492,
        month: { number: 5 },
        day: 3,
        hour: 17,
        minute: 5,
        formatted: { date: '3 Mirtul, 1492', time: '17:05' },
      },
    });
    const out = await tool.handleManageCalendar({ action: 'advance', hours: 8 });
    expect(calls.find(([n]) => n === 'manageCalendar')?.[1]).toMatchObject({
      action: 'advance',
      hours: 8,
    });
    expect(out).toContain('Advanced the world time by 28800 s');
    expect(out).toContain('before: 3 Mirtul, 1492 09:05');
    expect(out).toContain('after:  3 Mirtul, 1492 17:05');
    await tool.handleManageCalendar({ action: 'set', month: 'Mirtul', day: 4, hour: 6 });
    expect(calls.find(([n, a]) => n === 'manageCalendar' && a.action === 'set')?.[1]).toMatchObject(
      {
        month: 'Mirtul',
        day: 4,
        hour: 6,
      }
    );
    await expect(tool.handleManageCalendar({ action: 'set', hour: 24 })).rejects.toThrow();
    await expect(tool.handleManageCalendar({ action: 'set', day: 0 })).rejects.toThrow();
  });
});
