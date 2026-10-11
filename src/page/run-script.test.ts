/**
 * run-script's page half, offline: the shadow list, and a run against a stubbed page API with
 * stubbed hooks — the facade counts, the dry run stubs, the run's writes come back as `ops` (the
 * page keeps no receipts), the cap refuses, the shadowed globals read undefined, and a run abandoned
 * at its timeout can write no more. What counts as a write is the op table's (./_ops.test.ts); the
 * recorder and the undo are ./_receipts.test.ts's. The shadowing is an accident guard, not a
 * boundary (issue #15): the join user's role is.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { undoOps, withWriteLock } from './_receipts.js';
import { runScript, SHADOWED } from './run-script.js';

describe('the shadow list', () => {
  it('shadows the globals a script would reach for by habit', () => {
    for (const name of [
      'game',
      'canvas',
      'window',
      'document',
      'fetch',
      'Function',
      'fromUuid',
      'Hooks',
      'CONFIG',
    ]) {
      expect(SHADOWED).toContain(name);
    }
  });
});

describe('runScript against a stubbed page', () => {
  const hooks = new Map<string, Array<(...a: unknown[]) => void>>();
  let seq = 0;
  const calls: Array<[string, unknown]> = [];
  const fire = (hook: string, ...args: unknown[]) => {
    for (const fn of hooks.get(hook) ?? []) fn(...args);
  };

  beforeEach(() => {
    hooks.clear();
    calls.length = 0;
    seq = 0;
    const g = globalThis as any;
    g.CONFIG = {
      Actor: { documentClass: function Actor() {} },
      Item: { documentClass: function Item() {} },
    };
    g.game = { user: { id: 'u1' } };
    g.foundry = { utils: { deepClone: (v: unknown) => structuredClone(v) } };
    g.Hooks = {
      on: (hook: string, fn: (...a: unknown[]) => void) => {
        hooks.set(hook, [...(hooks.get(hook) ?? []), fn]);
        return ++seq;
      },
      off: (hook: string, _id: number) => {
        hooks.set(hook, []);
      },
    };
    g.window = {
      __fvtt: {
        listActors: async (a: unknown) => {
          calls.push(['listActors', a]);
          return [{ id: 'a1', name: 'Goblin' }];
        },
        createActorFromCompendium: async (a: unknown) => {
          calls.push(['createActorFromCompendium', a]);
          fire('createActor', { uuid: `Actor.${calls.length}`, name: 'Goblin' }, {}, 'u1');
          return { id: `a${calls.length}` };
        },
        updateActor: async (a: unknown) => {
          calls.push(['updateActor', a]);
          fire(
            'preUpdateActor',
            { uuid: 'Actor.a1', name: 'Goblin', _source: { name: 'Goblin', hp: 7 } },
            { hp: 1 },
            {},
            'u1'
          );
          return { ok: true };
        },
        deleteActor: async (a: unknown) => {
          calls.push(['deleteActor', a]);
          return { ok: true };
        },
        runScript: async () => {},
        undoOps: async () => {},
      },
    };
  });
  afterEach(() => {
    const g = globalThis as any;
    for (const k of ['CONFIG', 'game', 'foundry', 'Hooks', 'window', 'fromUuid', '__sink']) {
      delete g[k];
    }
  });

  it('runs the body with fvtt and log, returns the value, and hands back its writes', async () => {
    const r = await runScript({
      src: `const actors = await fvtt.listActors({}); log("found", actors.length);
        const made = await fvtt.createActorFromCompendium({ name: actors[0].name });
        await fvtt.updateActor({ id: made.id, hp: 1 });
        return { made: made.id };`,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ made: 'a2' });
    expect(r.log).toEqual(['found 1']);
    expect(r.receipt).toEqual({ created: 1, updated: 1, deleted: 0, calls: 3, writes: 2 });
    expect(r.ops).toEqual([
      { kind: 'create', documentName: 'Actor', uuid: 'Actor.2', label: 'Goblin' },
      { kind: 'update', documentName: 'Actor', uuid: 'Actor.a1', label: 'Goblin', pre: { hp: 7 } },
    ]);
    expect(hooks.get('createActor')).toEqual([]); // the hooks are off after the run
    // the page keeps nothing: the ops are the run's, the receipt is the bridge's (src/receipts.ts)
    expect((globalThis as any).__fvttReceipts).toBeUndefined();
  });

  it('a dry run stubs the writes and lists them; reads still run; no ops', async () => {
    const r = await runScript({
      src: `const a = await fvtt.listActors({}); const m = await fvtt.createActorFromCompendium({ n: 6 }); return m;`,
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ dryRun: true });
    expect(r.dryRun).toEqual([{ fn: 'createActorFromCompendium', args: { n: 6 } }]);
    expect(calls.map(c => c[0])).toEqual(['listActors']);
    expect(r.ops).toBeUndefined();
    expect(hooks.size).toBe(0); // a dry run records nothing
  });

  it('a dry run stubs by the op table: a remap is a write, a list action reads', async () => {
    const g = globalThis as any;
    g.window.__fvtt.remapSceneTeleporters = async (a: unknown) => {
      calls.push(['remapSceneTeleporters', a]);
      return { success: true, rewritten: 3 };
    };
    g.window.__fvtt.configureAreaSounds = async (a: unknown) => {
      calls.push(['configureAreaSounds', a]);
      return { action: 'list', sets: [] };
    };
    const r = await runScript({
      src: `const remap = await fvtt.remapSceneTeleporters({ sourceModule: "x" });
        const sets = await fvtt.configureAreaSounds({ action: "list" });
        await fvtt.configureAreaSounds({ action: "remove", setIdentifier: "all" });
        return { remap, sets };`,
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ remap: { dryRun: true }, sets: { action: 'list', sets: [] } });
    expect(r.dryRun?.map(d => d.fn)).toEqual(['remapSceneTeleporters', 'configureAreaSounds']);
    expect(calls).toEqual([['configureAreaSounds', { action: 'list' }]]);
  });

  it('the delete cap counts a delete action, not only a delete op', async () => {
    const g = globalThis as any;
    g.window.__fvtt.manageEffect = async (a: unknown) => {
      calls.push(['manageEffect', a]);
      return { success: true };
    };
    const r = await runScript({
      src: `await fvtt.manageEffect({ action: "list", actorIdentifier: "a" });
        await fvtt.manageEffect({ action: "delete", actorIdentifier: "a", effectId: "e1" });
        await fvtt.manageEffect({ action: "delete", actorIdentifier: "a", effectId: "e2" });
        return 1;`,
      maxDeletes: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('delete cap (1)');
    expect(r.receipt).toMatchObject({ calls: 3, writes: 1 });
    expect(calls).toHaveLength(2);
  });

  it("the write cap refuses the write past it, and the error is the script's", async () => {
    const r = await runScript({
      src: `for (let i = 0; i < 5; i++) await fvtt.createActorFromCompendium({ i }); return "unreachable";`,
      maxWrites: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('write cap (3)');
    expect(calls.filter(c => c[0] === 'createActorFromCompendium')).toHaveLength(3);
    // a failed run keeps its writes: the three creates made before the cap are its ops
    expect(r.ops?.map(o => o.kind)).toEqual(['create', 'create', 'create']);
  });

  it('a shadowed global reads undefined, and a script that throws reports its error', async () => {
    const r = await runScript({
      src: `return typeof game + " " + typeof window + " " + typeof fetch;`,
    });
    expect(r.result).toBe('undefined undefined undefined');
    const t = await runScript({ src: `game.actors.size;` });
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/TypeError/);
  });

  it('a timeout abandons the run and says so', async () => {
    const r = await runScript({ src: `await new Promise(() => {});`, timeoutMs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  }, 10_000);

  it('a run abandoned at its timeout can write no more: the facade refuses, nothing is recorded', async () => {
    // the body sleeps past the timeout, then reaches for a write; `__sink` is a plain global the
    // script reports through (it is not shadowed)
    (globalThis as any).__sink = [];
    const r = await runScript({
      src: `await new Promise(res => setTimeout(res, 1300));
        try { await fvtt.createActorFromCompendium({ late: true }); __sink.push("written"); }
        catch (e) { __sink.push(e.name + ": " + e.message); }`,
      timeoutMs: 1_000,
    });
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain('the script can make no more');
    await new Promise(res => setTimeout(res, 600));
    expect((globalThis as any).__sink).toEqual([
      'PageError:invalid: the run was abandoned at its timeout',
    ]);
    expect(calls.filter(c => c[0] === 'createActorFromCompendium')).toEqual([]);
    expect(r.ops).toEqual([]);
  }, 10_000);

  it('a real run holds the write lock until it settles; a dry run does not take it', async () => {
    const src = `await new Promise(res => setTimeout(res, 50)); await fvtt.listActors({}); return 1;`;
    // a write queued behind a real run sees the run's last call made
    const run = runScript({ src });
    expect(await withWriteLock(async () => calls.map(c => c[0]))).toEqual(['listActors']);
    await run;

    calls.length = 0;
    const dry = runScript({ src, dryRun: true });
    expect(await withWriteLock(async () => calls.map(c => c[0]))).toEqual([]);
    await dry;
    expect(calls.map(c => c[0])).toEqual(['listActors']);
  });

  it('a script that does not parse is refused as invalid', async () => {
    await expect(runScript({ src: `return (;` })).rejects.toThrow(/does not parse/);
  });

  it("the run's ops are what undoOps reverses, newest first", async () => {
    const g = globalThis as any;
    const touched: string[] = [];
    g.fromUuid = async (uuid: string) => ({
      uuid,
      delete: async () => {
        touched.push(`delete ${uuid}`);
      },
      update: async (d: unknown) => {
        touched.push(`update ${uuid} ${JSON.stringify(d)}`);
      },
    });
    const run = await runScript({
      src: `const m = await fvtt.createActorFromCompendium({}); await fvtt.updateActor({ id: m.id, hp: 1 }); return 1;`,
    });
    const u = await undoOps({ ops: run.ops ?? [] });
    expect(u.undone).toBe(2);
    expect(u.failed).toEqual([]);
    expect(touched).toEqual(['update Actor.a1 {"hp":7}', 'delete Actor.1']);
  });
});
