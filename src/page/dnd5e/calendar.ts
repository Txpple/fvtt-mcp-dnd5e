// Page-side: the in-world calendar (Foundry v14 game.time + the dnd5e 6.0 calendar layer). Runs
// inside the headless Foundry page.
//
// Ground truth (core client/helpers/time.mjs + client/data/calendar.mjs; dnd5e 6.0.1
// data/calendar/*.mjs, applications/calendar/set-date-dialog.mjs, config.mjs DND5E.calendar):
//  • game.time.worldTime is the canonical world time in SECONDS; game.time.components is the
//    calendar decomposition { year, month (0-based index), day (of year), dayOfMonth (0-based),
//    dayOfWeek, hour, minute, second, leapYear }; the displayed year adds `calendar.years.yearZero`.
//  • game.time.advance(seconds) / game.time.set(components|seconds) are the ONLY writers (they set
//    the core "time" world setting — a GM action); dnd5e's recovery (dawn / dusk / day uses, bastion
//    turns) hangs off the resulting updateWorldTime.
//  • dnd5e's set-date dialog jumps via calendar.jumpToDate({ year, month, day }) — year in display
//    terms, month a 0-based index, day 1-based — which keeps the time of day.
//  • dnd5e's HUD formatters (CONFIG.DND5E.calendar.formatters → static methods on the calendar
//    class): monthDay, monthDayYear, approximateDate, hoursMinutes, hoursMinutesSeconds,
//    approximateTime. The calendar in use is the dnd5e `calendar` setting (gregorian / greyhawk /
//    harptos / khorvaire); calendarConfig.enabled gates the HUD + calendar recovery.

import { readDnd5eSettings } from './settings.js';

/**
 * The seconds-per-unit of the ACTIVE calendar. Core `CalendarData.days` carries hoursPerDay /
 * minutesPerHour / secondsPerMinute (foundry.mjs CalendarData schema) and the stock calendars are
 * NOT all 24×60×60 — a homebrew / module calendar with a 20-hour day would drift badly under the
 * hard-coded 86400. A combat round stays 6 s (CONFIG.time.roundTime when the world overrides it):
 * it is a rules quantity, not a calendar one.
 */
export function unitSeconds(
  cal: any,
  config: any = (globalThis as any).CONFIG
): {
  round: number;
  minute: number;
  hour: number;
  day: number;
} {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  const secondsPerMinute = num(cal?.days?.secondsPerMinute, 60);
  const minutesPerHour = num(cal?.days?.minutesPerHour, 60);
  const hoursPerDay = num(cal?.days?.hoursPerDay, 24);
  const hour = secondsPerMinute * minutesPerHour;
  return {
    round: num(config?.time?.roundTime, 6),
    minute: secondsPerMinute,
    hour,
    day: hour * hoursPerDay,
  };
}

/** The number of days in month `index` of this calendar, honouring the leap-year variant. */
export function monthLength(cal: any, index: number, leapYear: boolean): number {
  const m = cal?.months?.values?.[index];
  const days = leapYear ? (m?.leapDays ?? m?.days) : m?.days;
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : 0;
}

export interface CalendarArgs {
  action: 'read' | 'advance' | 'set';
  // advance (any combination; negative rewinds)
  rounds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
  seconds?: number;
  // set (each optional — omitted parts keep their current value)
  year?: number;
  month?: number | string;
  day?: number;
  hour?: number;
  minute?: number;
}

/** Localize a calendar label — core's stock calendars carry i18n KEYS as month / day names. */
const loc = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? String(game.i18n?.localize?.(v) ?? v) : null;

function formatSafe(cal: any, components: any, formatter: string): string | null {
  try {
    return String(cal.format(components, formatter));
  } catch {
    return null;
  }
}

/** The calendar + current date/time, in display terms. */
export function readCalendar(): Record<string, unknown> {
  const cal: any = game.time.calendar;
  const c: any = game.time.components ?? {};
  const settings = readDnd5eSettings();
  const months: any[] = cal?.months?.values ?? [];
  const days: any[] = cal?.days?.values ?? [];
  const yearZero = cal?.years?.yearZero ?? 0;
  const month = months[c.month];
  const weekday = days[c.dayOfWeek];
  return {
    enabled: settings.calendarEnabled === true,
    calendar: settings.calendar ?? null,
    calendarName: cal?.name ?? null,
    // 'auto' is how the tool spells calendarConfig.dailyRecovery's unset/blank state — the stored
    // StringField has choices and therefore blank:false, so "" is not a writable value.
    dailyRecovery: settings.calendarDailyRecovery ?? 'auto',
    worldTime: game.time.worldTime,
    leapYear: c.leapYear === true,
    year: (c.year ?? 0) + yearZero,
    month: { index: c.month ?? 0, number: (c.month ?? 0) + 1, name: loc(month?.name) },
    day: (c.dayOfMonth ?? 0) + 1,
    dayOfYear: (c.day ?? 0) + 1,
    weekday: loc(weekday?.name),
    hour: c.hour ?? 0,
    minute: c.minute ?? 0,
    second: c.second ?? 0,
    formatted: {
      date: formatSafe(cal, c, 'formatMonthDayYear') ?? formatSafe(cal, c, 'timestamp'),
      time: formatSafe(cal, c, 'formatHoursMinutes'),
      approximate: [
        formatSafe(cal, c, 'formatApproximateTime'),
        formatSafe(cal, c, 'formatApproximateDate'),
      ]
        .filter(Boolean)
        .join(', '),
    },
    months: months.map((m: any, i: number) => ({
      index: i,
      number: i + 1,
      name: loc(m?.name),
      days: m?.days,
    })),
  };
}

