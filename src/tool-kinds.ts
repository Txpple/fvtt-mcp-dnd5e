// Node-side: what each tool does to the world, declared once per tool (issue #8).
//
// The registry reads this table for a read-only registration (FOUNDRY_TOOLSETS=readonly): it
// advertises the reads, a family tool narrowed to its read actions, and its dispatcher refuses every
// other call by name before a handler runs. A tool is tagged by what its handler does, not by its
// name, the rule the page ops' tags follow one layer down (src/page/_ops.ts): a read reads the
// world, the compendia or a pack on disk, and at most writes a file on this machine (a download, an
// export, a screenshot); a write changes the world (a document, a setting, a flag, a chat message,
// a file in Foundry's Data/, a player's view) or runs a program. A missing or an extra tool is a
// compile error (`satisfies` below) and fails the registry build. The writes whose change can be
// outside the world's documents (a Data/ file, a player's view), which no receipt records, carry a
// second tag, NO_RECEIPT. Pure: no I/O.

import type { TOOLSETS, ToolsetName } from './toolsets.js';
import { DND5E_SETTINGS } from './utils/dnd5e-settings.js';

/**
 * A tool's kind. An object is a write whose call is a read when its `action` is one of
 * `readActions`, or when every key in `readIfAbsent` is absent from the call.
 */
export type ToolKind =
  | 'read'
  | 'write'
  | { readActions?: readonly string[]; readIfAbsent?: readonly string[] };

/** Every dispatchable tool: the toolset table lists each exactly once (src/toolsets.ts). */
type ToolName = (typeof TOOLSETS)[ToolsetName][number];

export const TOOL_KINDS = {
  // actors (export writes a local file)
  'manage-actors': { readActions: ['list', 'get', 'get-entity', 'export'] },
  'search-actor-contents': 'read',
  'manage-items': { readActions: ['list', 'get'] },
  'remove-from-actor': 'write',
  // compendium
  'search-compendium': 'read',
  'get-compendium-entry': 'read',
  'list-compendium-packs': 'read',
  // scene / world
  'get-current-scene': 'read',
  'get-world-info': 'read',
  // actor creation and authoring
  'create-actor-from-compendium': 'write',
  'author-npc': 'write',
  'create-pc': 'write',
  'inspect-pc-advancement': 'read',
  'level-up-pc': 'write',
  'create-pc-from-prefab': 'write',
  'duplicate-actor': 'write',
  'update-actor-item': 'write',
  'manage-activity': { readActions: ['list'] },
  'add-free-cast': 'write',
  'manage-effect': { readActions: ['list'] },
  // no switch named reports every switch
  'configure-dnd5e-settings': {
    readIfAbsent: DND5E_SETTINGS.filter(s => !s.readOnly).map(s => s.key),
  },
  // no action is the read
  'manage-calendar': { readActions: ['read'], readIfAbsent: ['action'] },
  'apply-condition': 'write',
  'add-item': 'write',
  'content-audit': 'read',
  // groups and the primary party (no argument reports it)
  'create-group': 'write',
  'manage-group-members': 'write',
  'get-group': 'read',
  'set-primary-party': { readIfAbsent: ['groupIdentifier', 'clear'] },
  'add-feature': 'write',
  // journals
  'manage-journals': { readActions: ['list', 'get'] },
  'create-quest-journal': 'write',
  'link-quest-to-npc': 'write',
  'update-quest-journal': 'write',
  'search-journals': 'read',
  'set-journal-page-visibility': 'write',
  // ownership
  'set-actor-ownership': 'write',
  'list-actor-ownership': 'read',
  // the file plane (a download is a file on this machine, not in Data/)
  'list-assets': 'read',
  'asset-info': 'read',
  'download-asset': 'read',
  'upload-asset': 'write',
  'upload-asset-tree': 'write',
  'create-asset-folder': 'write',
  'delete-asset': 'write',
  'move-asset': 'write',
  'copy-asset': 'write',
  'asset-url': 'read',
  'find-asset-references': 'read',
  'relink-asset': 'write',
  'set-actor-art': 'write',
  'add-journal-image': 'write',
  // a scene-pack module read off disk
  'read-pack': 'read',
  // scenes (a screenshot views the scene in the bridge's own canvas; nothing persists)
  'manage-scenes': { readActions: ['list'] },
  'activate-scene': 'write',
  'pull-users-to-scene': 'write',
  'set-landing-scene': 'write',
  'get-scene-dimensions': 'read',
  'screenshot-scene': 'read',
  'manage-placeables': { readActions: ['list'] },
  // audio
  'manage-playlists': { readActions: ['list'] },
  'configure-area-sounds': { readActions: ['list', 'library'] },
  // tables (a roll evaluates without drawing or posting) and cards
  'manage-rolltables': { readActions: ['list', 'get'] },
  'roll-on-table': 'read',
  'manage-cards': { readActions: ['list'] },
  // chat (an export's remotePath copy is a file in Data/; its localPath copy is on this machine)
  'send-chat-message': 'write',
  'list-chat-messages': 'read',
  'delete-chat-messages': 'write',
  'export-chat-log': { readIfAbsent: ['remotePath'] },
  'post-item-card': 'write',
  'request-roll': 'write',
  // users and macros
  'list-users': 'read',
  'update-user': 'write',
  'set-user-avatar': 'write',
  'manage-macros': { readActions: ['list'] },
  // no field named reports the config
  'configure-combat-tracker': { readIfAbsent: ['resource', 'skipDefeated', 'turnMarker'] },
  // the bridge's own session; no world write
  'disconnect-bridge': 'read',
  // arbitrary JavaScript in the page is never a read
  'run-script': 'write',
  // organization
  'manage-folders': { readActions: ['list'] },
  'move-documents': 'write',
  'bulk-delete': 'write',
} as const satisfies Record<ToolName, ToolKind>;

