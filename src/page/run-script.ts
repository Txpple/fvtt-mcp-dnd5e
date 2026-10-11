// Page-side: run-script (issue #4). A short program the model wrote runs HERE, in the GM's page,
// against the page functions behind every tool (window.__fvtt, offered to the script as `fvtt`),
// so a loop of a dozen steps is one round trip and the intermediate data never enters the
// conversation. The facade is the intended surface. A script runs with the rights of the user the
// bridge joined as, and that role is the boundary (issue #15): what is below guards against
// accidents and makes a run reviewable and reversible, it does not contain a script.
//   - the globals a script would reach for by habit are shadowed (`game`, `canvas`, `window`,
//     `document`, every document class, `fromUuid`, `fetch`, …) and read `undefined`, so a habit
//     fails instead of stepping around the facade. Not a wall: any function's constructor still
//     compiles code in the real global scope. The Node side (src/tools/script.ts) refuses that
//     spelling and the obvious others before the script travels (`eval` cannot be a strict-mode
//     parameter name, so it is refused there too);
//   - writes are counted and capped (writes, deletes, seconds), by each op's tag (./_ops.ts);
//   - every document the run creates, updates or deletes is recorded by the recorder every write
//     tool shares (./_receipts.ts), with the pre-image an undo needs; the run holds the page's
//     write lock while it runs, so no other call's writes land in its receipt;
//   - a dry run stubs the writes (each returns `{ dryRun: true }`) and lists them;
//   - a run abandoned at its timeout cannot write any more: every facade call after it is refused
//     (issue #16's review), since its recorder is off by then.
// The page keeps no receipts: the run's writes ride back as `ops`, the bridge files them as the
// tool call's receipt (src/receipts.ts), and `undoOps` reverses one.

import { opKind } from './_ops.js';
import { documentNames, type ReceiptOp, record, withWriteLock } from './_receipts.js';
import { invalid } from './errors.js';

/**
 * The globals a script does not see by name: shadowed as parameters of the compiled function, so
 * `game.actors` in a script is a TypeError instead of a write past the facade's caps and receipt.
 * An accident guard, not a wall (see the header). Document classes come from CONFIG at run time
 * (`documentNames`).
 */
export const SHADOWED = [
  'game',
  'canvas',
  'window',
  'document',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Function',
  'Hooks',
  'CONFIG',
  'CONST',
  'foundry',
  'ui',
  'socket',
  'io',
  'fromUuid',
  'fromUuidSync',
  'Roll',
  'Dialog',
  'FilePicker',
  'ImagePopout',
  'PIXI',
  '$',
  'jQuery',
  'Handlebars',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'location',
  'history',
  'importScripts',
  'dnd5e',
];

export interface RunScriptArgs {
  src: string;
  dryRun?: boolean;
  maxWrites?: number;
  maxDeletes?: number;
  timeoutMs?: number;
}

export interface RunScriptResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  log: string[];
  timedOut: boolean;
  /** What the run did, counted: documents by kind, and the facade calls and writes it made. */
  receipt: {
    created: number;
    updated: number;
    deleted: number;
    calls: number;
    writes: number;
  };
  dryRun?: Array<{ fn: string; args: unknown }>;
  /** The run's writes, in order; the bridge lifts them out into the call's receipt. */
  ops?: ReceiptOp[];
}

interface Counts {
  calls: number;
  writes: number;
  deletes: number;
}

/** Arguments as they will be shown in a dry run: JSON, cut at 400 chars. */
function summarize(args: unknown): unknown {
  try {
    const s = JSON.stringify(args);
    if (s === undefined) return null;
    return s.length > 400 ? `${s.slice(0, 400)}…` : JSON.parse(s);
  } catch {
    return '(unserializable)';
  }
}

/**
 * The script's view of the world: the page API, counted, capped and (on a dry run) stubbed. What a
 * call does is the op's own tag (./_ops.ts), never a guess from its name. Once the run is abandoned
 * at its timeout, every call is refused.
 */
