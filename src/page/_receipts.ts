// Page-side: the receipt every write leaves (issue #6). Runs INSIDE the headless Foundry page; the
// Foundry globals are read at call time, never at module level, so the pure parts (the op shape,
// `effectiveOps`, `updatePreImage`) are imported by the Node side too (src/receipts.ts).
//
// One choke point: the bridge reaches every page op through `callOp` (window.__fvttCall). A read
// runs as it is. A write, when the Node side asks for a receipt, runs under the page's WRITE LOCK
// (a promise chain: one write at a time) with Foundry's own document hooks recording what it does:
// every document this user creates, updates or deletes, with the pre-image an undo needs. The lock
// is what keeps a receipt honest: two tool calls in flight never record each other's writes.
// run-script and `undoOps` take the lock and record for themselves (a script is many ops; an undo
// is a receipt of its own, so it can be reversed too). The page keeps nothing: the ops ride back
// with the result, and the Node side groups them per tool call and keeps them in a file.
//
// An update's pre-image is per changed path: the prior value of each path the change writes,
// cloned; a path the change adds is listed in `absent`, which undo removes; a path whose value does
// not change is left out, and an update that changes nothing is no op at all. A delete keeps the
// whole document. A pre-image over MAX_PRE_IMAGE_CHARS, or past MAX_RECEIPT_CHARS in one receipt,
// is not kept: the op is marked `tooLarge` and undo reports it as not undoable.

import { opKind } from './_ops.js';

/** One document write, as a receipt records it. */
export interface ReceiptOp {
  kind: 'create' | 'update' | 'delete';
  /** The document class: `Actor`, `JournalEntryPage`, `AmbientLight`, … */
  documentName: string;
  uuid: string;
  /** The document's name (a setting's key) when the write was recorded; '' when it has none. */
  label: string;
  /** update: the prior value of each changed path that had one; delete: the whole document. */
  pre?: Record<string, unknown>;
  /** update: the changed paths that had no prior value (undo removes them). */
  absent?: string[];
  /** delete: the parent's uuid for an embedded document, so it is re-created in place. */
  parentUuid?: string | null;
  /** The pre-image was over the cap and not kept: this write cannot be undone. */
  tooLarge?: true;
}

/** What the bridge's one entry point answers: the op's result and, when asked, the writes it made. */
export interface CallOutcome {
  result?: unknown;
  ops?: ReceiptOp[];
  /** The op threw after it had written: its words, which the Node side throws (src/foundry.ts). */
  error?: { name: string; message: string; stack?: string };
}

/** A pre-image larger than this (JSON characters) is not kept; the op is `tooLarge`. */
export const MAX_PRE_IMAGE_CHARS = 2_000_000;
/** Once one receipt's pre-images reach this, every further pre-image in it is dropped the same way. */
export const MAX_RECEIPT_CHARS = 8_000_000;

/**
 * A write whose options carry this key is never recorded: the bridge's own bookkeeping (the seat
 * marker on its User document, src/foundry.ts) is not part of anybody's receipt.
 */
export const UNRECORDED = 'fvttMcpUnrecorded';

/** The ops that hold the lock and record for themselves (they lift `ops` into their result). */
const SELF_RECORDING: ReadonlySet<string> = new Set(['runScript', 'undoOps']);

let lockTail: Promise<void> = Promise.resolve();

/**
 * Run `fn` once every earlier holder of the page's write lock has released it, and release it when
 * `fn` settles. Reads never take it.
 */
export async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = lockTail;
  let release: () => void = () => {};
  lockTail = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/** Every document class name CONFIG declares (Actor, Item, Token, ActiveEffect, Setting, …). */