/**
 * The write tools that can change something outside the world's documents, where no receipt
 * reaches: a file in Data/ (the file plane), a player's view (a socket pull). Such a call, once it
 * made that change (`noteUnrecorded`, src/receipts.ts), ends its answer with a "not undoable" line
 * naming it in these words (src/registry.ts); what it also wrote to documents is in its receipt as
 * usual (a move's relink, a chat message with an uploaded image). The registry refuses a tag on a
 * tool that only reads, and src/tools/registry.test.ts sorts every write tool into this table or
 * the recorded ones by name, so a new write tool is placed by hand.
 */
export const NO_RECEIPT = {
  'upload-asset': 'the file it wrote to Data/',
  'upload-asset-tree': 'the files it wrote to Data/',
  'create-asset-folder': 'the folder it made in Data/',
  'delete-asset': 'the delete in Data/',
  'move-asset': 'the move in Data/',
  'copy-asset': 'the copy it wrote to Data/',
  'export-chat-log': 'the copy it wrote to Data/',
  'send-chat-message': 'the image it uploaded to Data/',
  'pull-users-to-scene': "the players' views it moved",
  'run-script': 'what its file-plane or view calls changed',
} as const satisfies Partial<Record<ToolName, string>>;

/** The NO_RECEIPT words of a tool, if it carries the tag. */
export function noReceiptOf(name: string): string | undefined {
  return Object.hasOwn(NO_RECEIPT, name) ? (NO_RECEIPT as Record<string, string>)[name] : undefined;
}

const tagOf = (name: string): ToolKind | undefined =>
  Object.hasOwn(TOOL_KINDS, name) ? (TOOL_KINDS as Record<string, ToolKind>)[name] : undefined;

const argsOf = (args: unknown): Record<string, unknown> =>
  args !== null && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

const absent = (a: Record<string, unknown>, key: string): boolean =>
  !Object.hasOwn(a, key) || a[key] === undefined;

/**
 * What one call does: `read` or `write`, from the tool's tag and, for a tag that depends on the
 * call, its arguments. A name with no tag is a write: nothing vouches for it.
 */
export function toolKind(name: string, args: unknown): 'read' | 'write' {
  const tag = tagOf(name);
  if (tag === undefined) return 'write';
  if (typeof tag === 'string') return tag;
  const a = argsOf(args);
  if (typeof a.action === 'string' && tag.readActions?.includes(a.action)) return 'read';
  if (tag.readIfAbsent?.length && tag.readIfAbsent.every(k => absent(a, k))) return 'read';
  return 'write';
}

/** The `action` values a tool reads with; undefined when its kind does not turn on an action. */
export function readActionsOf(name: string): readonly string[] | undefined {
  const tag = tagOf(name);
  return typeof tag === 'object' ? tag.readActions : undefined;
}

/**
 * Why a call is refused under a read-only registration, by name: the tool, what made the call a
 * write (its action, or the write fields it names), the fix, and how the tool reads.
 */
export function readOnlyRefusal(name: string, args: unknown): string {
  const q = (v: unknown): string => JSON.stringify(v);
  const fix =
    'this registration is read-only (FOUNDRY_TOOLSETS=readonly); use a registration without it.';
  const tag = tagOf(name);
  if (typeof tag !== 'object') return `${name} is not a read: ${fix}`;
  const a = argsOf(args);
  const named = (tag.readIfAbsent ?? []).filter(k => !absent(a, k));
  const subject = tag.readActions
    ? typeof a.action === 'string'
      ? ` action ${q(a.action)}`
      : ' with no action'
    : ` with ${named.map(q).join(', ')}`;
  const reads: string[] = [];
  if (tag.readActions?.length) reads.push(`with action ${tag.readActions.map(q).join(', ')}`);
  if (named.length) reads.push(`without ${named.map(q).join(', ')}`);
  return `${name}${subject} is not a read: ${fix}${reads.length ? ` It reads ${reads.join(', or ')}.` : ''}`;
}
