import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { SCENE_TARGET, sceneTargetRequired } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import type { Host } from '../hosts/types.js';
import { filePlaneFor } from '../hosts/index.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { deletedLine, listLines, warningBlock } from '../utils/lines.js';
import { toInputSchema } from '../utils/schema.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

export interface SceneToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
  /** Where Foundry runs — reported by get-world-info so a session knows which instance and plane it is on. */
  host?: Host;
}

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.
const GetCurrentSceneSchema = z.object({
  includeTokens: z.boolean().default(true).describe('Include the placed tokens (default true).'),
  includeHidden: z.boolean().default(false).describe('Include hidden tokens too (default false).'),
});

const GetWorldInfoSchema = z.object({});

const ActivateSceneSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
});

const PullUsersToSceneSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
  userIdentifiers: z
    .array(z.string().min(1))
    .min(1, 'At least one user identifier is required')
    .describe('User ids or exact names; only connected users can be pulled.'),
});

const SetLandingSceneSchema = z.object({
  sceneIdentifier: sceneTargetRequired.describe(
    `${SCENE_TARGET} they log in to; "none" clears it (back to the active scene).`
  ),
  userIdentifiers: z
    .array(z.string().min(1))
    .min(1, 'At least one user identifier is required')
    .describe('User ids or exact names; offline users included.'),
});

// --- Scene authoring (create/list/update/delete) ----------------------------------------------
// Moved here from the old AssetBridgeTools so all scene tools live in one domain class (mirrors the
// page-side scenes.ts). Paths are Data-relative (what upload-asset returns); the page side validates
// `weather` against the live CONFIG.weatherEffects and resolves playlist/journal name→id.

// Cross-cutting scene fields shared by create-scene and update-scene (one source of truth).
const sceneCommonFields = {
  gridDistance: z
    .number()
    .positive()
    .optional()
    .describe('Real-world distance per grid cell (dnd5e default 5).'),
  gridUnits: z
    .string()
    .optional()
    .describe('Distance unit label per cell, e.g. "ft" (dnd5e default).'),
  gridColor: z.string().optional().describe('Grid line color as a hex string, e.g. "#000000".'),
  gridAlpha: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Grid line opacity 0–1 (e.g. 0.2 for a faint grid).'),
  tokenVision: z.boolean().optional().describe('Require token line-of-sight to see the scene.'),
  fogMode: z
    .enum(['disabled', 'individual', 'shared'])
    .optional()
    .describe('Fog of war: individual is per player, shared party-wide.'),
  darkness: z.number().min(0).max(1).optional().describe('0 = daylight, 1 = night.'),
  globalLight: z.boolean().optional().describe('Illuminate the whole scene.'),
  weather: z
    .string()
    .optional()
    .describe('Weather effect key (rain, snow, fog, leaves, rainStorm, blizzard …); "" = none.'),
  playlist: z
    .string()
    .optional()
    .describe('Playlist id or exact name played on activation; "" clears.'),
  journal: z
    .string()
    .optional()
    .describe('JournalEntry id or exact name as the scene notes; "" clears.'),
  thumb: z
    .string()
    .optional()
    .describe('Data-relative path of a pre-rendered nav thumbnail (Foundry may regenerate it).'),
};

// A wall placeable from a map sidecar JSON. Accepts the LEGACY Foundry shape OR the v14 shape; the
// page side normalizes either to the v14 WallDocument. `c` is [x0,y0,x1,y1] in ABSOLUTE canvas pixels.
const SidecarWallSchema = z
  .object({
    c: z.array(z.number()).length(4).describe('Endpoint coords [x0,y0,x1,y1] in canvas pixels.'),
    move: z.number().optional().describe('Movement restriction (legacy 1 or v14 20).'),
    sense: z.number().optional().describe('Legacy sight restriction (→ v14 sight+light).'),
    sight: z.number().optional().describe('v14 sight restriction.'),
    sound: z.number().optional().describe('Sound restriction.'),
    light: z.number().optional().describe('v14 light restriction.'),
    door: z.number().optional().describe('Door type (0 none, 1 door, 2 secret).'),
    ds: z.number().optional().describe('Door state (0 closed, 1 open, 2 locked).'),
    dir: z.number().optional().describe('Wall direction (0 both, 1 left, 2 right).'),
  })
  .passthrough();

