import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import {
  callContext,
  loadReceipt,
  receiptsDir,
  receiptWorldKey,
  type StoredReceipt,
} from '../receipts.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { toInputSchema } from '../utils/schema.js';

/**
 * run-script (issue #4): one tool whose argument is a short JavaScript program. The model writes
 * it, the page runs it against `fvtt.*` — the page functions behind every tool — and only the
 * return value comes back: a loop of a dozen steps in one round trip, with none of the
 * intermediate data in the conversation. The guard rails live in the page (src/page/run-script.ts):
 * counted and capped writes and a dry run that stubs them. A run's writes are its call's receipt,
 * like every write tool's (src/receipts.ts), and `undo` reverses any receipt by id: a run's, a
 * tool call's, or an undo's own (a redo). The facade is the intended surface. The check here
 * refuses, before anything travels, the words that step around it — in code, never in a string or
 * a comment — and the page shadows the globals a script would reach for by habit. Both guard
 * against accidents and close the obvious doors; neither is a security boundary (issue #15). A
 * script runs with the rights of the user the bridge joined as: that role is the boundary.
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
        'A receipt id from any write: delete what it created, restore what it changed or deleted.'
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
 * Words a script may not use as code: the ways around the facade that shadowing cannot close (a
 * dynamic `import()`, `require`) and the ones worth refusing by name before the page sees them.
 * Property access (`x.fetch`) and object keys (`fetch:`) are not matches; the page shadows the rest.
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

/**
 * The way back to the page's real globals past the shadowing: any function's constructor compiles
 * code in the global scope (`[].constructor.constructor('return this')()`), and the prototype
 * walks reach it. Refused as code tokens anywhere (after a dot, as a key), and as a computed key
 * written with a literal (`x['constructor']`, `x[ "__proto__" ]`, backticks too).
 */
const ESCAPES = ['constructor', 'Reflect', 'getPrototypeOf', '__proto__'];
const ESCAPE_RE = new RegExp(`\\b(${ESCAPES.join('|')})\\b`, 'g');
const COMPUTED_RE = new RegExp(`\\[\\s*(['"\`])(${ESCAPES.join('|')})\\1\\s*\\]`, 'g');

/**
 * The script with the text of every string literal, every template literal and every comment
 * replaced by spaces (newlines kept), so a word check reads code only and nothing shifts. A
 * `${ … }` inside a template literal stays code, nested braces and templates included. Regex
 * literals are not recognized: their text reads as code, so a `/fetch/` literal is refused (rare),
 * and a quote inside one throws the blanking off. A check built on this closes the obvious doors
 * and is porous by nature (a key assembled from pieces, a string handed to `setTimeout`).
 */
export function blankLiterals(src: string): string {
  const out = src.split('');
  const blank = (i: number) => {
    if (i < out.length && out[i] !== '\n') out[i] = ' ';
  };
  // One entry per open `${`: the depth of the braces opened inside it since.
  const exprs: number[] = [];
  let inTemplate = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (inTemplate) {
      if (c === '\\') {
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '`') {
        inTemplate = false;
        i++;
      } else if (c === '$' && src[i + 1] === '{') {
        exprs.push(0);
        inTemplate = false;
        i += 2;
      } else {
        blank(i);
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      while (i < stop) blank(i++);
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') blank(i++);
        blank(i++);
      }
      i++;
      continue;
    }
    const depth = exprs.length - 1;
    if (c === '`') {
      inTemplate = true;
    } else if (depth >= 0 && c === '{') {
      exprs[depth] += 1;
    } else if (depth >= 0 && c === '}') {
      if (exprs[depth] === 0) {
        exprs.pop();
        inTemplate = true;
      } else {
        exprs[depth] -= 1;
      }
    }
    i++;
  }
  return out.join('');
}

