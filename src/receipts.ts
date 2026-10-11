/**
 * Receipts, the Node side (issue #6). Every page write the bridge makes for a tool call comes back
 * with the documents it touched and their pre-images (src/page/_receipts.ts). Here they are grouped
 * per tool call, kept in a file on this machine and summed up in the one receipt line the server
 * appends to the call's answer (src/registry.ts, src/index.ts), so `run-script { "undo": "rcpt_…" }`
 * reverses the call, also after a disconnect or a restart of the server.
 *
 * - The grouping is an AsyncLocalStorage context: the registry runs each tool call inside one, and
 *   the bridge (src/foundry.ts `invoke`) asks the page to record only when a context is active and
 *   notes what came back into it. A sibling harness driving `fvtt-mcp-dnd5e/client` never sets
 *   one, so its calls run unrecorded and pay nothing.
 * - The store is one JSON file per receipt under the OS temp dir (`fvtt-mcp-dnd5e/receipts/`), named
 *   `<world key>-<id>.json`, the world key being the server URL and the world id hashed (the seat
 *   records' shape, src/holders.ts): a receipt belongs to the world it was written in, and is never
 *   applied to another one, the sandbox and a hosted world of the same id included. The world is
 *   the one of the bridge's last connect (`lastWorldId`): filing a receipt never reconnects. Per
 *   world the newest 50 are kept, none older than a day, at most 64 MB, and never the one just
 *   written. A pre-image is world content (a journal's text, an NPC's sheet), so the directory and
 *   the files are the user's alone where the OS has modes (a shared temp dir). The page keeps
 *   nothing, and a store failure never fails a tool call.
 * - An undo marks the receipt it reverses undone only when it reversed every write; one that could
 *   not reverse them all leaves the receipt undoable (`partialUndoBy`), and undoing it again is
 *   safe for what was already put back. An undo that reversed every write and changed nothing (the
 *   world already matched) marks it undone too, with no receipt of its own (NOTHING_PUT_BACK).
 *
 * Node-side only: no Playwright, no page.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomInt } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { effectiveOps, type ReceiptOp } from './page/_receipts.js';

export interface CallContext {
  /** Every write the call's page ops made, in order. */
  ops: ReceiptOp[];
  /** Set by run-script's undo: the receipt this call reverses. */
  reverses?: string;
  /**
   * Set by run-script's undo until the page answers that every write was reversed: the receipt it
   * reverses is then not marked undone, and stays undoable.
   */
  reversesPartial?: boolean;
}

/** The tool call in flight on this async path (src/registry.ts runs every call inside one). */
export const callContext = new AsyncLocalStorage<CallContext>();

/** Add a page op's writes to the call in flight; with no call in flight they are dropped. */
export function noteOps(ops: readonly ReceiptOp[]): void {
  const ctx = callContext.getStore();
  if (!ctx) return;
  for (const op of ops) ctx.ops.push(op);
}

export interface StoredReceipt {
  id: string;
  at: string;
  serverUrl: string;
  worldId: string;
  /** The tool whose call made the writes. */
  tool: string;
  ops: ReceiptOp[];
  /** An undo's own receipt: the receipt it reverses. */
  reverses?: string;
  /** An undo's own receipt: it could not reverse every write of the one it reverses. */
  partial?: true;
  /** The receipt of the undo that reversed this one, or NOTHING_PUT_BACK. */
  undoneBy?: string;
  /** The receipts of undos that reversed only part of this one: it stays undoable. */
  partialUndoBy?: string[];
}

/**
 * `undoneBy` of a receipt whose undo found the world already matching it (the values were put back
 * by hand): that undo wrote nothing, so it kept no receipt of its own to undo in turn.
 */
export const NOTHING_PUT_BACK = 'nothing to put back';

export interface PruneLimits {
  kept: number;
  maxAgeMs: number;
  maxBytes: number;
}

export const RECEIPT_LIMITS: PruneLimits = {
  kept: 50,
  maxAgeMs: 24 * 60 * 60_000,
  maxBytes: 64 * 1024 * 1024,
};

/** Where the receipts live: one directory per machine, shared by every bridge process on it. */
export function receiptsDir(): string {
  return join(tmpdir(), 'fvtt-mcp-dnd5e', 'receipts');
}

/** One world = one server URL + one world id; the key names its receipt files. */
export function receiptWorldKey(serverUrl: string, worldId: string): string {
  return createHash('sha1')
    .update(`${serverUrl.replace(/\/+$/, '')}\n${worldId}`)
    .digest('hex')
    .slice(0, 12);
}