// An ambient-light placeable from a map sidecar JSON. Accepts the LEGACY flat shape OR the v14
// shape (`config{}`); the page side nests emission props under `config`. x/y are absolute canvas pixels.
const SidecarLightSchema = z
  .object({
    x: z.number().describe('Light center X in canvas pixels.'),
    y: z.number().describe('Light center Y in canvas pixels.'),
    dim: z.number().optional().describe('Dim radius in grid-distance units (e.g. ft).'),
    bright: z.number().optional().describe('Bright radius in grid-distance units (e.g. ft).'),
    tintColor: z.string().optional().describe('Legacy tint color hex (→ config.color).'),
    tintAlpha: z.number().optional().describe('Legacy tint opacity 0–1 (→ config.alpha).'),
    color: z.string().optional().describe('v14 tint color hex.'),
    alpha: z.number().optional().describe('v14 tint opacity 0–1.'),
    rotation: z.number().optional().describe('Light rotation in degrees.'),
    angle: z.number().optional().describe('Emission cone angle in degrees (360 = full).'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "The light's full `config` (luminosity, attenuation, animation, darkness …), verbatim over " +
          'the flat fields.'
      ),
  })
  .passthrough();

// A region placeable (v12+ RegionDocument) from a scene-pack payload, carried WHOLE (typed minimal
// + .passthrough(), NOT z.any() — keeps the generated JSON schema useful). The page side strips the
// source/cli ids, stamps the source `_id` as a provenance flag, and creates it; cross-scene
// teleporter destinations are rewritten afterward by remap-teleporters (the ids are minted fresh).
const RegionSidecarSchema = z
  .object({
    name: z.string().optional().describe('Region label.'),
    color: z.string().optional().describe('Region tint hex.'),
    shapes: z
      .array(z.object({ type: z.string().optional() }).passthrough())
      .optional()
      .describe('Shapes (polygon / rectangle / ellipse), carried whole.'),
    elevation: z
      .object({
        bottom: z.number().nullable().optional(),
        top: z.number().nullable().optional(),
      })
      .passthrough()
      .optional()
      .describe('Region elevation band {bottom,top}.'),
    visibility: z.number().optional().describe('Region visibility mode.'),
    behaviors: z
      .array(
        z
          .object({
            type: z.string().optional(),
            system: z.object({}).passthrough().optional(),
          })
          .passthrough()
      )
      .optional()
      .describe(
        'Behaviors carried whole; teleportToken destinations are rewritten by the teleporter remap.'
      ),
    _id: z
      .string()
      .optional()
      .describe('Source region id, stamped as a provenance flag for the remap.'),
  })
  .passthrough();

// Modern-pack scene MOOD objects, carried mostly-whole (typed minimal + .passthrough()) so a v12+
// scene's full environment/fog and saved camera round-trip — not just the scalar knobs in
// sceneCommonFields. Minimal typing (not z.any()) keeps the generated JSON schema useful.
const SceneEnvironmentSchema = z
  .object({
    darknessLevel: z.number().min(0).max(1).optional(),
    globalLight: z.object({ enabled: z.boolean().optional() }).passthrough().optional(),
    cycle: z.boolean().optional(),
  })
  .passthrough();
const SceneFogSchema = z
  .object({
    exploration: z.boolean().optional(),
    overlay: z.string().nullable().optional(),
  })
  .passthrough();
const SceneInitialSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    scale: z.number().optional(),
  })
  .passthrough();

// Modern scene MOOD / saved-camera / flags fields shared by BOTH create-scene and update-scene (one
// source of truth so the two schemas can't drift). Each is deep-merged onto the scene on both paths —
// a partial patch layers on rather than replacing — which is what lets update-scene re-mood, re-frame,
// or re-flag a scene authored elsewhere (the create⊂update gap these close).
const sceneMoodFields = {
  environment: SceneEnvironmentSchema.optional().describe(
    'The full environment{} mood (darknessLevel, globalLight, cycle, base, dark …), deep-merged.'
  ),
  fog: SceneFogSchema.optional().describe(
    'The full fog{} (exploration, overlay, colors), deep-merged.'
  ),
  initial: SceneInitialSchema.optional().describe('The saved camera {x, y, scale}, deep-merged.'),
  flags: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Document flags by scope, e.g. {"<module>": {sourceId}}; deep-merged.'),
};

export const MANAGE_SCENES = 'manage-scenes';

