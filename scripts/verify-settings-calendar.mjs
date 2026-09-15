// Live verification for configure-dnd5e-settings + manage-calendar (2.1.1, plan rows 10 + 13):
//   * the allow-listed settings read as the catalogue promises; a plain switch, a choice, and the
//     DataModel-backed bastion / calendar fields each set with old → new and read back; the reload
//     flag rides a requiresReload key; a client-scoped key and an off-list value are refused;
//   * get-world-info carries the `automation` block;
//   * the calendar reads in display terms; advance moves worldTime by exactly the delta; set jumps to
//     a month by NAME + day and sets the time of day.
//
// Everything it changes is RESTORED in `finally` (the original settings and the original worldTime)
// — these are world-level switches, not tagged documents.
//
// Build first: npm run build. Run: FOUNDRY_PROFILE=local node scripts/verify-settings-calendar.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  if (line.trimStart().startsWith('#')) continue;
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

let passes = 0;
let fails = 0;
function assert(cond, msg, extra) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL  ${msg}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}
async function expectThrow(label, fn, re) {
  try {
    await fn();
    fails++;
    console.log(`  FAIL  ${label} — expected a throw, none thrown`);
  } catch (e) {
    const m = e?.message || String(e);
    if (re.test(m)) {
      passes++;
      console.log(`  PASS  ${label} — threw ${JSON.stringify(m.slice(0, 100))}`);
    } else {
      fails++;
      console.log(`  FAIL  ${label} — threw but message didn't match ${re}: ${m.slice(0, 160)}`);
    }
  }
}

const f = new Foundry(bridgeConfig(env));
let original = null; // the settings to restore
let originalWorldTime = null;

