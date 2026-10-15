// Page-side: actor ownership / player reads + writes. Runs inside the Foundry page.
//
// Reads against game.* collections; the write (setActorOwnership) updates the
// actor's ownership map. No permission/transaction/settings scaffolding — the
// headless page IS the GM, so it reads and mutates ownership directly.

import { fuzzyTier, resolveActorTarget } from './_shared.js';
import { notFound, unsupported } from './errors.js';

// Foundry token disposition constant for FRIENDLY (CONST.TOKEN_DISPOSITIONS.FRIENDLY).
const FRIENDLY_DISPOSITION = 1;

const PERMISSION_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'LIMITED',
  2: 'OBSERVER',
  3: 'OWNER',
};

/** A non-GM user's effective level: the explicit entry when there is one, else the actor default. */
function effectiveLevel(actor: any, user: any): number {
  return actor.testUserPermission(user, 'OWNER')
    ? 3
    : actor.testUserPermission(user, 'OBSERVER')
      ? 2
      : actor.testUserPermission(user, 'LIMITED')
        ? 1
        : 0;
}

/**
 * List ownership per actor. Optionally narrow to a single actor (or "all") and/or a single
 * player. GM users are always excluded (they test as OWNER on everything).
 *
 * Two shapes, both keeping the distinction setActorOwnership is careful about — an explicit
 * level-0 entry (a stored deny that overrides a permissive default) is NOT an absent key:
 *
 *   - compact (default): per actor `{id, name, default, explicit?: {<user name>: <level>}}` —
 *     the explicit entries only; a player absent from `explicit` inherits `default`. Actors
 *     whose ownership is trivial (default NONE and no explicit entry) are counted, not listed,
 *     unless one actor was asked for by name.
 *   - verbose: every actor asked for, with a row per non-GM user reporting the EFFECTIVE level
 *     plus its `source` ('explicit' / 'inherited') and the raw explicit level.
 */
export function getActorOwnership(args?: {
  actorIdentifier?: string | undefined;
  playerIdentifier?: string | undefined;
  verbose?: boolean | undefined;
}) {
  const actorIdentifier = args?.actorIdentifier;
  const playerIdentifier = args?.playerIdentifier;
  const single = !!actorIdentifier && actorIdentifier !== 'all';

  // One actor asked for: through a placed token's id it is that token's own actor (an unlinked
  // token's synthetic actor carries the token's ownership over its base actor's), and the row
  // names the token (issue #19).
  const target = single ? resolveActorTarget(actorIdentifier) : undefined;
  const actors: any[] = single ? (target ? [target.actor] : []) : (game.actors?.contents ?? []);
  const tokenOf = (actor: any) => (target?.token && target.actor === actor ? target.token : null);

  const users: any[] = (
    playerIdentifier
      ? [game.users?.getName(playerIdentifier) || game.users?.get(playerIdentifier)].filter(Boolean)
      : (game.users?.contents ?? [])
  ).filter((u: any) => u && !u.isGM);

  const levelName = (level: number) => PERMISSION_NAMES[level] ?? String(level);
  const rows: any[] = [];
  let trivial = 0;

  for (const actor of actors) {
    const map: Record<string, number> = actor.ownership ?? {};
    const defaultLevel = typeof map.default === 'number' ? map.default : 0;
    const token = tokenOf(actor);
    const tokenField = token ? { token: tokenRef(token) } : {};

    if (args?.verbose) {
      rows.push({
        id: actor.id,
        name: token?.name ?? actor.name,
        ...tokenField,
        type: actor.type,
        defaultPermission: levelName(defaultLevel),
        numericDefaultPermission: defaultLevel,
        ownership: users.map((user: any) => {
          // An explicit entry can hold ANY level, 0 included — presence of the key is the
          // question, not its value, so hasOwn rather than a truthiness/`?? null` test.
          const hasExplicit = Object.hasOwn(map, user.id);
          const explicitLevel = hasExplicit ? map[user.id] : null;
          const permission = effectiveLevel(actor, user);
          return {
            userId: user.id,
            userName: user.name,
            permission: levelName(permission),
            numericPermission: permission,
            source: hasExplicit ? 'explicit' : 'inherited',
            explicitPermission: explicitLevel === null ? null : levelName(explicitLevel),
            numericExplicitPermission: explicitLevel,
          };
        }),
      });
      continue;
    }

    const explicit: Record<string, string> = {};
    for (const user of users) {
      if (Object.hasOwn(map, user.id)) explicit[user.name] = levelName(map[user.id]!);
    }
    const hasExplicit = Object.keys(explicit).length > 0;
    if (!single && !hasExplicit && defaultLevel === 0) {
      trivial++;
      continue;
    }
    rows.push({
      id: actor.id,
      name: token?.name ?? actor.name,
      ...tokenField,
      default: levelName(defaultLevel),
      ...(hasExplicit ? { explicit } : {}),
    });
  }

  return { ownership: rows, total: actors.length, listed: rows.length, trivialOmitted: trivial };
}

