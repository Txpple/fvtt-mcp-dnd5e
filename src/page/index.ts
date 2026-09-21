// Page-side domain library — runs INSIDE the headless Foundry page.
//
// Bundled by esbuild (esbuild.page.mjs -> dist/page.bundle.js) and injected by
// src/foundry.ts after game.ready. It attaches a flat API to window.__fvtt; Node-side
// tools invoke it through the foundry.call(name, args) seam. Nothing here imports
// Node/Playwright — only browser + Foundry globals (see foundry-globals.d.ts).
//
// The api keys ARE the bridge method names: foundry.call('getCharacterInfo', args)
// === window.__fvtt.getCharacterInfo(args). They match the legacy
// foundry-mcp-bridge.<name> methods 1:1, so the Node tools rewire mechanically.

import { guardSerialization } from './_shared.js';
import { getWorldInfo } from './world.js';
import {
  getActiveScene,
  listScenes,
  createScene,
  updateScene,
  deleteScenes,
  activateScene,
  pullUsersToScene,
  setLandingScene,
  getSceneDimensions,
  prepareSceneShot,
} from './scenes.js';
import { configureSoundscape } from './soundscape.js';
import {
  createSceneTiles,
  listSceneTiles,
  updateSceneTiles,
  deleteSceneTiles,
} from './placeables/tile.js';
import {
  createSceneLights,
  listSceneLights,
  updateSceneLights,
  deleteSceneLights,
} from './placeables/light.js';
import {
  listSceneTokens,
  placeSceneTokens,
  deleteSceneTokens,
  updateSceneTokens,
} from './placeables/token.js';
import {
  createSceneNotes,
  listSceneNotes,
  updateSceneNotes,
  deleteSceneNotes,
} from './placeables/note.js';
import {
  createSceneRegions,
  listSceneRegions,
  updateSceneRegions,
  deleteSceneRegions,
  createSceneTeleporter,
  remapSceneTeleporters,
  addRegionBehavior,
} from './placeables/region.js';
import {
  createSceneSounds,
  listSceneSounds,
  updateSceneSounds,
  deleteSceneSounds,
} from './placeables/sound.js';
import {
  createSceneDrawings,
  listSceneDrawings,
  updateSceneDrawings,
  deleteSceneDrawings,
} from './placeables/drawing.js';
import {
  createSceneWalls,
  listSceneWalls,
  updateSceneWalls,
  deleteSceneWalls,
} from './placeables/wall.js';
import {
  listActors,
  getCharacterInfo,
  exportActorData,
  getCharacterEntity,
  searchCharacterItems,
  findActor,
  createActorFromCompendium,
  duplicateActor,
  deleteActor,
  addActorItems,
  removeActorItems,
  updateActor,
  updateActorItem,
} from './actors.js';
import {
  searchCompendium,
  getAvailablePacks,
  getCompendiumDocumentFull,
  warmCompendiumIndexes,
} from './compendium.js';
import {
  listJournals,
  getJournalContent,
  getJournalPageContent,
  createJournal,
  updateJournalContent,
  updateJournal,
  setJournalPageVisibility,
  deleteJournalPage,
  deleteJournals,
} from './journals.js';
import {
  listWorldItems,
  getWorldItem,
  createWorldItems,
  updateWorldItems,
  deleteWorldItems,
} from './items.js';
import {
  getActorOwnership,
  setActorOwnership,
  getFriendlyNPCs,
  getPartyCharacters,
  getConnectedPlayers,
  findPlayers,
} from './ownership.js';
import {
  listPlaylists,
  listRollTables,
  getRollTable,
  listCards,
  rollOnTable,
  createPlaylist,
  updatePlaylist,
  deletePlaylists,
  createRollTable,
  updateRollTable,
  deleteRollTables,
  importRollTable,
  createCards,
  importCardsPreset,
  deleteCards,
} from './collections.js';
import {
  postChatMessage,
  listChatMessages,
  deleteChatMessages,
  exportChatLog,
  postItemCard,
  requestRoll,
} from './chat.js';
import { setUserAvatar, listUsers, updateUser } from './users.js';
import { createMacro, listMacros, deleteMacros } from './macros.js';
import { configureCombatTracker } from './combat-tracker.js';
import { scanCombatStats } from './combat-stats.js';
import {
  listFolders,
  createFolder,
  updateFolder,
  moveDocuments,
  bulkDelete,
  deleteFolder,
} from './organization.js';
import { manageEffect } from './effects.js';
import { findAssetReferences, relinkAsset, setActorArt, addJournalImage } from './assets.js';
import { browseFiles, createDirectory, readFileBase64, statFile, uploadFile } from './files.js';
import { searchCompendiumFaceted } from './compendium-facets.js';
import { createNpcActor } from './dnd5e/npc.js';
import { applyCondition } from './dnd5e/conditions.js';
import { addSaveFeatureToActor, addPassiveFeatureToActor } from './dnd5e/features.js';
import { addAttackToActor, addAuraToActor, addAttackWithSaveToActor } from './dnd5e/attacks.js';
import { setActorSpellcasting, addSpellsToActor, addHomebrewSpellToActor } from './dnd5e/spells.js';
import { addFeaturesFromCompendium } from './dnd5e/compendium-features.js';
import { addItem, importItemFromCompendium } from './dnd5e/items.js';
import { auditContent } from './dnd5e/content-audit.js';
import { manageActivity } from './dnd5e/manage-activity.js';
import { configureDnd5eSettings } from './dnd5e/settings.js';
import { manageCalendar } from './dnd5e/calendar.js';
import { addFreeCast } from './dnd5e/free-cast.js';
import {
  createPcActor,
  createPcFromPrefab,
  inspectAdvancementChoices,
  levelUpPc,
} from './dnd5e/advancement.js';
import {
  createGroupActor,
  manageGroupMembers,
  getGroupInfo,
  configurePrimaryParty,
} from './dnd5e/group.js';

