// Page-side: what each page op does to the world, declared once per op (issue #14).
//
// run-script's facade (src/page/run-script.ts) reads this table: a dry run stubs every call that is
// not a read, and the write and delete caps count by it. It replaced a verb regex over the op names,
// which took `remapSceneTeleporters` for a read (no `remap` verb), so a dry run executed the remap
// for real. Every op is tagged by what its handler does, not by its name: a write creates, updates
// or deletes a document, changes a setting or a flag, posts to chat, uploads a file, or otherwise
// moves the world (a pull of the players' views); a delete is a write whose effect is removing
// documents. A missing or an extra op is a compile error (`satisfies` below), the same ratchet as
// `SeamGuard` in ./index.ts. Browser + Foundry globals only; the import is a type.

import type { PageApi } from './index.js';

/**
 * A page op's kind. An object is a write whose kind depends on the call: the first rule that applies
 * decides, else `kind` (default `write`).
 */
export type OpKind =
  | 'read'
  | 'write'
  | 'delete'
  | {
      /** What the call does when no rule below applies (default `write`). */
      kind?: 'write' | 'delete';
      /** The `action` values that only read. */
      readActions?: readonly string[];
      /** The `action` values whose effect is removing something. */
      deleteActions?: readonly string[];
      /** The action the handler runs when the call names none (`manageCalendar` reads). */
      defaultAction?: string;
      /** The op's own preview switch: a call with `dryRun: true` only reads. */
      dryRunReads?: true;
      /** A call that names no argument only reads: the configure ops answer their current state. */
      emptyReads?: true;
    };

