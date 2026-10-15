import { z } from 'zod';
import { ACTOR_TARGET, actorTarget } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError, ToolError } from '../utils/error-handler.js';
import { toInputSchema } from '../utils/schema.js';

export interface OwnershipToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

// Foundry ownership permission levels
const OwnershipLevels = {
  NONE: 0,
  LIMITED: 1,
  OBSERVER: 2,
  OWNER: 3,
} as const;

// INHERIT is not a level — it means "no explicit entry for this user", so the actor's
// `ownership.default` applies. It travels to the page as `permission: null`, which
// setActorOwnership implements by REMOVING the user's key. An explicit NONE (0) is a
// different thing: it OVERRIDES a permissive default and actively denies the user.
const ownershipLevelSchema = z.enum(['NONE', 'LIMITED', 'OBSERVER', 'OWNER', 'INHERIT']);

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.
const SetActorOwnershipSchema = z.object({
  actorIdentifier: actorTarget.describe(`${ACTOR_TARGET} Or a bulk phrase.`),
  playerIdentifier: z
    .string()
    .describe('Player or character name (substring ok), or "party" for every connected player.'),
  permissionLevel: ownershipLevelSchema.describe(
    "NONE stores a level-0 deny that overrides the actor's default; INHERIT removes the entry."
  ),
  confirmBulkOperation: z
    .boolean()
    .default(false)
    .describe('Required when several actors or players are affected.'),
});

const ListActorOwnershipSchema = z.object({
  actorIdentifier: actorTarget.optional().describe(`${ACTOR_TARGET} Omit/"all": every actor.`),
  playerIdentifier: z.string().optional().describe('One player, by name.'),
  verbose: z
    .boolean()
    .optional()
    .describe('The per-player matrix (effective level + source) for every actor asked.'),
});

