import { z } from 'zod';
import { actorTarget } from '../_targets.js';
import { toInputSchema } from '../../utils/schema.js';
import { AddToActorItemsSchema } from '../items.js';
import { AddFeatureSchema } from './add-feature.js';
import { AddFeaturesFromCompendiumSchema } from './features.js';

/**
 * The unified `add-feature` tool definition.
 *
 * add-feature is the single MCP entry point for adding content to an existing actor; the dispatch
 * (registry.ts) routes its `mode` to one of three handlers: author a feature from scratch, import
 * named features from a compendium, or attach world items. Each mode's parameters ARE the zod schema
 * the owning handler parses with — AddFeatureSchema (add-feature.ts), AddFeaturesFromCompendiumSchema
 * (features.ts), and AddToActorItemsSchema (items.ts) — composed here into ONE wrapper schema and
 * advertised via toInputSchema(). So the model gets each mode's complete parameter guidance without
 * those handlers being exposed as standalone MCP tools, and there is no hand-written JSON schema: the
 * advertised contract is generated from the same zod the handlers enforce. (Historically named
 * `grant-to-actor`; renamed to match how the skills/docs refer to it. The filename is kept to avoid
 * churn.)
 *
 * actorIdentifier is required ONCE, at the top level (the dispatch merges it into each mode's args);
 * the `feature` / `compendiumFeatures` sub-schemas carry their own for their handlers' parse, and
 * the wrapper omits those copies from the advertised contract (one field, one description — F22).
 */
const AddFeatureWrapperSchema = z.object({
  actorIdentifier: actorTarget,
  mode: z
    .enum(['compendium-features', 'feature', 'items'])
    .describe(
      'compendium-features imports by name (compendiumFeatures); feature authors one (feature); ' +
        'items attaches raw items.'
    ),
  feature: AddFeatureSchema.omit({ actorIdentifier: true })
    .optional()
    .describe("mode 'feature': the authored feature, by featureType."),
  compendiumFeatures: AddFeaturesFromCompendiumSchema.omit({ actorIdentifier: true })
    .optional()
    .describe("mode 'compendium-features': the names and packs."),
  items: AddToActorItemsSchema.optional().describe("mode 'items': raw items (name, type, system)."),
});

export function buildAddFeatureTool() {
  return {
    name: 'add-feature',
    description:
      'Add a feature, attack, spellcasting setup or spells to an actor. mode compendium-features ' +
      'imports named features from a pack (a copied feature reports any unresolved @scale formula); ' +
      'feature authors one by featureType (a duplicate name is refused); items attaches raw item ' +
      'data. Gear: import-item / add-item.',
    inputSchema: toInputSchema(AddFeatureWrapperSchema),
  };
}