/** The refused words a script uses as code, each once, in order of appearance. */
export function forbiddenWords(script: string): string[] {
  const code = blankLiterals(script);
  const hits: Array<[number, string]> = [];
  for (const m of code.matchAll(FORBIDDEN_RE)) hits.push([m.index, m[1]!]);
  for (const m of code.matchAll(ESCAPE_RE)) hits.push([m.index, m[1]!]);
  for (const m of script.matchAll(COMPUTED_RE)) hits.push([m.index, m[2]!]);
  hits.sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  for (const [, word] of hits) if (!out.includes(word)) out.push(word);
  return out;
}

export interface ScriptToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
  /** FOUNDRY_URL: with the live world's id, the key receipts are kept under (src/receipts.ts). */
  serverUrl?: string;
  /** Where receipts are kept (default: the OS temp dir). */
  receiptsDir?: string;
}

export class ScriptTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private serverUrl: string;
  private receiptsDir: string;

  constructor({ foundry, logger, serverUrl, receiptsDir: dir }: ScriptToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ScriptTools' });
    this.serverUrl = serverUrl ?? '';
    this.receiptsDir = dir ?? receiptsDir();
  }

  getToolDefinitions() {
    return [
      {
        name: 'run-script',
        description:
          'Run a short JavaScript program in the GM page against `fvtt.*`, the page functions behind ' +
          'every tool (the run-script skill lists them): loops and bulk jobs in one round trip, only ' +
          'the return value comes back. Writes are counted, capped and recorded; `dryRun` stubs ' +
          'them, `undo` reverses a receipt. It runs with the bridge user’s rights.',
        inputSchema: toInputSchema(RunScriptSchema),
      },
    ];
  }

  async handleRunScript(args: any): Promise<string> {
    const a = RunScriptSchema.parse(args ?? {});
    if (a.undo) return this.undo(a.undo);
    const script = a.script!;
    const bad = forbiddenWords(script);
    if (bad.length) {
      throw new Error(
        `run-script refused: the script uses ${bad.map(w => `\`${w}\``).join(', ')} as code — ` +
          'write it against `fvtt.*`, the intended surface (words in strings and comments are ' +
          'fine). The check and the shadowed globals guard against accidents; they are not a ' +
          'security boundary: a script runs with the rights of the user the bridge joined as.'
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
      // The receipt (its id, what changed, the undo) is the line the server appends to every write.
      lines.push(
        `${r.ok ? '✅ Done' : '❌ Failed'} — ${r.receipt.calls} call(s), ${r.receipt.writes} write(s).`
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

  /**
   * Reverse receipt `id` of the live world, newest write first. The undo's own writes are its call's
   * receipt, which names the one it reverses, so an undo can be undone (a redo), once like any. The
   * receipt is marked undone only when every write was reversed: one the page could not reverse
   * leaves it undoable, and undoing it again leaves alone what is already back.
   */
  private async undo(id: string): Promise<string> {
    const key = receiptWorldKey(this.serverUrl, await this.foundry.worldId());
    let receipt: StoredReceipt;
    try {
      receipt = loadReceipt(id, key, this.receiptsDir);
    } catch (err) {
      throw new FormattedToolError(`run-script: ${(err as Error).message}.`);
    }
    if (receipt.undoneBy) {
      throw new FormattedToolError(
        `run-script: receipt ${id} was already undone by ${receipt.undoneBy}; undo ` +
          `${receipt.undoneBy} to put it back.`
      );
    }
    const ctx = callContext.getStore();
    // partial until the page answers that every write was reversed (src/registry.ts keepReceipt)
    if (ctx) {
      ctx.reverses = id;
      ctx.reversesPartial = true;
    }
    this.logger.info('run-script undo', { id, ops: receipt.ops.length });
    const r = await this.foundry.call('undoOps', { ops: receipt.ops });
    if (ctx && r.failed.length === 0) delete ctx.reversesPartial;
    const failed = r.failed.length
      ? `\n${r.failed.length} could not be reversed; receipt ${id} stays undoable:\n${r.failed.map(f => `  • ${f.op} ${f.uuid}: ${f.error}`).join('\n')}`
      : '';
    return `↩️ Receipt ${id}: ${r.undone} write(s) reversed.${failed}`;
  }
}