export function documentNames(): string[] {
  const cfg = (globalThis as any).CONFIG ?? {};
  return Object.keys(cfg).filter(k => typeof cfg[k]?.documentClass === 'function');
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Foundry's data operators (`foundry.data.operators`, v14): ForcedDeletion, ForcedReplacement. */
function operators(): any {
  return (globalThis as any).foundry?.data?.operators;
}

function operatorOf(value: unknown): 'delete' | 'replace' | undefined {
  const ops = operators();
  if (!ops || value === null || typeof value !== 'object') return undefined;
  if (typeof ops.ForcedDeletion === 'function' && value instanceof ops.ForcedDeletion) {
    return 'delete';
  }
  if (typeof ops.ForcedReplacement === 'function' && value instanceof ops.ForcedReplacement) {
    return 'replace';
  }
  return undefined;
}

function operatorValue(value: unknown): unknown {
  const base = operators()?.DataFieldOperator;
  return typeof base?.get === 'function' ? base.get(value) : value;
}

/** One path an update writes: `set` merges the value in, `replace` writes it whole, `delete` removes it. */
export interface ChangedPath {
  path: string;
  how: 'set' | 'replace' | 'delete';
  value: unknown;
}

/**
 * The paths a change object writes, leaf by leaf. A plain object is walked (its keys may be dotted);
 * an array, a non-plain value and an empty object are leaves. A deletion (`{ key: ForcedDeletion }`,
 * or the legacy `-=key`) and a replacement (`ForcedReplacement`, or `==key`) end the walk at their
 * key. `whole`: an update with `recursive: false`, whose root keys are written whole.
 */
export function changedPaths(changes: unknown, whole = false): ChangedPath[] {
  const out: ChangedPath[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number): void => {
    for (const [key, value] of Object.entries(obj)) {
      const segments = key.split('.');
      const last = segments[segments.length - 1] ?? '';
      let how: ChangedPath['how'] = 'set';
      if (last.startsWith('-=') || last.startsWith('==')) {
        how = last.startsWith('-=') ? 'delete' : 'replace';
        segments[segments.length - 1] = last.slice(2);
      }
      const path = prefix ? `${prefix}.${segments.join('.')}` : segments.join('.');
      if (how === 'set') {
        const operator = operatorOf(value);
        if (operator === 'delete') {
          how = 'delete';
        } else if (operator === 'replace') {
          out.push({ path, how: 'replace', value: operatorValue(value) });
          continue;
        } else if (whole && depth === 0) {
          how = 'replace';
        } else if (isPlain(value) && Object.keys(value).length > 0 && depth < 64) {
          walk(value, path, depth + 1);
          continue;
        }
      }
      out.push({ path, how, value: how === 'delete' ? undefined : value });
    }
  };
  if (isPlain(changes)) walk(changes, '', 0);
  return out;
}

/** The value at a dotted path of plain data (own keys only), or undefined. */
function propertyAt(source: unknown, path: string): unknown {
  let target: unknown = source;
  for (const key of path.split('.')) {
    if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) {
      return undefined;
    }
    target = (target as Record<string, unknown>)[key];
  }
  return target;
}

/** Structural equality of plain data. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    k =>
      Object.hasOwn(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

function clone<T>(value: T): T {
  const deepClone = (globalThis as any).foundry?.utils?.deepClone;
  return typeof deepClone === 'function' ? deepClone(value) : structuredClone(value);
}

/**
 * An update's pre-image against the document's `source`: for each path the change writes, its prior
 * value (cloned), or the path in `absent` when it had none. A path whose value does not change is
 * left out, as are `_id` and `_stats`; null when nothing changes. Never `filterObject`: it aliases
 * array leaves into the live source and reads a deletion key as a key.
 */
