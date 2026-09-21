import { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * dnd5e GROUP actors (type:"group") — the shared party stash / travel group.
 * - create-group: create the group, enroll members (system.addMember), default ownership,
 *   optionally crown it the world's primary party — one call builds the whole stash.
 * - manage-group-members: add/remove members later, per-actor outcomes.
 * - get-group: the group-shaped read (members, shared currency, shared inventory, ownership,
 *   primary-party flag) — get-actor's character-shaped read returns an empty husk for groups.
 * - set-primary-party: read/set/clear the dnd5e primaryParty world setting.
 *
 * The page layer (src/page/dnd5e/group.ts) owns correctness: fuzzy resolution, the system
 * addMember/removeMember API with pre-classified outcomes, fail-closed create validation, and
 * the {actor: id} setting shape. Note dnd5e 5.3.3 has NO party/encounter subtype field on
 * GroupData, so none is advertised.
 *
 * Shared inventory/currency WRITES ride the existing paths (add-item / import-item items,
 * update-actor currency) — these tools own the group's shape, not a parallel item pipeline.
 */

const CoinSchema = z.number().int().min(0);

const CreateGroupSchema = z.object({
  name: z.string().min(1).describe('Name of the group actor, e.g. "The Party".'),
  members: z
    .array(z.string().min(1))
    .default([])
    .describe(
      'World actors to enroll (id or name, substring ok); one that fails resolves refuses the create.'
    ),
  description: z.string().optional().describe('Description (HTML).'),
  summary: z.string().optional().describe('One-line summary shown in group embeds.'),
  img: z
    .string()
    .optional()
    .describe('Portrait path or URL; an unresolvable path is dropped with a warning.'),
  folderName: z.string().optional().describe('Actor folder (created if missing).'),
  defaultOwnership: z
    .enum(['none', 'limited', 'observer', 'owner'])
    .optional()
    .describe('Default ownership, what every player gets (owner = a shared stash).'),
  currency: z
    .object({
      pp: CoinSchema.optional(),
      gp: CoinSchema.optional(),
      ep: CoinSchema.optional(),
      sp: CoinSchema.optional(),
      cp: CoinSchema.optional(),
    })
    .optional()
    .describe('Starting shared coin.'),
  makePrimaryParty: z.boolean().default(false).describe("Also make it the world's primary party."),
});

const ManageGroupMembersSchema = z
  .object({
    groupIdentifier: z.string().min(1).describe('Group actor id or name (substring ok).'),
    add: z
      .array(z.string().min(1))
      .default([])
      .describe('World actors to enroll (id or name); members already are skipped.'),
    remove: z
      .array(z.string().min(1))
      .default([])
      .describe('Members to remove (id or name; a raw member id works for a deleted actor).'),
  })
  .refine(a => a.add.length > 0 || a.remove.length > 0, {
    message: 'pass at least one actor in add or remove',
  });

const GetGroupSchema = z.object({
  groupIdentifier: z.string().min(1).describe('Group actor id or name (substring ok).'),
});

const SetPrimaryPartySchema = z
  .object({
    groupIdentifier: z
      .string()
      .min(1)
      .optional()
      .describe('Group actor id or name (substring ok).'),
    clear: z.boolean().default(false).describe('Unset the primary party instead.'),
  })
  .refine(a => !(a.groupIdentifier && a.clear), {
    message: 'pass groupIdentifier OR clear, not both',
  });

export interface DnD5eGroupToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eGroupTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eGroupToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eGroupTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'create-group',
        description:
          'Create a dnd5e group actor (type:group) with members, default ownership, shared coin, ' +
          'optionally as the primary party. One unresolved member refuses the whole create. Its ' +
          'inventory: add-item / import-item.',
        inputSchema: toInputSchema(CreateGroupSchema),
      },
      {
        name: 'manage-group-members',
        description:
          'Add and/or remove members of a group actor; each actor gets an outcome (added / removed / ' +
          'skipped with reason) and the roster is echoed.',
        inputSchema: toInputSchema(ManageGroupMembersSchema),
      },
      {
        name: 'get-group',
        description:
          'A group actor: members (dangling ids flagged), shared currency and inventory, ownership, ' +
          'whether it is the primary party.',
        inputSchema: toInputSchema(GetGroupSchema),
      },
      {
        name: 'set-primary-party',
        description:
          "Read or change the world's primary party: no arguments reports it, groupIdentifier sets " +
          'it, clear:true unsets it.',
        inputSchema: toInputSchema(SetPrimaryPartySchema),
      },
    ];
  }

  async handleCreateGroup(args: any): Promise<string> {
    const parsed = CreateGroupSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'create-group');
    const r = await this.foundry.call('createGroupActor', parsed);

    const lines = [
      `✅ Created group **${r.group.name}** (\`${r.group.id}\`)`,
      `- **Members:** ${formatRoster(r.members)}`,
      `- **Default ownership:** ${r.group.defaultOwnership}`,
    ];
    if (r.group.folderId) lines.push(`- **Folder:** \`${r.group.folderId}\``);
    if (r.primaryParty) {
      lines.push(
        `- **Primary party:** now this group${
          r.primaryParty.previous ? ` (was ${r.primaryParty.previous.name})` : ''
        }`
      );
    }
    for (const w of r.warnings ?? []) lines.push(`⚠️ ${w}`);
    return lines.join('\n');
  }

  async handleManageGroupMembers(args: any): Promise<string> {
    const parsed = ManageGroupMembersSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'manage-group-members');
    const r = await this.foundry.call('manageGroupMembers', parsed);

    const lines = [`✅ **${r.group.name}** membership updated`];
    if (r.added.length) {
      lines.push(`- **Added:** ${r.added.map((a: any) => a.name).join(', ')}`);
    }
    if (r.removed.length) {
      lines.push(`- **Removed:** ${r.removed.map((a: any) => a.name ?? `\`${a.id}\``).join(', ')}`);
    }
    for (const s of r.skipped ?? []) {
      lines.push(`- ⚠️ Skipped "${s.identifier}" — ${s.reason}`);
    }
    lines.push(`- **Roster now:** ${formatRoster(r.members)}`);
    return lines.join('\n');
  }

  async handleGetGroup(args: any): Promise<unknown> {
    const parsed = GetGroupSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'get-group');
    return this.foundry.call('getGroupInfo', parsed);
  }

  async handleSetPrimaryParty(args: any): Promise<string> {
    const parsed = SetPrimaryPartySchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'set-primary-party');
    const r = await this.foundry.call('configurePrimaryParty', parsed);

    const show = (p: { id: string; name: string } | null) =>
      p ? `**${p.name}** (\`${p.id}\`)` : '(none)';
    if (!r.changed) {
      const requested = parsed.groupIdentifier !== undefined || parsed.clear;
      return requested
        ? `✅ Already set — primary party is ${show(r.current)}.`
        : `**Primary party:** ${show(r.current)}`;
    }
    return `✅ Primary party: ${show(r.previous)} → ${show(r.current)}`;
  }
}

function formatRoster(members: Array<{ id: string; name: string | null }>): string {
  if (!members.length) return '(none)';
  return members.map(m => m.name ?? `\`${m.id}\` (dangling)`).join(', ');
}
