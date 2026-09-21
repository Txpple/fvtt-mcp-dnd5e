// Scene PLACEABLE editing tools — the per-kind CRUD library over the shared page-side kernel
// (src/page/_placeables.ts) and per-kind descriptors (src/page/placeables/**), advertised as ONE
// tool: `manage-placeables`, selected by kind × action (src/tools/_union.ts — M8 of the 3.0 plan).
//
// Separate from src/tools/scene.ts (scene-DOCUMENT tools: background, grid, mood, fog — never
// placeables) — the two axes stay hard-split. Each placeable kind is one module file here (its
// schemas and one action per op); this facade composes them. Full library: Tile, AmbientLight,
// Wall, Drawing, AmbientSound, Note (pins), Token (place / the actor→all-copies update / delete),
// Region (+ the teleporter / behavior / remap specials). MeasuredTemplate is out of scope (combat
// ephemera, not world-building) — the descriptor recipe in
// docs/history/scene-placeables-architecture.md §3.6 makes it a cheap add if ever wanted.

import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { unionTool, type UnionTool } from '../_union.js';
import { sceneTarget, type PlaceableKindModule } from './_module.js';
import { tileKindModule } from './tile.js';
import { lightKindModule } from './light.js';
import { wallKindModule } from './wall.js';
import { drawingKindModule } from './drawing.js';
import { soundKindModule } from './sound.js';
import { noteKindModule } from './note.js';
import { tokenKindModule } from './token.js';
import { regionKindModule } from './region.js';

export const MANAGE_PLACEABLES = 'manage-placeables';

export interface PlaceableToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class PlaceableTools {
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: PlaceableToolsOptions) {
    this.logger = logger.child({ component: 'PlaceableTools' });
    const kinds: PlaceableKindModule[] = [
      tileKindModule(foundry),
      lightKindModule(foundry),
      wallKindModule(foundry),
      drawingKindModule(foundry),
      soundKindModule(foundry),
      noteKindModule(foundry),
      tokenKindModule(foundry),
      regionKindModule(foundry),
    ];
    this.union = unionTool({
      name: MANAGE_PLACEABLES,
      description:
        'Scene placeables: kind × action (create / list / update / delete; regions also ' +
        'create-teleporter / add-behavior / remap-teleporters). sceneIdentifier omitted = the ' +
        'ACTIVE scene; a scene miss is an error. create / update take one entry per placeable, ' +
        'one bad entry does not fail the batch, create returns the ids, unresolved ids are ' +
        'reported, never fatal. GM-only.',
      discriminators: ['kind', 'action'],
      shared: { sceneIdentifier: sceneTarget },
      members: kinds.flatMap(k =>
        k.actions.map(a => ({
          select: { kind: k.kind, action: a.action },
          description: a.description,
          schema: a.schema,
          handler: a.handler,
        }))
      ),
    });
  }

  getToolDefinitions() {
    return [this.union.def];
  }

  /** Route one placeable tool call to its handler (registry-facing). */
  async handle(name: string, args: any): Promise<any> {
    if (name !== MANAGE_PLACEABLES) throw new Error(`Unknown placeable tool: ${name}`);
    return this.union.handle(args);
  }
}
