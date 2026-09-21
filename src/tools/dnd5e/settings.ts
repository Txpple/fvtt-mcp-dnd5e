import { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { DND5E_SETTINGS, type Dnd5eSettingSpec } from '../../utils/dnd5e-settings.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * configure-dnd5e-settings — read or set the dnd5e 6.0 automation switches (falling, token-size
 * and vision sync, exhaustion, initiative grouping, auto-Downed, encounter placement, the player
 * damage / effects trays, bastions, the calendar). One typed tool over an ALLOW-LIST — the pure
 * catalogue in utils/dnd5e-settings.ts is the contract; nothing else in the settings menu is
 * reachable. No arguments → report; any argument → apply and echo previous → new. GM-only.
 */

function fieldFor(spec: Dnd5eSettingSpec): z.ZodTypeAny {
  const describe = `${spec.hint}${spec.requiresReload ? ' Reload to apply.' : ''}`;
  if (spec.kind === 'boolean') return z.boolean().optional().describe(describe);
  if (spec.kind === 'integer') return z.number().int().min(1).optional().describe(describe);
  if (spec.choices) {
    return z
      .enum(spec.choices as [string, ...string[]])
      .optional()
      .describe(describe);
  }
  return z.string().min(1).optional().describe(describe);
}

const shape: Record<string, z.ZodTypeAny> = {};
for (const spec of DND5E_SETTINGS) if (!spec.readOnly) shape[spec.key] = fieldFor(spec);
const ConfigureDnd5eSettingsSchema = z.object(shape);

export interface DnD5eSettingsToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class DnD5eSettingsTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eSettingsToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eSettingsTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'configure-dnd5e-settings',
        description:
          '[D&D 5e] Read or set the dnd5e 6.0 automation switches: falling, token size / vision ' +
          'sync, exhaustion, initiative grouping, auto-Downed, encounter placement, the player trays, ' +
          'bastions, the calendar. No arguments: every switch. Any argument: applied and echoed ' +
          'previous → new; the switches that need a client reload are named. Only the listed keys ' +
          'are reachable. GM-only.',
        inputSchema: toInputSchema(ConfigureDnd5eSettingsSchema),
      },
    ];
  }

  async handleConfigureDnd5eSettings(args: any): Promise<string> {
    const parsed = ConfigureDnd5eSettingsSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'configure-dnd5e-settings');
    const requested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) if (v !== undefined) requested[k] = v;
    this.logger.info('configure-dnd5e-settings', { keys: Object.keys(requested) });
    const r = await this.foundry.call('configureDnd5eSettings', requested);
    return this.format(r, Object.keys(requested).length > 0);
  }

  private format(r: any, requested: boolean): string {
    const settings = r?.settings ?? {};
    const fmt = (v: unknown) =>
      v === '' ? '""' : v === undefined ? '(not registered)' : `\`${String(v)}\``;
    const lines = DND5E_SETTINGS.map(
      s =>
        `- **${s.label}** (\`${s.key}\`): ${fmt(settings[s.key])}${s.readOnly ? ' _(client — read-only)_' : ''}${s.requiresReload ? ' _(reload to apply)_' : ''}`
    );
    const calendars =
      Array.isArray(r?.calendars) && r.calendars.length > 0
        ? `- **Calendars available:** ${r.calendars.map((c: string) => `\`${c}\``).join(', ')}`
        : '';
    const applied = Array.isArray(r?.applied) ? r.applied : null;
    if (!applied) {
      const header = requested
        ? '✅ Already configured — no changes needed.'
        : '**dnd5e automation settings**';
      return [header, ...lines, ...(calendars ? [calendars] : [])].join('\n');
    }
    const reload =
      Array.isArray(r?.reloadRequired) && r.reloadRequired.length > 0
        ? `\n⚠ Takes effect after clients reload: ${r.reloadRequired.map((k: string) => `\`${k}\``).join(', ')}`
        : '';
    return [
      `✅ dnd5e settings updated (${applied.length} change(s)):`,
      ...applied.map((c: any) => `- ${c.key}: ${fmt(c.previous)} → ${fmt(c.next)}`),
      reload,
      '',
      '**Now:**',
      ...lines,
      ...(calendars ? [calendars] : []),
    ]
      .filter(l => l !== '' || true)
      .join('\n');
  }
}
