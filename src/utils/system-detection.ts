/**
 * Game System Detection Utilities
 *
 * This project targets D&D 5e exclusively. These helpers confirm the active
 * Foundry world is dnd5e and provide D&D 5e data-path mappings; any other
 * system resolves to 'other' (unsupported).
 */

import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';

/**
 * Supported game systems (D&D 5e only; 'other' = unsupported fallback)
 */
export type GameSystem = 'dnd5e' | 'other';

/**
 * Cache for system detection (avoid repeated queries)
 */
let cachedSystem: GameSystem | null = null;
let cachedSystemId: string | null = null;
let cachedSystemVersion: string | null = null;

/** The dnd5e major version this build authors for — it writes native 6.0 keys. */
export const REQUIRED_DND5E_MAJOR = 6;

/**
 * The leading integer of a version string ("6.0.1" → 6, "v5.3.3" → 5). Returns null when the
 * string carries no recognisable number, so an unreadable version never fabricates a refusal.
 */
export function majorVersion(version: string | null | undefined): number | null {
  const m = /(\d+)/.exec(String(version ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * Detect the active Foundry game system
 * Results are cached to avoid repeated queries
 */
export async function detectGameSystem(
  foundry: FoundryBridge,
  logger?: Logger
): Promise<GameSystem> {
  if (cachedSystem) {
    return cachedSystem;
  }

  try {
    const worldInfo = await foundry.call('getWorldInfo');
    const systemId = (worldInfo.system ?? '').toLowerCase();

    cachedSystemId = systemId;
    cachedSystemVersion =
      typeof worldInfo.systemVersion === 'string' && worldInfo.systemVersion
        ? worldInfo.systemVersion
        : null;

    cachedSystem = systemId === 'dnd5e' ? 'dnd5e' : 'other';

    if (logger) {
      logger.info('Game system detected', {
        systemId,
        systemVersion: cachedSystemVersion,
        detectedAs: cachedSystem,
      });
    }

    return cachedSystem;
  } catch (error) {
    if (logger) {
      logger.error('Failed to detect game system, defaulting to other', { error });
    }
    cachedSystem = 'other';
    return cachedSystem;
  }
}

/**
 * Assert the active Foundry world is D&D 5e **6.0 or later**, or throw a tool-labelled error.
 * Centralises the up-front guard every dnd5e authoring tool runs.
 *
 * Every caller of this helper is an AUTHORING tool — it writes. This build emits native dnd5e 6.0
 * keys (condition effects with `system.level`, activities, the 6.0 calendar / settings models), and
 * a 5.x schema PRUNES those on write: the call reports success and the document silently loses the
 * data. So the version gate is a hard refusal, not a warning. Read-only callers that want the fact
 * without the refusal use `dnd5eVersionAtLeast`.
 */
export async function assertDnd5e(
  foundry: FoundryBridge,
  logger: Logger,
  toolLabel: string
): Promise<void> {
  const system = await detectGameSystem(foundry, logger);
  if (system !== 'dnd5e') {
    throw new Error(
      `${toolLabel} requires D&D 5e. Detected system: "${getCachedSystemId() ?? 'unknown'}".`
    );
  }
  const version = getCachedSystemVersion();
  const major = majorVersion(version);
  if (major !== null && major < REQUIRED_DND5E_MAJOR) {
    const ver = version ?? 'unknown';
    throw new Error(
      `${toolLabel} requires dnd5e 6.0 or later (this build writes native 6.0 keys that a ${ver} ` +
        `schema prunes on write). Detected dnd5e ${ver}.`
    );
  }
}

/**
 * True when the detected dnd5e version is at least `major`. Unknown/unreadable versions answer
 * `true` — the tools stay usable rather than refusing on a missing field. Call `detectGameSystem`
 * (or `assertDnd5e`) first; this reads the cache only.
 */
export function dnd5eVersionAtLeast(major: number): boolean {
  const detected = majorVersion(getCachedSystemVersion());
  return detected === null || detected >= major;
}

/**
 * Get the raw system ID string (e.g., "dnd5e")
 */
export function getCachedSystemId(): string | null {
  return cachedSystemId;
}

/** Get the raw system version string (e.g., "6.0.1"), or null when it was not reported. */
export function getCachedSystemVersion(): string | null {
  return cachedSystemVersion;
}

/**
 * Clear cached system detection (useful for testing or world switches)
 */
export function clearSystemCache(): void {
  cachedSystem = null;
  cachedSystemId = null;
  cachedSystemVersion = null;
}
