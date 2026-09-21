// The per-kind module contract for the placeable tools package.
//
// Each placeable kind is ONE file exporting `<kind>KindModule(foundry)`: its hand-tuned zod schemas
// (the LLM-facing contract) and one ACTION per op — description, schema, handler side by side —
// which the facade (index.ts) composes into the single `manage-placeables` union tool (kind ×
// action; src/tools/_union.ts). Correctness lives in the page-side descriptor
// (src/page/placeables/<kind>.ts); judgment lives in the skills.
//
// `PlaceableToolModule` is the pre-M8 shape (one advertised tool per op, keyed by name) the kinds
// not yet consolidated still export; it goes when the last of them moves.

import type { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';

export interface PlaceableAction {
  /** The `action` discriminator value: create / list / update / delete, or a kind's special op. */
  action: string;
  /** What the op's tool advertised before the consolidation — the member description. */
  description: string;
  /** The op's own zod object (no discriminators); parsed at dispatch, refinements included. */
  schema: z.ZodObject<any>;
  handler: (parsed: any) => Promise<unknown>;
}

/** Declare an action with the handler typed by its schema's output. */
export function placeableAction<S extends z.ZodObject<any>>(a: {
  action: string;
  description: string;
  schema: S;
  handler: (parsed: z.output<S>) => Promise<unknown>;
}): PlaceableAction {
  return a;
}

export interface PlaceableKindModule {
  /** The `kind` discriminator value — the plural noun the old tool names carried (tiles, walls …). */
  kind: string;
  actions: PlaceableAction[];
}

export type PlaceableKindFactory = (foundry: FoundryBridge) => PlaceableKindModule;

/** Pre-M8: advertised definitions + handlers keyed by tool name (the facade asserts they match). */
export interface PlaceableToolModule {
  defs: Array<{ name: string; description: string; inputSchema: unknown }>;
  handlers: Record<string, (args: any) => Promise<any>>;
}

export type PlaceableModuleFactory = (foundry: FoundryBridge) => PlaceableToolModule;

/** The one scene-target base every placeable schema composes (src/tools/_targets.ts). */
export { sceneTarget } from '../_targets.js';
