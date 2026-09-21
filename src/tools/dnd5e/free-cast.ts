import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * add-free-cast — feature-granted "cast without a spell slot, N per rest", the native way.
 *
 * House rule (owner, 2026-07-05 — supersedes the earlier forward-on-the-spell shape): the sheet
 * gets TWO entries. The spell sits in the repertoire as a normal ALWAYS-PREPARED spell (castable
 * with slots, no pools, no dialogs), and the free cast is a `cast` activity ON the granting
 * feature — which projects a "<Spell> - <Feature>" entry into the sheet's NATIVE "Additional
 * Spells" spellbook section with its own tracked pool (default 1/long rest). The old shape (a use
 * pool + forward activity on the spell) is migrated off automatically.
 */

const AddFreeCastSchema = z.object({
  actorIdentifier: actorTarget,
  spellIdentifier: z
    .string()
    .min(1)
    .describe(
      'An embedded spell (name or id), or a premium compendium uuid to add it (always prepared) ' +
        'when the actor lacks it.'
    ),
  grantedBy: z
    .string()
    .min(1)
    .describe('The granting feature on the actor (name or id); the cast activity lands on it.'),
  uses: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe(
      'Casts per recovery period: a number or a formula ("@scale.ranger.favored-enemy"). Default 1.'
    ),
  recoveryPeriod: z
    .enum(['lr', 'sr', 'day', 'dawn', 'dusk'])
    .optional()
    .describe('When the casts recover (default lr).'),
});

export interface DnD5eFreeCastToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eFreeCastTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eFreeCastToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eFreeCastTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'add-free-cast',
        description:
          '[D&D 5e] Grant a feature-based free cast (Magic Initiate, Favored Enemy, a lineage): the ' +
          'spell stays in the repertoire always prepared (imported if missing) and a cast activity on ' +
          'the granting feature projects a "<Spell> - <Feature>" entry with its own pool into the ' +
          "sheet's Additional Spells. Migrates the old on-spell pool shape and dedupes cached " +
          'copies. Idempotent.',
        inputSchema: toInputSchema(AddFreeCastSchema),
      },
    ];
  }

  async handleAddFreeCast(args: any): Promise<any> {
    const parsed = AddFreeCastSchema.parse(args ?? {});
    this.logger.info('Adding free cast', {
      actorIdentifier: parsed.actorIdentifier,
      spellIdentifier: parsed.spellIdentifier,
      grantedBy: parsed.grantedBy,
    });

    await assertDnd5e(this.foundry, this.logger, 'add-free-cast');
    const result = await this.foundry.call('addFreeCast', parsed);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const warns: string[] = Array.isArray(result?.warnings) ? result.warnings : [];
    const verb = result?.activity?.reused ? 'Updated' : 'Added';
    const period = result?.activity?.uses?.recovery?.[0]?.period ?? '?';
    const summary =
      `✅ ${verb} free cast "${result?.activity?.name}" on "${result?.actor?.name}" ` +
      `(${result?.activity?.uses?.max ?? '?'}/${period}, on feature "${result?.feature?.name}")`;
    const repertoire = result?.repertoire?.imported
      ? `imported to the repertoire (always prepared)`
      : result?.repertoire?.migrated
        ? `already in the repertoire — old free-cast shape migrated off`
        : `already in the repertoire (clean)`;
    const details = [
      `**Actor:** ${result?.actor?.name} (id: \`${result?.actor?.id}\`)`,
      `**Repertoire spell:** ${result?.repertoire?.name} (id: \`${result?.repertoire?.id}\`) — ${repertoire}`,
      `**Feature:** ${result?.feature?.name} (id: \`${result?.feature?.id}\`)`,
      `**Cast activity:** ${result?.activity?.name} (id: \`${result?.activity?.id}\`, ` +
        `${result?.activity?.uses?.max} per ${period}, ${result?.activity?.activationType})`,
      `**Additional Spells entry:** ${result?.additionalSpells?.name ?? '(mints on first use)'}` +
        (result?.additionalSpells?.cachedId
          ? ` (id: \`${result.additionalSpells.cachedId}\`)`
          : ''),
    ].join('\n');
    const warningSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    return {
      summary,
      success: true,
      actor: result?.actor,
      feature: result?.feature,
      spell: result?.spell,
      repertoire: result?.repertoire,
      activity: result?.activity,
      additionalSpells: result?.additionalSpells,
      ...(warns.length ? { warnings: warns } : {}),
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }
}