try {
  console.log('[verify-settings-calendar] connecting…');
  await f.connect();
  console.log('[verify-settings-calendar] connected\n');

  // ======================================================================
  // 1. Settings — read
  // ======================================================================
  const read = await f.call('configureDnd5eSettings', {});
  original = read?.settings ?? null;
  assert(!!original && !('applied' in read), 'read: no args → settings, no applied', read);
  for (const k of [
    'disableFalling',
    'tokenSizeSync',
    'autoApplyDowned',
    'allowPlayerDamageTray',
    'bastionEnabled',
    'bastionDuration',
    'calendarEnabled',
    'calendarDailyRecovery',
    'calendar',
    'chatCardSummary',
  ]) {
    assert(k in original, `read: "${k}" reported (${JSON.stringify(original[k])})`);
  }
  assert(
    typeof original.disableFalling === 'boolean' &&
      typeof original.bastionDuration === 'number' &&
      typeof original.calendar === 'string',
    'read: kinds match the catalogue',
    original
  );
  assert(
    Array.isArray(read.calendars) &&
      read.calendars.includes('gregorian') &&
      read.calendars.includes('harptos'),
    'read: live calendar choices include gregorian + harptos',
    read.calendars
  );

  // ======================================================================
  // 2. Settings — set (plain switch, choice, DataModel fields, reload flag)
  // ======================================================================
  const set1 = await f.call('configureDnd5eSettings', {
    disableFalling: !original.disableFalling,
    autoApplyDowned: original.autoApplyDowned === 'npcs' ? 'deadOnly' : 'npcs',
    bastionDuration: original.bastionDuration + 3,
    calendarEnabled: !original.calendarEnabled,
  });
  assert(set1?.applied?.length === 4, 'set: four changes applied', set1?.applied);
  const byKey = Object.fromEntries((set1?.applied ?? []).map(c => [c.key, c]));
  assert(
    byKey.disableFalling?.previous === original.disableFalling &&
      byKey.disableFalling?.next === !original.disableFalling,
    'set: disableFalling previous → next',
    byKey.disableFalling
  );
  assert(
    set1?.settings?.bastionDuration === original.bastionDuration + 3 &&
      set1?.settings?.calendarEnabled === !original.calendarEnabled,
    'set: DataModel fields (bastionConfiguration.duration, calendarConfig.enabled) read back changed',
    set1?.settings
  );
  const live = await f.evaluate(() => ({
    falling: globalThis.game.settings.get('dnd5e', 'disableFalling'),
    downed: globalThis.game.settings.get('dnd5e', 'autoApplyDowned'),
    bastion: globalThis.game.settings.get('dnd5e', 'bastionConfiguration').toObject(),
    calendar: globalThis.game.settings.get('dnd5e', 'calendarConfig').toObject(),
  }));
  assert(
    live.falling === !original.disableFalling && live.downed === byKey.autoApplyDowned?.next,
    'live: the plain settings hold the new values',
    live
  );
  assert(
    live.bastion.duration === original.bastionDuration + 3 &&
      typeof live.bastion.enabled === 'boolean' &&
      live.calendar.enabled === !original.calendarEnabled,
    'live: the DataModel settings were written WHOLE (sibling fields intact)',
    live
  );
  assert(!set1?.reloadRequired, 'set: no reload flag for non-reload keys', set1?.reloadRequired);

  const noop = await f.call('configureDnd5eSettings', { disableFalling: !original.disableFalling });
  assert(!('applied' in noop), 're-applying the current value is a clean no-op', noop);

  const otherCal = original.calendar === 'harptos' ? 'gregorian' : 'harptos';
  const set2 = await f.call('configureDnd5eSettings', { calendar: otherCal });
  assert(
    set2?.applied?.[0]?.next === otherCal && set2?.reloadRequired?.includes('calendar'),
    'set: calendar changes and is flagged reloadRequired',
    set2
  );

  // ======================================================================
  // 3. Settings — refusals
  // ======================================================================
  await expectThrow(
    'refuses the client-scoped chatCardSummary',
    () => f.call('configureDnd5eSettings', { chatCardSummary: false }),
    /client-scoped/
  );
  await expectThrow(
    'refuses a calendar outside the live list',
    () => f.call('configureDnd5eSettings', { calendar: 'lunar' }),
    /must be one of/
  );
  await expectThrow(
    'refuses an off-list key',
    () => f.call('configureDnd5eSettings', { disableFalls: true }),
    /not a configurable dnd5e setting/
  );
  await expectThrow(
    'refuses a wrong kind',
    () => f.call('configureDnd5eSettings', { bastionDuration: 0 }),
    /positive whole number/
  );

  // ======================================================================
  // 4. get-world-info carries the automation block
  // ======================================================================
  const world = await f.call('getWorldInfo');
  assert(
    world?.automation &&
      typeof world.automation.disableFalling === 'boolean' &&
      typeof world.automation.calendarNow === 'string',
    'getWorldInfo: automation block (switches + calendarNow)',
    world?.automation
  );

  // ======================================================================
  // 5. Calendar — read / advance / set
  // ======================================================================
  const cal = await f.call('manageCalendar', { action: 'read' });
  originalWorldTime = cal?.worldTime;
  assert(
    typeof cal?.worldTime === 'number' &&
      typeof cal?.year === 'number' &&
      typeof cal?.month?.name === 'string' &&
      cal?.day >= 1 &&
      Array.isArray(cal?.months) &&
      cal.months.length > 0,
    'calendar read: worldTime, year, month name, day, months',
    cal
  );
  assert(
    typeof cal?.formatted?.date === 'string' && typeof cal?.formatted?.time === 'string',
    'calendar read: formatted date + time strings',
    cal?.formatted
  );

  const adv = await f.call('manageCalendar', { action: 'advance', hours: 8, minutes: 30 });
  assert(
    adv?.deltaSeconds === 8 * 3600 + 30 * 60 &&
      adv?.after?.worldTime - adv?.before?.worldTime === adv.deltaSeconds,
    'advance: worldTime moved by exactly 8h30m',
    { delta: adv?.deltaSeconds, before: adv?.before?.worldTime, after: adv?.after?.worldTime }
  );
  const back = await f.call('manageCalendar', { action: 'advance', rounds: -10 });
  assert(
    back?.deltaSeconds === -60,
    'advance: negative rounds rewind (10 rounds = -60 s)',
    back?.deltaSeconds
  );

  const targetMonth = cal.months[Math.min(2, cal.months.length - 1)];
  const setDate = await f.call('manageCalendar', {
    action: 'set',
    month: targetMonth.name,
    day: 5,
    hour: 6,
    minute: 30,
  });
  assert(
    setDate?.after?.month?.name === targetMonth.name && setDate?.after?.day === 5,
    `set: jumped to ${targetMonth.name} 5 by month NAME`,
    setDate?.after
  );
  assert(
    setDate?.after?.hour === 6 && setDate?.after?.minute === 30,
    'set: time of day 06:30',
    setDate?.after
  );
  const setNum = await f.call('manageCalendar', { action: 'set', month: 1, day: 1 });
  assert(
    setNum?.after?.month?.number === 1 && setNum?.after?.day === 1 && setNum?.after?.hour === 6,
    'set: month by NUMBER keeps the time of day',
    setNum?.after
  );
  await expectThrow(
    'refuses a month outside the calendar',
    () => f.call('manageCalendar', { action: 'set', month: 'Smarch' }),
    /not in this calendar/
  );
  await expectThrow(
    'refuses an empty advance',
    () => f.call('manageCalendar', { action: 'advance' }),
    /non-zero amount/
  );
} catch (e) {
  fails++;
  console.log(`  FAIL  unexpected error: ${e?.stack || e}`);
} finally {
  try {
    if (original) {
      await f.call('configureDnd5eSettings', {
        disableFalling: original.disableFalling,
        autoApplyDowned: original.autoApplyDowned,
        bastionDuration: original.bastionDuration,
        calendarEnabled: original.calendarEnabled,
        calendar: original.calendar,
      });
      console.log('\nrestored the original dnd5e settings');
    }
    if (typeof originalWorldTime === 'number') {
      await f.evaluate(async t => {
        await globalThis.game.time.set(t);
      }, originalWorldTime);
      console.log(`restored worldTime ${originalWorldTime}`);
    }
  } catch (e) {
    console.log(`restore failed: ${e?.message || e}`);
  }
  await f.disconnect?.();
  console.log(`\n${passes}/${passes + fails} passed`);
  process.exit(fails > 0 ? 1 : 0);
}