export const OPS = {
  // world / scene documents
  getWorldInfo: 'read',
  getActiveScene: 'read',
  listScenes: 'read',
  createScene: 'write',
  updateScene: 'write',
  deleteScenes: 'delete',
  activateScene: 'write',
  // a socket emit that moves connected players' views; no document changes
  pullUsersToScene: 'write',
  getSceneDimensions: 'read',
  // views and frames the scene in the bridge's own canvas; nothing persists
  prepareSceneShot: 'read',
  configureAreaSounds: { readActions: ['list', 'library'], deleteActions: ['remove'] },
  // scene placeables
  createSceneTiles: 'write',
  listSceneTiles: 'read',
  updateSceneTiles: 'write',
  deleteSceneTiles: 'delete',
  createSceneLights: 'write',
  listSceneLights: 'read',
  updateSceneLights: 'write',
  deleteSceneLights: 'delete',
  listSceneTokens: 'read',
  placeSceneTokens: 'write',
  deleteSceneTokens: 'delete',
  updateSceneTokens: 'write',
  createSceneNotes: 'write',
  listSceneNotes: 'read',
  updateSceneNotes: 'write',
  deleteSceneNotes: 'delete',
  createSceneRegions: 'write',
  listSceneRegions: 'read',
  updateSceneRegions: 'write',
  deleteSceneRegions: 'delete',
  createSceneTeleporter: 'write',
  // rewrites teleport destinations: region.updateEmbeddedDocuments('RegionBehavior', …)
  remapSceneTeleporters: 'write',
  addRegionBehavior: 'write',
  createSceneSounds: 'write',
  listSceneSounds: 'read',
  updateSceneSounds: 'write',
  deleteSceneSounds: 'delete',
  createSceneDrawings: 'write',
  listSceneDrawings: 'read',
  updateSceneDrawings: 'write',
  deleteSceneDrawings: 'delete',
  createSceneWalls: 'write',
  listSceneWalls: 'read',
  updateSceneWalls: 'write',
  deleteSceneWalls: 'delete',
  // actors
  listActors: 'read',
  getCharacterInfo: 'read',
  exportActorData: 'read',
  getCharacterEntity: 'read',
  searchCharacterItems: 'read',
  findActor: 'read',
  createActorFromCompendium: 'write',
  duplicateActor: 'write',
  deleteActor: 'delete',
  addActorItems: 'write',
  removeActorItems: 'delete',
  updateActor: 'write',
  updateActorItem: 'write',
  // compendium
  searchCompendium: 'read',
  warmCompendiumIndexes: 'read',
  getAvailablePacks: 'read',
  getCompendiumDocumentFull: 'read',
  searchCompendiumFaceted: 'read',
  // journals
  listJournals: 'read',
  getJournalContent: 'read',
  getJournalPageContent: 'read',
  createJournal: 'write',
  updateJournalContent: 'write',
  updateJournal: 'write',
  setJournalPageVisibility: 'write',
  deleteJournalPage: 'delete',
  deleteJournals: 'delete',
  // world items
  listWorldItems: 'read',
  getWorldItem: 'read',
  createWorldItems: 'write',
  updateWorldItems: 'write',
  deleteWorldItems: 'delete',
  // ownership / players
  getActorOwnership: 'read',
  setActorOwnership: 'write',
  getFriendlyNPCs: 'read',
  getPartyCharacters: 'read',
  getConnectedPlayers: 'read',
  findPlayers: 'read',
  // playlists / roll tables / cards
  listPlaylists: 'read',
  listRollTables: 'read',
  getRollTable: 'read',
  listCards: 'read',
  // table.roll(): evaluates without marking a result drawn or posting to chat
  rollOnTable: 'read',
  createPlaylist: 'write',
  updatePlaylist: 'write',
  deletePlaylists: 'delete',
  createRollTable: 'write',
  updateRollTable: 'write',
  deleteRollTables: 'delete',
  importRollTable: 'write',
  createCards: 'write',
  importCardsPreset: 'write',
  deleteCards: 'delete',
  // chat log
  postChatMessage: 'write',
  listChatMessages: 'read',
  deleteChatMessages: 'delete',
  exportChatLog: 'read',
  postItemCard: 'write',
  requestRoll: 'write',
  // users
  setUserAvatar: 'write',
  listUsers: 'read',
  updateUser: 'write',
  // macros
  createMacro: 'write',
  listMacros: 'read',
  deleteMacros: 'delete',
  // combat tracker: no field named = the read
  configureCombatTracker: { emptyReads: true },
  // organization
  listFolders: 'read',
  createFolder: 'write',
  updateFolder: 'write',
  moveDocuments: 'write',
  bulkDelete: { kind: 'delete', dryRunReads: true },
  deleteFolder: 'delete',
  // active effects
  manageEffect: { readActions: ['list'], deleteActions: ['delete'] },
  // assets
  findAssetReferences: 'read',
  relinkAsset: { dryRunReads: true },
  setActorArt: 'write',
  addJournalImage: 'write',
  // the bridge file plane
  browseFiles: 'read',
  statFile: 'read',
  readFileBase64: 'read',
  uploadFile: 'write',
  createDirectory: 'write',
  // dnd5e actor authoring
  createNpcActor: 'write',
  applyCondition: 'write',
  addPassiveFeatureToActor: 'write',
  addSaveFeatureToActor: 'write',
  addAttackToActor: 'write',
  addAttackWithSaveToActor: 'write',
  addAuraToActor: 'write',
  setActorSpellcasting: 'write',
  addSpellsToActor: 'write',
  addHomebrewSpellToActor: 'write',
  addFeaturesFromCompendium: 'write',
  addItem: 'write',
  importItemFromCompendium: 'write',
  auditContent: 'read',
  manageActivity: { readActions: ['list'], deleteActions: ['remove'] },
  addFreeCast: 'write',
  // dnd5e world switches (no setting named = the read) and the calendar (no action = read)
  configureDnd5eSettings: { emptyReads: true },
  manageCalendar: { readActions: ['read'], defaultAction: 'read' },
  // dnd5e PC authoring
  createPcActor: 'write',
  createPcFromPrefab: 'write',
  inspectAdvancementChoices: 'read',
  levelUpPc: 'write',
  // dnd5e group actors (the primary party: no argument = the read)
  createGroupActor: 'write',
  manageGroupMembers: 'write',
  getGroupInfo: 'read',
  configurePrimaryParty: { emptyReads: true },
  // run-script and the undo of a receipt; the facade never offers these two to a script
  runScript: 'write',
  undoOps: 'write',
} as const satisfies Record<keyof PageApi, OpKind>;

/**
 * The write ops whose change is not a document — a file in Data/ (the bridge file plane), the
 * players' views (a socket pull) — so the receipt recorder never sees it. A run that calls one is
 * told its change is not undoable (src/tools/script.ts; NO_RECEIPT in src/tool-kinds.ts).
 */
export const UNRECORDED_OPS: ReadonlySet<string> = new Set<keyof typeof OPS>([
  'uploadFile',
  'createDirectory',
  'pullUsersToScene',
]);

/**
 * What one call does: `read`, `write` or `delete`, from the op's tag and, for a tag that depends on
 * the call, its arguments. A name that is not a page op is a write: nothing vouches for it.
 */
export function opKind(name: string, args: unknown): 'read' | 'write' | 'delete' {
  if (!Object.hasOwn(OPS, name)) return 'write';
  const tag: OpKind = (OPS as Record<string, OpKind>)[name]!;
  if (typeof tag === 'string') return tag;
  const a = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  if (tag.emptyReads && Object.values(a).every(v => v === undefined)) return 'read';
  if (tag.dryRunReads && a.dryRun === true) return 'read';
  const action = typeof a.action === 'string' ? a.action : tag.defaultAction;
  if (action !== undefined) {
    if (tag.readActions?.includes(action)) return 'read';
    if (tag.deleteActions?.includes(action)) return 'delete';
  }
  return tag.kind ?? 'write';
}