/** A placed token as an ownership row names it: its id, its scene, whether it is linked. */
function tokenRef(token: any): { id: string; scene: string; linked: boolean } {
  return { id: token.id, scene: token.parent?.id ?? '', linked: !!token.actorLink };
}

/**
 * Set a single user's ownership permission on an actor, or (permission === null)
 * remove the user's entry so the actor's `ownership.default` applies again.
 *
 * The distinction matters: an explicit 0 is NOT the same as an absent key. On an
 * actor whose default is permissive (a shared party stash defaulting to OWNER),
 * storing 0 actively DENIES the user, and only deleting the key restores the
 * inherited level.
 *
 * Both paths write the whole ownership object with `{ diff: false, recursive: false }`.
 * That is load-bearing for the delete: the `{"ownership.-=<id>": null}` deletion idiom
 * SILENTLY NO-OPS on this field (verified live 2026-08-12 — it left 14 stale entries
 * across three actors; see fvtt-mod-partystash/tools/clean-stale-ownership.mjs), and a recursive update
 * would merge the removed key straight back in.
 *
 * A placed token (`sceneId` + `tokenId`, issue #19): an UNLINKED token's ownership is its own —
 * the token's ActorDelta carries only the entries set on the token, merged over the base actor's
 * per user, so a write there leaves the base actor and every other copy alone, and INHERIT
 * removes the token's entry (the user then inherits the base actor's). A LINKED token has no
 * ownership of its own: the write goes to the base actor, and the answer says so.
 *
 * A miss (no such actor, token or user) is an error, coded `not-found` (design.md §3).
 */
export async function setActorOwnership(args: {
  actorId: string;
  userId: string;
  permission: number | null;
  /** With `tokenId`: the scene of a placed token whose own ownership is written. */
  sceneId?: string | undefined;
  /** A placed token: unlinked, its own ownership (its ActorDelta's); linked, its base actor's. */
  tokenId?: string | undefined;
}): Promise<{ success: boolean; message: string; target: 'actor' | 'token' }> {
  const user = game.users?.get(args.userId);
  if (!user) throw notFound(`User not found: ${args.userId}`);

  if (args.tokenId) {
    const scene = game.scenes?.get(args.sceneId ?? '');
    const token = scene?.tokens?.get(args.tokenId);
    if (!token) {
      throw notFound(`Token not found: ${args.tokenId} on scene ${args.sceneId ?? '(none named)'}`);
    }
    if (!token.actorLink) return setTokenOwnership(token, user, args.permission);
    const base = game.actors?.get(token.actorId ?? args.actorId);
    if (!base) throw notFound(`Actor not found: the base actor of token "${token.name}"`);
    const out = await setOwnershipOn(base, user, args.permission);
    return {
      ...out,
      message:
        `${out.message} — token "${token.name}" is linked, so it has no ownership of its own: ` +
        `the write went to its base actor "${base.name}" and every token linked to it`,
    };
  }

  const actor = game.actors?.get(args.actorId);
  if (!actor) throw notFound(`Actor not found: ${args.actorId}`);
  return setOwnershipOn(actor, user, args.permission);
}