const ID_RE = /^rcpt_[0-9a-z]{6}$/;

export function newReceiptId(): string {
  let id = '';
  for (let i = 0; i < 6; i++) id += randomInt(36).toString(36);
  return `rcpt_${id}`;
}

/** The file receipt `id` of world `worldKey` is kept in. */
export const receiptPath = (dir: string, worldKey: string, id: string): string =>
  join(dir, `${worldKey}-${id}.json`);

/**
 * Keep a receipt, under a fresh id (never one already in the store), and return it. Throws when the
 * file cannot be written: the caller says so instead of printing an id nothing can undo.
 */
export function saveReceipt(
  fields: Omit<StoredReceipt, 'id'>,
  dir: string = receiptsDir()
): StoredReceipt {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = receiptWorldKey(fields.serverUrl, fields.worldId);
  for (let attempt = 1; ; attempt++) {
    const receipt: StoredReceipt = { id: newReceiptId(), ...fields };
    try {
      writeFileSync(receiptPath(dir, key, receipt.id), JSON.stringify(receipt), {
        flag: 'wx',
        mode: 0o600,
      });
      return receipt;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 5) throw err;
    }
  }
}

const KEPT = `receipts belong to the world they were written in, and the newest ${RECEIPT_LIMITS.kept} per world are kept for a day`;

function receiptFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/** The receipt `id` of the world `worldKey`, or a refusal naming the id. */
export function loadReceipt(
  id: string,
  worldKey: string,
  dir: string = receiptsDir()
): StoredReceipt {
  if (!ID_RE.test(id)) {
    throw new Error(`"${id}" is not a receipt id (rcpt_ and six letters or digits)`);
  }
  let receipt: StoredReceipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath(dir, worldKey, id), 'utf8')) as StoredReceipt;
  } catch {
    const elsewhere = receiptFiles(dir).some(f => f.endsWith(`-${id}.json`));
    throw new Error(
      elsewhere
        ? `receipt ${id} was written in another world: ${KEPT}`
        : `receipt ${id} is not in the store: ${KEPT}`
    );
  }
  if (receipt.id !== id || receiptWorldKey(receipt.serverUrl, receipt.worldId) !== worldKey) {
    throw new Error(`receipt ${id} was written in another world: ${KEPT}`);
  }
  return receipt;
}

/**
 * Record that receipt `id` was reversed by receipt `byId`: undone, or with `partial` only in part
 * (it stays undoable). Best effort; its age is unchanged.
 */
export function markUndone(
  id: string,
  worldKey: string,
  byId: string,
  dir: string = receiptsDir(),
  { partial = false }: { partial?: boolean } = {}
): void {
  const file = receiptPath(dir, worldKey, id);
  try {
    const { atime, mtime } = statSync(file);
    const receipt = JSON.parse(readFileSync(file, 'utf8')) as StoredReceipt;
    if (partial) receipt.partialUndoBy = [...(receipt.partialUndoBy ?? []), byId];
    else receipt.undoneBy = byId;
    writeFileSync(file, JSON.stringify(receipt));
    utimesSync(file, atime, mtime);
  } catch {
    // best effort: an unmarked receipt can still be undone, its undo's own receipt says so
  }
}

/**
 * Keep the newest `kept` receipts of world `worldKey`, none older than `maxAgeMs` and at most
 * `maxBytes` of them (the oldest go first); a receipt of any world older than `maxAgeMs` goes too.
 * `keep`, the file just written, is never removed: its line has offered its undo. It still counts
 * toward the limits. Best effort.
 */