// The geometry / navigation leaves both create and update take. With the mood and common fields
// they are the union's `shared` root leaves — described ONCE, each member advertising them bare —
// which is where the scene family's byte win comes from (the two tools had inlined them twice).
const sceneGeometryFields = {
  backgroundPath: z
    .string()
    .min(1)
    .optional()
    .describe('Data-relative path to the background/map image (create: required).'),
  width: z.number().int().positive().optional().describe('Pixels; create default from the image.'),
  height: z.number().int().positive().optional().describe('Pixels; create default from the image.'),
  gridSize: z.number().int().positive().optional().describe('Grid size in pixels (default 100).'),
  gridType: z.number().int().min(0).optional().describe('0 gridless, 1 square (default), 2+ hex.'),
  padding: z.number().min(0).max(0.5).optional().describe('Padding fraction, 0–0.5.'),
  navigation: z.boolean().optional().describe('Shown in the player navigation bar.'),
};

const sceneSharedFields = { ...sceneGeometryFields, ...sceneMoodFields, ...sceneCommonFields };

const CreateSceneSchema = z.object({
  name: z.string().min(1).describe('Scene name.'),
  walls: z
    .array(SidecarWallSchema)
    .optional()
    .describe('Inline walls in absolute canvas pixels (a file on disk: placeablesPath).'),
  lights: z
    .array(SidecarLightSchema)
    .optional()
    .describe('Inline ambient lights (a file on disk: placeablesPath).'),
  regions: z
    .array(RegionSidecarSchema)
    .optional()
    .describe(
      'Regions (teleporters included), each stamped with its source id for the teleporter remap.'
    ),
  placeablesPath: z
    .string()
    .optional()
    .describe(
      'Server-local JSON with {walls, lights, regions} (a map sidecar), read whole and merged with ' +
        'the inline arrays.'
    ),
  activate: z.boolean().default(false).describe('Activate the scene after creating it.'),
  folder: z.string().optional().describe('Scene folder id or exact name (created if absent).'),
  ...sceneSharedFields,
  backgroundPath: z.string().min(1),
});

const ListScenesSchema = z.object({
  filter: z.string().optional().describe('Case-insensitive substring match on scene name.'),
  includeActiveOnly: z.boolean().optional().describe('Only the active scene (default false).'),
  flagScope: z
    .string()
    .optional()
    .describe("Also print flags[<scope>] per scene (a scene pack's provenance stamp, for dedup)."),
});

const UpdateSceneSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
  name: z.string().min(1).optional().describe('New scene name.'),
  navName: z.string().optional().describe('Navigation-bar label.'),
  ...sceneSharedFields,
});

const DeleteSceneSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids or exact names.'),
});

/** The list columns (§3: a fixed, documented order); `flags` is appended under `flagScope`. */
const LIST_COLUMNS = [
  'id',
  'name',
  'active',
  'width',
  'height',
  'grid',
  'darkness',
  'weather',
  'tokens',
  'walls',
] as const;

const GetSceneDimensionsSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
});

const ScreenshotSceneSchema = z.object({
  sceneIdentifier: sceneTargetRequired,
  outputPath: z
    .string()
    .optional()
    .describe('Absolute local path for the PNG; default a temp file (returned).'),
  fit: z.boolean().default(true).describe('Fit the whole scene; false keeps the saved camera.'),
  mark: z
    .boolean()
    .default(false)
    .describe('Draw a numbered marker over each note pin (view-only overlay).'),
});

