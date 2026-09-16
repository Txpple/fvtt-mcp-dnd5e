/**
 * Offline unit tests for manage-calendar's page layer (src/page/dnd5e/calendar.ts) against a FAKE
 * game.time + CalendarData. They lock the two facts the live path got wrong:
 *
 *  • dnd5e's `CalendarData#jumpToDate` defaults an omitted `day` to `components.dayOfMonth`, which
 *    core keeps 0-BASED, and then computes `dayOfYear = day - 1` — so a `set` that named only the
 *    month/year used to step the date back one day. We now always forward all three components
 *    from our own (1-based) read, and bound the day by the month's length.
 *  • `advance` must scale by the ACTIVE calendar's days.{hoursPerDay,minutesPerHour,secondsPerMinute},
 *    not a hard-coded 86400/3600/60 — a 20-hour-day calendar drifts otherwise. Rounds stay 6 s.
 *
 * The live writes are covered by scripts/verify-settings-calendar.mjs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manageCalendar, monthLength, unitSeconds } from './calendar.js';

const GREGORIAN_MONTHS = [
  { name: 'January', days: 31 },
  { name: 'February', days: 28, leapDays: 29 },
  { name: 'March', days: 31 },
  { name: 'April', days: 30 },
];

interface WorldOptions {
  hoursPerDay?: number;
  minutesPerHour?: number;
  secondsPerMinute?: number;
  months?: Array<{ name: string; days: number; leapDays?: number }>;
  /** The 0-based month index + 0-based day-of-month the fake clock currently reads. */
  month?: number;
  dayOfMonth?: number;
  leapYear?: boolean;
  isGM?: boolean;
}

function installWorld(opts: WorldOptions = {}) {
  const months = opts.months ?? GREGORIAN_MONTHS;
  const jumpToDate = vi.fn(async (_components: unknown) => undefined);
  const set = vi.fn(async (_components: unknown) => undefined);
  const advance = vi.fn(async (_seconds: number) => undefined);

  const calendar = {
    name: 'Fake Calendar',
    months: { values: months },
    days: {
      values: [{ name: 'Sunday' }],
      hoursPerDay: opts.hoursPerDay ?? 24,
      minutesPerHour: opts.minutesPerHour ?? 60,
      secondsPerMinute: opts.secondsPerMinute ?? 60,
    },
    years: { yearZero: 0 },
    format: () => {
      throw new Error('no formatter in the fake calendar');
    },
    jumpToDate,
  };

  const components = {
    year: 1492,
    month: opts.month ?? 1, // 0-based → February
    day: 40, // day of year (0-based) — readCalendar reports it +1; nothing under test reads it
    dayOfMonth: opts.dayOfMonth ?? 9, // 0-based → the 10th
    dayOfWeek: 0,
    hour: 9,
    minute: 5,
    second: 0,
    leapYear: opts.leapYear ?? false,
  };

  (globalThis as any).game = {
    i18n: { localize: (v: string) => v },
    user: { isGM: opts.isGM !== false },
    // Only calendarConfig / calendar are read by readDnd5eSettings for the fields we assert on;
    // everything else simply reports undefined, which the reader tolerates.
    settings: {
      get: (_ns: string, name: string) => {
        if (name === 'calendarConfig') return { enabled: true };
        if (name === 'calendar') return 'gregorian';
        return undefined;
      },
    },
    time: { worldTime: 1000, components, calendar, set, advance },
  };
  (globalThis as any).CONFIG = { DND5E: { calendar: { calendars: [] } }, time: { roundTime: 6 } };
  (globalThis as any).foundry = { utils: { deepClone: (v: any) => structuredClone(v) } };

  return { jumpToDate, set, advance, calendar };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  (globalThis as any).game = undefined;
  (globalThis as any).CONFIG = undefined;
  (globalThis as any).foundry = undefined;
});

describe('unitSeconds', () => {
  it('scales by the active calendar, not by 86400/3600/60', () => {
    expect(
      unitSeconds({ days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } })
    ).toEqual({ round: 6, minute: 60, hour: 3600, day: 86400 });
    // a 20-hour day of 50-minute hours of 50-second minutes
    expect(
      unitSeconds({ days: { hoursPerDay: 20, minutesPerHour: 50, secondsPerMinute: 50 } }, {})
    ).toEqual({ round: 6, minute: 50, hour: 2500, day: 50000 });
  });

  it('falls back to the earth defaults and honours CONFIG.time.roundTime', () => {
    expect(unitSeconds(undefined, {})).toEqual({ round: 6, minute: 60, hour: 3600, day: 86400 });
    expect(unitSeconds(undefined, { time: { roundTime: 10 } }).round).toBe(10);
  });
});