export function pruneReceipts(
  worldKey: string,
  dir: string = receiptsDir(),
  {
    keep,
    limits = RECEIPT_LIMITS,
    now = Date.now(),
  }: { keep?: string; limits?: PruneLimits; now?: number } = {}
): void {
  const kept = keep === undefined ? undefined : resolve(keep);
  const files: Array<{ path: string; mine: boolean; mtime: number; size: number }> = [];
  for (const name of receiptFiles(dir)) {
    try {
      const path = join(dir, name);
      const { mtimeMs, size } = statSync(path);
      files.push({ path, mine: name.startsWith(`${worldKey}-`), mtime: mtimeMs, size });
    } catch {
      // gone meanwhile
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  let count = 0;
  let bytes = 0;
  for (const f of files) {
    let drop = now - f.mtime > limits.maxAgeMs;
    if (f.mine && !drop) {
      count++;
      bytes += f.size;
      drop = count > limits.kept || bytes > limits.maxBytes;
    }
    if (drop && resolve(f.path) !== kept) {
      try {
        rmSync(f.path, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

export interface ReceiptSummary {
  /** One entry per document, in the order first written: what the receipt did to it. */
  documents: Array<{ op: ReceiptOp; did: 'created' | 'updated' | 'deleted'; paths: string[] }>;
  /** Writes whose pre-image was over the cap: they cannot be undone. */
  notUndoable: number;
}

/**
 * What a receipt did, per document (`effectiveOps` first: what a receipt both created and deleted
 * is nothing): created, deleted, or updated with the paths it changed.
 */
export function summarizeOps(ops: readonly ReceiptOp[]): ReceiptSummary {
  const effective = effectiveOps(ops);
  const byUuid = new Map<string, ReceiptOp[]>();
  for (const op of effective) {
    const list = byUuid.get(op.uuid);
    if (list) list.push(op);
    else byUuid.set(op.uuid, [op]);
  }
  const documents: ReceiptSummary['documents'] = [];
  for (const list of byUuid.values()) {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (first.kind === 'create') documents.push({ op: first, did: 'created', paths: [] });
    else if (last.kind === 'delete') documents.push({ op: last, did: 'deleted', paths: [] });
    else {
      const paths = new Set<string>();
      for (const op of list) {
        for (const p of Object.keys(op.pre ?? {})) paths.add(p);
        for (const p of op.absent ?? []) paths.add(p);
      }
      documents.push({ op: first, did: 'updated', paths: [...paths] });
    }
  }
  return { documents, notUndoable: effective.filter(op => op.tooLarge).length };
}

/** The parenthesis of a receipt line is cut here. */
const DETAIL_MAX = 240;

/**
 * The receipt line the server appends to a call's answer:
 * `receipt rcpt_ab12cd: 1 created, 1 updated, 0 deleted (Actor "Goblin 3": system.attributes.hp.value)
 * · undo: run-script { "undo": "rcpt_ab12cd" }`. `canUndo`: the registration advertises run-script.
 * `notKept`: the store failed, so the line names why and offers no undo. `noWorld`: the bridge
 * had read no world id, so the receipt is kept under none and no undo would find it (a guard:
 * nothing writes without a world). An undo names the receipt it reverses, `partly` when it could
 * not reverse every write of it.
 */
export function receiptLine(
  receipt: Pick<StoredReceipt, 'id' | 'ops' | 'reverses' | 'partial'>,
  opts: { canUndo: boolean; notKept?: string; noWorld?: boolean }
): string {
  const { documents, notUndoable } = summarizeOps(receipt.ops);
  const n = (did: string) => documents.filter(d => d.did === did).length;
  const ref = (op: ReceiptOp) =>
    op.label
      ? `${op.documentName} "${op.label}"`
      : `${op.documentName} ${op.uuid.split('.').pop()}`;
  let detail = documents
    .filter(d => d.did !== 'created')
    .map(d => (d.paths.length ? `${ref(d.op)}: ${d.paths.join(', ')}` : ref(d.op)))
    .join('; ');
  if (detail.length > DETAIL_MAX) detail = `${detail.slice(0, DETAIL_MAX - 1)}…`;
  const name = opts.notKept ? 'receipt' : `receipt ${receipt.id}`;
  const reverses = receipt.reverses
    ? ` (${receipt.partial ? 'partly reverses' : 'reverses'} ${receipt.reverses})`
    : '';
  const parts = [
    `${name}${reverses}: ${n('created')} created, ` +
      `${n('updated')} updated, ${n('deleted')} deleted${detail ? ` (${detail})` : ''}`,
  ];
  if (notUndoable) parts.push(`${notUndoable} not undoable (pre-image over the cap)`);
  if (opts.notKept) parts.push(`not kept (${opts.notKept}), so it cannot be undone`);
  else if (opts.noWorld) parts.push('kept under no world id (none was read), so no undo finds it');
  else if (opts.canUndo) parts.push(`undo: run-script { "undo": "${receipt.id}" }`);
  else parts.push('undo needs the scripting toolset (FOUNDRY_TOOLSETS)');
  return parts.join(' · ');
}

const LINE = Symbol('receiptLine');

/** The error a failed call throws, carrying the receipt line of the writes it made before failing. */
export function withReceiptLine(err: unknown, line: string): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  (error as Error & { [LINE]?: string })[LINE] = line;
  return error;
}

/** The receipt line a failed call's error carries, if it wrote before failing. */
export function receiptLineOf(err: unknown): string | undefined {
  return err instanceof Error ? (err as Error & { [LINE]?: string })[LINE] : undefined;
}
