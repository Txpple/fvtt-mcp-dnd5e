// The bridge's own facts (issue #9): what the joined page reads about its client (Chromium's
// renderer, the canvas, the window, the Open Roll 5e modules) and how they read in a report:
// get-world-info's `bridge` block, `npm run doctor`, the bridge smoke. Pure: the page bundle uses
// the types and the renderer test, the Node side the labels.

export type FamilyModuleKey = 'bythebooks' | 'areasounds' | 'openserver';

/** A family module's report name, what needs it, and the package it replaced, if it was renamed. */
interface FamilyModule {
  name: string;
  neededBy: string;
  /**
   * The package this module was before a rename (its old id and name, and the new id to install).
   * A world still on the old package reads as it, flagged legacy, rather than as not active.
   */
  legacy?: { id: string; name: string; install: string };
}

/**
 * The Open Roll 5e modules a skill or tool leans on, and what needs each. The page reads them by
 * package id (src/page/world.ts); a world without one is not an error, only a warning. Battle Flow
 * became By the Books at 3.0.0 (2026-10-11): a world still on Battle Flow 2.x reports it as legacy.
 */
export const FAMILY_MODULES: Record<FamilyModuleKey, FamilyModule> = {
  bythebooks: {
    name: 'By the Books',
    neededBy: 'the combat report',
    legacy: { id: 'fvtt-mod-battleflow', name: 'Battle Flow', install: 'fvtt-mod-bythebooks' },
  },
  areasounds: { name: 'Area Sounds', neededBy: 'configure-area-sounds' },
  openserver: { name: 'Open Server', neededBy: 'set-landing-scene' },
};

const FAMILY_KEYS = Object.keys(FAMILY_MODULES) as FamilyModuleKey[];

/**
 * A family module in this world: whether it is active, and its version (null when not installed).
 * `legacy` marks the fact as the renamed module's old package (FAMILY_MODULES[key].legacy), read
 * because the new one is not active and the old one is.
 */
export interface ModuleFact {
  active: boolean;
  version: string | null;
  legacy?: true;
}

/** The bridge's own client, as the page reads it. Every field is null-safe; the read never throws. */
export interface BridgeFacts {
  /** The canvas's unmasked WebGL renderer; `gpu` is false for a software one, null when unreadable. */
  renderer: { name: string | null; gpu: boolean | null };
  canvasReady: boolean;
  viewport: { width: number; height: number } | null;
  modules: Record<FamilyModuleKey, ModuleFact>;
}

/**
 * Is a WebGL renderer the GPU? Headless Chromium falls back to software rendering (SwiftShader; on a
 * Linux box with no GPU, llvmpipe), where the canvas draws at a few frames a second and a screenshot
 * takes seconds and carries Foundry's hardware-acceleration banner (issue #2). Null when unreadable.
 */
export function rendererOnGpu(name: string | null | undefined): boolean | null {
  if (!name?.trim()) return null;
  return !/SwiftShader|llvmpipe|software/i.test(name);
}

/** `GPU: <name>`, `software: <name>`, or `unknown`. */
export function rendererLabel(r: BridgeFacts['renderer'] | undefined): string {
  if (!r?.name || typeof r.gpu !== 'boolean') return 'unknown';
  return `${r.gpu ? 'GPU' : 'software'}: ${r.name}`;
}

/** The old package a fact stands for, when the fact is a renamed module's legacy read. */
function legacyOf(m: ModuleFact | undefined, key: FamilyModuleKey | undefined) {
  return m?.active && m.legacy && key ? FAMILY_MODULES[key].legacy : undefined;
}

/**
 * A family module's version when it is active, else `not active`; a legacy read names the old
 * package: `Battle Flow 2.17.0 (legacy)`.
 */
export function moduleLabel(m: ModuleFact | undefined, key?: FamilyModuleKey): string {
  if (!m?.active) return 'not active';
  const version = m.version ?? 'active';
  const legacy = legacyOf(m, key);
  return legacy ? `${legacy.name} ${version} (legacy)` : version;
}

/**
 * One line for the doctor and the smoke, `renderer GPU: <name>; By the Books 3.0.0, Area Sounds not
 * active, Open Server 1.2.0` (a world on the old package: `Battle Flow 2.17.0 (legacy, now By the
 * Books)`), and whether it wants a look: a software renderer, or a family module that is not
 * active or is still its old package.
 */
export function bridgeLine(b: BridgeFacts | undefined): { text: string; amber: boolean } {
  const modules = FAMILY_KEYS.map(k => {
    const m = b?.modules?.[k];
    const legacy = legacyOf(m, k);
    return legacy
      ? `${legacy.name} ${m?.version ?? 'active'} (legacy, now ${FAMILY_MODULES[k].name})`
      : `${FAMILY_MODULES[k].name} ${moduleLabel(m, k)}`;
  }).join(', ');
  return {
    text: `renderer ${rendererLabel(b?.renderer)}; ${modules}`,
    amber:
      b?.renderer?.gpu === false ||
      FAMILY_KEYS.some(k => !b?.modules?.[k]?.active || b?.modules?.[k]?.legacy === true),
  };
}

/**
 * The bridge block's module warnings: each inactive family module, naming what needs it, and each
 * one only its old package stands in for, naming the package to install and the one to disable.
 */
export function moduleWarnings(b: BridgeFacts | undefined): string[] {
  if (!b?.modules) return [];
  const out: string[] = [];
  for (const k of FAMILY_KEYS) {
    const m = b.modules[k];
    const { name, neededBy } = FAMILY_MODULES[k];
    const legacy = legacyOf(m, k);
    if (legacy) {
      const version = m?.version ? ` ${m.version}` : '';
      out.push(
        `Only the legacy ${legacy.name}${version} is active in this world: it is now ${name}; ` +
          `install ${legacy.install} and disable ${legacy.name}`
      );
    } else if (!m?.active) {
      out.push(`${name} is not active in this world: ${neededBy} needs it`);
    }
  }
  return out;
}
