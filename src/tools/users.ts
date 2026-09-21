import { z } from 'zod';
import { ACTOR_TARGET, actorTarget } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * User-account tools.
 * - list-users: the namespace's read — every user account with role, connection state, and
 *   assigned character.
 * - update-user: GM admin on a user account — role, name, color, pronouns, assigned character.
 * - set-user-avatar: the portrait Foundry shows next to a user's chat messages. Defaults to the
 *   bridge user (MCP-Claude), so it's the simple way to give the MCP's own chat posts a portrait
 *   instead of the default mystery-man.
 */

const ListUsersSchema = z.object({});

const UpdateUserSchema = z
  .object({
    user: z.string().min(1).describe('User id or exact name (case-insensitive). No default.'),
    role: z
      .enum(['none', 'player', 'trusted', 'assistant', 'gamemaster'])
      .optional()
      .describe(
        'Permission role (none = banned). The bridge user and the last gamemaster cannot be demoted.'
      ),
    name: z.string().min(1).optional().describe('Rename the user account (their login name).'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #rrggbb hex string')
      .optional()
      .describe('Player color as #rrggbb — used for cursors, targeting, and chat borders.'),
    pronouns: z.string().optional().describe('Pronouns shown next to the user name.'),
    character: actorTarget.optional().describe(`${ACTOR_TARGET} "none" clears.`),
  })
  .refine(
    o => o.role !== undefined || o.name || o.color || o.pronouns !== undefined || o.character,
    { message: 'nothing to update — pass at least one of role, name, color, pronouns, character' }
  );

const SetUserAvatarSchema = z.object({
  avatar: z
    .string()
    .min(1)
    .describe(
      'Data-relative asset path (upload-asset returns one), an https URL, or a Foundry icon path.'
    ),
  user: z.string().optional().describe('User id or exact name; default the bridge user.'),
});

export interface UserToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class UserTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: UserToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'UserTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'list-users',
        description:
          'Every user account: id, name, role, connected, color, pronouns, avatar, assigned ' +
          'character, landing scene (only when set; an unassigned user follows the active scene).',
        inputSchema: toInputSchema(ListUsersSchema),
      },
      {
        name: 'update-user',
        description:
          'Update a user account: role, login name, color, pronouns, assigned character. GM-only; ' +
          'the bridge user and the last gamemaster cannot be demoted.',
        inputSchema: toInputSchema(UpdateUserSchema),
      },
      {
        name: 'set-user-avatar',
        description:
          "Set a user's avatar (the portrait beside their chat messages). Defaults to the bridge " +
          'user. GM-only.',
        inputSchema: toInputSchema(SetUserAvatarSchema),
      },
    ];
  }

  async handleListUsers(args: any): Promise<string> {
    ListUsersSchema.parse(args ?? {});
    const r = await this.foundry.call('listUsers');
    const users = Array.isArray(r?.users) ? r.users : [];
    const lines = users.map((u: any) => {
      // A landing scene is only reported when SET: an unassigned user follows the active scene,
      // which is core's own behavior and not worth a line each. A dangling id (the scene was
      // deleted out from under the flag) has no name to print, so show the id — that is exactly
      // the case someone needs to see in order to clear it.
      const landing = u.landingScene
        ? [`lands on: ${u.landingScene.name ?? `⚠️ deleted scene ${u.landingScene.id}`}`]
        : [];
      const bits = [
        `role ${u.role} (${u.roleLabel})`,
        u.active ? 'CONNECTED' : 'offline',
        ...(u.character ? [`character: ${u.character.name}`] : []),
        ...landing,
        ...(u.isBridgeUser ? ['← bridge user'] : []),
      ];
      return `- **${u.name}** (\`${u.id}\`) — ${bits.join(' · ')}`;
    });
    return `${users.length} user(s):\n${lines.join('\n')}`;
  }

  async handleUpdateUser(args: any): Promise<string> {
    const parsed = UpdateUserSchema.parse(args ?? {});
    const r = await this.foundry.call('updateUser', parsed);
    const applied: string[] = Array.isArray(r?.applied) ? r.applied : [];
    if (applied.length === 0) {
      return `No changes for ${r?.user?.name} — everything already matched.`;
    }
    const changes = applied.map(field => {
      const prev = (r?.previous as any)?.[field];
      const now =
        field === 'role'
          ? `${r?.user?.role} (${r?.user?.roleLabel})`
          : field === 'character'
            ? (r?.user?.character?.name ?? 'none')
            : ((r?.user as any)?.[field] ?? '');
      return `- ${field}: ${prev ?? '(unset)'} → ${now}`;
    });
    const warns = Array.isArray(r?.warnings) ? r.warnings : [];
    const warnSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    return `Updated user ${r?.user?.name} (\`${r?.user?.id}\`):\n${changes.join('\n')}${warnSection}`;
  }

  async handleSetUserAvatar(args: any): Promise<string> {
    const parsed = SetUserAvatarSchema.parse(args ?? {});
    const r = await this.foundry.call('setUserAvatar', parsed);
    const warns = Array.isArray(r?.warnings) ? r.warnings : [];
    const warnSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    return `Set ${r?.name}'s avatar to ${r?.avatar}.${warnSection}`;
  }
}
