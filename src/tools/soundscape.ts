import { z } from 'zod';
import { SCENE_TARGET, sceneTarget } from './_targets.js';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * configure-soundscape — author the per-scene SOUND SETS of house module #6, fvtt-mod-soundscape.
 *
 * Soundscape fills a gap core Foundry has no shape for: AmbientSound placeables are positional
 * single-file loops and Playlists have no concept of *silence with variation*, so neither can do "a
 * crow, then quiet, then a distant dog". A Soundscape set is a POOL of files plus a play style —
 * interval sets play a random member then wait `interval ± variation` seconds; loop sets overlap
 * members under an equal-power crossfade, which makes a single file a seamless bed with no
 * loop-point authoring. A scene carries any number of them, stacked.
 *
 * One action-based tool rather than a CRUD family: the whole surface is one flag array on one
 * document, and folding the template-library browse in beside it keeps a rarely-used authoring path
 * from costing a second tool description in every session. The page layer (configureSoundscape)
 * owns correctness — the set schema, its clamps, set resolution, and the KEEP+WARN asset check.
 */

export interface SoundscapeToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

// Single source of truth for the tool's input contract: the handler parses with this schema and
// getToolDefinitions() advertises toInputSchema(...) of the same schema.
const ConfigureSoundscapeSchema = z.object({
  action: z
    .enum(['list', 'library', 'add', 'update', 'remove'])
    .describe("list = the scene's sets (and what plays now); library = the template catalog."),
  sceneIdentifier: sceneTarget.describe(
    `${SCENE_TARGET}; omit for the ACTIVE scene. Ignored by "library" (world-wide).`
  ),
  setIdentifier: z
    .string()
    .optional()
    .describe(
      'update / remove: the set id or exact name (ambiguous = an error); remove "all" clears.'
    ),

  // --- library browse / add-from-template -------------------------------------------------------
  template: z
    .string()
    .optional()
    .describe(
      'add: copy this library template by exact name (other fields override it); omit for files.'
    ),
  query: z.string().optional().describe('library: match on name, category or section.'),
  section: z
    .enum(['Interval Sounds', 'Ambient Loops'])
    .optional()
    .describe(
      'Interval Sounds = randomized one-shots, Ambient Loops = beds; filters library, narrows template.'
    ),
  category: z
    .string()
    .optional()
    .describe('Category substring; filters library, narrows template.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(40)
    .describe('library: max templates (default 40).'),
  verifyFiles: z
    .boolean()
    .default(false)
    .describe('list: HEAD-check every pool file and report the missing (one request per file).'),

  // --- set fields (add / update) ----------------------------------------------------------------
  name: z.string().optional().describe('Required when adding from files; a rename on update.'),
  files: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Data-relative audio paths of the pool (update replaces it); a 404 is kept and warned.'
    ),
  playStyle: z
    .enum(['interval', 'loop'])
    .optional()
    .describe(
      'interval = one-shots with interval ± intervalVariation s of silence; loop = a crossfaded bed.'
    ),
  interval: z.number().optional().describe('interval: seconds of silence (1–3600, default 25).'),
  intervalVariation: z
    .number()
    .optional()
    .describe('interval: ± seconds of jitter (default 5; clamped to interval).'),
  crossfade: z.number().optional().describe('loop: overlap in seconds (0.5–30, default 4).'),
  volume: z.number().optional().describe('0–1 (default 0.8), under the Ambient channel.'),
  volumeVariation: z
    .number()
    .optional()
    .describe('Per-play volume jitter 0–1, attenuate-only (default 0).'),
  pitchVariation: z
    .number()
    .optional()
    .describe('Per-play pitch jitter in octaves, 0–1 (default 0).'),
  whenToPlay: z
    .enum(['always', 'day', 'night'])
    .optional()
    .describe('Darkness gate: day = darkness < 0.5, night = ≥ 0.5 (default always).'),
  active: z.boolean().optional().describe('Default true.'),
});

export class SoundscapeTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: SoundscapeToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'SoundscapeTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'configure-soundscape',
        description:
          "A scene's soundscape sets (the soundscape companion module: pools of audio files played " +
          'at randomized intervals with silence between, or as a crossfaded bed): list, library, ' +
          'add (from a template or files), update (named fields; files replaces the pool), remove ' +
          '(one or "all"). Out-of-range numbers are clamped and reported; a 404 path is kept and ' +
          'warned; warns when the module is absent. GM-only.',
        inputSchema: toInputSchema(ConfigureSoundscapeSchema),
      },
    ];
  }

  async handleConfigureSoundscape(args: any): Promise<string> {
    const parsed = ConfigureSoundscapeSchema.parse(args ?? {});
    this.logger.info('Configuring soundscape', {
      action: parsed.action,
      scene: parsed.sceneIdentifier ?? '(active)',
    });
    const result = await this.foundry.call('configureSoundscape', parsed);

    switch (result?.action) {
      case 'library':
        return formatLibrary(result);
      case 'list':
        return formatList(result);
      case 'remove':
        return formatRemoval(result);
      default:
        return formatWrite(result);
    }
  }
}