/** A world actor's ownership map, written whole (the module comment above says why). */
async function setOwnershipOn(
  actor: any,
  user: any,
  permission: number | null
): Promise<{ success: boolean; message: string; target: 'actor' }> {
  const currentOwnership: Record<string, number> = actor.ownership || {};

  // INHERIT: rebuild the map WITHOUT this user's key.
  if (permission === null) {
    const hadEntry = Object.hasOwn(currentOwnership, user.id);
    const next: Record<string, number> = {};
    for (const [id, level] of Object.entries(currentOwnership)) {
      if (id !== user.id) next[id] = level;
    }

    await actor.update({ ownership: next }, { diff: false, recursive: false });

    const defaultLevel = next.default ?? 0;
    const inherited = PERMISSION_NAMES[defaultLevel] ?? String(defaultLevel);
    return {
      success: true,
      target: 'actor',
      message: hadEntry
        ? `Removed ${user.name}'s explicit ownership entry on ${actor.name} — now inherits the actor default (${inherited})`
        : `${user.name} had no explicit ownership entry on ${actor.name} — already inheriting the actor default (${inherited})`,
    };
  }

  // Merge the new permission into the actor's existing ownership map.
  const newOwnership = { ...currentOwnership, [user.id]: permission };
  await actor.update({ ownership: newOwnership }, { diff: false, recursive: false });

  const permissionName = PERMISSION_NAMES[permission] ?? permission.toString();
  return {
    success: true,
    target: 'actor',
    message:
      `Set ${actor.name} ownership to ${permissionName} for ${user.name}` +
      (permission === 0
        ? ` (explicit deny — overrides the actor default; use INHERIT to fall back to it)`
        : ''),
  };
}

/**
 * An unlinked token's own ownership: the entries on its ActorDelta, merged per user over its base
 * actor's (Foundry's `ActorDelta.applyDelta`), so the base actor and the other copies keep theirs.
 * A set MERGES one entry into the delta (a non-recursive write would rebuild the token's actor
 * from the base actor plus the ownership alone, dropping the token's other changes, its hit points
 * among them, on every client); the first entry also carries the token's current default, since
 * Foundry's ownership field fills a missing `default` with NONE, which would lock every other user
 * out of the token. INHERIT cannot delete one entry: the server ignores a deletion inside an
 * ownership map and of the whole map alike (measured on Foundry 14.369), and takes a map written
 * whole, the way Foundry's own ownership dialog writes a token's (a ForcedReplacement). So the
 * token's map is written whole: the base actor's entries, the token's others over them, and this
 * user's base entry or none (the default). Every client's token actor then equals what Foundry
 * re-derives; the base actor's entries are copied onto the token, as the dialog copies them. The
 * result is read back: a removal Foundry did not make is an error, never a success.
 */
async function setTokenOwnership(
  token: any,
  user: any,
  permission: number | null
): Promise<{ success: boolean; message: string; target: 'token' }> {
  const delta = token.delta;
  if (!delta) throw notFound(`Token "${token.name}" has no actor data of its own`);
  const base = game.actors?.get(token.actorId);
  const baseMap: Record<string, number> = base?.ownership ?? {};
  const baseDefault = typeof baseMap.default === 'number' ? baseMap.default : 0;
  const own: Record<string, number> = { ...(delta.ownership ?? {}) };
  const levelName = (level: number) => PERMISSION_NAMES[level] ?? String(level);
  const where = `token "${token.name}" (${token.id}, scene ${token.parent?.id ?? '?'})`;

  if (permission === null) {
    const hadEntry = Object.hasOwn(own, user.id);
    if (hadEntry) {
      const next: Record<string, number> = { ...baseMap, ...own };
      delete next[user.id];
      if (Object.hasOwn(baseMap, user.id)) next[user.id] = baseMap[user.id]!;
      if (typeof next.default !== 'number') next.default = baseDefault;
      const ops = (globalThis as any).foundry?.data?.operators;
      if (typeof ops?.ForcedReplacement?.create === 'function') {
        await delta.update({ ownership: ops.ForcedReplacement.create(next) });
      } else {
        await delta.update({ ownership: next }, { diff: false, recursive: false });
      }
      // never report a removal Foundry did not make
      const after: Record<string, number> = token.delta?.ownership ?? {};
      const want = Object.hasOwn(baseMap, user.id) ? baseMap[user.id] : undefined;
      if (Object.hasOwn(after, user.id) && after[user.id] !== want) {
        throw unsupported(
          `Foundry kept ${user.name}'s own entry on ${where} (` +
            `${levelName(after[user.id]!)}); nothing else changed. Set the level ` +
            "the user should have on the token instead, or reset the token's ownership in Foundry."
        );
      }
    }
    const fallback = Object.hasOwn(baseMap, user.id)
      ? `the base actor's entry (${levelName(baseMap[user.id]!)})`
      : `the default (${levelName(typeof own.default === 'number' ? own.default : baseDefault)})`;
    return {
      success: true,
      target: 'token',
      message: hadEntry
        ? `Removed ${user.name}'s own entry on ${where} — it now inherits ${fallback} (Foundry ` +
          "takes a token's ownership whole, so the base actor's entries are copied onto the token)"
        : `${user.name} had no entry of its own on ${where} — already inheriting ${fallback}`,
    };
  }

  const change: Record<string, number> = { [`ownership.${user.id}`]: permission };
  // the token's effective default now (its own, else the base actor's): kept through the write
  if (typeof own.default !== 'number') {
    const current = token.actor?.ownership?.default;
    change['ownership.default'] = typeof current === 'number' ? current : baseDefault;
  }
  await delta.update(change);
  return {
    success: true,
    target: 'token',
    message:
      `Set ${where} ownership to ${levelName(permission)} for ${user.name}; its base actor ` +
      `${base ? `"${base.name}" ` : ''}and the other tokens keep theirs` +
      (permission === 0 ? ' (an explicit deny on this token; INHERIT falls back)' : ''),
  };
}

