import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * apply-condition — set (or clear) dnd5e conditions on an actor via the core toggleStatusEffect API.
 * Authoring-only: it changes a creature's condition state; it does NOT run combat (no duration
 * tick-down, no save-ends loop). Exhaustion is leveled — pass exhaustionLevel (1-6; 0 removes).
 */

const ApplyConditionSchema = z.object({
  actorIdentifier: actorTarget,
  conditions: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'dnd5e condition / status ids (blinded, prone, exhaustion, coverHalf, concentrating …), ' +
        'case-insensitive.'
    ),
  active: z.boolean().default(true).describe('false removes them.'),
  exhaustionLevel: z
    .number()
    .int()
    .min(0)
    .max(6)
    .optional()
    .describe('Exhaustion level 1–6 when applying (0 removes).'),
});

export interface DnD5eConditionToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eConditionTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eConditionToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eConditionTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'apply-condition',
        description:
          '[D&D 5e] Apply or remove conditions on an actor (exhaustion by level). Sets state only; no ' +
          'duration countdown.',
        inputSchema: toInputSchema(ApplyConditionSchema),
      },
    ];
  }

  async handleApplyCondition(args: any): Promise<any> {
    const parsed = ApplyConditionSchema.parse(args ?? {});
    this.logger.info('Applying conditions', {
      actorIdentifier: parsed.actorIdentifier,
      conditions: parsed.conditions,
      active: parsed.active,
    });

    await assertDnd5e(this.foundry, this.logger, 'apply-condition');
    const result = await this.foundry.call('applyCondition', parsed);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const applied: string[] = result?.applied ?? [];
    const removed: string[] = result?.removed ?? [];
    const warnings: string[] = result?.warnings ?? [];
    const parts: string[] = [];
    if (applied.length) parts.push(`applied ${applied.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    const summary = `✅ ${result?.actor?.name}: ${parts.join('; ') || 'no change'}`;
    const details = [
      `**Actor:** ${result?.actor?.name} (id: \`${result?.actor?.id}\`)`,
      `**Now active:** ${(result?.statuses ?? []).join(', ') || '(none)'}`,
    ].join('\n');
    const warningSection =
      warnings.length > 0
        ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      actor: result?.actor,
      applied,
      removed,
      statuses: result?.statuses ?? [],
      warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }
}
