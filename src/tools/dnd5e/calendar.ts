import { z } from 'zod';
import type { FoundryBridge } from '../../foundry.js';
import { Logger } from '../../logger.js';
import { assertDnd5e } from '../../utils/system-detection.js';
import { toInputSchema } from '../../utils/schema.js';

/**
 * manage-calendar — the in-world date and time (Foundry v14 game.time + the dnd5e 6.0 calendar):
 * read the current date/time, advance it (rounds / minutes / hours / days), or set the date and
 * time of day. Advancing time is what drives dnd5e's dawn / dusk / day recovery and bastion turns
 * once the calendar is enabled (configure-dnd5e-settings calendarEnabled). GM-only writes.
 */

const ManageCalendarSchema = z.object({
  action: z
    .enum(['read', 'advance', 'set'])
    .default('read')
    .describe('read the calendar (default); advance the world time; set the date / time of day.'),
  rounds: z
    .number()
    .int()
    .optional()
    .describe('advance: combat rounds (6 s each); negative rewinds.'),
  minutes: z.number().int().optional().describe('advance: minutes; negative rewinds.'),
  hours: z.number().int().optional().describe('advance: hours; negative rewinds.'),
  days: z.number().int().optional().describe('advance: days; negative rewinds.'),
  seconds: z.number().int().optional().describe('advance: seconds; negative rewinds.'),
  year: z.number().int().optional().describe('set: the year as displayed (e.g. 1492 DR).'),
  month: z
    .union([z.number().int().min(1), z.string().min(1)])
    .optional()
    .describe(
      'set: the month — its number (1-based) or its name in the active calendar ("Mirtul").'
    ),
  day: z.number().int().min(1).optional().describe('set: the day of the month (1-based).'),
  hour: z.number().int().min(0).max(23).optional().describe('set: the hour (0–23).'),
  minute: z.number().int().min(0).max(59).optional().describe('set: the minute (0–59).'),
});

export interface DnD5eCalendarToolOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

const stamp = (c: any) =>
  c
    ? `${c.formatted?.date ?? `${c.year}-${c.month?.number}-${c.day}`} ${c.formatted?.time ?? `${c.hour}:${String(c.minute).padStart(2, '0')}`}` +
      (c.formatted?.approximate ? ` (${c.formatted.approximate})` : '')
    : '?';

export class DnD5eCalendarTool {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: DnD5eCalendarToolOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'DnD5eCalendarTool' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-calendar',
        description:
          '[D&D 5e] The in-world date and time (dnd5e 6.0 calendar on Foundry v14 game.time). ' +
          'action "read" (default) reports the calendar in use, whether it is enabled, and the current ' +
          'date / time (year as displayed, month name + number, day, weekday, hour, minute, plus the ' +
          'system\'s own formatted / approximate strings). "advance" moves time by rounds / minutes / ' +
          'hours / days / seconds (negative rewinds) — this is what triggers dawn / dusk / day recovery ' +
          'and bastion turns when the calendar is enabled. "set" jumps to a date (year / month by ' +
          'number or name / day) and/or a time of day (hour / minute); omitted parts keep their value. ' +
          'Writes report before → after. Enable the calendar / pick one with configure-dnd5e-settings. ' +
          'GM-only writes.',
        inputSchema: toInputSchema(ManageCalendarSchema),
      },
    ];
  }

  async handleManageCalendar(args: any): Promise<string> {
    const parsed = ManageCalendarSchema.parse(args ?? {});
    await assertDnd5e(this.foundry, this.logger, 'manage-calendar');
    this.logger.info('manage-calendar', { action: parsed.action });
    const r: any = await this.foundry.call('manageCalendar', parsed);
    if (parsed.action === 'read') return this.formatRead(r);
    const head =
      parsed.action === 'advance'
        ? `⏩ Advanced the world time by ${r?.deltaSeconds} s`
        : '📅 Set the world date/time';
    return [`${head}:`, `- before: ${stamp(r?.before)}`, `- after:  ${stamp(r?.after)}`].join('\n');
  }

  private formatRead(c: any): string {
    const months = Array.isArray(c?.months) ? c.months.map((m: any) => m.name).join(', ') : '';
    return [
      `**Calendar:** ${c?.calendarName ?? c?.calendar ?? '?'} (\`${c?.calendar ?? '?'}\`) — ${c?.enabled ? 'enabled' : 'DISABLED (HUD + calendar recovery off; enable with configure-dnd5e-settings calendarEnabled)'}`,
      `- **Now:** ${stamp(c)}`,
      `- **Components:** year ${c?.year}, month ${c?.month?.number} (${c?.month?.name ?? '?'}), day ${c?.day}${c?.weekday ? ` (${c.weekday})` : ''}, ${c?.hour}:${String(c?.minute ?? 0).padStart(2, '0')}:${String(c?.second ?? 0).padStart(2, '0')} · worldTime ${c?.worldTime} s`,
      `- **Daily recovery:** ${c?.dailyRecovery === '' ? 'automatic' : (c?.dailyRecovery ?? '?')}`,
      ...(months ? [`- **Months:** ${months}`] : []),
    ].join('\n');
  }
}
