// Page-side: world/system facts. Runs inside the Foundry page.
//
// Rewritten from scratch for the headless migration. Oracle: the old
// data-access.ts getWorldInfo (commit 6f9612e). Pure reads against game.*;
// no permission/transaction/settings scaffolding.
//
// READ-ONLY BY DESIGN: a world-metadata WRITE (an update-world tool) was built and dropped
// 2026-07-06. v14 ground truth (probed live on 14.364): game.world.update() does not exist —
// World is a PACKAGE, and the only write path is the /setup editWorld POST the "Edit World"
// dialog uses. That route requires a server-admin session (unreachable while a world is live;
// /auth and /setup redirect to /join) or a role-4 GAMEMASTER session — the bridge user is a
// role-3 ASSISTANT and stays that way by decision. Don't rebuild this without revisiting that.

import { PREMIUM_BOOK_PREFIXES } from '../utils/compendium-sources.js';
import { readCalendar } from './dnd5e/calendar.js';
import { readDnd5eSettings } from './dnd5e/settings.js';

/** Role number → the name Foundry uses (CONST.USER_ROLES), for the bridge-user report. */
function roleName(role: number): string {
  const table: Record<string, number> = (globalThis as any).CONST?.USER_ROLES ?? {};
  return Object.keys(table).find(k => table[k] === role) ?? String(role);
}

/**
 * Which premium books (design.md §2.3 — the ONE definition in utils/compendium-sources.ts) have
 * packs registered in this world: `present` when any pack carries the book's prefix (an
 * installed but inactive module registers none), else `missing`.
 */
function libraryPresence(): Record<string, 'present' | 'missing'> {
  const packIds: string[] = game.packs.map((p: any) =>
    String(p.collection ?? p.metadata?.id ?? '')
  );
  const out: Record<string, 'present' | 'missing'> = {};
  for (const prefix of PREMIUM_BOOK_PREFIXES) {
    const id = prefix.replace(/\.$/, '');
    out[id] = packIds.some(p => p.startsWith(prefix)) ? 'present' : 'missing';
  }
  return out;
}

/** The calendar's headline facts for the world summary (date + time strings, enabled). */
function calendarSummary(): Record<string, unknown> {
  const c: any = readCalendar();
  return {
    calendarNow: c.formatted?.date
      ? `${c.formatted.date} ${c.formatted.time ?? ''}`.trim()
      : `${c.year}-${c.month?.number}-${c.day} ${c.hour}:${String(c.minute ?? 0).padStart(2, '0')}`,
  };
}

interface WorldUser {
  id: string;
  name: string;
  active: boolean;
  isGM: boolean;
}

interface WorldInfo {
  id: string;
  title: string;
  description: string;
  background: string | null;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  users: WorldUser[];
  /** The user the bridge joined as, and its role — writes need ASSISTANT or GAMEMASTER. */
  bridgeUser: { name: string; role: string };
  /** The premium books (§2.3): which have packs in this world (dnd5e only). */
  library?: Record<string, 'present' | 'missing'>;
  /** dnd5e 6.0 automation switches + the calendar (present on a dnd5e world only). */
  automation?: Record<string, unknown>;
}

/**
 * Basic world/system metadata.
 *
 * Shape contract (consumed by SceneTools.formatWorldResponse and
 * detectGameSystem): { id, title, system, systemVersion, foundryVersion,
 * users: [{ id, name, active, isGM }] }. `system` is the bare system id
 * string; the Node side rolls users up into counts + an activeUsers list.
 */
export function getWorldInfo(): WorldInfo {
  // dnd5e 6.0: the automation switches ride along so start-session / session-audit can reason
  // about them (falling on, auto-Downed mode, calendar enabled…) without a second call.
  let automation: Record<string, unknown> | undefined;
  if (game.system.id === 'dnd5e') {
    try {
      automation = { ...readDnd5eSettings(), ...calendarSummary() };
    } catch {
      automation = undefined;
    }
  }
  return {
    ...(automation ? { automation } : {}),
    ...(game.system.id === 'dnd5e' ? { library: libraryPresence() } : {}),
    bridgeUser: {
      name: String(game.user?.name ?? ''),
      role: roleName(Number(game.user?.role ?? 0)),
    },
    id: game.world.id,
    title: game.world.title,
    description: String((game.world as any).description ?? ''),
    background: (game.world as any).background || null,
    system: game.system.id,
    systemVersion: game.system.version,
    foundryVersion: game.version,
    users: game.users.map((user: any) => ({
      id: user.id || '',
      name: user.name || '',
      active: user.active,
      isGM: user.isGM,
    })),
  };
}