const api = {
  // world / scene (scene-DOCUMENT ops only — placeables live below)
  getWorldInfo,
  getActiveScene,
  listScenes,
  createScene,
  updateScene,
  deleteScenes,
  activateScene,
  pullUsersToScene,
  setLandingScene,
  getSceneDimensions,
  prepareSceneShot,
  // house module #6 (fvtt-mod-soundscape): per-scene atmospheric sound sets, flags-only
  configureSoundscape,
  // scene placeables (per-type CRUD over the shared kernel, src/page/placeables/**)
  createSceneTiles,
  listSceneTiles,
  updateSceneTiles,
  deleteSceneTiles,
  createSceneLights,
  listSceneLights,
  updateSceneLights,
  deleteSceneLights,
  listSceneTokens,
  placeSceneTokens,
  deleteSceneTokens,
  updateSceneTokens,
  createSceneNotes,
  listSceneNotes,
  updateSceneNotes,
  deleteSceneNotes,
  createSceneRegions,
  listSceneRegions,
  updateSceneRegions,
  deleteSceneRegions,
  createSceneTeleporter,
  remapSceneTeleporters,
  addRegionBehavior,
  createSceneSounds,
  listSceneSounds,
  updateSceneSounds,
  deleteSceneSounds,
  createSceneDrawings,
  listSceneDrawings,
  updateSceneDrawings,
  deleteSceneDrawings,
  createSceneWalls,
  listSceneWalls,
  updateSceneWalls,
  deleteSceneWalls,
  // actors / characters
  listActors,
  getCharacterInfo,
  exportActorData,
  getCharacterEntity,
  searchCharacterItems,
  findActor,
  createActorFromCompendium,
  duplicateActor,
  deleteActor,
  addActorItems,
  removeActorItems,
  updateActor,
  updateActorItem,
  // compendium
  searchCompendium,
  warmCompendiumIndexes,
  getAvailablePacks,
  getCompendiumDocumentFull,
  searchCompendiumFaceted,
  // journals
  listJournals,
  getJournalContent,
  getJournalPageContent,
  createJournal,
  updateJournalContent,
  updateJournal,
  setJournalPageVisibility,
  deleteJournalPage,
  deleteJournals,
  // world items
  listWorldItems,
  getWorldItem,
  createWorldItems,
  updateWorldItems,
  deleteWorldItems,
  // ownership / players
  getActorOwnership,
  setActorOwnership,
  getFriendlyNPCs,
  getPartyCharacters,
  getConnectedPlayers,
  findPlayers,
  // collections (playlists / roll tables / cards)
  listPlaylists,
  listRollTables,
  getRollTable,
  listCards,
  rollOnTable,
  createPlaylist,
  updatePlaylist,
  deletePlaylists,
  createRollTable,
  updateRollTable,
  deleteRollTables,
  importRollTable,
  createCards,
  importCardsPreset,
  deleteCards,
  // chat log (post / list / delete / export / dnd5e cards / roll requests)
  postChatMessage,
  listChatMessages,
  deleteChatMessages,
  exportChatLog,
  postItemCard,
  requestRoll,
  // users
  setUserAvatar,
  listUsers,
  updateUser,
  // macros (world Macro documents + user hotbar pins)
  createMacro,
  listMacros,
  deleteMacros,
  // combat tracker (the core.combatTrackerConfig world setting — turn marker etc.)
  configureCombatTracker,
  // combat stats (read-only scan of Battle Flow's stat stamps — the get-combat-stats tool)
  scanCombatStats,
  // organization (folders / move / bulk-delete)
  listFolders,
  createFolder,
  updateFolder,
  moveDocuments,
  bulkDelete,
  deleteFolder,
  // active effects (create/edit/delete/list on actor or item)
  manageEffect,
  // assets (reference integrity + art/image composition)
  findAssetReferences,
  relinkAsset,
  setActorArt,
  addJournalImage,
  // the bridge file plane (Foundry's own FilePicker — browse / stat / read / upload / mkdir)
  browseFiles,
  statFile,
  readFileBase64,
  uploadFile,
  createDirectory,
  // dnd5e actor authoring (npc creation, feature/attack/aura/spell authoring, compendium import)
  createNpcActor,
  applyCondition,
  addPassiveFeatureToActor,
  addSaveFeatureToActor,
  addAttackToActor,
  addAttackWithSaveToActor,
  addAuraToActor,
  setActorSpellcasting,
  addSpellsToActor,
  addHomebrewSpellToActor,
  addFeaturesFromCompendium,
  addItem,
  importItemFromCompendium,
  auditContent,
  manageActivity,
  addFreeCast,
  // dnd5e 6.0 world switches + the in-world calendar
  configureDnd5eSettings,
  manageCalendar,
  // dnd5e PC authoring (leveling engine: type:character + advancement → @scale resolves natively)
  createPcActor,
  createPcFromPrefab,
  inspectAdvancementChoices,
  levelUpPc,
  // dnd5e group actors (party stash / travel group: create, membership, group-shaped read,
  // the primaryParty world setting)
  createGroupActor,
  manageGroupMembers,
  getGroupInfo,
  configurePrimaryParty,
} satisfies Record<string, (...args: any[]) => unknown>;

