/**
 * The page's receipt machinery, offline, on stubbed Foundry globals (the run-script.test.ts
 * pattern): the write lock, the recorder's per-path pre-image, its token on a create (a create
 * begun on another page, or under another recorder, is not this receipt's), the bookkeeping it
 * never records, the byte cap per page op and per call (`capReceipt`), the choke point
 * (`callOp`), the netting, and `undoOps`. Issue #6 and its review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callOp,
  capReceipt,
  changedPaths,
  documentNames,
  effectiveOps,
  MAX_PRE_IMAGE_CHARS,
  MAX_RECEIPT_CHARS,
  RECORDER_MARK,
  type ReceiptOp,
  record,
  UNRECORDED,
  undoOps,
  undoUpdateData,
  updatePreImage,
  withWriteLock,
} from './_receipts.js';

/** Foundry v14's data operators, as much of them as the recorder and the undo touch. */
class DataFieldOperator {
  constructor(readonly value?: unknown) {}
  static get(v: unknown): unknown {
    return v instanceof DataFieldOperator ? v.value : v;
  }
}
class ForcedDeletion extends DataFieldOperator {}
class ForcedReplacement extends DataFieldOperator {
  static create(v: unknown): ForcedReplacement {
    return new ForcedReplacement(v);
  }
}
const OPERATORS = { DataFieldOperator, ForcedDeletion, ForcedReplacement };

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const g = globalThis as any;
let seq = 0;
const hooks = new Map<string, Array<{ id: number; fn: (...a: unknown[]) => unknown }>>();
const fire = (hook: string, ...args: unknown[]) => {
  for (const h of hooks.get(hook) ?? []) h.fn(...args);
};
const liveHooks = () => [...hooks.values()].reduce((n, list) => n + list.length, 0);
/**
 * A create as Foundry runs it on the page that makes it: `preCreate<Doc>` with the operation's
 * options, then `create<Doc>` with the same options as the server hands them back.
 */
const create = (
  name: string,
  doc: Record<string, unknown>,
  options: Record<string, unknown> = {},
  userId = 'u1'
) => {
  fire(`preCreate${name}`, doc, {}, options, userId);
  fire(`create${name}`, doc, options, userId);
  return options;
};

beforeEach(() => {
  hooks.clear();
  seq = 0;
  g.CONFIG = {
    Actor: { documentClass: Object.assign(function Actor() {}, { create: vi.fn() }) },
    JournalEntryPage: { documentClass: function JournalEntryPage() {} },
    Scene: { documentClass: function Scene() {} },
    Setting: { documentClass: function Setting() {} },
  };
  g.game = { user: { id: 'u1' } };
  g.foundry = { utils: { deepClone: (v: unknown) => structuredClone(v) } };
  g.Hooks = {
    on: (hook: string, fn: (...a: unknown[]) => unknown) => {
      const id = ++seq;
      hooks.set(hook, [...(hooks.get(hook) ?? []), { id, fn }]);
      return id;
    },
    off: (hook: string, id: number) => {
      hooks.set(
        hook,
        (hooks.get(hook) ?? []).filter(h => h.id !== id)
      );
    },
  };
});
afterEach(() => {
  for (const k of ['CONFIG', 'game', 'foundry', 'Hooks', 'window', 'fromUuid']) delete g[k];
});

