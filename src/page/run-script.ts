// Page-side: run-script (issue #4). A short program the model wrote runs HERE, in the GM's page,
// against the page functions behind every tool (window.__fvtt, offered to the script as `fvtt`),
// so a loop of a dozen steps is one round trip and the intermediate data never enters the
// conversation. What makes it bearable to hand a script GM rights:
//   - the globals are shadowed (`game`, `canvas`, `window`, `document`, every document class,
//     `fromUuid`, `fetch`, …): the facade is the whole surface (`eval` cannot be a strict-mode
//     parameter name; the Node side refuses the word before the script travels);
//   - writes are counted and capped (writes, deletes, seconds);
//   - every document the run creates, updates or deletes is recorded through Foundry's own hooks
//     into a receipt, with the pre-image of what it changed or deleted;
//   - a dry run stubs the writes (each returns `{ dryRun: true }`) and lists them;
//   - `undoScript` reverses a receipt as one unit, newest write first.
// Receipts live in this page (`globalThis.__fvttReceipts`, the last 50): a reload loses them, and
// the result says so. Pre-images in the world (a hidden journal) are the next step, not this one.

import { invalid, notFound } from './errors.js';

/** Page-API names that write, by verb; anything else is a read and passes through on a dry run. */
const WRITE_VERBS =
  /^(create|update|delete|add|remove|set|place|apply|import|configure|activate|pull|post|roll|move|bulk|level|manage|duplicate|upload|relink|request|author)/;
const DELETE_VERBS = /^(delete|remove|bulkDelete)/;
/** `manage*` ops carry an `action`; these actions read. */
const READ_ACTIONS = new Set(['list', 'get', 'info', 'read', 'find', 'search']);

export function isWriteCall(name: string, args: unknown): boolean {
  if (!WRITE_VERBS.test(name)) return false;
  if (name.startsWith('manage')) {
    const action = (args as { action?: unknown } | null)?.action;
    if (typeof action === 'string' && READ_ACTIONS.has(action)) return false;
  }
  return true;
}

export function isDeleteCall(name: string, args: unknown): boolean {
  if (DELETE_VERBS.test(name)) return true;
  if (name.startsWith('manage')) {
    const action = (args as { action?: unknown } | null)?.action;
    return typeof action === 'string' && /^(delete|remove)/.test(action);
  }
  return false;
}

/**
 * The globals a script cannot see: shadowed as parameters of the compiled function, so the only
 * door to the world is `fvtt`. Document classes come from CONFIG at run time (`documentNames`).
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

/** Every document class name CONFIG declares (Actor, Item, Token, ActiveEffect, …). */
function documentNames(): string[] {
  const cfg = (globalThis as any).CONFIG ?? {};
  return Object.keys(cfg).filter(k => typeof cfg[k]?.documentClass === 'function');
}

export interface ReceiptOp {
  kind: 'create' | 'update' | 'delete';
  documentName: string;
  uuid: string;
  /** update: the pre-image of the keys that changed; delete: the whole document. */
  pre?: Record<string, unknown>;
  /** delete: the parent's uuid for an embedded document, so it can be re-created in place. */
  parentUuid?: string | null;
}

export interface Receipt {
  id: string;
  at: string;
  ops: ReceiptOp[];
  calls: number;
  writes: number;
  deletes: number;
}

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
  receipt: {
    id: string;
    created: number;
    updated: number;
    deleted: number;
    calls: number;
    writes: number;
  };
  dryRun?: Array<{ fn: string; args: unknown }>;
}

const RECEIPTS_KEPT = 50;

function receipts(): Map<string, Receipt> {
  const g = globalThis as any;
  g.__fvttReceipts ??= new Map<string, Receipt>();
  return g.__fvttReceipts as Map<string, Receipt>;
}