/**
 * The exact tool↔page contract: each key is a bridge method name and its value is the
 * page handler's signature. `FoundryBridge.call` (src/foundry.ts) narrows its `name`
 * parameter to `keyof PageApi`, so a mistyped method name is a COMPILE error caught by
 * the gate, not a runtime "Unknown page function" in a live session. Registering a
 * handler in `api` is the single step that exposes it across the seam.
 */
export type PageApi = typeof api;

/** The argument tuple handler `N` takes: `[]`, `[args]` or `[args?]` — what `foundry.call` accepts. */
export type PageArgs<N extends keyof PageApi> = Parameters<PageApi[N]>;
/** What handler `N` answers with, awaited — what `foundry.call` resolves to. */
export type PageResult<N extends keyof PageApi> = Awaited<ReturnType<PageApi[N]>>;

// The seam's guarantee (3.0 M6, F24): no handler answers `any` or `unknown`, none takes an `any` /
// `unknown` argument, and none takes more than the ONE argument the bridge passes (`fn(a)`). A
// regression is a compile error on the line below, naming the handler — `tsc` is the ratchet.
type IsAny<T> = 0 extends 1 & T ? true : false;
type Untyped<T> = IsAny<T> extends true ? true : unknown extends T ? true : false;
type UntypedResult = {
  [K in keyof PageApi]: Untyped<PageResult<K>> extends true ? K : never;
}[keyof PageApi];
type UntypedArg = {
  [K in keyof PageApi]: PageArgs<K> extends []
    ? never
    : Untyped<PageArgs<K>[0]> extends true
      ? K
      : never;
}[keyof PageApi];
type ExtraArg = {
  [K in keyof PageApi]: PageArgs<K>['length'] extends 0 | 1 ? never : K;
}[keyof PageApi];
type MustBeNever<T extends never> = T;
export type SeamGuard = [
  MustBeNever<UntypedResult>,
  MustBeNever<UntypedArg>,
  MustBeNever<ExtraArg>,
];

// Bind the GUARDED handlers: every return value is asserted plain-JSON-serializable in-page,
// before it crosses the Playwright bridge, so a forgotten toObject()/dump() (a Map silently
// flattened to {}, a live Document that throws opaquely) fails loudly naming the handler + path
// instead of corrupting data. `PageApi` above stays derived from the RAW `api`, so the tool-side
// `foundry.call(name)` contract is unchanged (see src/page/_shared.ts guardSerialization).
window.__fvtt = guardSerialization(api);
