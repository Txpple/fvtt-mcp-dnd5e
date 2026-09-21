// The shared target leaves — ONE description per resolution rule, so a tool cannot advertise a
// contract its page handler does not implement (F22 of the 2026-09 review: `actorIdentifier` was
// described 16 ways across 14 tools against two page-side rules, and add-feature said "exact"
// while resolving fuzzy). `src/measure.test.ts` refuses a `*Identifier` leaf that does not start
// with its rule's text; a tool that needs a note appends it (`actorTarget.describe(`${ACTOR_TARGET}
// Omit for a world item.`)`) — the rule stays first, verbatim.

import { z } from 'zod';

/**
 * The fuzzy rule — `resolveActorFuzzy` (src/page/_shared.ts): exact id, exact name, then a
 * case-insensitive name substring; then a placed token id on any scene, which targets that token's
 * own actor (its delta), not the base actor. Every read and every sheet edit.
 */
export const ACTOR_TARGET =
  'Actor id or name (substring ok); a placed token id targets that token, not its base actor.';
export const actorTarget = z.string().min(1).describe(ACTOR_TARGET);

/**
 * The strict rule — exact id, then exact name, nothing else: the destructive tools (delete-actor,
 * duplicate-actor) and set-actor-art, where a substring hit would be the wrong actor.
 */
export const ACTOR_TARGET_STRICT = 'Actor id or exact name (no substring match).';
export const actorTargetStrict = z.string().min(1).describe(ACTOR_TARGET_STRICT);

/**
 * Scenes resolve strictly everywhere (exact id, then exact name). Optional on the placeable tools
 * — omitted, the page resolves `game.scenes.active`, the ONE world-wide active scene, a fact, not a
 * guess (never the bridge's viewed scene); no active scene is an error, not an empty list. The
 * scene-document tools (update-scene, activate-scene, screenshot-scene …) keep theirs required.
 */
export const SCENE_TARGET = 'Scene id or exact name';
export const sceneTarget = z
  .string()
  .min(1)
  .optional()
  .describe(`${SCENE_TARGET}; omit for the ACTIVE scene.`);
export const sceneTargetRequired = z.string().min(1).describe(`${SCENE_TARGET}.`);

/**
 * An item — embedded on an actor (`resolveActorItem`) or in the world sidebar (`resolveWorldItem`):
 * exact id, exact name (case-insensitive), then a name substring.
 */
export const ITEM_TARGET = 'Item id, exact name, or name substring';
export const itemTarget = z.string().min(1).describe(`${ITEM_TARGET}.`);