export class SceneTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private host: Host | undefined;
  private union: UnionTool;

  constructor({ foundry, logger, host }: SceneToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'SceneTools' });
    this.host = host;
    this.union = unionTool({
      name: MANAGE_SCENES,
      description:
        'Scene documents: create / list / update / delete — never placeables (manage-placeables), ' +
        'never the active flag (activate-scene). Paths are Data-relative; the mood / camera / flags ' +
        'objects deep-merge. GM-only writes.',
      discriminators: ['action'],
      shared: sceneSharedFields,
      members: [
        unionMember({
          select: { action: 'create' },
          description:
            'Create a Scene from a background image: size from the image unless given, the nav ' +
            'thumbnail generated unless thumb is given, optionally activated; walls, lights and ' +
            'regions import inline or from placeablesPath (legacy or v14 shapes, normalized).',
          schema: CreateSceneSchema,
          handler: parsed => this.createScene(parsed),
        }),
        unionMember({
          select: { action: 'list' },
          description:
            'Scenes: id, name, active, W × H, grid, darkness 0–1, weather, token / wall counts ' +
            '(+ flags[flagScope]). Background path: get-current-scene.',
          schema: ListScenesSchema,
          handler: async parsed => {
            const scenes = await this.foundry.call('listScenes', parsed);
            const records = (Array.isArray(scenes) ? scenes : []).map(s => ({
              id: s.id,
              name: s.name,
              active: s.active ?? false,
              width: s.width ?? null,
              height: s.height ?? null,
              grid: s.grid ?? null,
              darkness: typeof s.darkness === 'number' ? s.darkness : null,
              weather: s.weather || null,
              tokens: s.tokens ?? 0,
              walls: s.walls ?? 0,
              ...(parsed.flagScope !== undefined ? { flags: s.flags ?? null } : {}),
            }));
            const columns =
              parsed.flagScope !== undefined ? [...LIST_COLUMNS, 'flags'] : [...LIST_COLUMNS];
            return listLines(`${records.length} scene(s)`, columns, records);
          },
        }),
        unionMember({
          select: { action: 'update' },
          description:
            'Update a Scene: name, background, navigation, dimensions / grid / padding, vision, fog, ' +
            'lighting, weather, playlist / journal ("" clears), the mood / camera / flags objects.',
          schema: UpdateSceneSchema,
          handler: async parsed => {
            const result = await this.foundry.call('updateScene', parsed);
            if (result?.updated === false) {
              throw new FormattedToolError(
                `Scene not found: "${result?.notFound ?? parsed.sceneIdentifier}". Nothing changed.`
              );
            }
            return (
              `Updated scene "${result?.sceneName}" (${result?.sceneId})\n  background: ${result?.background}` +
              formatSceneSettings(result?.settings) +
              warningBlock(result?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Permanently delete scenes.',
          schema: DeleteSceneSchema,
          handler: async ({ identifiers }) => {
            const result = await this.foundry.call('deleteScenes', { identifiers });
            return deletedLine(result, 'scene');
          },
        }),
      ],
    });
  }

  /** The scene-document union (registry-facing). */
  async handleManageScenes(args: unknown): Promise<unknown> {
    return this.union.handle(args);
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      this.union.def,
      {
        name: 'get-current-scene',
        description:
          'The ACTIVE scene: size, background path, darkness 0–1, weather, element counts, ' +
          'tokens (position, actor, disposition), note pins.',
        inputSchema: toInputSchema(GetCurrentSceneSchema),
      },
      {
        name: 'get-world-info',
        description:
          'The world: id, title, system + Foundry versions, host (and whether the asset file ' +
          'tools have a plane here), user counts, who is online, and the dnd5e automation switches. ' +
          'READ-ONLY — world metadata has no write tool; edit it in the in-app "Edit World" dialog.',
        inputSchema: toInputSchema(GetWorldInfoSchema),
      },
      {
        name: 'activate-scene',
        description:
          'Make a scene the one active scene (every connected player lands on it); the previous one ' +
          'is reported, already active is a no-op. Some players only: pull-users-to-scene. GM-only.',
        inputSchema: toInputSchema(ActivateSceneSchema),
      },
      {
        name: 'pull-users-to-scene',
        description:
          "Pull users' view to a scene without activating it (no scene ownership needed). Reports " +
          'pulled / offline / notFound per user — only connected users move, and the bridge user ' +
          'itself cannot be pulled (selfSkipped). GM-only.',
        inputSchema: toInputSchema(PullUsersToSceneSchema),
      },
      {
        name: 'set-landing-scene',
        description:
          'Set the scene users land on at login (a persistent User flag the openserver companion ' +
          'module acts on; warns when it is not installed). Works on offline users; "none" clears. ' +
          'Reports who is assigned and who follows the active scene. GM-only.',
        inputSchema: toInputSchema(SetLandingSceneSchema),
      },
      {
        name: 'get-scene-dimensions',
        description:
          "A scene's padded-canvas geometry: total width / height, the background rect within the " +
          'padding (sceneX / sceneY / sceneWidth / sceneHeight — a canvas pixel is offset by these, ' +
          'not gridCell × size), grid size / distance, rows / columns. Any scene, active or not.',
        inputSchema: toInputSchema(GetSceneDimensionsSchema),
      },
      {
        name: 'screenshot-scene',
        description:
          'Render a scene in the headless bridge to a local PNG: the whole map fitted (or the saved ' +
          'camera with fit:false), numbered note-pin markers with mark:true. Returns the file path ' +
          'and scene metadata. GM-only.',
        inputSchema: toInputSchema(ScreenshotSceneSchema),
      },
    ];
  }

  private async createScene(parsed: z.output<typeof CreateSceneSchema>): Promise<string> {
    const callArgs: any = { ...parsed };
    // Pull walls/lights from a read-pack payload file SERVER-SIDE (they never transit the agent).
    if (callArgs.placeablesPath) {
      let payload: any;
      try {
        payload = JSON.parse(readFileSync(callArgs.placeablesPath, 'utf8'));
      } catch (err) {
        throw new Error(
          `manage-scenes create: could not read placeablesPath "${callArgs.placeablesPath}": ${(err as Error).message}`
        );
      }
      if (Array.isArray(payload?.walls))
        callArgs.walls = [...(callArgs.walls ?? []), ...payload.walls];
      if (Array.isArray(payload?.lights))
        callArgs.lights = [...(callArgs.lights ?? []), ...payload.lights];
      if (Array.isArray(payload?.regions))
        callArgs.regions = [...(callArgs.regions ?? []), ...payload.regions];
      delete callArgs.placeablesPath; // page-side createScene doesn't know this field
    }
    const result = await this.foundry.call('createScene', callArgs);
    const dims =
      result?.width && result?.height
        ? `\n  dimensions: ${result.width}×${result.height}px${result.autoSized ? ' (auto from image)' : ''}`
        : '';
    const placeables: string[] = [];
    if (typeof result?.wallsCreated === 'number') placeables.push(`${result.wallsCreated} wall(s)`);
    if (typeof result?.lightsCreated === 'number')
      placeables.push(`${result.lightsCreated} light(s)`);
    if (typeof result?.regionsCreated === 'number')
      placeables.push(`${result.regionsCreated} region(s)`);
    const placeableLine = placeables.length ? `\n  imported: ${placeables.join(', ')}` : '';
    // Regions can hold cross-scene teleporters whose destinations need a post-import remap pass.
    const teleportHint =
      (result.regionsCreated ?? 0) > 0
        ? '\n  ↪ regions imported — run manage-placeables (regions, remap-teleporters) once after all scenes to link teleporters'
        : '';
    const placeableErrs = Array.isArray(result?.placeableErrors)
      ? result.placeableErrors.map((e: string) => `\n  ⚠ ${e}`).join('')
      : '';
    const folderLine = result?.folderName ? `\n  folder: ${result.folderName}` : '';
    const thumbLine = result?.autoThumbnail ? '\n  thumbnail: auto-generated from background' : '';
    return (
      `Created scene "${result?.sceneName}" (${result?.sceneId})` +
      `${result?.active ? ' [active]' : ''}\n  background: ${result?.background}` +
      dims +
      folderLine +
      thumbLine +
      placeableLine +
      teleportHint +
      placeableErrs +
      formatSceneSettings(result?.settings) +
      warningBlock(result?.warnings)
    );
  }

  async handleGetSceneDimensions(args: any): Promise<any> {
    const parsed = GetSceneDimensionsSchema.parse(args ?? {});
    const result = await this.foundry.call('getSceneDimensions', parsed);
    if (result?.found === false) {
      return `Scene not found: "${result?.notFound ?? parsed.sceneIdentifier}".`;
    }
    return result;
  }

  async handleScreenshotScene(args: any): Promise<string> {
    const parsed = ScreenshotSceneSchema.parse(args ?? {});
    // Page-side: view + fit + (optional) marker overlay, returning scene metadata.
    const meta = await this.foundry.call('prepareSceneShot', {
      sceneIdentifier: parsed.sceneIdentifier,
      fit: parsed.fit,
      mark: parsed.mark,
    });
    if (!meta?.found) {
      return `Scene not found: "${meta?.notFound ?? parsed.sceneIdentifier}". Nothing captured.`;
    }
    // Bridge-side (Playwright): capture the rendered page to a file. Default to a temp path.
    const safeId = String(meta.sceneId ?? 'scene').replace(/[^a-zA-Z0-9_-]/g, '');
    const outPath = parsed.outputPath || join(tmpdir(), `fvtt-scene-${safeId}.png`);
    await this.foundry.screenshot(outPath);
    const dims = meta.dimensions
      ? `\n  canvas: ${meta.dimensions.width}×${meta.dimensions.height}px (renderer ${meta.renderer ?? '?'})`
      : '';
    return (
      `Captured "${meta.sceneName}" (${meta.sceneId}) → ${outPath}` +
      (parsed.mark ? `\n  marked ${meta.noteCount ?? 0} note pin(s)` : '') +
      dims +
      '\n  (open or Read the file to view the image)'
    );
  }

  async handleActivateScene(args: any): Promise<string> {
    const parsed = ActivateSceneSchema.parse(args ?? {});
    const result = await this.foundry.call('activateScene', parsed);

    if (result?.success === false) {
      return `Scene not found: "${result?.notFound ?? parsed.sceneIdentifier}". Nothing changed.`;
    }

    const name = `"${result?.scene?.name}" (${result?.scene?.id})`;
    if (result?.alreadyActive) {
      return `Scene ${name} was ALREADY the active scene — nothing changed.`;
    }

    return (
      `⚡ Activated scene ${name} — connected clients follow it and users land there on login.` +
      (result?.previous
        ? `\n  previously active: "${result.previous.name}" (${result.previous.id})`
        : '')
    );
  }

  async handlePullUsersToScene(args: any): Promise<string> {
    const parsed = PullUsersToSceneSchema.parse(args ?? {});
    const result = await this.foundry.call('pullUsersToScene', parsed);

    if (result?.sceneNotFound) {
      return `Scene not found: "${result.sceneNotFound}". Nothing changed.`;
    }

    const scene = `"${result?.scene?.name}" (${result?.scene?.id})`;
    const pulled: Array<{ name: string }> = result?.pulled ?? [];
    const offline: Array<{ name: string }> = result?.offline ?? [];
    const selfSkipped: Array<{ name: string }> = result?.selfSkipped ?? [];
    const notFound: string[] = result?.notFound ?? [];

    const head = pulled.length
      ? `👁️ Pulled ${pulled.length} user(s) to ${scene}: ${pulled.map(u => u.name).join(', ')}` +
        `\n  (the active scene is unchanged — everyone else stays where they are)`
      : `⚠️ Nobody was pulled to ${scene}.`;

    return (
      head +
      (offline.length
        ? `\n⚠️ Offline, so NOT pulled (core skips disconnected users — pull them once they log in): ${offline
            .map(u => u.name)
            .join(', ')}`
        : '') +
      (selfSkipped.length
        ? `\n⚠️ Cannot pull the bridge user itself (${selfSkipped
            .map(u => u.name)
            .join(', ')}) — pullUsers works over a socket, which is never echoed back to the ` +
          `sending client. Nothing to do: the bridge has no visible canvas anyone is watching.`
        : '') +
      (notFound.length ? `\n⚠️ No such user: ${notFound.join(', ')}` : '')
    );
  }

  async handleSetLandingScene(args: any): Promise<string> {
    const parsed = SetLandingSceneSchema.parse(args ?? {});
    const result = await this.foundry.call('setLandingScene', parsed);

    if (result?.sceneNotFound) {
      return (
        `Scene not found: "${result.sceneNotFound}". Nothing changed. ` +
        '(Pass "none" if you meant to CLEAR the assignment.)'
      );
    }

    const assigned: Array<{ name: string; previous: string | null }> = result?.assigned ?? [];
    const unchanged: Array<{ name: string }> = result?.unchanged ?? [];
    const notFound: string[] = result?.notFound ?? [];
    const followActive: Array<{ name: string }> = result?.followActive ?? [];
    const warnings: string[] = result?.warnings ?? [];
    const active = result?.activeScene
      ? `"${result.activeScene.name}" (${result.activeScene.id})`
      : 'none';

    let head: string;
    if (!assigned.length) {
      head = '⚠️ No landing-scene assignments changed.';
    } else if (result?.cleared) {
      head =
        `🧭 Cleared the landing scene for ${assigned.length} user(s): ` +
        `${assigned.map(u => `${u.name}${u.previous ? ` (was "${u.previous}")` : ''}`).join(', ')}` +
        `\n  They now log in to the ACTIVE scene like everyone else.`;
    } else {
      head =
        `🧭 ${assigned.length} user(s) will now LOG IN to "${result.scene?.name}" ` +
        `(${result.scene?.id}): ` +
        `${assigned.map(u => `${u.name}${u.previous ? ` (was "${u.previous}")` : ''}`).join(', ')}` +
        `\n  Sticky until cleared, and it takes effect on their next login/refresh — ` +
        `use pull-users-to-scene to move someone who is already connected.`;
    }

    return (
      head +
      `\n  active scene (where unassigned users land): ${active}` +
      (followActive.length
        ? `\n  still following the active scene: ${followActive.map(u => u.name).join(', ')}`
        : '\n  every user now has an explicit landing scene.') +
      (unchanged.length
        ? `\n  already set that way, untouched: ${unchanged.map(u => u.name).join(', ')}`
        : '') +
      (notFound.length ? `\n⚠️ No such user: ${notFound.join(', ')}` : '') +
      (warnings.length ? `\n\n⚠️ ${warnings.map(w => `- ${w}`).join('\n')}` : '')
    );
  }

  async handleGetCurrentScene(args: any): Promise<any> {
    const { includeTokens, includeHidden } = GetCurrentSceneSchema.parse(args);

    this.logger.info('Getting current scene information', { includeTokens, includeHidden });

    const sceneData = await this.foundry.call('getActiveScene');

    this.logger.debug('Successfully retrieved scene data', {
      sceneId: sceneData.id,
      sceneName: sceneData.name,
      tokenCount: sceneData.tokens?.length || 0,
    });

    return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    const worldData = await this.foundry.call('getWorldInfo');

    this.logger.debug('Successfully retrieved world data', {
      worldId: worldData.id,
      system: worldData.system,
    });

    return this.formatWorldResponse(worldData);
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      background: sceneData.background || null,
      darkness: sceneData.darkness,
      weather: sceneData.weather || '',
      navigation: sceneData.navigation,
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    // The world description (HTML, ~760 chars) and join-page background are not returned: no
    // skill reads them and they rode along on every session start (start-session, session-audit).
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      // Where this instance runs (src/hosts) and which file plane the asset file tools use here
      // (the host's direct plane, else Foundry's own FilePicker through the bridge).
      ...(this.host
        ? {
            host: {
              kind: this.host.kind,
              label: this.host.label,
              files: filePlaneFor(this.host, this.foundry).label,
            },
          }
        : {}),
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
      // The user the bridge joined as and its role (writes need ASSISTANT / GAMEMASTER).
      ...(worldData.bridgeUser ? { bridgeUser: worldData.bridgeUser } : {}),
      // The premium books (design.md §2.3): present = packs registered, missing = not installed
      // or inactive. The authoring skills need MM / PHB / DMG; the rest are optional extensions.
      ...(worldData.library ? { library: worldData.library } : {}),
      // dnd5e 6.0 automation switches + the calendar (configure-dnd5e-settings / manage-calendar)
      ...(worldData.automation ? { automation: worldData.automation } : {}),
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }
}