function newReceiptId(): string {
  const r =
    (globalThis as any).foundry?.utils?.randomID?.(6) ?? Math.random().toString(36).slice(2, 8);
  return `rcpt_${r}`;
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
 * Record this user's own document writes through Foundry's hooks for the run's duration.
 * Returns the stop function. Pre-images: an update keeps the prior values of the keys it changes
 * (`filterObject` over the changes' shape — a key the update ADDS has no prior value and is not
 * restored); a delete keeps the whole document and its parent.
 */
function record(receipt: Receipt): () => void {
  const g = globalThis as any;
  const me = g.game?.user?.id;
  const ids: Array<[string, number]> = [];
  for (const name of documentNames()) {
    ids.push([
      `create${name}`,
      g.Hooks.on(`create${name}`, (doc: any, _o: unknown, userId: string) => {
        if (userId !== me) return;
        receipt.ops.push({ kind: 'create', documentName: name, uuid: doc.uuid });
      }),
    ]);
    ids.push([
      `preUpdate${name}`,
      g.Hooks.on(`preUpdate${name}`, (doc: any, changes: unknown, _o: unknown, userId: string) => {
        if (userId !== me) return;
        let pre: Record<string, unknown> = {};
        try {
          pre = g.foundry.utils.filterObject(doc.toObject(), changes);
        } catch {
          // an unusual change shape: recorded without a pre-image
        }
        receipt.ops.push({ kind: 'update', documentName: name, uuid: doc.uuid, pre });
      }),
    ]);
    ids.push([
      `preDelete${name}`,
      g.Hooks.on(`preDelete${name}`, (doc: any, _o: unknown, userId: string) => {
        if (userId !== me) return;
        receipt.ops.push({
          kind: 'delete',
          documentName: name,
          uuid: doc.uuid,
          pre: doc.toObject(),
          parentUuid: doc.parent?.uuid ?? null,
        });
      }),
    ]);
  }
  return () => {
    for (const [hook, id] of ids) g.Hooks.off(hook, id);
  };
}

/** The script's view of the world: the page API, counted, capped and (on a dry run) stubbed. */
function facade(
  receipt: Receipt,
  opts: { dryRun: boolean; maxWrites: number; maxDeletes: number },
  dry: Array<{ fn: string; args: unknown }>
): Record<string, (args?: unknown) => Promise<unknown>> {
  const api = (globalThis as any).window.__fvtt as Record<string, (a?: unknown) => unknown>;
  const out: Record<string, (args?: unknown) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(api)) {
    if (name === 'runScript' || name === 'undoScript' || typeof fn !== 'function') continue;
    out[name] = async (args?: unknown) => {
      receipt.calls++;
      if (isWriteCall(name, args)) {
        if (opts.dryRun) {
          dry.push({ fn: name, args: summarize(args) });
          return { dryRun: true };
        }
        if (isDeleteCall(name, args)) {
          receipt.deletes++;
          if (receipt.deletes > opts.maxDeletes) {
            throw invalid(`the run's delete cap (${opts.maxDeletes}) was reached at fvtt.${name}`);
          }
        }
        receipt.writes++;
        if (receipt.writes > opts.maxWrites) {
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

  const receipt: Receipt = {
    id: newReceiptId(),
    at: new Date().toISOString(),
    ops: [],
    calls: 0,
    writes: 0,
    deletes: 0,
  };
  const log: string[] = [];
  const dry: Array<{ fn: string; args: unknown }> = [];
  const logFn = (...parts: unknown[]) => {
    log.push(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    if (log.length > 500) log.splice(0, log.length - 500);
  };

  // Compile with every reachable global shadowed; `"use strict"` makes a stray assignment throw.
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

  const fvtt = facade(receipt, { dryRun, maxWrites, maxDeletes }, dry);
  const stop = dryRun ? () => {} : record(receipt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMEOUT = Symbol('timeout');
  let ok = true;
  let error: string | undefined;
  let result: unknown;
  try {
    const outcome = await Promise.race([
      body(fvtt, logFn, ...shadow.map(() => undefined)),
      new Promise<typeof TIMEOUT>(r => {
        timer = setTimeout(() => r(TIMEOUT), timeoutMs);
      }),
    ]);
    if (outcome === TIMEOUT) {
      ok = false;
      error = `the run exceeded ${Math.round(timeoutMs / 1000)} s and was abandoned; a write still in flight is not in the receipt`;
    } else {
      result = serializable(outcome);
    }
  } catch (err) {
    ok = false;
    const e = err as Error;
    error = `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
  } finally {
    if (timer) clearTimeout(timer);
    stop();
  }

  if (!dryRun) {
    const all = receipts();
    all.set(receipt.id, receipt);
    while (all.size > RECEIPTS_KEPT) all.delete(all.keys().next().value as string);
  }

  const count = (kind: ReceiptOp['kind']) => receipt.ops.filter(o => o.kind === kind).length;
  const out: RunScriptResult = {
    ok,
    log,
    timedOut: error?.startsWith('the run exceeded') ?? false,
    receipt: {
      id: dryRun ? '' : receipt.id,
      created: count('create'),
      updated: count('update'),
      deleted: count('delete'),
      calls: receipt.calls,
      writes: receipt.writes,
    },
  };
  if (ok) out.result = result;
  else out.error = error ?? 'unknown error';
  if (dryRun) out.dryRun = dry;
  return out;
}

export interface UndoScriptResult {
  id: string;
  undone: number;
  failed: Array<{ op: string; uuid: string; error: string }>;
}

/** Reverse a receipt, newest op first: delete what it created, restore what it changed or deleted. */
export async function undoScript(args: { id: string }): Promise<UndoScriptResult> {
  const id = String(args?.id ?? '');
  const receipt = receipts().get(id);
  if (!receipt) {
    throw notFound(
      `receipt "${id}" is not in this page (the last ${RECEIPTS_KEPT} runs are kept; a reload of the bridge loses them)`
    );
  }
  const g = globalThis as any;
  // A document the run created and then deleted nets to nothing: reversing both would re-create
  // it and then delete the re-creation (the 2026-10-11 live verify lost the restored actor that
  // way). Every op on such a uuid is dropped before the walk.
  const created = new Set(receipt.ops.filter(o => o.kind === 'create').map(o => o.uuid));
  const netted = new Set(
    receipt.ops.filter(o => o.kind === 'delete' && created.has(o.uuid)).map(o => o.uuid)
  );
  const ops = receipt.ops.filter(o => !netted.has(o.uuid));
  let undone = 0;
  const failed: UndoScriptResult['failed'] = [];
  for (const op of [...ops].reverse()) {
    try {
      if (op.kind === 'create') {
        const doc = await g.fromUuid(op.uuid);
        if (doc) await doc.delete();
      } else if (op.kind === 'update') {
        const doc = await g.fromUuid(op.uuid);
        if (doc && op.pre && Object.keys(op.pre).length) await doc.update(op.pre);
      } else {
        const exists = await g.fromUuid(op.uuid).catch(() => null);
        if (!exists && op.pre) {
          if (op.parentUuid) {
            const parent = await g.fromUuid(op.parentUuid);
            if (!parent) throw new Error(`parent ${op.parentUuid} is gone`);
            await parent.createEmbeddedDocuments(op.documentName, [op.pre], { keepId: true });
          } else {
            await g.CONFIG[op.documentName].documentClass.create(op.pre, { keepId: true });
          }
        }
      }
      undone++;
    } catch (err) {
      failed.push({
        op: `${op.kind} ${op.documentName}`,
        uuid: op.uuid,
        error: (err as Error).message,
      });
    }
  }
  receipts().delete(id);
  return { id, undone, failed };
}