const warningBlock = (warnings?: string[]): string =>
  warnings?.length ? `\n\n⚠️ ${warnings.map(w => `- ${w}`).join('\n')}` : '';

const sceneLine = (scene: any): string =>
  `${scene?.name} (${scene?.id})${scene?.active ? ' — the ACTIVE scene' : ''}` +
  `, darkness ${scene?.darkness}`;

function formatLibrary(result: any): string {
  if (!result.libraryFound) {
    return `📚 No Soundscape template library on this world.${warningBlock(result.warnings)}`;
  }
  const filtered = result.matched !== result.total;
  const head =
    `📚 Soundscape library — ${result.total} template(s) at ${result.libraryPath}` +
    (filtered ? `, ${result.matched} matching` : '');

  const sections = result.sections
    .map(
      (s: any) =>
        `\n  ${s.section} (${s.total}): ` +
        s.categories.map((c: any) => `${c.category} ${c.count}`).join(' · ')
    )
    .join('');

  const matches = result.matches.length
    ? '\n\n' +
      result.matches
        .map(
          (t: any) =>
            `  • "${t.name}" — ${t.section} / ${t.category} · ${t.fileCount} file(s) · ${t.timing}`
        )
        .join('\n')
    : '\n\n  (no template matched)';

  const more = result.truncated
    ? `\n  …and ${result.truncated} more — narrow with query/section/category, or raise limit.`
    : '';

  return `${head}${sections}${matches}${more}\n\n  Add one with action "add" + template "<exact name>".`;
}

function formatList(result: any): string {
  const mod = result.module?.installed
    ? result.module.enabled
      ? `module v${result.module.version ?? '?'} enabled`
      : 'module DISABLED'
    : 'module NOT INSTALLED';

  if (!result.sets.length) {
    return (
      `🔇 No sound sets on ${sceneLine(result.scene)} — ${mod}.` +
      '\n  Browse action "library" for a prebaked set, or add one from explicit files.' +
      warningBlock(result.warnings)
    );
  }

  const playing = result.sets.filter((s: any) => s.wouldPlayNow).length;
  const rows = result.sets
    .map((s: any) => {
      const flag = s.wouldPlayNow ? '▶' : '⏸';
      const gate = s.whenToPlay === 'always' ? '' : ` · ${s.whenToPlay} only`;
      const idle = s.idle ? ` — idle: ${s.idle}` : '';
      const missing = s.missingFiles?.length
        ? `\n      ⚠ ${s.missingFiles.length} missing file(s): ${s.missingFiles.join(', ')}`
        : '';
      return (
        `  ${flag} "${s.name}" (${s.id})\n` +
        `      ${s.playStyle} · ${s.fileCount} file(s) · ${s.timing} · vol ${s.volume}${gate}${idle}${missing}`
      );
    })
    .join('\n');

  return (
    `🔊 ${result.sets.length} sound set(s) on ${sceneLine(result.scene)} — ${mod}.\n` +
    `  ${playing} would be playing now for a client viewing this scene` +
    (result.combatDucking ? ' (combat is running — sets are DUCKED under the combat music)' : '') +
    (result.filesVerified ? '' : ' · pass verifyFiles to HEAD-check the pools') +
    `\n${rows}` +
    warningBlock(result.warnings)
  );
}

function formatRemoval(result: any): string {
  if (!result.removed.length) {
    return `Nothing to remove — ${result.scene?.name} has no sound sets.`;
  }
  return (
    `🗑️ Removed ${result.removed.length} sound set(s) from ${sceneLine(result.scene)}: ` +
    result.removed.map((s: any) => `"${s.name}"`).join(', ') +
    `\n  ${result.remaining} set(s) remain.`
  );
}

function formatWrite(result: any): string {
  const set = result.set;
  const verb = result.action === 'add' ? 'Added' : 'Updated';
  const source = result.fromTemplate ? ` from library template "${result.fromTemplate}"` : '';

  const head =
    `🔊 ${verb} sound set "${set.name}" (${set.id})${source} on ${sceneLine(result.scene)}.\n` +
    `  ${set.playStyle} · ${set.files.length} file(s) · ${set.timing} · vol ${set.volume}` +
    (set.whenToPlay === 'always' ? '' : ` · ${set.whenToPlay} only`) +
    (set.active ? '' : ' · INACTIVE') +
    `\n  ${set.wouldPlayNow ? 'Playing now' : 'Not playing right now'} for a client viewing this scene` +
    ` · ${result.total} set(s) on the scene.`;

  const changed =
    result.action === 'update'
      ? result.changed?.length
        ? `\n  changed: ${result.changed.join(', ')}`
        : '\n  nothing actually changed — the set already read that way.'
      : '';

  const clamped = result.clamped?.length
    ? `\n  clamped to the module's limits: ${result.clamped.join(', ')}`
    : '';

  return head + changed + clamped + warningBlock(result.warnings);
}