/**
 * Friendly-disposition tokens on the active scene, as { id, name }. Prefers the
 * token's underlying actor id; falls back to the token id.
 */
export function getFriendlyNPCs(): Array<{ id: string; name: string }> {
  const scene = game.scenes?.find((s: any) => s.active);
  if (!scene) return [];

  return scene.tokens
    .filter((token: any) => token.disposition === FRIENDLY_DISPOSITION)
    .map((token: any) => ({
      id: token.actor?.id || token.id || '',
      name: token.name || token.actor?.name || 'Unknown',
    }))
    .filter((t: any) => t.id);
}

/**
 * Player-owned character actors (the party), as { id, name }.
 */
export function getPartyCharacters(): Array<{ id: string; name: string }> {
  return (game.actors?.contents ?? [])
    .filter((actor: any) => actor.hasPlayerOwner && actor.type === 'character')
    .map((actor: any) => ({
      id: actor.id || '',
      name: actor.name || 'Unknown',
    }))
    .filter((c: any) => c.id);
}

/**
 * Connected (active) non-GM users, as { id, name }.
 */
export function getConnectedPlayers(): Array<{ id: string; name: string }> {
  return (game.users?.contents ?? [])
    .filter((user: any) => user.active && !user.isGM)
    .map((user: any) => ({
      id: user.id || '',
      name: user.name || 'Unknown',
    }))
    .filter((u: any) => u.id);
}

/**
 * The players an identifier names, for a write (set-actor-ownership): the non-GM users by
 * `fuzzyTier` (id, exact name, the name without case, then a name containing it when
 * allowPartialMatch); none, and includeCharacterOwners, the owners of the character actors it
 * names by the same tiers. One tier answers, so an exact name never brings its substring matches
 * along: more than one entry is a tie the caller refuses. Returns { id, name }[].
 */
export function findPlayers(args: {
  identifier: string;
  allowPartialMatch?: boolean | undefined;
  includeCharacterOwners?: boolean | undefined;
}): Array<{ id: string; name: string }> {
  const { identifier, allowPartialMatch = true, includeCharacterOwners = true } = args;
  const pick = (docs: any[]): any[] => {
    const byId = (id: string) => docs.find((d: any) => d.id === id);
    const tier = fuzzyTier({ contents: docs, get: byId }, identifier);
    // without partial matching, a substring tier is no match
    if (allowPartialMatch) return tier;
    const lower = identifier.toLowerCase();
    return tier.filter((d: any) => d.id === identifier || d.name?.toLowerCase() === lower);
  };

  const players: Array<{ id: string; name: string }> = pick(
    (game.users?.contents ?? []).filter((u: any) => !u.isGM)
  ).map((u: any) => ({ id: String(u.id || ''), name: String(u.name || 'Unknown') }));
  if (players.length || !includeCharacterOwners) return players.filter(p => p.id);

  // Character-name fallback: resolve to each named character's owning player.
  const owners: Array<{ id: string; name: string }> = [];
  const characters = (game.actors?.contents ?? []).filter((a: any) => a.type === 'character');
  for (const actor of pick(characters)) {
    const owner = game.users?.contents.find(
      (user: any) => actor.testUserPermission(user, 'OWNER') && !user.isGM
    );
    if (owner && !owners.some(p => p.id === owner.id)) {
      owners.push({ id: owner.id || '', name: owner.name || 'Unknown' });
    }
  }
  return owners.filter(p => p.id);
}
