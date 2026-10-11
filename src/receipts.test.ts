/**
 * The receipt store and the receipt line (issue #6), offline, in a temp dir: the world key, save /
 * load / the refusals, the undone mark, the pruning by count, age and bytes, the grouping context,
 * and the line every write answers with.
 */
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReceiptOp } from './page/_receipts.js';
import {
  callContext,
  loadReceipt,
  markUndone,
  newReceiptId,
  noteOps,
  pruneReceipts,
  RECEIPT_LIMITS,
  receiptLine,
  receiptLineOf,
  receiptWorldKey,
  saveReceipt,
  summarizeOps,
  withReceiptLine,
} from './receipts.js';

const URL = 'http://localhost:30000';
const op = (kind: ReceiptOp['kind'], uuid: string, extra: Partial<ReceiptOp> = {}): ReceiptOp => ({
  kind,
  documentName: uuid.split('.').at(-2) ?? 'Actor',
  uuid,
  label: '',
  ...extra,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fvtt-receipts-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the world key', () => {
  it('is the server URL and the world id, hashed: a trailing slash is the same server', () => {
    const key = receiptWorldKey(URL, 'w');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(receiptWorldKey(`${URL}/`, 'w')).toBe(key);
    // the sandbox and a hosted copy of the same world are two worlds
    expect(receiptWorldKey('https://box.example', 'w')).not.toBe(key);
    expect(receiptWorldKey(URL, 'other')).not.toBe(key);
  });

  it('a receipt id is rcpt_ and six base-36 characters', () => {
    expect(newReceiptId()).toMatch(/^rcpt_[0-9a-z]{6}$/);
  });
});

describe('the store', () => {
  const fields = (worldId = 'w') => ({
    at: '2026-10-11T12:00:00.000Z',
    serverUrl: URL,
    worldId,
    tool: 'manage-actors',
    ops: [op('update', 'Actor.a1', { label: 'Goblin', pre: { name: 'Old' } })],
  });

  it('saves under a fresh id and loads it back by id and world', () => {
    const saved = saveReceipt(fields(), dir);
    expect(saved.id).toMatch(/^rcpt_[0-9a-z]{6}$/);
    const key = receiptWorldKey(URL, 'w');
    expect(readdirSync(dir)).toEqual([`${key}-${saved.id}.json`]);
    expect(loadReceipt(saved.id, key, dir)).toEqual(saved);
  });

  it('refuses another world, a missing id and a malformed one, each by name', () => {
    const saved = saveReceipt(fields('w'), dir);
    expect(() => loadReceipt(saved.id, receiptWorldKey(URL, 'other'), dir)).toThrow(
      `receipt ${saved.id} was written in another world: receipts belong to the world they were written in, and the newest 50 per world are kept for a day`
    );
    expect(() => loadReceipt('rcpt_zzzzzz', receiptWorldKey(URL, 'w'), dir)).toThrow(
      'receipt rcpt_zzzzzz is not in the store: receipts belong to the world'
    );
    expect(() => loadReceipt('rcpt_../x', receiptWorldKey(URL, 'w'), dir)).toThrow(
      '"rcpt_../x" is not a receipt id'
    );
  });

  it('marks a receipt undone by another, and its age stays its own', () => {
    const saved = saveReceipt(fields(), dir);
    const key = receiptWorldKey(URL, 'w');
    const file = join(dir, `${key}-${saved.id}.json`);
    const then = new Date(Date.now() - 3_600_000);
    utimesSync(file, then, then);
    markUndone(saved.id, key, 'rcpt_aaaaaa', dir);
    expect(loadReceipt(saved.id, key, dir).undoneBy).toBe('rcpt_aaaaaa');
    expect(Math.abs(statSync(file).mtimeMs - then.getTime())).toBeLessThan(1_000);
    markUndone('rcpt_nonexi', key, 'rcpt_aaaaaa', dir); // a missing receipt: nothing, no throw
  });

  describe('pruning', () => {
    const now = Date.now();
    /** A receipt file of world `key`, `ageMs` old, `bytes` long. */
    const put = (key: string, id: string, ageMs: number, bytes = 10) => {
      const file = join(dir, `${key}-${id}.json`);
      writeFileSync(file, 'x'.repeat(bytes));
      const at = new Date(now - ageMs);
      utimesSync(file, at, at);
    };
    const mine = receiptWorldKey(URL, 'w');
    const theirs = receiptWorldKey(URL, 'other');
    const left = () => readdirSync(dir).sort();

    it('keeps the newest 50 of the world', () => {
      for (let i = 0; i < 53; i++) put(mine, `rcpt_${String(i).padStart(6, '0')}`, i * 60_000);
      pruneReceipts(mine, dir, RECEIPT_LIMITS, now);
      const kept = left();
      expect(kept).toHaveLength(50);
      expect(kept.at(-1)).toBe(`${mine}-rcpt_000049.json`);
    });

    it('drops anything older than a day, in any world; another world keeps its count', () => {
      put(mine, 'rcpt_old000', 25 * 3_600_000);
      put(mine, 'rcpt_new000', 60_000);
      put(theirs, 'rcpt_old111', 25 * 3_600_000);
      for (let i = 0; i < 55; i++) put(theirs, `rcpt_t${String(i).padStart(5, '0')}`, 60_000);
      pruneReceipts(mine, dir, RECEIPT_LIMITS, now);
      const kept = left();
      expect(kept).toContain(`${mine}-rcpt_new000.json`);
      expect(kept).not.toContain(`${mine}-rcpt_old000.json`);
      expect(kept).not.toContain(`${theirs}-rcpt_old111.json`);
      expect(kept.filter(f => f.startsWith(theirs))).toHaveLength(55);
    });

    it('keeps at most maxBytes of the world, the oldest going first', () => {
      for (let i = 0; i < 5; i++) put(mine, `rcpt_b0000${i}`, i * 60_000, 400);
      pruneReceipts(mine, dir, { ...RECEIPT_LIMITS, maxBytes: 1_000 }, now);
      expect(left()).toEqual([`${mine}-rcpt_b00000.json`, `${mine}-rcpt_b00001.json`]);
    });
  });
});

