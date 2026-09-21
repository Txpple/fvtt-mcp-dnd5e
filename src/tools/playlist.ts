import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { deletedLine, listLines, warningBlock } from '../utils/lines.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

/**
 * Playlist tools — Foundry Playlist documents over the bridge, advertised as ONE tool:
 * `manage-playlists`, selected by `action` (create / list / update / delete; src/tools/_union.ts —
 * M8 of the 3.0 plan). The page side is page/collections.ts. Paths are Data-relative (what
 * upload-asset returns), so an uploaded track chains straight into the create action with no
 * conversion — the playlist-builder skill's "upload these tracks and make a tavern ambience"
 * becomes upload-asset×N → manage-playlists create.
 */

export const MANAGE_PLAYLISTS = 'manage-playlists';

const PLAYLIST_MODES = ['sequential', 'shuffle', 'simultaneous', 'soundboard', 'disabled'] as const;

// Single source of truth for each action's input contract: the member parses with these schemas
// and the advertised JSON Schema is derived from the same zod.
const CreatePlaylistSchema = z.object({
  name: z.string().min(1).describe('Playlist name.'),
  soundPaths: z
    .array(z.string().min(1))
    .min(1)
    .describe('Data-relative paths to the sound files, in order.'),
  mode: z.enum(PLAYLIST_MODES).default('sequential'),
  defaultVolume: z.number().min(0).max(1).optional().describe('Per-track volume (default 0.5).'),
  repeat: z.boolean().default(false).describe('Each track loops.'),
  fade: z.number().min(0).optional().describe('Crossfade in ms.'),
});

const ListPlaylistsSchema = z.object({});

const UpdatePlaylistSchema = z.object({
  identifier: z.string().min(1).describe('Playlist id or exact name.'),
  name: z.string().min(1).optional().describe('New playlist name.'),
  mode: z.enum(PLAYLIST_MODES).optional(),
  fade: z.number().min(0).optional().describe('Crossfade in ms.'),
});

const DeletePlaylistSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1).describe('Exact ids (preferred) or exact names.'),
});

/** The list columns (§3: a fixed, documented order). */
const LIST_COLUMNS = ['id', 'name', 'mode', 'tracks', 'playing'] as const;

export interface PlaylistToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class PlaylistTools {
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: PlaylistToolsOptions) {
    this.logger = logger.child({ component: 'PlaylistTools' });
    this.union = unionTool({
      name: MANAGE_PLAYLISTS,
      description: 'Playlists (exact id or name): create / list / update / delete. GM-only.',
      discriminators: ['action'],
      shared: {
        mode: z
          .enum(PLAYLIST_MODES)
          .describe(
            'Playback mode (create default sequential); soundboard = disabled, the UI\'s "Soundboard Only".'
          ),
      },
      members: [
        unionMember({
          select: { action: 'create' },
          description: 'Create a Playlist, one track per path.',
          schema: CreatePlaylistSchema,
          handler: async parsed => {
            const r = await foundry.call('createPlaylist', parsed);
            return (
              `Created playlist "${r?.playlistName}" (${r?.playlistId}): mode ${r?.mode}, ` +
              `${r?.soundCount} track(s)` +
              warningBlock(r?.warnings)
            );
          },
        }),
        unionMember({
          select: { action: 'list' },
          description: 'Playlists: id, name, mode, track count, playing.',
          schema: ListPlaylistsSchema,
          handler: async () => {
            const playlists = await foundry.call('listPlaylists');
            const records = (Array.isArray(playlists) ? playlists : []).map(p => ({
              id: p.id,
              name: p.name,
              mode: p.mode,
              tracks: p.soundCount,
              playing: p.playing,
            }));
            return listLines(`${records.length} playlist(s)`, LIST_COLUMNS, records);
          },
        }),
        unionMember({
          select: { action: 'update' },
          description: "Update a Playlist's name, mode or crossfade (not its tracks).",
          schema: UpdatePlaylistSchema,
          handler: async parsed => {
            const r = await foundry.call('updatePlaylist', parsed);
            if (r?.updated === false) {
              throw new FormattedToolError(
                `Playlist not found: "${r?.notFound ?? parsed.identifier}". Nothing changed.`
              );
            }
            return `Updated playlist "${r?.playlistName}" (${r?.playlistId})`;
          },
        }),
        unionMember({
          select: { action: 'delete' },
          description: 'Permanently delete playlists.',
          schema: DeletePlaylistSchema,
          handler: async ({ identifiers }) => {
            const r = await foundry.call('deletePlaylists', { identifiers });
            return deletedLine(r, 'playlist');
          },
        }),
      ],
    });
  }

  getToolDefinitions() {
    return [this.union.def];
  }

  /** Route one playlist tool call to its member (registry-facing). */
  async handle(name: string, args: unknown): Promise<unknown> {
    if (name !== MANAGE_PLAYLISTS) throw new Error(`Unknown playlist tool: ${name}`);
    return this.union.handle(args);
  }
}