export function updatePreImage(
  source: unknown,
  changes: unknown,
  whole = false
): { pre: Record<string, unknown>; absent: string[] } | null {
  const pre: Record<string, unknown> = {};
  const absent: string[] = [];
  for (const { path, how, value } of changedPaths(changes, whole)) {
    if (path === '_id' || path === '_stats' || path.startsWith('_stats.')) continue;
    const prior = propertyAt(source, path);
    if (how === 'delete') {
      if (prior !== undefined) pre[path] = clone(prior);
      continue;
    }
    if (prior === undefined) {
      if (value !== undefined) absent.push(path);
      continue;
    }
    if (same(prior, value)) continue;
    // merging an empty object into an object writes nothing
    if (how === 'set' && isPlain(value) && isPlain(prior) && Object.keys(value).length === 0) {
      continue;
    }
    pre[path] = clone(prior);
  }
  return Object.keys(pre).length > 0 || absent.length > 0 ? { pre, absent } : null;
}

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function labelOf(doc: any): string {
  for (const value of [doc?.name, doc?.key]) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

export interface Recorder {
  /** Take the hooks off and hand over the writes, in the order they happened. Idempotent. */
  stop(): ReceiptOp[];
}

/**
 * Record this user's own document writes through Foundry's hooks until `stop()`: `create<Doc>` for a
 * create, `preUpdate<Doc>` / `preDelete<Doc>` for the pre-image of an update or a delete, for every
 * document class in CONFIG. A hook here never throws and never vetoes a write.
 */
export function record(): Recorder {
  const g = globalThis as any;
  const me = g.game?.user?.id;
  const ops: ReceiptOp[] = [];
  let total = 0;
  const withPre = (op: ReceiptOp, pre: Record<string, unknown>): ReceiptOp => {
    const size = sizeOf(pre);
    if (size > MAX_PRE_IMAGE_CHARS || total + size > MAX_RECEIPT_CHARS) {
      delete op.absent;
      op.tooLarge = true;
    } else {
      total += size;
      op.pre = pre;
    }
    return op;
  };
  const mine = (options: any, userId: unknown): boolean => userId === me && !options?.[UNRECORDED];
  const ids: Array<[string, unknown]> = [];
  const on = (hook: string, fn: (...args: any[]) => void): void => {
    const id = g.Hooks.on(hook, (...args: any[]) => {
      try {
        fn(...args);
      } catch {
        // a receipt never breaks the write it records
      }
    });
    ids.push([hook, id]);
  };
  for (const name of documentNames()) {
    on(`create${name}`, (doc, options, userId) => {
      if (!mine(options, userId)) return;
      ops.push({ kind: 'create', documentName: name, uuid: doc.uuid, label: labelOf(doc) });
    });
    on(`preUpdate${name}`, (doc, changes, options, userId) => {
      if (!mine(options, userId)) return;
      const op: ReceiptOp = {
        kind: 'update',
        documentName: name,
        uuid: doc.uuid,
        label: labelOf(doc),
      };
      let image: ReturnType<typeof updatePreImage>;
      try {
        image = updatePreImage(
          doc._source ?? doc.toObject?.(),
          changes,
          options?.recursive === false
        );
      } catch {
        ops.push(op); // an unreadable change: recorded, without a pre-image to restore
        return;
      }
      if (!image) return;
      if (image.absent.length) op.absent = image.absent;
      ops.push(withPre(op, image.pre));
    });
    on(`preDelete${name}`, (doc, options, userId) => {
      if (!mine(options, userId)) return;
      const op: ReceiptOp = {
        kind: 'delete',
        documentName: name,
        uuid: doc.uuid,
        label: labelOf(doc),
        parentUuid: doc.parent?.uuid ?? null,
      };
      let pre: Record<string, unknown>;
      try {
        pre = doc.toObject(); // the document's source, already a deep copy
      } catch {
        ops.push(op);
        return;
      }
      ops.push(withPre(op, pre));
    });
  }
  let stopped = false;
  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        for (const [hook, id] of ids) g.Hooks.off(hook, id);
      }
      return ops;
    },
  };
}

/**
 * The writes an undo reverses, in order: a document the receipt created and then deleted nets to
 * nothing; one it created keeps only its create (undoing that deletes it, whatever happened to it
 * since), and so does everything embedded in it; a document that existed before keeps every op.
 */
export function effectiveOps(ops: readonly ReceiptOp[]): ReceiptOp[] {
  const first = new Map<string, ReceiptOp>();
  const last = new Map<string, ReceiptOp>();
  for (const op of ops) {
    if (!first.has(op.uuid)) first.set(op.uuid, op);
    last.set(op.uuid, op);
  }
  const roots: string[] = [];
  for (const [uuid, head] of first) if (head.kind === 'create') roots.push(uuid);
  return ops.filter(op => {
    if (roots.some(root => op.uuid.startsWith(`${root}.`))) return false;
    const head = first.get(op.uuid);
    if (head?.kind !== 'create') return true;
    return last.get(op.uuid)?.kind !== 'delete' && op === head;
  });
}

function thrown(err: unknown): NonNullable<CallOutcome['error']> {
  const e = err as { name?: unknown; message?: unknown; stack?: unknown } | null;
  const out = {
    name: typeof e?.name === 'string' ? e.name : 'Error',
    message: typeof e?.message === 'string' ? e.message : String(err),
  };
  return typeof e?.stack === 'string' ? { ...out, stack: e.stack } : out;
}

/**
 * The bridge's one way into the page ops (window.__fvttCall; src/foundry.ts `invoke`). A read, or a
 * call that asks for no receipt (`record` false: a sibling harness), runs as it is. A write runs
 * under the write lock with the recorder on and answers `{ result, ops }`; a write that throws after
 * it has written answers `{ error, ops }`, so its receipt is not lost with it. run-script and
 * `undoOps` take the lock and record for themselves; their `ops` are lifted out of the result.
 */
export async function callOp(
  name: string,
  args: unknown,
  opts: { record?: boolean } = {}
): Promise<CallOutcome> {
  const api = (globalThis as any).window?.__fvtt as
    | Record<string, (a?: unknown) => unknown>
    | undefined;
  const fn = api?.[name];
  if (typeof fn !== 'function') throw new Error(`Unknown page function: ${name}`);
  if (SELF_RECORDING.has(name)) {
    const { ops, ...result } = ((await fn(args)) ?? {}) as { ops?: ReceiptOp[] };
    return ops?.length ? { result, ops } : { result };
  }
  if (!opts.record || opKind(name, args) === 'read') return { result: await fn(args) };
  return withWriteLock(async () => {
    const recorder = record();
    try {
      const result = await fn(args);
      const ops = recorder.stop();
      return ops.length ? { result, ops } : { result };
    } catch (err) {
      const ops = recorder.stop();
      if (!ops.length) throw err;
      return { error: thrown(err), ops };
    }
  });
}