export class OwnershipTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: OwnershipToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'OwnershipTools' });
  }

  /**
   * Get tool definitions for ownership management
   */
  getToolDefinitions() {
    return [
      {
        name: 'set-actor-ownership',
        description:
          "Set a player's permission on an actor. NONE is a stored deny that overrides a permissive " +
          'default; INHERIT removes the entry so the default applies. actorIdentifier also takes the ' +
          'bulk phrases "all friendly NPCs" / "party characters", playerIdentifier "party" — bulk ' +
          'writes need confirmBulkOperation.',
        inputSchema: toInputSchema(SetActorOwnershipSchema),
      },
      {
        name: 'list-actor-ownership',
        description:
          'Actor ownership, one row per actor with explicit entries or a non-NONE default: {id, name, ' +
          'default, explicit: {<player>: <level>}} (an explicit NONE is a stored deny). Trivial ' +
          'actors are counted, not listed, unless named.',
        inputSchema: toInputSchema(ListActorOwnershipSchema),
      },
    ];
  }

  /**
   * Handle tool execution
   */
  async handleToolCall(name: string, args: any) {
    switch (name) {
      case 'set-actor-ownership':
        return await this.assignActorOwnership(args);
      case 'list-actor-ownership':
        return await this.listActorOwnership(args);
      default:
        throw new Error(`Unknown ownership tool: ${name}`);
    }
  }

  /**
   * Assign actor ownership permissions. A placed token's id writes that token's own ownership (an
   * unlinked token's ActorDelta), never its base actor's, and a linked token's answer says the
   * write went to its base actor (issue #19). An identifier that names several actors or players
   * is refused by name (a write is never given the first match), and one that names none is a miss.
   */
  private async assignActorOwnership(args: any) {
    const { actorIdentifier, playerIdentifier, permissionLevel, confirmBulkOperation } =
      SetActorOwnershipSchema.parse(args ?? {});

    this.logger.info(
      `Assigning ${permissionLevel} ownership of "${actorIdentifier}" to "${playerIdentifier}"`
    );

    // Validate permission level. INHERIT has no numeric level — null tells the page side to
    // DELETE the user's ownership key (falling back to the actor's default) rather than store one.
    const validatedLevel = permissionLevel;
    const numericLevel = validatedLevel === 'INHERIT' ? null : OwnershipLevels[validatedLevel];

    // Resolve actors and players: a miss or a tie throws, before any write
    const actors = await this.resolveActors(actorIdentifier);
    const players = await this.resolvePlayers(playerIdentifier);

    // Bulk-operation guard: a precondition failure, thrown (like every other tool's guards) so the
    // guidance surfaces verbatim rather than as a masquerading success:false payload.
    const isBulkOperation = actors.length > 1 || players.length > 1;
    if (isBulkOperation && !confirmBulkOperation) {
      throw new FormattedToolError(
        `Bulk operation detected: ${actors.length} actors × ${players.length} players = ${actors.length * players.length} ownership changes. Set confirmBulkOperation to true to proceed.`
      );
    }

    // Apply ownership changes
    const results = [];
    let firstError: unknown;
    for (const actor of actors) {
      for (const player of players) {
        try {
          const result = await this.foundry.call('setActorOwnership', {
            actorId: actor.id,
            userId: player.id,
            permission: numericLevel,
            ...(actor.token ? { sceneId: actor.token.sceneId, tokenId: actor.token.tokenId } : {}),
          });

          results.push({
            actor: actor.name,
            ...(actor.token
              ? {
                  token: {
                    id: actor.token.tokenId,
                    scene: actor.token.sceneId,
                    linked: actor.token.linked,
                  },
                }
              : {}),
            player: player.name,
            permission: validatedLevel,
            target: result.target,
            success: result.success,
            message: result.message,
          });
        } catch (error) {
          firstError ??= error;
          results.push({
            actor: actor.name,
            player: player.name,
            permission: validatedLevel,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    // nothing landed: the call failed, with the first refusal's own code (design.md §3)
    if (successCount === 0 && firstError) throw firstError;

    return {
      success: true,
      message: `${successCount} ownership assignments completed${failureCount > 0 ? `, ${failureCount} failed` : ''}`,
      results,
    };
  }

  /**
   * List actor ownership permissions
   */
  private async listActorOwnership(args: any) {
    const { actorIdentifier, playerIdentifier, verbose } = ListActorOwnershipSchema.parse(
      args ?? {}
    );

    this.logger.info(
      `Listing actor ownership for actor: "${actorIdentifier || 'all'}", player: "${playerIdentifier || 'all'}"`
    );

    const data = await this.foundry.call('getActorOwnership', {
      actorIdentifier,
      playerIdentifier,
      verbose,
    });

    const summary = verbose
      ? `${data.listed} actor(s), a row per player`
      : `${data.listed} of ${data.total} actor(s) with explicit entries or a non-NONE default; ` +
        `${data.trivialOmitted} inherit default NONE with no entries (not listed)`;
    return {
      success: true,
      summary,
      ownership: data.ownership,
    };
  }

  /**
   * Resolve actors from identifier: the bulk phrases, else one actor by the write rule (a tie is
   * refused by the page, naming the actors), with the placed token it came through.
   */
  private async resolveActors(identifier: string): Promise<
    Array<{
      id: string;
      name: string;
      token?: { sceneId: string; tokenId: string; linked: boolean } | undefined;
    }>
  > {
    this.logger.debug(`Resolving actors for identifier: ${identifier}`);
    const phrase = identifier.toLowerCase();
    if (phrase.includes('all friendly npcs')) {
      // Get all tokens in current scene with friendly disposition
      const actors = await this.foundry.call('getFriendlyNPCs');
      if (!actors.length) {
        throw new ToolError('not-found', 'No friendly NPC token is on the active scene.');
      }
      return actors;
    }
    if (phrase.includes('party characters')) {
      // Get all player-owned characters
      const actors = await this.foundry.call('getPartyCharacters');
      if (!actors.length)
        throw new ToolError('not-found', 'No character actor has a player owner.');
      return actors;
    }
    const actor = await this.foundry.call('findActor', { identifier, forWrite: true });
    if (!actor)
      throw new ToolError('not-found', `No actor or placed token matches "${identifier}".`);
    return [actor];
  }

  /**
   * Resolve players from identifier: "party" is every connected player; anything else is one
   * player (or a character's owner) by name, and a name that matches several is refused, naming
   * them, never written to all of them.
   */
  private async resolvePlayers(identifier: string): Promise<Array<{ id: string; name: string }>> {
    this.logger.debug(`Resolving players for identifier: ${identifier}`);
    if (identifier.toLowerCase() === 'party') {
      const players = await this.foundry.call('getConnectedPlayers');
      if (!players.length) {
        throw new ToolError(
          'not-found',
          'No player is connected: "party" means the connected players. Name an offline player instead.'
        );
      }
      return players;
    }
    const players = await this.foundry.call('findPlayers', {
      identifier,
      allowPartialMatch: true,
      includeCharacterOwners: true, // Also match by character names they own
    });
    if (!players.length) {
      throw new ToolError(
        'not-found',
        `No player (or character owned by one) matches "${identifier}".`
      );
    }
    if (players.length > 1) {
      const shown = players.map(p => `"${p.name}" (${p.id})`).join(', ');
      throw new ToolError(
        'ambiguous',
        `Player "${identifier}" matches ${players.length}: ${shown}. A write changes one player's ` +
          'entry, so it is not picked for you: name the player by user id or full name, or use "party".'
      );
    }
    return players;
  }
}
