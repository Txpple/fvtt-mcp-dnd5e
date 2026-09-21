// Toolsets — the named slices of the tool surface a registration can choose to advertise.
//
// Why: the full surface is ~150 tools, ~57k tokens of tools/list. A client that loads MCP schemas
// eagerly pays that before the first word — twice, when prod and the sandbox are both registered.
// A registration that only ever narrates a session, or only ever manages files, can say so:
//
//     "env": { "FOUNDRY_TOOLSETS": "world,chat,combat" }
//
// and advertise just those. Unset = everything (the skills need the whole surface). `session` is
// always on — get-world-info / disconnect-bridge are the session's lifeline whatever else is off;
// the world-level writes (`settings`) are opt-in like every other family, so a narrow
// registration does not carry them (M7 of the 3.0 plan: the always-on set ≤ 2,100 chars).
//
// This table is the single source of truth: every dispatchable tool belongs to exactly ONE
// toolset, and registry.test.ts fails the build if a tool is unlisted, listed twice, or listed
// without a handler. A call to a tool outside the enabled set is refused BY NAME (which toolset,
// how to enable it), never as "unknown tool".

export const TOOLSETS = {
  /** The session's lifeline: always advertised, whatever else is off. */
  session: ['get-world-info', 'get-current-scene', 'disconnect-bridge', 'list-users'],
  /** World-level state: user accounts, the dnd5e automation switches, the calendar. */
  settings: ['update-user', 'set-user-avatar', 'configure-dnd5e-settings', 'manage-calendar'],
  /** Actors — NPCs and PCs, their sheets, effects, activities, inventory, groups, art, ownership. */
  actors: [
    'get-actor',
    'export-actor',
    'list-actors',
    'get-actor-entity',
    'search-actor-contents',
    'create-actor-from-compendium',
    'author-npc',
    'create-pc',
    'inspect-pc-advancement',
    'level-up-pc',
    'create-pc-from-prefab',
    'duplicate-actor',
    'delete-actor',
    'update-actor',
    'update-actor-item',
    'manage-activity',
    'add-free-cast',
    'manage-effect',
    'apply-condition',
    'add-item',
    'import-item',
    'content-audit',
    'add-feature',
    'remove-from-actor',
    'create-group',
    'manage-group-members',
    'get-group',
    'set-primary-party',
    'set-actor-ownership',
    'list-actor-ownership',
    'set-actor-art',
  ],
  /** World (sidebar) Items. */
  items: ['create-item', 'list-items', 'get-item', 'update-item', 'delete-item'],
  /** The premium-book library and pack readers. */
  compendium: [
    'search-compendium',
    'get-compendium-entry',
    'search-compendium-creatures',
    'search-compendium-spells',
    'search-compendium-items',
    'list-compendium-packs',
    'read-pack',
  ],
  /** Scenes, who-sees-what routing, and every placeable kind. */
  scenes: [
    'create-scene',
    'list-scenes',
    'update-scene',
    'activate-scene',
    'pull-users-to-scene',
    'set-landing-scene',
    'delete-scene',
    'get-scene-dimensions',
    'screenshot-scene',
    'manage-placeables',
    'list-tokens',
    'place-tokens',
    'update-token',
    'delete-tokens',
    'create-region',
    'list-regions',
    'update-region',
    'delete-region',
    'create-teleporter',
    'add-region-behavior',
    'remap-teleporters',
  ],
  /** Journals, quests, handouts. */
  journals: [
    'create-quest-journal',
    'link-quest-to-npc',
    'update-quest-journal',
    'list-journals',
    'search-journals',
    'create-journal',
    'update-journal',
    'set-journal-page-visibility',
    'delete-journal-page',
    'delete-journal',
    'add-journal-image',
  ],
  /** Roll tables. */
  tables: [
    'create-rolltable',
    'import-rolltable',
    'list-rolltables',
    'update-rolltable',
    'roll-on-table',
    'get-rolltable',
    'delete-rolltable',
  ],
  /** Card decks. */
  cards: ['create-cards', 'import-cards', 'list-cards', 'delete-cards'],
  /** Playlists and the per-scene soundscape. */
  audio: [
    'create-playlist',
    'list-playlists',
    'update-playlist',
    'delete-playlist',
    'configure-soundscape',
  ],
  /** The chat log — narration, whispers, roll requests, cards, export. */
  chat: [
    'send-chat-message',
    'list-chat-messages',
    'delete-chat-messages',
    'export-chat-log',
    'post-item-card',
    'request-roll',
  ],
  /** Combat tracker configuration and per-combat analytics. */
  combat: ['configure-combat-tracker', 'get-combat-stats'],
  /** The asset file library (Plane B) and asset reference integrity. */
  assets: [
    'list-assets',
    'asset-info',
    'download-asset',
    'upload-asset',
    'upload-asset-tree',
    'create-asset-folder',
    'delete-asset',
    'move-asset',
    'copy-asset',
    'asset-url',
    'find-asset-references',
    'relink-asset',
  ],
  /** Folders, moves, bulk deletes, macros. */
  organization: [
    'list-folders',
    'create-folder',
    'update-folder',
    'delete-folder',
    'move-documents',
    'bulk-delete',
    'create-macro',
    'list-macros',
    'delete-macro',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ToolsetName = keyof typeof TOOLSETS;

export const TOOLSET_NAMES = Object.keys(TOOLSETS) as ToolsetName[];

/** The toolset that is advertised whatever a registration asks for. */
export const ALWAYS_ON: ToolsetName = 'session';

/** tool name → its toolset. */
export function toolsetOf(): Map<string, ToolsetName> {
  const out = new Map<string, ToolsetName>();
  for (const name of TOOLSET_NAMES) {
    for (const tool of TOOLSETS[name]) out.set(tool, name);
  }
  return out;
}

/**
 * Resolve a registration's toolset selection. Empty = every toolset. An unknown name is a
 * misconfiguration and fails loudly (at startup) with the valid names. `session` is always included.
 */
export function resolveToolsets(selected: readonly string[]): Set<ToolsetName> {
  const clean = selected.map(s => s.trim()).filter(Boolean);
  if (clean.length === 0) return new Set(TOOLSET_NAMES);
  const out = new Set<ToolsetName>([ALWAYS_ON]);
  for (const s of clean) {
    if (!(TOOLSET_NAMES as string[]).includes(s)) {
      throw new Error(
        `FOUNDRY_TOOLSETS: "${s}" is not a toolset (one of: ${TOOLSET_NAMES.join(', ')}).`
      );
    }
    out.add(s as ToolsetName);
  }
  return out;
}

/** Parse the FOUNDRY_TOOLSETS env value (comma-separated). */
export function parseToolsetsEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
