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

import {
  type BridgeFacts,
  FAMILY_MODULES,
  type FamilyModuleKey,
  type ModuleFact,
  rendererOnGpu,
} from '../utils/bridge-facts.js';
import { PREMIUM_BOOK_PREFIXES } from '../utils/compendium-sources.js';
import { AREASOUNDS_MODULE_ID } from './areasounds.js';
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

/** The family modules' package ids; their names and what needs each: utils/bridge-facts.ts. */
const FAMILY_MODULE_IDS: Record<FamilyModuleKey, string> = {
  bythebooks: 'fvtt-mod-bythebooks',
  areasounds: AREASOUNDS_MODULE_ID,
  openserver: 'fvtt-mod-openserver',
};

/** A read off the client, or `fallback` when it throws: the bridge report never fails on one. */
function tryRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The canvas's unmasked WebGL renderer (WEBGL_debug_renderer_info), or null when unreadable. */
function rendererName(): string | null {
  return tryRead(() => {
    const gl = (globalThis as any).canvas?.app?.renderer?.gl;
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  }, null);
}

/** A module in this world (game.modules): active, and its version; absent = not active, no version. */
function moduleFact(id: string): ModuleFact {
  return tryRead(
    () => {
      const m = game.modules?.get?.(id);
      const version = typeof m?.version === 'string' && m.version ? m.version : null;
      return { active: m?.active === true, version };
    },
    { active: false, version: null }
  );
}

/**
 * A family module's fact. A renamed module (By the Books, Battle Flow until 3.0.0) that is not
 * active falls back to its old package when that one is: the fact is the old package's, flagged
 * `legacy`, so a world still on Battle Flow 2.x reads as something true rather than not active.
 */
function familyModuleFact(key: FamilyModuleKey): ModuleFact {
  const fact = moduleFact(FAMILY_MODULE_IDS[key]);
  const legacyId = FAMILY_MODULES[key].legacy?.id;
  if (fact.active || !legacyId) return fact;
  const old = moduleFact(legacyId);
  return old.active ? { ...old, legacy: true } : fact;
}

/**
 * The bridge's own client (issue #9): Chromium's renderer (the GPU, or software, which makes every
 * screenshot slow and stamps it with Foundry's hardware-acceleration banner; issue #2), whether the
 * canvas is ready, the window's size, and the Open Roll 5e modules the skills lean on. Every read is
 * fenced: this never throws.
 */
function bridgeFacts(): BridgeFacts {
  const name = rendererName();
  return {
    renderer: { name, gpu: rendererOnGpu(name) },
    canvasReady: tryRead(() => (globalThis as any).canvas?.ready === true, false),
    viewport: tryRead(() => {
      const w = (globalThis as any).window;
      const width = Number(w?.innerWidth);
      const height = Number(w?.innerHeight);
      return width > 0 && height > 0 ? { width, height } : null;
    }, null),
    modules: {
      bythebooks: familyModuleFact('bythebooks'),
      areasounds: familyModuleFact('areasounds'),
      openserver: familyModuleFact('openserver'),
    },
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
  library?: Record<string, 'present' | 'missing'> | undefined;
  /** dnd5e 6.0 automation switches + the calendar (present on a dnd5e world only). */
  automation?: Record<string, unknown> | undefined;
  /** The bridge's own client: renderer, canvas, window, the family modules (issue #9). */
  bridge: BridgeFacts;
}

/**
 * Basic world/system metadata, and the bridge's own client: its renderer, canvas and window, and
 * the Open Roll 5e modules.
 *
 * Shape contract (consumed by SceneTools.formatWorldResponse and
 * detectGameSystem): { id, title, system, systemVersion, foundryVersion,
 * users: [{ id, name, active, isGM }], bridge }. `system` is the bare system id
 * string; the Node side rolls users up into counts + an activeUsers list, and
 * reads `bridge` into get-world-info's bridge block.
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
    bridge: bridgeFacts(),
  };
}
