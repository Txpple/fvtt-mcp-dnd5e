import { z } from 'zod';
import { actorTargetStrict } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * Asset-bridge tools — reference integrity + asset→document composition over the live bridge.
 * Unlike the file-plane tools in tools/assets (which talk to the host's file plane, never the
 * world), these manipulate live Foundry documents via foundry.call, so they need the world loaded. Scenes moved to tools/scene.ts and playlists to
 * tools/playlist.ts so the Node-side classes mirror the page-side domain split (page/assets.ts is the
 * art/reference home); what remains here is the cohesive "asset" pair: reference integrity
 * (find/relink) and asset→document art composition (set-actor-art, add-journal-image).
 *
 * Paths are Data-relative (the same vocabulary upload-asset returns) — what Foundry stores in src/img
 * fields — so an uploaded asset path chains straight into set-actor-art with no conversion.
 */

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.
const FindAssetReferencesSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).describe('Data-relative asset paths.'),
});

const RelinkAssetSchema = z.object({
  oldPath: z.string().min(1).describe('The referenced Data-relative path.'),
  newPath: z.string().min(1).describe('The new Data-relative path.'),
  dryRun: z.boolean().default(false).describe('Report what would change without writing.'),
});

const SetActorArtSchema = z.object({
  actorIdentifier: actorTargetStrict,
  imagePath: z
    .string()
    .min(1)
    .describe(
      'Data-relative path of the portrait (a still image); the token texture too unless tokenImagePath.'
    ),
  tokenImagePath: z
    .string()
    .optional()
    .describe(
      'Data-relative path of the prototype token texture (video allowed); default imagePath.'
    ),
  applyToToken: z.boolean().default(true).describe('Also set the prototype token texture.'),
  normalizePrototype: z
    .boolean()
    .default(true)
    .describe(
      'On a token texture change, reset the texture scale to 1 and turn the dynamic ring off.'
    ),
  autoRotate: z
    .boolean()
    .optional()
    .describe('true = the token turns to face its movement (lockRotation off).'),
});

const AddJournalImageSchema = z.object({
  journalIdentifier: z.string().min(1).describe('Journal id or exact name.'),
  imagePath: z.string().min(1).describe('Data-relative path to the image.'),
  pageName: z.string().optional().describe('Page title (defaults to the file name).'),
  caption: z.string().optional().describe('Optional image caption.'),
  playerVisible: z
    .boolean()
    .optional()
    .describe('If true, players can OBSERVE this image page (a handout). Default: GM-only.'),
});

export interface AssetBridgeToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class AssetBridgeTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: AssetBridgeToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'AssetBridgeTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'find-asset-references',
        description:
          'Every world document (scenes, actors, items, journals, playlists, macros, tables) that ' +
          'references an asset path.',
        inputSchema: toInputSchema(FindAssetReferencesSchema),
      },
      {
        name: 'relink-asset',
        description:
          'Rewrite every reference from one asset path to another; dryRun previews. GM-only.',
        inputSchema: toInputSchema(RelinkAssetSchema),
      },
      {
        name: 'set-actor-art',
        description:
          "Set an actor's portrait and, by default, its prototype token art; a changed token texture " +
          'is normalized (scale 1, ring off). Reports placed tokens still carrying the old art. ' +
          'GM-only.',
        inputSchema: toInputSchema(SetActorArtSchema),
      },
      {
        name: 'add-journal-image',
        description:
          'Append an image page (optional caption) to a journal entry from a Data-relative path. ' +
          'GM-only unless playerVisible (a handout).',
        inputSchema: toInputSchema(AddJournalImageSchema),
      },
    ];
  }

  // --- handlers -------------------------------------------------------------

  async handleFindAssetReferences(args: any): Promise<string> {
    const { paths } = FindAssetReferencesSchema.parse(args ?? {});
    const result = await this.foundry.call('findAssetReferences', { paths });
    const refs = result?.references ?? {};
    const lines: string[] = [];
    for (const path of paths) {
      const hits = refs[path] ?? [];
      if (hits.length === 0) {
        lines.push(`• ${path} — no references found (safe to delete/move).`);
      } else {
        lines.push(`• ${path} — ${hits.length} reference(s):`);
        for (const h of hits) {
          lines.push(`    - ${h.documentType} "${h.documentName}" (${h.documentId}) :: ${h.field}`);
        }
      }
    }
    return `Asset references (${result?.totalReferences ?? 0} total):\n${lines.join('\n')}`;
  }

  async handleRelinkAsset(args: any): Promise<string> {
    const { oldPath, newPath, dryRun } = RelinkAssetSchema.parse(args ?? {});
    const result = await this.foundry.call('relinkAsset', {
      oldPath,
      newPath,
      dryRun,
    });
    const changed = result?.changed ?? [];
    const verb = result?.dryRun ? 'Would rewrite' : 'Rewrote';
    const header = `${verb} ${result?.changedCount ?? changed.length} reference(s): ${oldPath} → ${newPath}`;
    if (changed.length === 0) return `${header} (nothing referenced the old path).`;
    const lines = changed.map(
      (c: any) => `  - ${c.documentType} "${c.documentName}" (${c.documentId}) :: ${c.field}`
    );
    return `${header}\n${lines.join('\n')}`;
  }

  async handleSetActorArt(args: any): Promise<string> {
    const parsed = SetActorArtSchema.parse(args ?? {});
    const result = await this.foundry.call('setActorArt', parsed);
    const warns = result.warnings ?? [];
    const warnSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    // Nothing valid was written (e.g. a video portrait with applyToToken:false) — report + warn.
    if (!result.updated) {
      return `No art applied to actor "${result.actorName ?? parsed.actorIdentifier}".${warnSection}`;
    }
    const img = result.img;
    const tokenSrc = result.tokenSrc;
    // Distinct portrait vs token art (a still portrait + an animated token) → show both; otherwise
    // keep the original single-path phrasing.
    const artDesc =
      result.appliedToToken && tokenSrc && tokenSrc !== img
        ? `portrait ${img ?? '(unchanged)'} · token ${tokenSrc}`
        : `${img ?? tokenSrc}${result.appliedToToken ? ' (portrait + prototype token)' : ' (portrait only)'}`;
    const normalized =
      Array.isArray(result.normalized) && result.normalized.length
        ? ` Prototype normalized: ${result.normalized.join(', ')}.`
        : '';
    // `placedTokens` is cut at 20; `placedTokensStale` is the full count (both present together).
    const stale = result.placedTokensStale ?? 0;
    const placed =
      Array.isArray(result.placedTokens) && result.placedTokens.length
        ? `\n\n⚠️ ${stale} placed token(s) still carry the old art/settings — ` +
          'update-token each or delete + re-drop:\n' +
          result.placedTokens
            .map(t => `- ${t.scene} · ${t.name} (${t.tokenId}): ${t.stale.join(', ')}`)
            .join('\n') +
          (stale > result.placedTokens.length
            ? `\n- … ${stale - result.placedTokens.length} more`
            : '')
        : '';
    return `Set art for actor "${result.actorName}" (${result.actorId}) → ${artDesc}.${normalized}${placed}${warnSection}`;
  }

  async handleAddJournalImage(args: any): Promise<string> {
    const parsed = AddJournalImageSchema.parse(args ?? {});
    const result = await this.foundry.call('addJournalImage', parsed);
    const warns = result.warnings ?? [];
    const warnSection = warns.length
      ? `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
      : '';
    return (
      `Added image page "${result?.pageName}" (${result?.pageId}) to journal ` +
      `"${result?.journalName}" (${result?.journalId}) → ${result?.src}.` +
      warnSection
    );
  }
}