/**
 * Compact one-line summary of a scene's effective settings for tool output.
 * Grid/vision/fog are always shown (always relevant); darkness, global light,
 * weather, and links appear only when non-default/set, to keep the line short.
 * Returns '' when there are no settings to report (keeps legacy output stable).
 */
function formatSceneSettings(s: any): string {
  if (!s || typeof s !== 'object') return '';
  const parts: string[] = [];
  const g = s.grid ?? {};
  // gridType 0 = gridless (no overlay); 2+ = hex. Show the type so a gridless/hex change is
  // confirmable from the report (not just the size line, which looks identical for square vs gridless).
  if (g.type === 0) {
    parts.push('gridless');
  } else if (g.size != null || g.distance != null) {
    const hex = typeof g.type === 'number' && g.type >= 2 ? ' hex' : '';
    parts.push(
      `grid ${g.size ?? '?'}px = ${g.distance ?? '?'}${g.units ? ` ${g.units}` : ''}${hex}`
    );
  }
  if (s.tokenVision != null) parts.push(`vision ${s.tokenVision ? 'on' : 'off'}`);
  if (s.fogMode) parts.push(`fog ${s.fogMode}`);
  if (typeof s.darkness === 'number' && s.darkness > 0) parts.push(`darkness ${s.darkness}`);
  if (s.globalLight === true) parts.push('global light on');
  if (s.weather) parts.push(`weather ${s.weather}`);
  if (typeof s.navigation === 'boolean') parts.push(`nav ${s.navigation ? 'on' : 'off'}`);
  if (s.playlist) parts.push(`playlist ${s.playlist}`);
  if (s.journal) parts.push(`journal ${s.journal}`);
  return parts.length ? `\n  settings: ${parts.join(', ')}` : '';
}
