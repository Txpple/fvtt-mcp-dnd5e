// Page-side: actor WRITES — create-from-compendium (with the prefab-as-base modifications layered
// through updateActor), delete (+ the bridge-folder sweep), duplicate, add / remove embedded items.
// Awaited Foundry document mutations, best-effort (no rollback). Runs INSIDE the headless Foundry
// page. (F45: the writes third of the old src/page/actors.ts.)

import {
  resolveActorFuzzy as resolveActor,
  getOrCreateFolder as getOrCreateFolderShared,
  importFromCompendium,
  findUnresolvedScaleTokens,
  scaleTokensResolveFor,
  MCP_FLAG_SCOPE,
  MCP_FOLDER_CREATION_COLORS,
  toSource,
} from '../_shared.js';
import {
  readDarkvision,
  resolveDisposition,
  TOKEN_DISPOSITION,
  tokenDefaults,
  type DispositionKey,
} from '../dnd5e/token-defaults.js';
import { ambiguous, invalid, notFound as notFoundError } from '../errors.js';

import { updateActor } from './update.js';

// Foundry document class (Actor) lives in the page global scope but is not
// declared in foundry-globals.d.ts; reach it off globalThis (loosely typed).
const ActorClass: any = (globalThis as any).Actor;

// Legacy bridge id — kept ONLY as a console log prefix. The folder flag namespace
// moved to MCP_FLAG_SCOPE ('world') so it stays valid after the foundry-mcp-bridge
// module is uninstalled (an unregistered scope throws on getFlag/setFlag).
const MODULE_ID = 'foundry-mcp-bridge';

// ---------------------------------------------------------------------------
// Write helpers (local; no rollback — writes are best-effort in v1).
// ---------------------------------------------------------------------------

/**
 * Resolve or create a folder for organizing MCP-generated content, scoped to a
 * document `type`. Thin wrapper over the shared helper that preserves this
 * file's `[foundry-mcp-bridge]`-prefixed console.warn on failure.
 */
async function getOrCreateFolder(
  folderName: string,
  type: string,
  markGenerated = false
): Promise<string | null> {
  return getOrCreateFolderShared(folderName, type, `[${MODULE_ID}] `, markGenerated);
}

interface TokenPlacement {
  actorIds: string[];
  placement: 'random' | 'grid' | 'center' | 'coordinates';
  hidden: boolean;
  coordinates?: { x: number; y: number }[] | undefined;
}

/**
 * Compute the position for the index-th token under the given placement mode.
 */
function calculateTokenPosition(
  placement: 'random' | 'grid' | 'center' | 'coordinates',
  scene: any,
  index: number,
  coordinates?: { x: number; y: number }[]
): { x: number; y: number } {
  const gridSize = scene.grid?.size || 100;

  switch (placement) {
    case 'coordinates': {
      if (coordinates?.[index]) {
        return coordinates[index];
      }
      const fallbackCols = Math.ceil(Math.sqrt(index + 1));
      const fallbackRow = Math.floor(index / fallbackCols);
      const fallbackCol = index % fallbackCols;
      return {
        x: gridSize + fallbackCol * gridSize * 2,
        y: gridSize + fallbackRow * gridSize * 2,
      };
    }

    case 'center':
      return {
        x: scene.width / 2 + index * gridSize,
        y: scene.height / 2,
      };

    case 'grid': {
      const cols = Math.ceil(Math.sqrt(index + 1));
      const row = Math.floor(index / cols);
      const col = index % cols;
      return {
        x: gridSize + col * gridSize * 2,
        y: gridSize + row * gridSize * 2,
      };
    }
    default:
      return {
        x: Math.random() * (scene.width - gridSize),
        y: Math.random() * (scene.height - gridSize),
      };
  }
}

/**
 * Place tokens for the given world actors onto the current scene. Best-effort:
 * actors that fail to prepare are collected as errors and skipped. Returns
 * { success, tokensCreated, tokenIds, errors? }.
 */
