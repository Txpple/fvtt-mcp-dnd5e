import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { formatImportReport } from '../../utils/format.js';
import { DEFAULT_FEATURE_PACKS, assertNoSrdPacks } from '../../utils/compendium-sources.js';

// Single source of truth for this handler's input contract: the handler parses with this schema
// and buildAddFeatureTool (grant-to-actor.ts) composes it into the advertised add-feature tool as
// the 'compendium-features' mode params, so the advertised and enforced contracts cannot drift.
// (Not advertised as a standalone tool — add-feature is the one MCP entry.)
export const AddFeaturesFromCompendiumSchema = z.object({
  actorIdentifier: actorTarget,
  featureNames: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Feature names (exact, case-insensitive), max 50.'),
  compendiumPacks: z
    .array(z.string().min(1))
    .default([...DEFAULT_FEATURE_PACKS])
    .describe(
      'Packs to search in order (first match wins; default MM features, then PHB classes); an SRD ' +
        'pack is refused.'
    ),
});

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eFeaturesFromCompendiumToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eFeaturesFromCompendiumTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eFeaturesFromCompendiumToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eFeaturesFromCompendiumTools' });
  }

  async handleAddFeaturesFromCompendium(args: any): Promise<any> {
    const parsed = AddFeaturesFromCompendiumSchema.parse(args);
    assertNoSrdPacks(parsed.compendiumPacks, 'add-feature compendium-features');

    this.logger.info('Adding features to D&D 5e actor from compendium', {
      actorIdentifier: parsed.actorIdentifier,
      featureCount: parsed.featureNames.length,
      packs: parsed.compendiumPacks,
    });

    await assertDnd5e(this.foundry, this.logger, 'add-features-from-compendium');

    const result = await this.foundry.call('addFeaturesFromCompendium', parsed);

    this.logger.info('Features import complete', {
      actorId: result.actor?.id,
      added: result.added?.length,
      skipped: result.skipped?.length,
      notFound: result.notFound?.length,
      failed: result.failed?.length,
    });

    return formatImportReport(result, parsed.featureNames.length, 'Features');
  }
}