/** `a.b.c` with a legacy operator prefix on its last key: `a.b.-=c`. */
function legacyKey(path: string, prefix: '-=' | '=='): string {
  const dot = path.lastIndexOf('.');
  return `${path.slice(0, dot + 1)}${prefix}${path.slice(dot + 1)}`;
}

/**
 * The update that puts an update's paths back: each prior value, an object one written whole (a
 * `ForcedReplacement`), and each added path removed (a `ForcedDeletion`); the legacy `==` / `-=`
 * keys where Foundry has no data operators.
 */
export function undoUpdateData(op: Pick<ReceiptOp, 'pre' | 'absent'>): Record<string, unknown> {
  const ops = operators();
  const data: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(op.pre ?? {})) {
    if (!isPlain(value)) data[path] = value;
    else if (typeof ops?.ForcedReplacement?.create === 'function') {
      data[path] = ops.ForcedReplacement.create(value);
    } else data[legacyKey(path, '==')] = value;
  }
  for (const path of op.absent ?? []) {
    if (typeof ops?.ForcedDeletion === 'function') data[path] = new ops.ForcedDeletion();
    else data[legacyKey(path, '-=')] = null;
  }
  return data;
}

async function lookup(uuid: string): Promise<any> {
  try {
    return (await (globalThis as any).fromUuid(uuid)) ?? null;
  } catch {
    return null;
  }
}

/** Reverse one write; throws why it could not be. */
async function undoOne(op: ReceiptOp): Promise<void> {
  if (op.tooLarge) throw new Error('not undoable: its pre-image was over the cap and not kept');
  if (op.kind === 'create') {
    const doc = await lookup(op.uuid);
    if (doc) await doc.delete();
    return;
  }
  if (op.kind === 'update') {
    if (!op.pre && !op.absent) throw new Error('not undoable: no pre-image was recorded');
    const doc = await lookup(op.uuid);
    if (!doc) throw new Error('the document no longer exists');
    await doc.update(undoUpdateData(op));
    return;
  }
  if (!op.pre) throw new Error('not undoable: no pre-image was recorded');
  if (await lookup(op.uuid)) return; // already back
  if (op.parentUuid) {
    const parent = await lookup(op.parentUuid);
    if (!parent) throw new Error(`its parent ${op.parentUuid} is gone`);
    await parent.createEmbeddedDocuments(op.documentName, [op.pre], { keepId: true });
    return;
  }
  const pack = /^Compendium\.([^.]+\.[^.]+)\./.exec(op.uuid)?.[1];
  const cls = (globalThis as any).CONFIG?.[op.documentName]?.documentClass;
  if (typeof cls?.create !== 'function') {
    throw new Error(`no ${op.documentName} class to re-create it with`);
  }
  await cls.create(op.pre, { keepId: true, ...(pack ? { pack } : {}) });
}

export interface UndoOpsResult {
  /** The writes reversed. */
  undone: number;
  failed: Array<{ op: string; uuid: string; error: string }>;
  /** The undo's own writes; the bridge lifts them into the undo's own receipt. */
  ops?: ReceiptOp[];
}

/**
 * Reverse a receipt's writes, newest first (`effectiveOps` decides which): delete what it created,
 * put back the paths it changed (removing the ones it added), re-create what it deleted with its id
 * (under its parent when embedded). A `tooLarge` write is reported as not undoable. Under the write
 * lock, recorded: the undo answers its own writes, so an undo can be reversed too.
 */
export async function undoOps(args: { ops: ReceiptOp[] }): Promise<UndoOpsResult> {
  const todo = effectiveOps(Array.isArray(args?.ops) ? args.ops : []).reverse();
  return withWriteLock(async () => {
    const recorder = record();
    let undone = 0;
    const failed: UndoOpsResult['failed'] = [];
    try {
      for (const op of todo) {
        try {
          await undoOne(op);
          undone++;
        } catch (err) {
          failed.push({
            op: `${op.kind} ${op.documentName}`,
            uuid: op.uuid,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }
    } finally {
      recorder.stop();
    }
    return { undone, failed, ops: recorder.stop() };
  });
}
