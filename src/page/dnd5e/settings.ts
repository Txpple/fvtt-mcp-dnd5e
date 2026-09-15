// Page-side: the dnd5e 6.0 automation settings — read + allow-listed set. Runs inside the headless
// Foundry page. The catalogue (which keys, kinds, choices, storage) is the pure
// utils/dnd5e-settings.ts, shared with the Node tool; this file owns the live game.settings I/O.
//
// Ground truth (6.0.1 settings.mjs + data/settings/*.mjs):
//  • the automation switches are plain world settings (Boolean / String with choices);
//  • bastionConfiguration (BastionSetting) and calendarConfig (CalendarConfigSetting) are DataModel
//    settings — game.settings.get returns a model; write the WHOLE object back (toObject → set path
//    → set), never a partial;
//  • `calendar` is a StringField whose choices come from CONFIG.DND5E.calendar.calendars (modules
//    can add calendars) — validated live; requiresReload;
//  • chatCardSummary is CLIENT-scoped — reported for the bridge user, never written.

import {
  DND5E_SETTINGS,
  type Dnd5eSettingChange,
  planDnd5eSettingChanges,
} from '../../utils/dnd5e-settings.js';

const NS = 'dnd5e';

function getPath(obj: any, path: string | undefined): unknown {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj: any, path: string, value: unknown): void {
  const parts = path.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[parts[parts.length - 1] as string] = value;
}

/** A setting's stored value as plain data (DataModel settings → toObject). */
function readSettingPlain(name: string): any {
  let v: any;
  try {
    v = game.settings.get(NS, name);
  } catch {
    return undefined; // not registered on this world (an older system) — reported as undefined
  }
  if (v && typeof v === 'object' && typeof v.toObject === 'function') return v.toObject();
  return v && typeof v === 'object' ? foundry.utils.deepClone(v) : v;
}

/** The calendars this world offers (CONFIG.DND5E.calendar.calendars → ids). */
function liveCalendarIds(): string[] {
  const list = (CONFIG as any).DND5E?.calendar?.calendars;
  return Array.isArray(list)
    ? list.map((c: any) => c?.value).filter((v: unknown): v is string => typeof v === 'string')
    : [];
}

/** Every catalogued setting's current value, keyed by the tool key. */
export function readDnd5eSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of DND5E_SETTINGS) {
    let v = getPath(readSettingPlain(spec.setting), spec.path);
    // an unset optional choice (calendarConfig.dailyRecovery has no initial) IS the "" option
    if (v === undefined && spec.kind === 'choice' && spec.choices?.includes('')) v = '';
    out[spec.key] = v;
  }
  return out;
}

/**
 * Read (no args) or set the allow-listed dnd5e settings. Returns the current values, the live
 * calendar choices, and — after a write — the applied changes (old → new) and which of them need a
 * client reload before they take effect.
 */
export async function configureDnd5eSettings(args: Record<string, unknown> = {}): Promise<unknown> {
  const calendars = liveCalendarIds();
  const current = readDnd5eSettings();
  const changes: Dnd5eSettingChange[] = planDnd5eSettingChanges(current, args ?? {}, {
    calendars,
  });
  if (changes.length === 0) {
    return { success: true, settings: current, calendars };
  }
  if (!game.user?.isGM) {
    throw new Error(
      'configure-dnd5e-settings writes world settings — the bridge user must be a GM.'
    );
  }
  // Group DataModel writes by setting so a bastion/calendar object is written once, whole.
  const grouped = new Map<string, Dnd5eSettingChange[]>();
  for (const c of changes) {
    const spec = DND5E_SETTINGS.find(s => s.key === c.key);
    if (!spec) continue;
    const list = grouped.get(spec.setting) ?? [];
    list.push(c);
    grouped.set(spec.setting, list);
  }
  for (const [setting, list] of grouped) {
    const specs = list.map(c => DND5E_SETTINGS.find(s => s.key === c.key));
    if (specs.every(s => s && !s.path)) {
      // a plain setting — one key per setting
      await game.settings.set(NS, setting, list[0]?.next);
      continue;
    }
    const obj = readSettingPlain(setting) ?? {};
    for (let i = 0; i < list.length; i++) {
      const spec = specs[i];
      const change = list[i];
      if (spec?.path && change) setPath(obj, spec.path, change.next);
    }
    await game.settings.set(NS, setting, obj);
  }
  const reloadRequired = changes.filter(c => c.requiresReload).map(c => c.key);
  return {
    success: true,
    applied: changes,
    settings: readDnd5eSettings(),
    calendars,
    ...(reloadRequired.length > 0 ? { reloadRequired } : {}),
  };
}