function facade(
  counts: Counts,
  opts: { dryRun: boolean; maxWrites: number; maxDeletes: number },
  dry: Array<{ fn: string; args: unknown }>,
  abandoned: () => boolean
): Record<string, (args?: unknown) => Promise<unknown>> {
  const api = (globalThis as any).window.__fvtt as Record<string, (a?: unknown) => unknown>;
  const out: Record<string, (args?: unknown) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(api)) {
    if (name === 'runScript' || name === 'undoOps' || typeof fn !== 'function') continue;
    out[name] = async (args?: unknown) => {
      if (abandoned()) throw invalid('the run was abandoned at its timeout');
      counts.calls++;
      const kind = opKind(name, args);
      if (kind !== 'read') {
        if (opts.dryRun) {
          dry.push({ fn: name, args: summarize(args) });
          return { dryRun: true };
        }
        if (kind === 'delete') {
          counts.deletes++;
          if (counts.deletes > opts.maxDeletes) {
            throw invalid(`the run's delete cap (${opts.maxDeletes}) was reached at fvtt.${name}`);
          }
        }
        counts.writes++;
        if (counts.writes > opts.maxWrites) {
          throw invalid(`the run's write cap (${opts.maxWrites}) was reached at fvtt.${name}`);
        }
      }
      return fn(args);
    };
  }
  return Object.freeze(out);
}

/** A JSON round trip with a size cap: the result travels to Node as data, never as live objects. */
function serializable(value: unknown): unknown {
  if (value === undefined) return null;
  const s = JSON.stringify(value);
  if (s === undefined) return null;
  if (s.length > 200_000) return { truncated: true, chars: s.length, head: s.slice(0, 2_000) };
  return JSON.parse(s);
}

export async function runScript(args: RunScriptArgs): Promise<RunScriptResult> {
  const src = String(args?.src ?? '');
  if (!src.trim()) throw invalid('run-script: the script is empty');
  const dryRun = !!args.dryRun;
  const maxWrites = Math.max(1, Math.floor(args.maxWrites ?? 150));
  const maxDeletes = Math.max(0, Math.floor(args.maxDeletes ?? 30));
  const timeoutMs = Math.max(1_000, Math.floor(args.timeoutMs ?? 60_000));

  // Compile with the habitual globals shadowed; `"use strict"` makes a stray assignment throw.
  const shadow = [...new Set([...SHADOWED, ...documentNames()])];
  let body: (...a: unknown[]) => Promise<unknown>;
  try {
    body = new Function(
      'fvtt',
      'log',
      ...shadow,
      `"use strict"; return (async () => {\n${src}\n})();`
    ) as (...a: unknown[]) => Promise<unknown>;
  } catch (err) {
    throw invalid(`run-script: the script does not parse — ${(err as Error).message}`);
  }

  const run = async (): Promise<RunScriptResult> => {
    const counts: Counts = { calls: 0, writes: 0, deletes: 0 };
    const log: string[] = [];
    const dry: Array<{ fn: string; args: unknown }> = [];
    const logFn = (...parts: unknown[]) => {
      log.push(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
      if (log.length > 500) log.splice(0, log.length - 500);
    };
    let abandoned = false;
    const fvtt = facade(counts, { dryRun, maxWrites, maxDeletes }, dry, () => abandoned);
    const recorder = dryRun ? null : record();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMEOUT = Symbol('timeout');
    let ok = true;
    let error: string | undefined;
    let result: unknown;
    let ops: ReceiptOp[] = [];
    try {
      const outcome = await Promise.race([
        body(fvtt, logFn, ...shadow.map(() => undefined)),
        new Promise<typeof TIMEOUT>(r => {
          timer = setTimeout(() => {
            abandoned = true;
            r(TIMEOUT);
          }, timeoutMs);
        }),
      ]);
      if (outcome === TIMEOUT) {
        ok = false;
        error = `the run exceeded ${Math.round(timeoutMs / 1000)} s and was abandoned; a write still in flight is not in the receipt, and the script can make no more`;
      } else {
        result = serializable(outcome);
      }
    } catch (err) {
      ok = false;
      const e = err as Error;
      error = `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
    } finally {
      if (timer) clearTimeout(timer);
      ops = recorder?.stop() ?? [];
    }

    const count = (kind: ReceiptOp['kind']) => ops.filter(o => o.kind === kind).length;
    const out: RunScriptResult = {
      ok,
      log,
      timedOut: error?.startsWith('the run exceeded') ?? false,
      receipt: {
        created: count('create'),
        updated: count('update'),
        deleted: count('delete'),
        calls: counts.calls,
        writes: counts.writes,
      },
    };
    if (ok) out.result = result;
    else out.error = error ?? 'unknown error';
    if (dryRun) out.dryRun = dry;
    else out.ops = ops;
    return out;
  };
  // A real run holds the write lock until the race settles (its timeout included): nothing else
  // writes while it runs, so its recorder sees only its own writes. A dry run writes nothing.
  return dryRun ? run() : withWriteLock(run);
}