/** Resolve a month given as a 1-based number or a (case-insensitive) name to its 0-based index. */
function monthIndex(cal: any, month: number | string): number {
  const months: any[] = cal?.months?.values ?? [];
  if (typeof month === 'number') {
    if (!Number.isInteger(month) || month < 1 || month > months.length) {
      throw new Error(`month must be 1–${months.length} (got ${month}).`);
    }
    return month - 1;
  }
  const name = String(month).trim().toLowerCase();
  const idx = months.findIndex(
    (m: any) =>
      String(loc(m?.name) ?? '').toLowerCase() === name ||
      String(m?.name ?? '').toLowerCase() === name ||
      String(loc(m?.abbreviation) ?? '').toLowerCase() === name
  );
  if (idx < 0) {
    throw new Error(
      `month "${month}" is not in this calendar — it has: ${months.map((m: any) => loc(m?.name)).join(', ')}.`
    );
  }
  return idx;
}

/**
 * read the calendar; advance the world time by rounds / minutes / hours / days / seconds (negative
 * rewinds); or set the date (year in display terms, month by number or name, day 1-based) and/or
 * the time of day. Writes go through game.time (GM-only); the report shows before → after.
 */
export async function manageCalendar(args: CalendarArgs): Promise<unknown> {
  const action = args?.action ?? 'read';
  if (action === 'read') return { success: true, ...readCalendar() };
  if (!game.user?.isGM)
    throw new Error('manage-calendar writes the world time — the bridge user must be a GM.');
  const before = readCalendar();
  const cal: any = game.time.calendar;

  if (action === 'advance') {
    const unit = unitSeconds(cal);
    const delta =
      (args.rounds ?? 0) * unit.round +
      (args.minutes ?? 0) * unit.minute +
      (args.hours ?? 0) * unit.hour +
      (args.days ?? 0) * unit.day +
      (args.seconds ?? 0);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error(
        'advance needs a non-zero amount: rounds / minutes / hours / days / seconds (negative rewinds).'
      );
    }
    await game.time.advance(delta);
    return { success: true, action, deltaSeconds: delta, before, after: readCalendar() };
  }

  if (action === 'set') {
    const { year, month, day, hour, minute } = args;
    if ([year, month, day, hour, minute].every(v => v === undefined)) {
      throw new Error('set needs at least one of year / month / day / hour / minute.');
    }
    if (year !== undefined || month !== undefined || day !== undefined) {
      const mi = month === undefined ? undefined : monthIndex(cal, month);
      if (day !== undefined && (!Number.isInteger(day) || day < 1)) {
        throw new Error(`day must be a positive whole number (got ${day}).`);
      }
      // ⚠️ jumpToDate defaults an omitted `day` to `components.dayOfMonth`, which core keeps
      // 0-BASED, and then does `dayOfYear = day - 1` — so forwarding nothing steps the date back a
      // day. Always send all three, taken from our own (1-based) read.
      const target = {
        year: year ?? (before.year as number),
        month: mi ?? (before.month as any).index,
        day: day ?? (before.day as number),
      };
      const length = monthLength(cal, target.month, before.leapYear === true);
      if (length > 0 && target.day > length) {
        const name = (before.months as any[])?.[target.month]?.name ?? `month ${target.month + 1}`;
        throw new Error(`day must be 1–${length} in ${name} (got ${target.day}).`);
      }
      await cal.jumpToDate(target);
    }
    if (hour !== undefined || minute !== undefined) {
      const c = { ...(game.time.components as any) };
      if (hour !== undefined) {
        if (!Number.isInteger(hour) || hour < 0 || hour > 23)
          throw new Error(`hour must be 0–23 (got ${hour}).`);
        c.hour = hour;
      }
      if (minute !== undefined) {
        if (!Number.isInteger(minute) || minute < 0 || minute > 59)
          throw new Error(`minute must be 0–59 (got ${minute}).`);
        c.minute = minute;
      }
      await game.time.set(c);
    }
    return { success: true, action, before, after: readCalendar() };
  }

  throw new Error(`Unknown action "${action}". Use read, advance, or set.`);
}