describe('the write lock', () => {
  it('two writes run one after the other; a read does not wait for a held lock', async () => {
    const order: string[] = [];
    g.window = {
      __fvtt: {
        createScene: async () => {
          order.push('A start');
          await sleep(40);
          order.push('A end');
          return 'A';
        },
        updateScene: async () => {
          order.push('B start');
          order.push('B end');
          return 'B';
        },
        listScenes: async () => {
          order.push('read');
          return [];
        },
      },
    };
    const a = callOp('createScene', {}, { record: true });
    await sleep(5); // A holds the lock now
    const b = callOp('updateScene', {}, { record: true });
    await callOp('listScenes', {}, { record: true });
    order.push('read done');
    expect(await a).toEqual({ result: 'A' });
    expect(await b).toEqual({ result: 'B' });
    expect(order).toEqual(['A start', 'read', 'read done', 'A end', 'B start', 'B end']);
  });

  it('a holder that throws still releases the lock', async () => {
    await expect(
      withWriteLock(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await withWriteLock(async () => 'next')).toBe('next');
  });
});

describe('the recorder', () => {
  const goblin = () => ({
    uuid: 'Actor.a1',
    name: 'Goblin',
    _source: {
      _id: 'a1',
      name: 'Goblin',
      system: { hp: { value: 7, max: 7 } },
      flags: { world: { mark: { by: 'x' } } },
      tags: ['a', 'b'],
      ownership: { default: 2, u2: 3 },
    },
  });

  it('an update keeps the prior value of each changed path; an added path goes to absent', () => {
    const rec = record();
    const doc = goblin();
    fire(
      'preUpdateActor',
      doc,
      {
        _id: 'a1',
        system: { hp: { value: 3, max: 7 }, speed: 30 },
        flags: { world: { '-=mark': null } },
        tags: ['a', 'b', 'c'],
        'flags.world.note': 'hi',
      },
      {},
      'u1'
    );
    const [op] = rec.stop();
    expect(op).toEqual({
      kind: 'update',
      documentName: 'Actor',
      uuid: 'Actor.a1',
      label: 'Goblin',
      // max did not change and _id is never a path; the deletion key is the path it deletes
      pre: { 'system.hp.value': 7, 'flags.world.mark': { by: 'x' }, tags: ['a', 'b'] },
      absent: ['system.speed', 'flags.world.note'],
    });
    // an array is a leaf, cloned whole: the pre-image does not move with the live source
    doc._source.tags.push('z');
    expect(op!.pre!.tags).toEqual(['a', 'b']);
  });

  it("v14's operators: a ForcedDeletion and a ForcedReplacement, and recursive:false roots whole", () => {
    g.foundry.data = { operators: OPERATORS };
    const rec = record();
    fire(
      'preUpdateActor',
      goblin(),
      {
        flags: { world: { mark: new ForcedDeletion() } },
        system: ForcedReplacement.create({ hp: { value: 1 } }),
      },
      {},
      'u1'
    );
    fire('preUpdateActor', goblin(), { ownership: { default: 0 } }, { recursive: false }, 'u1');
    const [replaced, whole] = rec.stop();
    expect(replaced!.pre).toEqual({
      'flags.world.mark': { by: 'x' },
      system: { hp: { value: 7, max: 7 } },
    });
    expect(whole!.pre).toEqual({ ownership: { default: 2, u2: 3 } });
  });

  it("records nothing that changes nothing, nor another user's write, nor an UNRECORDED one", () => {
    const rec = record();
    fire('preUpdateActor', goblin(), { name: 'Goblin', system: { hp: { value: 7 } } }, {}, 'u1');
    fire('preUpdateActor', goblin(), { name: 'Hob' }, {}, 'someone-else');
    fire('preUpdateActor', goblin(), { name: 'Hob' }, { [UNRECORDED]: true }, 'u1');
    fire('createActor', { uuid: 'Actor.n', name: 'N' }, {}, 'someone-else');
    expect(rec.stop()).toEqual([]);
  });

  it('a create begun on this page is recorded from its post hook; a delete keeps the document and its parent', () => {
    const rec = record();
    create('Actor', { uuid: 'Actor.n1', name: 'New' });
    fire(
      'preDeleteJournalEntryPage',
      {
        uuid: 'JournalEntry.j1.JournalEntryPage.p1',
        name: 'Clues',
        parent: { uuid: 'JournalEntry.j1' },
        toObject: () => ({ _id: 'p1', name: 'Clues', text: { content: '<p>x</p>' } }),
      },
      {},
      'u1'
    );
    create('Setting', { uuid: 'Setting.s1', key: 'dnd5e.rulesVersion' });
    expect(rec.stop()).toEqual([
      { kind: 'create', documentName: 'Actor', uuid: 'Actor.n1', label: 'New' },
      {
        kind: 'delete',
        documentName: 'JournalEntryPage',
        uuid: 'JournalEntry.j1.JournalEntryPage.p1',
        label: 'Clues',
        parentUuid: 'JournalEntry.j1',
        pre: { _id: 'p1', name: 'Clues', text: { content: '<p>x</p>' } },
      },
      // a setting has no name: its key labels it
      { kind: 'create', documentName: 'Setting', uuid: 'Setting.s1', label: 'dnd5e.rulesVersion' },
    ]);
  });

  it('a hook per document class goes on, and stop takes them all off, once', () => {
    const rec = record();
    // four classes in CONFIG × preCreate / create / preUpdate / preDelete
    expect(liveHooks()).toBe(4 * 4);
    rec.stop();
    expect(liveHooks()).toBe(0);
    expect(rec.stop()).toEqual([]);
  });

  it('a hook never throws into the write and never vetoes it', () => {
    const rec = record();
    const results = (hooks.get('preUpdateActor') ?? []).map(h =>
      h.fn(
        {
          uuid: 'Actor.x',
          get _source() {
            throw new Error('boom');
          },
        },
        { a: 1 },
        {},
        'u1'
      )
    );
    expect(results).toEqual([undefined]);
    // recorded without a pre-image: the undo reports it instead of restoring something wrong
    expect(rec.stop()).toEqual([
      { kind: 'update', documentName: 'Actor', uuid: 'Actor.x', label: '' },
    ]);
  });

  it("a create is this recorder's only when it carries back the token its preCreate stamped", () => {
    // begun under an earlier recorder, whose stop came before the server answered
    const earlier = record();
    const late: Record<string, unknown> = {};
    fire('preCreateActor', { name: 'Late' }, {}, late, 'u1');
    expect(late[RECORDER_MARK]).toEqual(expect.any(String));
    earlier.stop();
    const rec = record();
    fire('createActor', { uuid: 'Actor.late', name: 'Late' }, late, 'u1');
    // the same user's create, begun on another page (a second session on the seat): no token
    fire('createActor', { uuid: 'Actor.remote', name: 'Remote' }, {}, 'u1');
    // one with a token that is not this recorder's
    fire('createActor', { uuid: 'Actor.other', name: 'Other' }, { [RECORDER_MARK]: 'x' }, 'u1');
    // one begun here, now
    const own = create('Actor', { uuid: 'Actor.own', name: 'Own' });
    expect(own[RECORDER_MARK]).toEqual(expect.any(String));
    expect(own[RECORDER_MARK]).not.toBe(late[RECORDER_MARK]); // each recorder draws its own
    expect(rec.stop()).toEqual([
      { kind: 'create', documentName: 'Actor', uuid: 'Actor.own', label: 'Own' },
    ]);
    expect(earlier.stop()).toEqual([]);
  });

  it('never records FogExploration: bookkeeping a read can write while a write records', () => {
    g.CONFIG.FogExploration = { documentClass: function FogExploration() {} };
    const rec = record();
    expect([...hooks.keys()].filter(h => h.endsWith('FogExploration'))).toEqual([]);
    const fog = { uuid: 'FogExploration.f1', name: '', _source: { explored: 'a' } };
    create('FogExploration', fog);
    fire('preUpdateFogExploration', fog, { explored: 'b' }, {}, 'u1');
    fire('preDeleteFogExploration', { ...fog, parent: null, toObject: () => ({}) }, {}, 'u1');
    expect(rec.stop()).toEqual([]);
    // left out of the receipts, still shadowed in a script (./run-script.ts)
    expect(documentNames()).toContain('FogExploration');
  });
});

describe('the byte cap', () => {
  const big = (n: number) => ({
    uuid: `Scene.s${n}`,
    name: `Big ${n}`,
    parent: null,
    toObject: () => ({ _id: `s${n}`, blob: 'x'.repeat(1_900_000) }),
  });

  it('a pre-image over MAX_PRE_IMAGE_CHARS is not kept: the op is tooLarge', () => {
    const rec = record();
    fire(
      'preDeleteScene',
      {
        uuid: 'Scene.huge',
        name: 'Huge',
        parent: null,
        toObject: () => ({ blob: 'x'.repeat(MAX_PRE_IMAGE_CHARS) }),
      },
      {},
      'u1'
    );
    const [op] = rec.stop();
    expect(op).toMatchObject({ kind: 'delete', uuid: 'Scene.huge', tooLarge: true });
    expect(op!.pre).toBeUndefined();
  });

  it('once a receipt holds MAX_RECEIPT_CHARS of pre-images, every further one is dropped', () => {
    const rec = record();
    for (let n = 1; n <= 5; n++) fire('preDeleteScene', big(n), {}, 'u1');
    const ops = rec.stop();
    const kept = ops.filter(o => o.pre).length;
    expect(kept * 1_900_000).toBeLessThanOrEqual(MAX_RECEIPT_CHARS);
    expect(ops.map(o => !!o.tooLarge)).toEqual([false, false, false, false, true]);
  });

  it('capReceipt holds the cap across a whole call: past it a pre-image is dropped, its op tooLarge', () => {
    const ops = [
      op('update', 'Actor.a', { pre: { bio: 'x'.repeat(40) } }), // 50 chars of JSON
      op('create', 'Actor.n'),
      op('delete', 'Actor.b', { pre: { bio: 'y'.repeat(40) } }), // 100 in all: past 60
      op('update', 'Actor.c', { pre: { hp: 1 }, absent: ['flags.world.x'] }), // 58: within
    ];
    const capped = capReceipt(ops, 60);
    expect(capped.map(o => [o.uuid, !!o.pre, !!o.tooLarge])).toEqual([
      ['Actor.a', true, false],
      ['Actor.n', false, false],
      ['Actor.b', false, true],
      ['Actor.c', true, false],
    ]);
    expect(capped[2]).toEqual({
      kind: 'delete',
      documentName: 'Actor',
      uuid: 'Actor.b',
      label: '',
      tooLarge: true,
    });
    expect(ops[2]!.pre).toBeDefined(); // the ops handed in are not changed
    // two page ops' pre-images of 4.5 MB: each within its own recorder's cap, not within one call's
    const big = (uuid: string) => op('delete', uuid, { pre: { blob: 'z'.repeat(4_500_000) } });
    expect(capReceipt([big('Scene.s1'), big('Scene.s2')]).map(o => !!o.tooLarge)).toEqual([
      false,
      true,
    ]);
  });
});

describe('callOp — the choke point', () => {
  const writes = () => ({
    getWorldInfo: async () => ({ id: 'w' }),
    updateActor: async (a: { name: string }) => {
      fire(
        'preUpdateActor',
        { uuid: 'Actor.a1', name: 'Goblin', _source: { name: 'Goblin' } },
        { name: a.name },
        {},
        'u1'
      );
      return { ok: true };
    },
    deleteActor: async () => {
      fire(
        'preDeleteActor',
        { uuid: 'Actor.a1', name: 'Goblin', parent: null, toObject: () => ({ name: 'Goblin' }) },
        {},
        'u1'
      );
      throw new Error('PageError:x: the second half failed');
    },
    deleteScenes: async () => {
      throw Object.assign(new Error('nope'), { name: 'PageError:not-found' });
    },
    runScript: async () => ({ ok: true, log: [], ops: [{ kind: 'create', uuid: 'Actor.s' }] }),
  });

  it('a read answers { result } and records nothing', async () => {
    g.window = { __fvtt: writes() };
    const on = vi.spyOn(g.Hooks, 'on');
    expect(await callOp('getWorldInfo', undefined, { record: true })).toEqual({
      result: { id: 'w' },
    });
    expect(on).not.toHaveBeenCalled();
  });

  it('a write answers { result, ops } when asked for a receipt, { result } when not', async () => {
    g.window = { __fvtt: writes() };
    expect(await callOp('updateActor', { name: 'Hob' }, { record: true })).toEqual({
      result: { ok: true },
      ops: [
        {
          kind: 'update',
          documentName: 'Actor',
          uuid: 'Actor.a1',
          label: 'Goblin',
          pre: { name: 'Goblin' },
        },
      ],
    });
    const on = vi.spyOn(g.Hooks, 'on');
    expect(await callOp('updateActor', { name: 'Hob' })).toEqual({ result: { ok: true } });
    expect(on).not.toHaveBeenCalled(); // a sibling harness pays nothing
    expect(liveHooks()).toBe(0);
  });

  it('a write that throws after it wrote answers its error and its ops; one that wrote nothing throws', async () => {
    g.window = { __fvtt: writes() };
    const out = await callOp('deleteActor', { identifiers: ['a1'] }, { record: true });
    expect(out.error).toMatchObject({
      name: 'Error',
      message: 'PageError:x: the second half failed',
    });
    expect(out.error?.stack).toContain('the second half failed');
    expect(out.ops).toHaveLength(1);
    expect(out.ops![0]).toMatchObject({ kind: 'delete', uuid: 'Actor.a1' });
    await expect(callOp('deleteScenes', {}, { record: true })).rejects.toMatchObject({
      name: 'PageError:not-found',
    });
    expect(liveHooks()).toBe(0);
  });

  it('run-script records for itself: its ops are lifted out of its result', async () => {
    g.window = { __fvtt: writes() };
    expect(await callOp('runScript', { src: '' }, { record: false })).toEqual({
      result: { ok: true, log: [] },
      ops: [{ kind: 'create', uuid: 'Actor.s' }],
    });
  });

  it('an unknown name is refused as before', async () => {
    g.window = { __fvtt: writes() };
    await expect(callOp('noSuchOp', {})).rejects.toThrow('Unknown page function: noSuchOp');
  });
});

const op = (kind: ReceiptOp['kind'], uuid: string, extra: Partial<ReceiptOp> = {}): ReceiptOp => ({
  kind,
  documentName: uuid.split('.').at(-2) ?? 'Actor',
  uuid,
  label: '',
  ...extra,
});

describe('effectiveOps — what an undo reverses', () => {
  it('nets a document created and then deleted, with what is embedded in it', () => {
    const ops = [
      op('create', 'Actor.t'),
      op('create', 'Actor.t.Item.i'),
      op('update', 'Actor.t', { pre: { name: 'T' } }),
      op('delete', 'Actor.t', { pre: {} }),
      op('update', 'Actor.keep', { pre: { name: 'K' } }),
    ];
    expect(effectiveOps(ops).map(o => o.uuid)).toEqual(['Actor.keep']);
  });

  it('a created document keeps only its create; one that existed keeps every op', () => {
    const ops = [
      op('create', 'Actor.n'),
      op('update', 'Actor.n', { pre: { name: 'N' } }),
      op('update', 'Actor.n.Item.i', { pre: { name: 'I' } }),
      op('update', 'Actor.old', { pre: { name: 'O' } }),
      op('delete', 'Actor.old', { pre: { name: 'O2' } }),
    ];
    expect(effectiveOps(ops).map(o => `${o.kind} ${o.uuid}`)).toEqual([
      'create Actor.n',
      'update Actor.old',
      'delete Actor.old',
    ]);
  });
});

describe('changedPaths / updatePreImage / undoUpdateData', () => {
  it('walks plain objects and dotted keys; arrays and empty objects are leaves', () => {
    expect(changedPaths({ a: { b: 1, 'c.d': [1] }, e: {}, '-=f': null })).toEqual([
      { path: 'a.b', how: 'set', value: 1 },
      { path: 'a.c.d', how: 'set', value: [1] },
      { path: 'e', how: 'set', value: {} },
      { path: 'f', how: 'delete', value: undefined },
    ]);
  });

  it('merging an empty object writes nothing; _stats is never a path', () => {
    expect(updatePreImage({ flags: { x: 1 } }, { flags: {}, _stats: { modifiedTime: 2 } })).toBe(
      null
    );
  });

  it('without data operators: the legacy keys, -= on the last segment', () => {
    expect(
      undoUpdateData({
        pre: { name: 'Old', 'flags.world.mark': { by: 'x' } },
        absent: ['system.speed'],
      })
    ).toEqual({ name: 'Old', 'flags.world.==mark': { by: 'x' }, 'system.-=speed': null });
  });

  it('with them: an object restored whole (ForcedReplacement), an added path removed', () => {
    g.foundry.data = { operators: OPERATORS };
    const data = undoUpdateData({
      pre: { tags: ['a'], ownership: { default: 2 } },
      absent: ['flags.world.note'],
    });
    expect(data.tags).toEqual(['a']);
    expect(data.ownership).toBeInstanceOf(ForcedReplacement);
    expect((data.ownership as ForcedReplacement).value).toEqual({ default: 2 });
    expect(data['flags.world.note']).toBeInstanceOf(ForcedDeletion);
  });
});

describe('undoOps', () => {
  /** A world of fake documents by uuid; every write is logged, and fires the hooks Foundry would. */
  function world(uuids: string[]) {
    const log: string[] = [];
    const docs = new Map<string, any>();
    const make = (uuid: string): any => ({
      uuid,
      name: uuid,
      parent: null,
      _source: { name: uuid, system: { hp: 3 } },
      toObject: () => ({ _id: uuid.split('.').at(-1), name: uuid }),
      delete: async () => {
        fire(`preDelete${uuid.split('.').at(-2)}`, docs.get(uuid), {}, 'u1');
        docs.delete(uuid);
        log.push(`delete ${uuid}`);
      },
      update: async (data: Record<string, unknown>) => {
        fire(`preUpdate${uuid.split('.').at(-2)}`, docs.get(uuid), data, {}, 'u1');
        log.push(`update ${uuid} ${JSON.stringify(data)}`);
      },
      createEmbeddedDocuments: async (name: string, data: any[], opts: object) => {
        log.push(`create ${name} under ${uuid} ${JSON.stringify(data)} ${JSON.stringify(opts)}`);
        create(name, { uuid: `${uuid}.${name}.${data[0]._id}`, name: '' }, { ...opts });
      },
    });
    for (const uuid of uuids) docs.set(uuid, make(uuid));
    g.fromUuid = async (uuid: string) => docs.get(uuid) ?? null;
    g.CONFIG.Actor.documentClass.create = vi.fn(async (data: any, opts: object) => {
      log.push(`create Actor ${JSON.stringify(data)} ${JSON.stringify(opts)}`);
      create('Actor', { uuid: `Actor.${data._id}`, name: data.name }, { ...opts });
    });
    return { log, docs };
  }

  it('reverses create, update and delete newest first, ids kept, embedded under the parent', async () => {
    const { log } = world(['Actor.n1', 'Actor.a1', 'JournalEntry.j1']);
    const r = await undoOps({
      ops: [
        op('create', 'Actor.n1'),
        op('update', 'Actor.a1', { pre: { name: 'Old' }, absent: ['flags.world.added'] }),
        op('delete', 'JournalEntry.j1.JournalEntryPage.p1', {
          pre: { _id: 'p1', name: 'Clues' },
          parentUuid: 'JournalEntry.j1',
        }),
        op('delete', 'Actor.gone', { pre: { _id: 'gone', name: 'Gone' }, parentUuid: null }),
      ],
    });
    expect(r.failed).toEqual([]);
    expect(r.undone).toBe(4);
    expect(log).toEqual([
      'create Actor {"_id":"gone","name":"Gone"} {"keepId":true}',
      'create JournalEntryPage under JournalEntry.j1 [{"_id":"p1","name":"Clues"}] {"keepId":true}',
      'update Actor.a1 {"name":"Old","flags.world.-=added":null}',
      'delete Actor.n1',
    ]);
    // the undo records its own writes, the documents it re-creates included
    expect(r.ops?.map(o => `${o.kind} ${o.uuid}`)).toEqual([
      'create Actor.gone',
      'create JournalEntry.j1.JournalEntryPage.p1',
      'update Actor.a1',
      'delete Actor.n1',
    ]);
  });

  it('nets what the receipt created and deleted; reports tooLarge and a vanished document', async () => {
    const { log } = world([]);
    const r = await undoOps({
      ops: [
        op('create', 'Actor.t'),
        op('delete', 'Actor.t', { pre: {} }),
        op('delete', 'Scene.big', { tooLarge: true }),
        op('update', 'Actor.vanished', { pre: { name: 'V' } }),
      ],
    });
    expect(log).toEqual([]);
    expect(r.undone).toBe(0);
    expect(r.failed).toEqual([
      { op: 'update Actor', uuid: 'Actor.vanished', error: 'the document no longer exists' },
      {
        op: 'delete Scene',
        uuid: 'Scene.big',
        error: 'not undoable: its pre-image was over the cap and not kept',
      },
    ]);
  });

  it('answers its own writes, so an undo can be undone, and holds the lock while it runs', async () => {
    const { log } = world(['Actor.n1', 'Actor.a1']);
    const undo = undoOps({
      ops: [op('create', 'Actor.n1'), op('update', 'Actor.a1', { pre: { 'system.hp': 7 } })],
    });
    // a write queued behind the undo sees every one of its writes done
    const seen = await withWriteLock(async () => [...log]);
    const r = await undo;
    expect(seen).toEqual(log);
    expect(log).toHaveLength(2);
    expect(r.ops).toEqual([
      // the restore of a1: its hp goes back from 3; hp 3 is the redo's pre-image
      {
        kind: 'update',
        documentName: 'Actor',
        uuid: 'Actor.a1',
        label: 'Actor.a1',
        pre: { 'system.hp': 3 },
      },
      // the delete of what the receipt created: whole, so the redo re-creates it with its id
      {
        kind: 'delete',
        documentName: 'Actor',
        uuid: 'Actor.n1',
        label: 'Actor.n1',
        parentUuid: null,
        pre: { _id: 'n1', name: 'Actor.n1' },
      },
    ]);
  });
});
