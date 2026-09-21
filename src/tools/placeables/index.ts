// Scene PLACEABLE editing tools — the per-kind CRUD library over the shared page-side kernel
// (src/page/_placeables.ts) and per-kind descriptors (src/page/placeables/**).
//
// Separate from src/tools/scene.ts (scene-DOCUMENT tools: background, grid, mood, fog — never
// placeables) — the two axes stay hard-split. Each placeable kind is one module file here; this
// facade composes the consolidated kinds into ONE advertised tool, `manage-placeables` (kind ×
// action; src/tools/_union.ts — M8 of the 3.0 plan), and the kinds not yet consolidated as their
// pre-M8 per-op tools, asserting defs↔handlers can't drift. Full library: Tile, AmbientLight,
// AmbientSound, Drawing, Wall, Token (place/update/delete), Note (pins), Region (+ teleporter
// special ops). MeasuredTemplate is out of scope (combat ephemera, not world-building) — the
// descriptor recipe in docs/history/scene-placeables-architecture.md §3.6 makes it a cheap add.

import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { unionTool, type UnionTool } from '../_union.js';
import { sceneTarget, type PlaceableKindModule, type PlaceableToolModule } from './_module.js';
import { tileKindModule } from './tile.js';
import { lightKindModule } from './light.js';
import { soundKindModule } from './sound.js';
import { drawingKindModule } from './drawing.js';
import { wallKindModule } from './wall.js';
import { tokenToolModule } from './token.js';
import { noteToolModule } from './note.js';
import { regionToolModule } from './region.js';

export const MANAGE_PLACEABLES = 'manage-placeables';

export interface PlaceableToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class PlaceableTools {
  private logger: Logger;
  private union: UnionTool;
  private legacy: PlaceableToolModule[];
  private handlers: Record<string, (args: any) => Promise<any>>;

  constructor({ foundry, logger }: PlaceableToolsOptions) {
    this.logger = logger.child({ component: 'PlaceableTools' });
    const kinds: PlaceableKindModule[] = [
      tileKindModule(foundry),
      lightKindModule(foundry),
      wallKindModule(foundry),
      drawingKindModule(foundry),
      soundKindModule(foundry),
    ];
    this.union = unionTool({
      name: MANAGE_PLACEABLES,
      description:
        `Scene placeables by kind (${kinds.map(k => k.kind).join(' / ')}) × action (create / ` +
        'list / update / delete). sceneIdentifier omitted = the ACTIVE scene; a scene miss is an ' +
        'error. create / update take one entry per placeable and one bad entry does not fail the ' +
        'batch; create returns the ids; unresolved ids are reported, never fatal. GM-only.',
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

    this.legacy = [tokenToolModule(foundry), noteToolModule(foundry), regionToolModule(foundry)];
    // Compose the name->handler map and fail LOUDLY on any def↔handler drift or name collision.
    this.handlers = { [MANAGE_PLACEABLES]: args => this.union.handle(args) };
    for (const m of this.legacy) {
      const defNames = new Set(m.defs.map(d => d.name));
      for (const name of Object.keys(m.handlers)) {
        if (!defNames.has(name)) {
          throw new Error(`Placeable tool "${name}" has a handler but no advertised definition`);
        }
        if (this.handlers[name]) {
          throw new Error(`Placeable tool "${name}" is defined by two modules`);
        }
        this.handlers[name] = m.handlers[name];
      }
      for (const name of defNames) {
        if (!m.handlers[name]) {
          throw new Error(`Placeable tool "${name}" is advertised but has no handler`);
        }
      }
    }
  }

  getToolDefinitions() {
    return [this.union.def, ...this.legacy.flatMap(m => m.defs)];
  }

  /** Route one placeable tool call to its handler (registry-facing). */
  async handle(name: string, args: any): Promise<any> {
    const handler = this.handlers[name];
    if (!handler) throw new Error(`Unknown placeable tool: ${name}`);
    return handler(args);
  }
}