async function addActorsToScene(placement: TokenPlacement): Promise<{
  success: boolean;
  tokensCreated: number;
  tokenIds: string[];
  errors?: string[] | undefined;
}> {
  const scene = game.scenes.current;
  if (!scene) {
    throw notFoundError('No active scene found');
  }

  const tokenData: any[] = [];
  const errors: string[] = [];

  for (const actorId of placement.actorIds) {
    try {
      const actor = game.actors.get(actorId);
      if (!actor) {
        errors.push(`Actor ${actorId} not found`);
        continue;
      }

      const tokenDoc = actor.prototypeToken.toObject();
      const position = calculateTokenPosition(
        placement.placement,
        scene,
        tokenData.length,
        placement.coordinates
      );

      // Clear any lingering remote token texture URL (Foundry may have
      // re-applied the source after our actor-creation fix).
      if (tokenDoc.texture?.src?.startsWith('http')) {
        console.error(
          `[${MODULE_ID}] Token texture still has remote URL, clearing: ${tokenDoc.texture.src}`
        );
        tokenDoc.texture.src = null;
      }

      tokenData.push({
        ...tokenDoc,
        x: position.x,
        y: position.y,
        actorId,
        hidden: placement.hidden,
      });
    } catch (error) {
      errors.push(
        `Failed to prepare token for actor ${actorId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Never call createEmbeddedDocuments with [] (it can throw), and if the create itself rejects, degrade
  // into the errors[] channel instead of rejecting the whole call — so one un-placeable actor doesn't
  // wipe token placement for the actors that DID prepare (caller: createActorFromCompendium).
  let createdTokens: any[] = [];
  if (tokenData.length > 0) {
    try {
      createdTokens = await scene.createEmbeddedDocuments('Token', tokenData);
    } catch (error) {
      errors.push(
        `Failed to place ${tokenData.length} token(s) on the scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return {
    success: createdTokens.length > 0,
    tokensCreated: createdTokens.length,
    tokenIds: createdTokens.map((token: any) => token.id),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/** Count documents + subfolders directly inside a folder (direct children only). */
function folderChildCounts(folder: any): { documents: number; subfolders: number } {
  const documents = folder?.contents?.length || 0;
  const subfolders = (game.folders?.filter((f: any) => f.folder?.id === folder.id) || []).length;
  return { documents, subfolders };
}

/**
 * Delete a folder only if it is empty AND was created by this bridge
 * (mcpGenerated flag). Returns the removed folder's info, or null when kept
 * (not found, non-empty, or user-created). Used by deleteActor cleanup.
 */
async function removeFolderIfEmptyAndMcp(
  folderId: string
): Promise<{ id: string; name: string } | null> {
  const folder = game.folders?.get(folderId);
  if (!folder) return null;

  const { documents, subfolders } = folderChildCounts(folder);
  if (documents > 0 || subfolders > 0) return null;

  const mcpGenerated = folder.flags?.[MCP_FLAG_SCOPE]?.mcpGenerated === true;
  if (!mcpGenerated) return null;

  // The flag is provenance stamped at creation and never re-checked, so it can outlive the
  // folder's ownership: legacy bridge versions flagged even user-named folders (the `_DM`
  // incident). A folder that no longer wears a bridge creation color was re-styled by the
  // user — treat that as adoption and keep it.
  const sourceColor = toSource(folder)?.color;
  if (!sourceColor || !MCP_FOLDER_CREATION_COLORS.has(String(sourceColor).toLowerCase())) {
    return null;
  }

  const info = { id: folder.id ?? folderId, name: folder.name ?? '' };
  await folder.delete();
  return info;
}

// ---------------------------------------------------------------------------
// Exported write API.
// ---------------------------------------------------------------------------

/**
 * Pull the damage TYPES a creature's attacks/abilities deal, from its embedded item SOURCE objects
 * (toSource(item)). create-actor-from-compendium surfaces this so a reskin can't hide the base theme
 * (rule 7): when you copy a creature and re-theme it (a radiant Priest → a necrotic Shar priestess),
 * you must SEE "this base deals radiant" and replace the off-theme abilities with real ones of the new
 * type — not reflavor in prose. PURE — unit-tested in actors.test.ts.
 */
export function extractDamageProfile(sourceItems: any[]): {
  damageTypes: string[];
  attacks: Array<{ name: string; types: string[] }>;
} {
  const all = new Set<string>();
  const attacks: Array<{ name: string; types: string[] }> = [];
  for (const src of sourceItems ?? []) {
    if (src?.type !== 'weapon' && src?.type !== 'feat') continue;
    const sys = src.system ?? {};
    const types = new Set<string>();
    for (const t of sys.damage?.base?.types ?? []) if (t) types.add(t);
    for (const act of Object.values<any>(sys.activities ?? {})) {
      for (const part of act?.damage?.parts ?? []) {
        for (const t of part?.types ?? []) if (t) types.add(t);
      }
    }
    if (types.size > 0) {
      const sorted = [...types].sort();
      attacks.push({ name: src.name ?? '', types: sorted });
      for (const t of sorted) all.add(t);
    }
  }
  return { damageTypes: [...all].sort(), attacks };
}

/**
 * Create one or more world actors by copying a specific compendium entry
 * (resolved by exact packId + itemId). Each copy carries the source's full
 * system data, embedded items, effects, and prototype token (with remote token
 * texture URLs cleared), and is filed under the caller's `folder` (id or exact
 * name, created if absent) — default: the auto-managed "Foundry MCP Creatures"
 * Actor folder. Optionally places tokens on the current scene.
 * Best-effort: per-actor failures are collected as `errors` rather than aborting.
 * Returns { success, totalCreated, totalRequested, actors, tokensPlaced, folder?, errors? }.
 */
export async function createActorFromCompendium(request: {
  packId: string;
  itemId: string;
  customNames: string[];
  quantity?: number | undefined;
  // Destination Actor folder (id or exact name; created if absent). Mirrors create-scene's param.
  folder?: string | undefined;
  addToScene?: boolean | undefined;
  placement?:
    | {
        type: 'random' | 'grid' | 'center' | 'coordinates';
        coordinates?: { x: number; y: number }[] | undefined;
      }
    | undefined;
  // Prefab-as-base bridge (design.md §6 step 2): update-actor-shaped stat edits to layer onto each
  // instantiated WORLD COPY (never the source compendium doc). Applied via the same updateActor
  // correctness; same edits applied to every copy.
  modifications?: Record<string, any> | undefined;
  // The caller's friend/foe judgment (authoring-policy rule 10) — e.g. 'neutral' for townsfolk.
  // Absent → by source type: copied PC pregen friendly, copied monster hostile.
  disposition?: DispositionKey | undefined;
}) {
  const { packId, itemId, customNames, quantity = 1, addToScene = false, placement } = request;
  const modifications = request.modifications;
  const hasMods =
    !!modifications && typeof modifications === 'object' && Object.keys(modifications).length > 0;

  // Resolve + fetch through the shared whole-document copy primitive (validates
  // inputs, resolves the pack, fetches the document). Actor-specific validation
  // runs below on the live `source`; the per-quantity loop re-derives an
  // independent copy via sourceActor.toObject().
  const { pack, source: sourceActor } = await importFromCompendium(packId, itemId);

  // Validate that the document is an Actor.
  if (sourceActor.documentName !== 'Actor') {
    throw invalid(
      `Document "${itemId}" is not an Actor (documentName: ${sourceActor.documentName}, type: ${sourceActor.type})`
    );
  }

  // Validate actor type — support all common actor types including DSA5
  // creatures and Cosmere RPG adversaries.
  const validActorTypes = ['character', 'npc', 'creature', 'adversary'];
  if (!validActorTypes.includes(sourceActor.type)) {
    throw invalid(
      `Document "${itemId}" has unsupported actor type: ${sourceActor.type}. Supported types: ${validActorTypes.join(', ')}`
    );
  }

  // Prepare custom names.
  const names = customNames.length > 0 ? customNames : [`${sourceActor.name} Copy`];
  const finalQuantity = Math.min(quantity, names.length);

  const createdActors: any[] = [];
  const errors: string[] = [];

  // Resolve the destination folder ONCE, before the per-copy loop — the caller's folder (id or
  // exact name; created if absent, mirroring create-scene's param), else the auto-managed default.
  // An unresolvable requested folder falls back to the default and is reported, never silent.
  const requestedFolder = typeof request.folder === 'string' ? request.folder.trim() : '';
  let folderId: string | null = null;
  if (requestedFolder !== '') {
    const existing =
      game.folders?.get(requestedFolder) ||
      game.folders?.find((x: any) => x.name === requestedFolder && x.type === 'Actor');
    folderId = existing ? existing.id : await getOrCreateFolder(requestedFolder, 'Actor');
    if (!folderId) {
      errors.push(
        `could not resolve or create Actor folder "${requestedFolder}" — filed under "Foundry MCP Creatures" instead`
      );
    }
  }
  // Only the bridge-invented default is marked auto-removable; a user-named `requestedFolder`
  // above is the user's org structure and must never be flagged for cleanup.
  if (!folderId) folderId = await getOrCreateFolder('Foundry MCP Creatures', 'Actor', true);

  // Create actors.
  for (let i = 0; i < finalQuantity; i++) {
    try {
      const customName = names[i] || `${sourceActor.name} ${i + 1}`;

      // Build actor data from the source's full system, items, and effects.
      const sourceData = sourceActor.toObject();
      const actorData = {
        name: customName,
        type: sourceData.type,
        img: sourceData.img,
        system: sourceData.system || sourceData.data || {},
        items: sourceData.items || [],
        effects: sourceData.effects || [],
        folder: null as string | null, // Don't inherit folder.
        prototypeToken: sourceData.prototypeToken, // Include prototype token.
      };

      // Normalize remote prototype-token texture URLs to a local fallback.
      if (actorData.prototypeToken?.texture?.src?.startsWith('http')) {
        actorData.prototypeToken.texture.src = null;
      }

      // The prototype token inherits the SOURCE creature's name (a "Worg" copied as "Gravewidow"
      // keeps "Worg"), so re-point it to the custom name — otherwise every token dragged from the
      // copy, and its combat-tracker entry, reads the source name instead of the rename. Then apply
      // the shared table-ready defaults: name + HP bar shown to everyone, vision on and matching the
      // copied sheet's darkvision, and a disposition — the caller's call when given (rule 10:
      // townsfolk are neutral), else by source type (a copied PC pregen is friendly, a copied
      // monster is hostile).
      actorData.prototypeToken = actorData.prototypeToken ?? {};
      actorData.prototypeToken.name = customName;
      Object.assign(
        actorData.prototypeToken,
        tokenDefaults({
          disposition: resolveDisposition(
            request.disposition,
            sourceData.type === 'character' ? TOKEN_DISPOSITION.friendly : TOKEN_DISPOSITION.hostile
          ),
          darkvision: readDarkvision(sourceData.system?.attributes?.senses),
          ring: actorData.prototypeToken.ring,
        })
      );

      if (folderId) {
        actorData.folder = folderId;
      }

      const newActor = await ActorClass.create(actorData);
      if (!newActor) {
        throw new Error(`Failed to create actor "${customName}"`);
      }

      // Report (don't resolve) any @scale.* tokens the copied embedded items carry THAT DON'T
      // resolve in this copy's roll data. A type:character copy (e.g. a PHB pregen) keeps its
      // class item's ScaleValue advancement, so @scale resolves natively and is no problem; on
      // an NPC rollData.scale is absent and the same literal token dangles to 0 — surface the
      // token + its item so the skill can patch an explicit die (design.md §2.1/§6).
      const unresolvedScale: Array<{
        itemId: string;
        itemName: string;
        path: string;
        formula: string;
      }> = [];
      for (const item of newActor.items ?? []) {
        for (const t of findUnresolvedScaleTokens(toSource(item))) {
          if (scaleTokensResolveFor(newActor, t.formula)) continue;
          unresolvedScale.push({ itemId: item.id, itemName: item.name, ...t });
        }
      }

      // Prefab-as-base bridge: layer the requested stat edits onto THIS world copy via the same
      // updateActor correctness (resolves game.actors by id, so the source compendium doc is never
      // touched). Best-effort: a mod failure is recorded but doesn't lose the created actor.
      let modifications_applied: string[] | undefined;
      const modifications_warnings: string[] = [];
      if (hasMods) {
        try {
          // Force the target to THIS fresh copy last, so a stray `actorIdentifier` in modifications
          // can never redirect the edit to another actor (updateActor only resolves world actors, so
          // it can't touch the compendium source either — this pins it to the intended copy).
          const res: any = await updateActor({
            ...modifications,
            actorIdentifier: newActor.id,
          });
          modifications_applied = res?.applied;
          if (Array.isArray(res?.warnings)) modifications_warnings.push(...res.warnings);
        } catch (modErr) {
          errors.push(
            `Modifications on "${customName}" failed: ${modErr instanceof Error ? modErr.message : 'Unknown error'}`
          );
        }
      }

      // Rule 7 — surface the base creature's damage themes so a reskin must reconcile (never reflavor).
      const damageProfile = extractDamageProfile(
        (newActor.items ?? []).map((i: any) => toSource(i))
      );

      createdActors.push({
        id: newActor.id,
        name: newActor.name,
        originalName: sourceActor.name,
        sourcePackLabel: pack.metadata.label,
        ...(damageProfile.attacks.length > 0 ? { damageProfile } : {}),
        ...(unresolvedScale.length > 0 ? { unresolvedScale } : {}),
        ...(modifications_applied
          ? { modifications: { applied: modifications_applied, warnings: modifications_warnings } }
          : {}),
      });
    } catch (error) {
      const errorMsg = `Failed to create actor ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      console.error(`[${MODULE_ID}] ${errorMsg}`, error);
    }
  }

  // Add to scene if requested.
  let tokensPlaced = 0;
  if (addToScene && createdActors.length > 0) {
    try {
      const sceneResult = await addActorsToScene({
        actorIds: createdActors.map(a => a.id),
        placement: placement?.type || 'grid',
        hidden: false,
        ...(placement?.coordinates && { coordinates: placement.coordinates }),
      });
      tokensPlaced = sceneResult.success ? sceneResult.tokensCreated : 0;
    } catch (error) {
      errors.push(
        `Failed to add actors to scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return {
    success: createdActors.length > 0,
    totalCreated: createdActors.length,
    totalRequested: finalQuantity,
    actors: createdActors,
    tokensPlaced,
    // Echo where the copies were filed so the tool can confirm it (id + resolved name).
    ...(folderId
      ? { folder: { id: folderId, name: game.folders?.get(folderId)?.name ?? null } }
      : {}),
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Permanently delete one or more world actors by STRICT identifier (exact id,
 * then exact name — no fuzzy matching). When removeEmptyFolder is not false,
 * any bridge-invented housekeeping folder this deletion leaves completely empty
 * is also removed (only mcpGenerated + empty + still wearing its bridge creation
 * color — never a user folder, one the user re-styled, or one with remaining
 * contents). Returns { success, deletedCount, deleted, notFound?,
 * removedFolders? }.
 */
export async function deleteActor(data: {
  identifiers: string[];
  removeEmptyFolder?: boolean | undefined;
}) {
  // Default ON: if deleting an actor leaves a bridge-created folder empty,
  // remove it (the auto-foldering litter from createActorFromCompendium).
  const removeEmptyFolder = data.removeEmptyFolder !== false;

  const deleted: Array<{ id: string; name: string }> = [];
  const notFound: string[] = [];
  const touchedFolderIds = new Set<string>();

  for (const identifier of data.identifiers) {
    // STRICT resolution only — exact id, then exact name.
    const actor = game.actors?.get(identifier) || game.actors?.getName?.(identifier);
    if (actor) {
      const info = { id: actor.id ?? identifier, name: actor.name ?? '' };
      const folderId = actor.folder?.id;
      await actor.delete();
      deleted.push(info);
      if (folderId) touchedFolderIds.add(folderId);
    } else {
      notFound.push(identifier);
    }
  }

  // Clean up any bridge-created folder this deletion left completely empty.
  const removedFolders: Array<{ id: string; name: string }> = [];
  if (removeEmptyFolder) {
    for (const folderId of touchedFolderIds) {
      const removed = await removeFolderIfEmptyAndMcp(folderId);
      if (removed) removedFolders.push(removed);
    }
  }

  return {
    success: true,
    deletedCount: deleted.length,
    deleted,
    notFound: notFound.length > 0 ? notFound : undefined,
    removedFolders: removedFolders.length > 0 ? removedFolders : undefined,
  };
}

/**
 * Resolve the user who should own duplicated copies: exact id, then exact name
 * (case-insensitive), then partial case-insensitive name match. Throws on no
 * match AND on an ambiguous partial match — assigning copies to the wrong
 * player is worse than assigning none, so ambiguity never silently picks.
 */
function resolveOwnerUser(identifier: string): any {
  const byId = game.users?.get(identifier);
  if (byId) return byId;

  const users: any[] = game.users?.contents ?? [];
  const term = identifier.toLowerCase();
  const exact = users.find((u: any) => u.name?.toLowerCase() === term);
  if (exact) return exact;

  const partial = users.filter((u: any) => u.name?.toLowerCase().includes(term));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw ambiguous(
      `Ambiguous owner "${identifier}" — matches ${partial.map((u: any) => u.name).join(', ')}`
    );
  }
  throw notFoundError(`User not found: ${identifier}`);
}

/**
 * Duplicate one or more existing WORLD actors as full toObject() clones — the
 * whole sheet travels (system data, embedded items, spells, effects, prototype
 * token), so every copy stays fully rollable. The sandbox "(Sim)" path: clone
 * the party so a player can re-run a battle without touching the real sheets.
 *
 * Resolution is STRICT (exact id, then exact name — the deleteActor contract).
 * Each copy is named newNames[i] when supplied, else source name + suffix
 * (default " (Copy)"), and the prototype nameplate is re-pointed to the new
 * name (same fix as createActorFromCompendium — an inherited source name would
 * leak onto every dragged token + combat-tracker entry). `folder` (id or exact
 * name, created if absent — mirroring createActorFromCompendium) files all
 * copies together; omitted, each copy keeps its source's folder. `owner` (+
 * numeric ownershipLevel, default OWNER) rewrites the copy's ownership to
 * exactly { default: NONE, [user]: level }; omitted, the source's ownership map
 * travels with the clone. The owner is resolved BEFORE any copy is created —
 * an unresolvable owner fails the whole batch fast (copies with the wrong
 * visibility are worse than no copies). Per-actor error isolation: a missing
 * source lands in notFound and a failed create in errors; neither aborts the
 * batch. Returns { success, totalCreated, totalRequested, actors, owner?,
 * notFound?, warnings?, errors? }.
 */
export async function duplicateActor(request: {
  actorIdentifiers: string[];
  newNames?: string[] | undefined;
  suffix?: string | undefined;
  folder?: string | undefined;
  owner?: string | undefined;
  ownershipLevel?: number | undefined;
}) {
  const { actorIdentifiers, newNames, suffix, owner } = request;
  if (!Array.isArray(actorIdentifiers) || actorIdentifiers.length === 0) {
    throw invalid('actorIdentifiers is required and must contain at least one entry');
  }

  // Read the Actor document class lazily (not the module-scope ActorClass) so
  // unit tests can stub globalThis.Actor after import.
  const ActorCls: any = (globalThis as any).Actor;

  // Resolve the owner ONCE, before any copy exists — fail fast on a bad owner.
  const ownershipLevel = typeof request.ownershipLevel === 'number' ? request.ownershipLevel : 3;
  const ownerUser = owner ? resolveOwnerUser(owner) : null;

  const warnings: string[] = [];

  // Resolve the destination folder ONCE (caller's id or exact name; created if
  // absent — createActorFromCompendium's contract). An unresolvable requested
  // folder degrades to "beside the source" with a warning, never silently.
  const requestedFolder = typeof request.folder === 'string' ? request.folder.trim() : '';
  let folderId: string | null = null;
  if (requestedFolder !== '') {
    const existing =
      game.folders?.get(requestedFolder) ||
      game.folders?.find((x: any) => x.name === requestedFolder && x.type === 'Actor');
    folderId = existing ? existing.id : await getOrCreateFolder(requestedFolder, 'Actor');
    if (!folderId) {
      warnings.push(
        `could not resolve or create Actor folder "${requestedFolder}" — each copy filed beside its source instead`
      );
    }
  }

  const created: Array<{
    id: string;
    name: string;
    sourceId: string;
    sourceName: string;
    folderName: string | null;
  }> = [];
  const notFound: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < actorIdentifiers.length; i++) {
    const identifier = actorIdentifiers[i];
    // STRICT resolution only — exact id, then exact name (the deleteActor contract).
    const source = game.actors?.get(identifier) || game.actors?.getName?.(identifier);
    if (!source) {
      notFound.push(identifier);
      continue;
    }

    const newName = newNames?.[i] ?? `${source.name}${suffix ?? ' (Copy)'}`;
    try {
      const data = source.toObject();
      delete data._id;
      data.name = newName;
      // Re-point the prototype nameplate to the copy's name.
      data.prototypeToken = data.prototypeToken ?? {};
      data.prototypeToken.name = newName;
      // Requested folder wins; otherwise data.folder already carries the source's folder id.
      if (folderId) data.folder = folderId;
      // Requested owner wins ({ default: NONE, [user]: level }); otherwise the
      // source's ownership map travels with the clone.
      if (ownerUser) data.ownership = { default: 0, [ownerUser.id]: ownershipLevel };

      const copy = await ActorCls.create(data);
      if (!copy) {
        throw new Error(`Actor.create returned nothing for "${newName}"`);
      }

      created.push({
        id: copy.id,
        name: copy.name,
        sourceId: source.id,
        sourceName: source.name,
        folderName: copy.folder?.name ?? null,
      });
    } catch (error) {
      errors.push(
        `Failed to duplicate "${source.name}" as "${newName}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return {
    success: created.length > 0,
    totalCreated: created.length,
    totalRequested: actorIdentifiers.length,
    actors: created,
    ...(ownerUser
      ? { owner: { id: ownerUser.id, name: ownerUser.name, level: ownershipLevel } }
      : {}),
    notFound: notFound.length > 0 ? notFound : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Add one or more freshly-authored embedded Items to an existing actor (no
 * compendium lookup). name + type are required; type is checked against the
 * active system's declared Item document types when available, then the rest is
 * delegated to Foundry's DataModel layer. Returns { actorId, actorName, created }.
 */
export async function addActorItems(params: {
  actorIdentifier: string;
  items: Array<{
    name: string;
    type: string;
    img?: string | undefined;
    system?: Record<string, any> | undefined;
  }>;
}) {
  const { actorIdentifier, items } = params;

  if (!actorIdentifier) {
    throw invalid('actorIdentifier is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw invalid('items array is required and must contain at least one entry');
  }

  const actor = resolveActor(actorIdentifier);
  if (!actor) {
    throw notFoundError(`Actor not found: ${actorIdentifier}`);
  }

  // Discover the active system's declared Item types for a useful pre-flight
  // error before the doc reaches Foundry's DataModel layer.
  const itemDocTypes = game.system?.documentTypes?.Item;
  const validTypes: string[] | null =
    itemDocTypes && typeof itemDocTypes === 'object' ? Object.keys(itemDocTypes) : null;

  const payload = items.map((it, idx) => {
    if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
      throw invalid(`items[${idx}]: "name" is required and must be a non-empty string`);
    }
    if (typeof it.type !== 'string' || it.type.trim().length === 0) {
      throw invalid(`items[${idx}] ("${it.name}"): "type" is required`);
    }
    if (validTypes && !validTypes.includes(it.type)) {
      throw invalid(
        `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${game.system?.id}". ` +
          `Valid Item types: ${validTypes.join(', ')}`
      );
    }

    const doc: Record<string, any> = { name: it.name, type: it.type };
    if (it.img) doc.img = it.img;
    if (it.system && typeof it.system === 'object') doc.system = it.system;
    return doc;
  });

  const created = await actor.createEmbeddedDocuments('Item', payload);

  return {
    actorId: actor.id,
    actorName: actor.name,
    created: (created || []).map((doc: any) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type,
    })),
  };
}

/**
 * Remove embedded Items from an existing actor, identified by id (exact) and/or
 * name (case-insensitive, optionally constrained to a `type`). Identifiers that
 * match nothing are reported in `notFound` rather than silently ignored.
 * Returns { actorId, actorName, removed, notFound }.
 */
export async function removeActorItems(params: {
  actorIdentifier: string;
  itemIds?: string[] | undefined;
  itemNames?: string[] | undefined;
  type?: string | undefined;
}) {
  const { actorIdentifier, itemIds, itemNames, type } = params;

  if (!actorIdentifier) {
    throw invalid('actorIdentifier is required');
  }
  const hasIds = Array.isArray(itemIds) && itemIds.length > 0;
  const hasNames = Array.isArray(itemNames) && itemNames.length > 0;
  if (!hasIds && !hasNames) {
    throw invalid('Provide itemIds and/or itemNames identifying the items to remove');
  }

  const actor = resolveActor(actorIdentifier);
  if (!actor) {
    throw notFoundError(`Actor not found: ${actorIdentifier}`);
  }

  const typeLower = type?.toLowerCase();
  const toDelete = new Map<string, any>(); // id -> item (dedupes overlap)
  const notFound: string[] = [];

  if (hasIds) {
    for (const id of itemIds) {
      const item = actor.items.get(id);
      if (item) toDelete.set(item.id, item);
      else notFound.push(id);
    }
  }
  if (hasNames) {
    for (const name of itemNames) {
      const nameLower = name.toLowerCase();
      const item = actor.items.find(
        (i: any) => i.name?.toLowerCase() === nameLower && (!typeLower || i.type === typeLower)
      );
      if (item) toDelete.set(item.id, item);
      else notFound.push(name);
    }
  }

  if (toDelete.size === 0) {
    return { actorId: actor.id, actorName: actor.name, removed: [], notFound };
  }

  const removed = Array.from(toDelete.values()).map((i: any) => ({
    id: i.id,
    name: i.name,
    type: i.type,
  }));

  await actor.deleteEmbeddedDocuments(
    'Item',
    removed.map(r => r.id)
  );

  return { actorId: actor.id, actorName: actor.name, removed, notFound };
}
