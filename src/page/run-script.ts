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
//   - a run that has ended (returned, thrown, or abandoned at its timeout) can make no more calls:
//     every facade call after it is refused (issue #16's review). A call it still had in flight is
//     waited on, ABANDON_GRACE_MS at most, with the recorder on and the lock held, so what it writes
//     is this run's receipt and nobody else's (issue #6's review). A call still running after the
//     grace is let go, and what it writes is not in this receipt: a create it began in time lands
//     in no receipt (it carries this run's recorder token, ./_receipts.ts), but a write it begins
//     later can land in the next write's receipt, since a hook cannot tell which call made it.
// The page keeps no receipts: the run's writes ride back as `ops`, the bridge files them as the
// tool call's receipt (src/receipts.ts), and `undoOps` reverses one.

import { opKind, UNRECORDED_OPS } from './_ops.js';
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
    /**
     * The write ops the run called whose change no receipt records (./_ops.ts UNRECORDED_OPS: a
     * file in Data/, the players' views), each once; absent when none ran.
     */
    unrecorded?: string[];
  };
  dryRun?: Array<{ fn: string; args: unknown }>;
  /** The run's writes, in order; the bridge lifts them out into the call's receipt. */
  ops?: ReceiptOp[];
}

interface Counts {
  calls: number;
  writes: number;
  deletes: number;
  /** The UNRECORDED_OPS a call of the run completed. */
  unrecorded: Set<string>;
}

/**
 * How long a run that ended with facade calls still in flight (abandoned at its timeout, or a call
 * it did not await) waits for them, its recorder on and the write lock held, before both go: what
 * they write meanwhile is the run's receipt (issue #6's review). Well within run-script's op cap
 * (its timeout + 30 s, src/foundry.ts).
 */
const ABANDON_GRACE_MS = 15_000;

/** What the facade asks of its run: may a call still start, and where a call in flight is kept. */
interface RunState {
  /** Why no call may start any more (the run has ended), or undefined while it runs. */
  refusal(): string | undefined;
  /** The facade calls in flight; each leaves the set when it settles. */
  pending: Set<Promise<unknown>>;
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
 * call does is the op's own tag (./_ops.ts), never a guess from its name. Once the run has ended
 * (abandoned at its timeout included), every call is refused; a call in flight is tracked until it
 * settles.
 */
function facade(
  counts: Counts,
  opts: { dryRun: boolean; maxWrites: number; maxDeletes: number },
  dry: Array<{ fn: string; args: unknown }>,
  run: RunState
): Record<string, (args?: unknown) => Promise<unknown>> {
  const api = (globalThis as any).window.__fvtt as Record<string, (a?: unknown) => unknown>;
  const out: Record<string, (args?: unknown) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(api)) {
    if (name === 'runScript' || name === 'undoOps' || typeof fn !== 'function') continue;
    out[name] = async (args?: unknown) => {
      const refused = run.refusal();
      if (refused) throw invalid(refused);
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
      const call = Promise.resolve(fn(args));
      run.pending.add(call);
      const settled = () => {
        run.pending.delete(call);
      };
      // a completed file-plane or view op changed what the receipt cannot hold
      const done = () => {
        if (UNRECORDED_OPS.has(name)) counts.unrecorded.add(name);
        settled();
      };
      void call.then(done, settled);
      return call;
    };
  }
  return Object.freeze(out);
}

/** Wait until every call in `pending` has settled, `ms` at most; answer how many still run. */
async function settle(pending: Set<Promise<unknown>>, ms: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
  return pending.size;
}

/** A run abandoned at its timeout, in words: what became of the calls it had in flight. */
function abandonedError(timeoutMs: number, inFlight: number, unsettled: number): string {
  const head = `the run exceeded ${Math.round(timeoutMs / 1000)} s and was abandoned: the script can make no more calls`;
  if (!inFlight) return head;
  const grace = `the ${ABANDON_GRACE_MS / 1000} s grace`;
  if (!unsettled) {
    return `${head}, and the ${inFlight} call(s) it had in flight settled within ${grace}: their writes are in the receipt`;
  }
  return (
    `${head}; of the ${inFlight} call(s) it had in flight, ${inFlight - unsettled} settled within ${grace} ` +
    `(their writes are in the receipt) and ${unsettled} did not: their outcome is unknown, and what they write is not in this receipt`
  );
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
    const counts: Counts = { calls: 0, writes: 0, deletes: 0, unrecorded: new Set() };
    const log: string[] = [];
    const dry: Array<{ fn: string; args: unknown }> = [];
    const logFn = (...parts: unknown[]) => {
      log.push(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
      if (log.length > 500) log.splice(0, log.length - 500);
    };
    // running, then abandoned (at the timeout) or ended (the body settled): no call starts after
    let state: 'running' | 'abandoned' | 'ended' = 'running';
    const pending = new Set<Promise<unknown>>();
    const fvtt = facade(counts, { dryRun, maxWrites, maxDeletes }, dry, {
      pending,
      refusal: () =>
        state === 'abandoned'
          ? 'the run was abandoned at its timeout'
          : state === 'ended'
            ? 'the run has ended'
            : undefined,
    });
    const recorder = dryRun ? null : record();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMEOUT = Symbol('timeout');
    let ok = true;
    let timedOut = false;
    let error: string | undefined;
    let result: unknown;
    let ops: ReceiptOp[] = [];
    let inFlight = 0;
    let unsettled = 0;
    try {
      const outcome = await Promise.race([
        body(fvtt, logFn, ...shadow.map(() => undefined)),
        new Promise<typeof TIMEOUT>(r => {
          timer = setTimeout(() => {
            state = 'abandoned';
            r(TIMEOUT);
          }, timeoutMs);
        }),
      ]);
      if (outcome === TIMEOUT) {
        ok = false;
        timedOut = true;
      } else {
        result = serializable(outcome);
      }
    } catch (err) {
      ok = false;
      const e = err as Error;
      error = `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
    } finally {
      if (timer) clearTimeout(timer);
      if (state === 'running') state = 'ended';
      // A call still in flight writes into this run's receipt: the recorder stays on and the lock
      // held until it settles, ABANDON_GRACE_MS at most. A dry run records nothing, holds no lock.
      if (recorder && pending.size) {
        inFlight = pending.size;
        unsettled = await settle(pending, ABANDON_GRACE_MS);
      }
      ops = recorder?.stop() ?? [];
    }
    if (timedOut) error = abandonedError(timeoutMs, inFlight, unsettled);
    else if (unsettled) {
      log.push(
        `${unsettled} call(s) the script did not await were still in flight ${ABANDON_GRACE_MS / 1000} s after it ended: ` +
          'their outcome is unknown, and what they write is not in this receipt'
      );
    }

    const count = (kind: ReceiptOp['kind']) => ops.filter(o => o.kind === kind).length;
    const out: RunScriptResult = {
      ok,
      log,
      timedOut,
      receipt: {
        created: count('create'),
        updated: count('update'),
        deleted: count('delete'),
        calls: counts.calls,
        writes: counts.writes,
        ...(counts.unrecorded.size ? { unrecorded: [...counts.unrecorded] } : {}),
      },
    };
    if (ok) out.result = result;
    else out.error = error ?? 'unknown error';
    if (dryRun) out.dryRun = dry;
    else out.ops = ops;
    return out;
  };
  // A real run holds the write lock until the race settles (its timeout included) and the calls it
  // had in flight have settled (ABANDON_GRACE_MS at most): nothing else writes while it runs, so its
  // recorder sees only its own writes. A dry run writes nothing.
  return dryRun ? run() : withWriteLock(run);
}
