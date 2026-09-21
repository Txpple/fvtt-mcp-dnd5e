import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * content-audit — the finishing-check safety net for authoring rules 7/8/9/12. A read-only scan the
 * skill runs BEFORE declaring a build "done": it flags placeholder icons (rule 8), GM-fudge /
 * pretend-reskin language in descriptions/biographies (rule 7), magic items on an NPC with no world-Item
 * loot twin (rule 9), and GM-note / spoiler leaks in a player-visible item description (rule 12) —
 * catching violations no matter which handler or hand edit produced them. The page layer (auditContent)
 * owns the gathering + the pure scanners.
 */
const ContentAuditSchema = z.object({
  actorIdentifiers: z
    .array(actorTarget)
    .optional()
    .describe('Actors to audit, each with its embedded items and features.'),
  itemFolders: z
    .array(z.string().min(1))
    .optional()
    .describe('World-Item folders to audit (name or id).'),
  worldItemIds: z.array(z.string().min(1)).optional().describe('World Items to audit, by id.'),
});

export interface DnD5eContentAuditToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eContentAuditTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eContentAuditToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eContentAuditTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'content-audit',
        description:
          '[D&D 5e] Read-only scan of authored content for the authoring-policy rules: placeholder ' +
          'icons (rule 8), GM-fudge / reskin language (7), a magic NPC item with no loot twin (9), a ' +
          'GM note or spoiler in a player-visible item description (12; biographies are not scanned). ' +
          'No target = every NPC and every world Item.',
        inputSchema: toInputSchema(ContentAuditSchema),
      },
    ];
  }

  async handleContentAudit(args: any): Promise<any> {
    const parsed = ContentAuditSchema.parse(args ?? {});
    this.logger.info('Auditing authored content', {
      actors: parsed.actorIdentifiers?.length ?? 0,
      folders: parsed.itemFolders?.length ?? 0,
      worldItems: parsed.worldItemIds?.length ?? 0,
    });

    await assertDnd5e(this.foundry, this.logger, 'content-audit');
    const result = await this.foundry.call('auditContent', parsed);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const findings: any[] = result?.findings ?? [];
    const c = result?.counts ?? {};
    const where = (f: any) => (f.owner ? `${f.owner} → ${f.name}` : f.name);

    let body: string;
    if (findings.length === 0) {
      body = `✅ No rule 7/8/9/12 violations found (${result?.scope}). Scanned ${result?.scanned?.actors ?? 0} actor(s) + ${result?.scanned?.worldItems ?? 0} world item(s).`;
    } else {
      const groups: Array<[number, string, string]> = [
        [8, 'icons/svg', '🖼️ Rule 8 — placeholder icons (set a real compendium icon)'],
        [7, 'fudge', '🎭 Rule 7 — GM-fudge / pretend-reskin (use real mechanics instead)'],
        [9, 'loot', '💰 Rule 9 — NPC magic with no loot twin (mint a world Item)'],
        [
          12,
          'gm-leak',
          '🤫 Rule 12 — GM note / spoiler in a player-visible description (rewrite innocuous; move the note to a GM-only journal)',
        ],
        [
          0,
          'dead-rule',
          '⚙️ Dead dnd5e 6.0 rules change — key × type mismatch, a silent no-op in play (re-author the change with manage-effect)',
        ],
      ];
      const sections = groups
        .map(([rule, , heading]) => {
          const rows = findings.filter(f => f.rule === rule);
          if (rows.length === 0) return null;
          return `**${heading}** (${rows.length})\n${rows
            .map(f => `- ${where(f)} (${f.docType} \`${f.id}\`) — ${f.detail}`)
            .join('\n')}`;
        })
        .filter(Boolean);
      body =
        `⚠️ Found ${findings.length} issue(s) — fix and re-run content-audit.\n\n` +
        sections.join('\n\n');
    }

    return {
      success: true,
      ok: result?.ok ?? findings.length === 0,
      counts: c,
      findings,
      scanned: result?.scanned,
      ...(result?.notFound ? { notFound: result.notFound } : {}),
      message: body,
    };
  }
}