describe('monthLength', () => {
  const cal = { months: { values: GREGORIAN_MONTHS } };
  it('reads days, and leapDays in a leap year', () => {
    expect(monthLength(cal, 0, false)).toBe(31);
    expect(monthLength(cal, 1, false)).toBe(28);
    expect(monthLength(cal, 1, true)).toBe(29);
    // a month with no leapDays keeps its normal length in a leap year
    expect(monthLength(cal, 3, true)).toBe(30);
  });
  it('returns 0 for a month it cannot read (no bound is then enforced)', () => {
    expect(monthLength(cal, 99, false)).toBe(0);
    expect(monthLength(undefined, 0, false)).toBe(0);
  });
});

describe('manageCalendar set', () => {
  it('month-only keeps the day — all three components are forwarded 1-based', async () => {
    const { jumpToDate } = installWorld({ month: 1, dayOfMonth: 9 });
    await manageCalendar({ action: 'set', month: 3 });
    // dayOfMonth 9 (0-based) is the 10th; jumpToDate takes a 1-based day
    expect(jumpToDate).toHaveBeenCalledWith({ year: 1492, month: 2, day: 10 });
  });

  it('year-only keeps the month and the day', async () => {
    const { jumpToDate } = installWorld({ month: 1, dayOfMonth: 9 });
    await manageCalendar({ action: 'set', year: 1493 });
    expect(jumpToDate).toHaveBeenCalledWith({ year: 1493, month: 1, day: 10 });
  });

  it('day-only keeps the year and the month', async () => {
    const { jumpToDate } = installWorld({ month: 1, dayOfMonth: 9 });
    await manageCalendar({ action: 'set', day: 2 });
    expect(jumpToDate).toHaveBeenCalledWith({ year: 1492, month: 1, day: 2 });
  });

  it('refuses a day past the end of the target month, naming the range', async () => {
    const { jumpToDate } = installWorld({ month: 1, dayOfMonth: 9 });
    await expect(manageCalendar({ action: 'set', month: 2, day: 30 })).rejects.toThrow(
      /day must be 1–28 in February/
    );
    expect(jumpToDate).not.toHaveBeenCalled();
  });

  it('allows the 29th of February in a leap year', async () => {
    const { jumpToDate } = installWorld({ month: 1, dayOfMonth: 9, leapYear: true });
    await manageCalendar({ action: 'set', month: 2, day: 29 });
    expect(jumpToDate).toHaveBeenCalledWith({ year: 1492, month: 1, day: 29 });
  });

  it('hour-only never touches the date — only game.time.set', async () => {
    const { jumpToDate, set } = installWorld();
    await manageCalendar({ action: 'set', hour: 17 });
    expect(jumpToDate).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0] as any)[0]).toMatchObject({ hour: 17, minute: 5 });
  });

  it('needs at least one component', async () => {
    installWorld();
    await expect(manageCalendar({ action: 'set' })).rejects.toThrow(/at least one of/);
  });

  it('refuses a write from a non-GM bridge user', async () => {
    installWorld({ isGM: false });
    await expect(manageCalendar({ action: 'set', day: 1 })).rejects.toThrow(/must be a GM/);
  });
});

describe('manageCalendar advance', () => {
  it('uses the calendar units, not 86400/3600/60', async () => {
    const { advance } = installWorld({ hoursPerDay: 20, minutesPerHour: 50, secondsPerMinute: 50 });
    const r: any = await manageCalendar({ action: 'advance', days: 1, hours: 2, minutes: 3 });
    // day = 20*50*50 = 50000 · hour = 50*50 = 2500 · minute = 50
    expect(r.deltaSeconds).toBe(50000 + 2 * 2500 + 3 * 50);
    expect(advance).toHaveBeenCalledWith(55150);
  });

  it('keeps a combat round at 6 s on any calendar', async () => {
    const { advance } = installWorld({ hoursPerDay: 20, minutesPerHour: 50, secondsPerMinute: 50 });
    await manageCalendar({ action: 'advance', rounds: -10 });
    expect(advance).toHaveBeenCalledWith(-60);
  });

  it('still measures an earth calendar in 86400 s days', async () => {
    const { advance } = installWorld();
    await manageCalendar({ action: 'advance', days: 1 });
    expect(advance).toHaveBeenCalledWith(86400);
  });

  it('refuses an empty advance', async () => {
    installWorld();
    await expect(manageCalendar({ action: 'advance' })).rejects.toThrow(/non-zero amount/);
  });
});
