/**
 * run-script's page half, offline: the write classification (what is counted, capped and stubbed),
 * the shadow list, and a run against a stubbed page API with stubbed hooks — the facade counts,
 * the dry run stubs, the receipt records, the cap refuses, the globals are out of reach.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDeleteCall, isWriteCall, runScript, SHADOWED, undoScript } from './run-script.js';

describe('the write classification', () => {
  it('reads pass, writes count, deletes count twice', () => {
    expect(isWriteCall('listActors', {})).toBe(false);
    expect(isWriteCall('searchCompendium', {})).toBe(false);
    expect(isWriteCall('createActorFromCompendium', {})).toBe(true);
    expect(isWriteCall('placeSceneTokens', {})).toBe(true);
    expect(isDeleteCall('deleteActor', {})).toBe(true);
    expect(isDeleteCall('removeActorItems', {})).toBe(true);
    expect(isDeleteCall('createScene', {})).toBe(false);
  });
  it('manage* is a write unless its action reads', () => {
    expect(isWriteCall('manageEffect', { action: 'list' })).toBe(false);
    expect(isWriteCall('manageEffect', { action: 'create' })).toBe(true);
    expect(isDeleteCall('manageEffect', { action: 'delete' })).toBe(true);
    expect(isDeleteCall('manageEffect', { action: 'update' })).toBe(false);
  });
  it('shadows the doors out of the facade', () => {
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
    g.foundry = {
      utils: {
        filterObject: (src: any, tpl: any) =>
          Object.fromEntries(Object.keys(tpl).map(k => [k, src[k]])),
      },
    };
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
          fire('createActor', { uuid: `Actor.${calls.length}` }, {}, 'u1');
          return { id: `a${calls.length}` };
        },
        updateActor: async (a: unknown) => {
          calls.push(['updateActor', a]);
          fire(
            'preUpdateActor',
            { uuid: 'Actor.a1', toObject: () => ({ name: 'Goblin', hp: 7 }) },
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
      },
    };
  });
  afterEach(() => {
    const g = globalThis as any;
    for (const k of ['CONFIG', 'game', 'foundry', 'Hooks', 'window']) delete g[k];
  });

  it('runs the body with fvtt and log, returns the value, and records the receipt', async () => {
    const r = await runScript({
      src: `const actors = await fvtt.listActors({}); log("found", actors.length);
        const made = await fvtt.createActorFromCompendium({ name: actors[0].name });
        await fvtt.updateActor({ id: made.id, hp: 1 });
        return { made: made.id };`,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ made: 'a2' });
    expect(r.log).toEqual(['found 1']);
    expect(r.receipt).toMatchObject({ created: 1, updated: 1, deleted: 0, calls: 3, writes: 2 });
    expect(r.receipt.id).toMatch(/^rcpt_/);
    expect(hooks.get('createActor')).toEqual([]); // the hooks are off after the run
  });

  it('a dry run stubs the writes and lists them; reads still run', async () => {
    const r = await runScript({
      src: `const a = await fvtt.listActors({}); const m = await fvtt.createActorFromCompendium({ n: 6 }); return m;`,
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ dryRun: true });
    expect(r.dryRun).toEqual([{ fn: 'createActorFromCompendium', args: { n: 6 } }]);
    expect(calls.map(c => c[0])).toEqual(['listActors']);
    expect(r.receipt.id).toBe('');
  });

  it("the write cap refuses the write past it, and the error is the script's", async () => {
    const r = await runScript({
      src: `for (let i = 0; i < 5; i++) await fvtt.createActorFromCompendium({ i }); return "unreachable";`,
      maxWrites: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('write cap (3)');
    expect(calls.filter(c => c[0] === 'createActorFromCompendium')).toHaveLength(3);
  });

  it('the globals are out of reach, and a script that throws reports its error', async () => {
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

  it('a script that does not parse is refused as invalid', async () => {
    await expect(runScript({ src: `return (;` })).rejects.toThrow(/does not parse/);
  });

  it('undo reverses the receipt newest first, and an unknown receipt is not-found', async () => {
    const g = globalThis as any;
    const deleted: string[] = [];
    const updated: Array<[string, unknown]> = [];
    g.fromUuid = async (uuid: string) => ({
      uuid,
      delete: async () => {
        deleted.push(uuid);
      },
      update: async (d: unknown) => {
        updated.push([uuid, d]);
      },
    });
    const run = await runScript({
      src: `const m = await fvtt.createActorFromCompendium({}); await fvtt.updateActor({ id: m.id, hp: 1 }); return 1;`,
    });
    const u = await undoScript({ id: run.receipt.id });
    expect(u.undone).toBe(2);
    expect(updated).toEqual([['Actor.a1', { hp: 7 }]]); // the pre-image, restored first (newest op)
    expect(deleted).toEqual(['Actor.1']);
    await expect(undoScript({ id: run.receipt.id })).rejects.toThrow(/not in this page/);
    delete g.fromUuid;
  });

  it('a document created and then deleted in one run nets out of the undo', async () => {
    const g = globalThis as any;
    const touched: string[] = [];
    g.fromUuid = async (uuid: string) => ({
      uuid,
      delete: async () => {
        touched.push(`delete ${uuid}`);
      },
      update: async () => {
        touched.push(`update ${uuid}`);
      },
    });
    g.window.__fvtt.deleteActor = async (a: any) => {
      calls.push(['deleteActor', a]);
      fire(
        'preDeleteActor',
        { uuid: a.uuid, toObject: () => ({ name: 'gone' }), parent: null },
        {},
        'u1'
      );
      return { ok: true };
    };
    const run = await runScript({
      src: `const m = await fvtt.createActorFromCompendium({}); await fvtt.deleteActor({ uuid: "Actor.1" }); return m;`,
    });
    expect(run.receipt).toMatchObject({ created: 1, deleted: 1 });
    const u = await undoScript({ id: run.receipt.id });
    expect(u.undone).toBe(0);
    expect(touched).toEqual([]);
    delete g.fromUuid;
  });
});
