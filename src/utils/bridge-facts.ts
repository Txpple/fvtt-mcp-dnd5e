// The bridge's own facts (issue #9): what the joined page reads about its client (Chromium's
// renderer, the canvas, the window, the Open Roll 5e modules) and how they read in a report:
// get-world-info's `bridge` block, `npm run doctor`, the bridge smoke. Pure: the page bundle uses
// the types and the renderer test, the Node side the labels.

/**
 * The Open Roll 5e modules a skill or tool leans on, and what needs each. The page reads them by
 * package id (src/page/world.ts); a world without one is not an error, only a warning.
 */
export const FAMILY_MODULES = {
  battleflow: { name: 'Battle Flow', neededBy: 'the combat report' },
  areasounds: { name: 'Area Sounds', neededBy: 'configure-area-sounds' },
  openserver: { name: 'Open Server', neededBy: 'set-landing-scene' },
} as const;

export type FamilyModuleKey = keyof typeof FAMILY_MODULES;

const FAMILY_KEYS = Object.keys(FAMILY_MODULES) as FamilyModuleKey[];

/** A family module in this world: whether it is active, and its version (null when not installed). */
export interface ModuleFact {
  active: boolean;
  version: string | null;
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

/** A family module's version when it is active, else `not active`. */
export function moduleLabel(m: ModuleFact | undefined): string {
  if (!m?.active) return 'not active';
  return m.version ?? 'active';
}

/**
 * One line for the doctor and the smoke, `renderer GPU: <name>; Battle Flow 2.17.0, Area Sounds not
 * active, Open Server 1.2.0`, and whether it wants a look: a software renderer, or a family module
 * that is not active.
 */
export function bridgeLine(b: BridgeFacts | undefined): { text: string; amber: boolean } {
  const modules = FAMILY_KEYS.map(
    k => `${FAMILY_MODULES[k].name} ${moduleLabel(b?.modules?.[k])}`
  ).join(', ');
  return {
    text: `renderer ${rendererLabel(b?.renderer)}; ${modules}`,
    amber: b?.renderer?.gpu === false || FAMILY_KEYS.some(k => !b?.modules?.[k]?.active),
  };
}

/** The bridge block's module warnings: each inactive family module, naming what needs it. */
export function moduleWarnings(b: BridgeFacts | undefined): string[] {
  if (!b?.modules) return [];
  return FAMILY_KEYS.filter(k => !b.modules[k]?.active).map(
    k =>
      `${FAMILY_MODULES[k].name} is not active in this world: ${FAMILY_MODULES[k].neededBy} needs it`
  );
}
