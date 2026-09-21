import { z } from 'zod';
import { actorTarget, itemTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * update-actor-item — edit an item embedded on an actor (a weapon, feature, spell, piece of
 * equipment, ...). Generic dot-path editor: `patch` keys are Foundry data paths applied as-is, and
 * `deletePaths` remove keys (via the `-=` form). For authoring/editing activities specifically,
 * prefer manage-activity, which knows the activity shapes; this tool is the low-level escape hatch
 * for any item field. The page layer (updateActorItem) owns resolution + the deletion-key transform.
 */

const UpdateActorItemSchema = z.object({
  actorIdentifier: actorTarget,
  itemIdentifier: itemTarget,
  type: z.string().optional().describe('Item type to disambiguate ("weapon", "feat", "spell").'),
  name: z.string().min(1).optional().describe('Rename the item.'),
  img: z.string().optional().describe('Item image path or URL.'),
  patch: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Dot-path → value, applied as-is (arrays replace whole), e.g. ' +
        '{"system.activities.<id>.attack.bonus": "2"}.'
    ),
  deletePaths: z
    .array(z.string().min(1))
    .optional()
    .describe('Dot-paths to delete, e.g. "system.activities.<id>" (the "-=" form is applied).'),
});

export interface DnD5eUpdateActorItemToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eUpdateActorItemTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eUpdateActorItemToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eUpdateActorItemTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'update-actor-item',
        description:
          '[D&D 5e] Edit an item embedded on an actor: name, img, a dot-path `patch`, `deletePaths`. ' +
          'Activities have their own editor (manage-activity); the paths and ids come from ' +
          'manage-actors get-entity.',
        inputSchema: toInputSchema(UpdateActorItemSchema),
      },
    ];
  }

  async handleUpdateActorItem(args: any): Promise<any> {
    const parsed = UpdateActorItemSchema.parse(args ?? {});
    if (
      parsed.name === undefined &&
      parsed.img === undefined &&
      !parsed.patch &&
      !parsed.deletePaths
    ) {
      throw new Error('Provide at least one of: name, img, patch, deletePaths.');
    }
    this.logger.info('Updating embedded actor item', {
      actorIdentifier: parsed.actorIdentifier,
      itemIdentifier: parsed.itemIdentifier,
    });

    await assertDnd5e(this.foundry, this.logger, 'update-actor-item');
    const result = await this.foundry.call('updateActorItem', parsed);
    return this.formatResponse(result);
  }

  private formatResponse(result: any): any {
    const keys: string[] = result?.appliedKeys ?? [];
    // Surface any bad-asset (broken-img) warnings the page layer reported (rule 8).
    const warns = Array.isArray(result?.warnings) ? result.warnings : [];
    const summary = `✅ Updated "${result?.item?.name}" on "${result?.actor?.name}" (${keys.length} change${keys.length === 1 ? '' : 's'})`;
    const details = [
      `**Actor:** ${result?.actor?.name} (id: \`${result?.actor?.id}\`)`,
      `**Item:** ${result?.item?.name} (id: \`${result?.item?.id}\`, type: ${result?.item?.type})` +
        // dnd5e identity mask: while unidentified, `name` above is the mask — show the source name too.
        (result?.item?.trueName ? ` — unidentified; true name: "${result.item.trueName}"` : ''),
      `**Changed:** ${keys.join(', ') || '(none)'}`,
    ].join('\n');
    const warningSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    return {
      summary,
      success: true,
      actor: result?.actor,
      item: result?.item,
      appliedKeys: keys,
      ...(warns.length ? { warnings: warns } : {}),
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }
}