describe('the call context', () => {
  it('notes a page op’s writes into the call in flight; with none in flight they are dropped', async () => {
    const ctx = { ops: [] as ReceiptOp[] };
    await callContext.run(ctx, async () => {
      await Promise.resolve();
      noteOps([op('create', 'Actor.n')]);
    });
    noteOps([op('create', 'Actor.lost')]);
    expect(ctx.ops.map(o => o.uuid)).toEqual(['Actor.n']);
  });
});

describe('the receipt line', () => {
  const ops: ReceiptOp[] = [
    op('create', 'Actor.n1', { label: 'Goblin 3' }),
    op('update', 'Actor.n1', { label: 'Goblin 3', pre: { name: 'x' } }), // of a created one: hidden
    op('update', 'Actor.a1', {
      label: 'Goblin 1',
      pre: { 'system.attributes.hp.value': 7 },
      absent: ['flags.world.note'],
    }),
    op('update', 'Actor.a1', { label: 'Goblin 1', pre: { name: 'Goblin 1' } }),
    op('delete', 'Scene.s1.AmbientLight.l1', { pre: {}, parentUuid: 'Scene.s1' }),
    op('create', 'Actor.t'),
    op('delete', 'Actor.t', { pre: {} }), // created and deleted: nothing
  ];

  it('counts per document and names what changed; a nameless one by its id', () => {
    expect(receiptLine({ id: 'rcpt_ab12cd', ops }, { canUndo: true })).toBe(
      'receipt rcpt_ab12cd: 1 created, 1 updated, 1 deleted (Actor "Goblin 1": ' +
        'system.attributes.hp.value, flags.world.note, name; AmbientLight l1) · ' +
        'undo: run-script { "undo": "rcpt_ab12cd" }'
    );
    expect(summarizeOps(ops).documents.map(d => `${d.did} ${d.op.uuid}`)).toEqual([
      'created Actor.n1',
      'updated Actor.a1',
      'deleted Scene.s1.AmbientLight.l1',
    ]);
  });

  it('an undo names the receipt it reverses; without run-script it says how to get the undo', () => {
    const line = receiptLine(
      { id: 'rcpt_x00001', ops, reverses: 'rcpt_y00002' },
      { canUndo: false }
    );
    expect(line).toMatch(/^receipt rcpt_x00001 \(reverses rcpt_y00002\): 1 created/);
    expect(line).toMatch(/ · undo needs the scripting toolset \(FOUNDRY_TOOLSETS\)$/);
  });

  it('cuts the detail at 240 characters and counts what cannot be undone', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      op('update', `Actor.a${i}`, {
        label: `Goblin number ${i}`,
        pre: { 'system.details.biography.value': '' },
      })
    );
    many.push(op('delete', 'Scene.big', { label: 'Big', tooLarge: true }));
    const line = receiptLine({ id: 'rcpt_ab12cd', ops: many }, { canUndo: true });
    const detail = /\((.*)\) · 1 not undoable/.exec(line)?.[1] ?? '';
    expect(detail.length).toBe(240);
    expect(detail.endsWith('…')).toBe(true);
    expect(line).toContain(' · 1 not undoable (pre-image over the cap) · undo: run-script');
  });

  it('a receipt the store could not keep says so and offers no undo', () => {
    expect(
      receiptLine({ id: '', ops: [op('create', 'Actor.n')] }, { canUndo: true, notKept: 'EACCES' })
    ).toBe('receipt: 1 created, 0 updated, 0 deleted · not kept (EACCES), so it cannot be undone');
  });

  it('rides a failed call’s error', () => {
    const err = withReceiptLine(new Error('boom'), 'receipt rcpt_x: 1 created');
    expect(err.message).toBe('boom');
    expect(receiptLineOf(err)).toBe('receipt rcpt_x: 1 created');
    expect(receiptLineOf(new Error('plain'))).toBeUndefined();
    expect(receiptLineOf(withReceiptLine('a string', 'line'))).toBe('line');
  });
});
