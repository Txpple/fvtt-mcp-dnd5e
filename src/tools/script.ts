import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * run-script (issue #4): one tool whose argument is a short JavaScript program. The model writes
 * it, the page runs it against `fvtt.*` — the page functions behind every tool — and only the
 * return value plus a receipt come back: a loop of a dozen steps in one round trip, with none of
 * the intermediate data in the conversation. The guard rails live in the page (src/page/run-script.ts):
 * shadowed globals, counted and capped writes, a receipt of every document touched, a dry run that
 * stubs the writes, and `undo` by receipt id. The static check here is the cheap first door: the
 * words that reach outside the facade are refused before anything travels.
 */

const RunScriptSchema = z
  .object({
    script: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The body of an async function: `await fvtt.listActors({})`; `log(…)` collects lines; `return` what is wanted.'
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'List the writes the script would make; each returns `{ dryRun: true }` instead of running.'
      ),
    undo: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A receipt id from an earlier run: delete what it created, restore what it changed or deleted.'
      ),
    maxWrites: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Cap on write calls (default 150).'),
    maxDeletes: z
      .number()
      .int()
      .min(0)
      .max(500)
      .optional()
      .describe('Cap on delete calls (default 30).'),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(600)
      .optional()
      .describe('Seconds before the run is abandoned (default 60).'),
  })
  .refine(o => (o.script ? 1 : 0) + (o.undo ? 1 : 0) === 1, {
    message: 'pass exactly one of script or undo',
  });

/**
 * Words a script may not use: the ways out of the facade that shadowing cannot close (a dynamic
 * `import()`, `require`) and the ones worth refusing by name before the page sees them. Property
 * access (`x.fetch`) and object keys (`fetch:`) are not matches; the page shadows the rest.
 */
const FORBIDDEN = [
  'import',
  'require',
  'eval',
  'Function',
  'globalThis',
  'process',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
];
const FORBIDDEN_RE = new RegExp(`(?<![.\\w$])\\b(${FORBIDDEN.join('|')})\\b(?!\\s*:)`, 'g');

/** The forbidden words a script uses, each once, in order of appearance. */
export function forbiddenWords(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(FORBIDDEN_RE)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

export interface ScriptToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class ScriptTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor({ foundry, logger }: ScriptToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ScriptTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'run-script',
        description:
          'Run a short JavaScript program in the GM page against `fvtt.*`, the page functions behind ' +
          'every tool (the run-script skill lists them): loops and bulk jobs in one round trip, only ' +
          'the return value comes back. Globals are shadowed, writes are counted and capped, every ' +
          'document touched is recorded; `dryRun` stubs the writes, `undo` reverses a receipt.',
        inputSchema: toInputSchema(RunScriptSchema),
      },
    ];
  }

  async handleRunScript(args: any): Promise<string> {
    const a = RunScriptSchema.parse(args ?? {});
    if (a.undo) {
      const r = await this.foundry.call('undoScript', { id: a.undo });
      const failed = r.failed.length
        ? `\n${r.failed.length} could not be reversed:\n${r.failed.map(f => `  • ${f.op} ${f.uuid}: ${f.error}`).join('\n')}`
        : '';
      return `↩️ Receipt ${r.id}: ${r.undone} write(s) reversed.${failed}`;
    }
    const script = a.script!;
    const bad = forbiddenWords(script);
    if (bad.length) {
      throw new Error(
        `run-script refused: the script uses ${bad.map(w => `\`${w}\``).join(', ')} — the facade ` +
          '(`fvtt.*`) is the whole surface; there is no way out of it by design.'
      );
    }
    this.logger.info('run-script', { chars: script.length, dryRun: !!a.dryRun });
    const r = await this.foundry.call('runScript', {
      src: script,
      ...(a.dryRun ? { dryRun: true } : {}),
      ...(a.maxWrites !== undefined ? { maxWrites: a.maxWrites } : {}),
      ...(a.maxDeletes !== undefined ? { maxDeletes: a.maxDeletes } : {}),
      ...(a.timeoutSeconds !== undefined ? { timeoutMs: a.timeoutSeconds * 1000 } : {}),
    });

    const lines: string[] = [];
    if (r.dryRun) {
      lines.push(
        `🧪 Dry run — ${r.dryRun.length} write(s) the script would make (${r.receipt.calls} call(s) in all):`
      );
      for (const w of r.dryRun) lines.push(`  • fvtt.${w.fn}(${JSON.stringify(w.args)})`);
      if (!r.ok) {
        lines.push(
          `The dry run stopped where a stubbed write's result was needed: ${r.error}. The writes above are the ones reached.`
        );
      }
    } else {
      const rc = r.receipt;
      lines.push(
        `${r.ok ? '✅' : '❌'} ${r.ok ? 'Done' : 'Failed'} — receipt ${rc.id}: ${rc.created} created, ` +
          `${rc.updated} updated, ${rc.deleted} deleted (${rc.calls} call(s), ${rc.writes} write(s)). ` +
          `Undo with { "undo": "${rc.id}" }.`
      );
      if (!r.ok) lines.push(`Error: ${r.error}`);
    }
    for (const l of r.log) lines.push(`  · ${l}`);
    if (r.ok && !r.dryRun) {
      lines.push('Result:');
      lines.push(JSON.stringify(r.result, null, 2));
    }
    return lines.join('\n');
  }
}
