/**
 * Unit tests for the clue ops (src/page/clues.ts): the party and the Clue resolve before anything is
 * written, a Clue already on the record is reported and not collected twice, `stamp: false` reaches
 * the module and is refused by a Clue Board too old to read it, and nothing runs without the module.
 *
 * `game` and `foundry` are page globals; these tests stand up the world and a stub of the module's API.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { collectClues, listClues, uncollectClues } from './clues.js';

const CLUE = 'fvtt-mod-clueboard.clue';

function stubWorld({ version = '1.2.0', active = true, parties = ['Party'] } = {}) {
  const groups = parties.map((name, i) => ({ id: `g${i}`, name, type: 'group' }));
  const items = [
    { id: 'c1', name: 'Bloodaxe Signet Ring', type: CLUE, system: { kind: 'object' } },
    { id: 'c2', name: "Songkeeper's Tuning-Pipe", type: CLUE, system: { kind: 'object' } },
    { id: 'w1', name: 'Bloodaxe Signet Ring', type: 'equipment', system: {} },
  ];
  const records = new Map<string, Map<string, any>>(groups.map(g => [g.id, new Map()]));
  const calls: any[] = [];
  const api = {
    parties: () => groups,
    entries: (g: any) => [...records.get(g.id)!.values()],
    entry: (g: any, id: string) => records.get(g.id)!.get(id) ?? null,
    collect: async (item: any, g: any, opts: any) => {
      calls.push({ op: 'collect', id: item.id, party: g.id, opts });
      const e = {
        id: item.id,
        kind: item.system.kind,
        snapshot: { name: item.name, revision: 1 },
        foundIn: {},
        readers: {},
      };
      records.get(g.id)!.set(item.id, e);
      return e;
    },
    uncollect: async (g: any, id: string, opts: any) => {
      calls.push({ op: 'uncollect', id, party: g.id, opts });
      return records.get(g.id)!.delete(id);
    },
  };
  (globalThis as any).game = {
    modules: {
      get: (id: string) => (id === 'fvtt-mod-clueboard' ? { active, api, version } : undefined),
    },
    actors: { party: groups[0] },
    items: {
      contents: items,
      get: (id: string) => items.find(i => i.id === id),
      getName: (n: string) => items.find(i => i.name === n),
    },
  };
  (globalThis as any).foundry = {
    utils: {
      isNewerVersion: (a: string, b: string) =>
        a.localeCompare(b, undefined, { numeric: true }) > 0,
    },
  };
  return { calls, records };
}

afterEach(() => {
  delete (globalThis as any).game;
  delete (globalThis as any).foundry;
});

describe('collectClues', () => {
  it('collects by name on the primary party, skipping the same-named non-Clue item', async () => {
    const { calls } = stubWorld();
    const r = await collectClues({ clues: ['Bloodaxe Signet Ring'] });
    expect(calls).toEqual([
      { op: 'collect', id: 'c1', party: 'g0', opts: { how: 'mcp', stamp: true } },
    ]);
    expect(r.collected.map(e => e.id)).toEqual(['c1']);
    expect(r.entries).toBe(1);
  });

  it('reports a Clue already on the record and passes stamp: false through', async () => {
    const { calls } = stubWorld();
    await collectClues({ clues: ['c1'] });
    const r = await collectClues({ clues: ['c1', 'c2'], stamp: false });
    expect(r.already).toEqual(['Bloodaxe Signet Ring']);
    expect(calls.at(-1)).toEqual({
      op: 'collect',
      id: 'c2',
      party: 'g0',
      opts: { how: 'mcp', stamp: false },
    });
  });

  it('resolves every name before writing anything', async () => {
    const { calls } = stubWorld();
    await expect(collectClues({ clues: ['c1', 'No Such Clue'] })).rejects.toThrow(/No world Clue/);
    expect(calls).toEqual([]);
  });

  it('refuses stamp: false on a Clue Board before 1.2.0', async () => {
    stubWorld({ version: '1.1.0' });
    await expect(collectClues({ clues: ['c1'], stamp: false })).rejects.toThrow(/1\.2\.0 or later/);
  });

  it('refuses without the module', async () => {
    stubWorld({ active: false });
    await expect(collectClues({ clues: ['c1'] })).rejects.toThrow(/not active/);
  });
});

describe('listClues and uncollectClues', () => {
  it('lists the record and the uncollected world Clues', async () => {
    stubWorld();
    await collectClues({ clues: ['c1'] });
    const r = await listClues({});
    expect(r.entries.map(e => e.id)).toEqual(['c1']);
    expect(r.uncollected.map(c => c.id)).toEqual(['c2']);
  });

  it('takes a Clue off without asking, and reports one not on the record', async () => {
    const { calls } = stubWorld();
    await collectClues({ clues: ['c1'] });
    const r = await uncollectClues({ clues: ['c1', 'c2'] });
    expect(r.removed).toEqual(['Bloodaxe Signet Ring']);
    expect(r.notOnRecord).toEqual(["Songkeeper's Tuning-Pipe"]);
    expect(calls.at(-1)).toEqual({
      op: 'uncollect',
      id: 'c1',
      party: 'g0',
      opts: { confirm: false },
    });
  });

  it('names the parties when a named one is missing', async () => {
    stubWorld({ parties: ['Party', 'Other'] });
    await expect(listClues({ party: 'Nobody' })).rejects.toThrow(/Parties: Party, Other/);
  });
});
