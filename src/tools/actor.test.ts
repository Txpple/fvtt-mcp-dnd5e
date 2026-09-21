/**
 * Unit tests for ActorTools — manage-actors (the M8 union: action list / get / update / delete;
 * the update and delete members' bodies are tested with their own modules, update-actor.test.ts
 * and actor-creation.test.ts) and the reads that stay their own (get-actor-entity, export-actor,
 * search-actor-contents). World-Item CRUD + add/remove-from-actor live in ItemTools — see
 * items.test.ts.
 *
 * These exercise the two things each handler owns before/after the bridge call:
 *   1. zod input validation — required fields, .min(1) non-empty strings (bad input throws and
 *      never reaches the bridge).
 *   2. forwarding + response shaping — the bridge method name + payload the handler sends, and the
 *      object it builds from the bridge result.
 *
 * get-actor's basicInfo/stats come from the single dnd5e extractor
 * (tools/dnd5e/actor-stats.ts) — there is no system registry/adapter. To keep
 * call-index assertions robust we use a method-keyed mock response and locate
 * bridge calls by method name rather than by position.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActorTools, MANAGE_ACTORS } from './actor.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

/**
 * Build an ActorTools with a method-keyed mock bridge.
 *
 * `responses` maps a bridge method name to the value its call resolves to
 * (keys are the bare op name, e.g. 'getCharacterInfo').
 */
function build(responses: Record<string, any> = {}) {
  const { foundry, calls } = makeFoundry((method: string) => responses[method]);
  const tools = new ActorTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handleManageActors(args);
  return { tools, calls, foundry, run };
}

/** Find the [method, data] pair for a given bare bridge op name. */
function callFor(calls: Array<[string, any]>, bareMethod: string) {
  return calls.find(([m]) => m === bareMethod);
}

describe('ActorTools.getToolDefinitions', () => {
  it('exposes exactly the actor-read tool names', () => {
    const { tools } = build();
    const names = tools
      .getToolDefinitions()
      .map(t => t.name)
      .sort();
    expect(names).toEqual([MANAGE_ACTORS, 'search-actor-contents']);
  });

  it('manage-actors: the action enum, the shared actorIdentifier leaf, closed members', () => {
    const def = build()
      .tools.getToolDefinitions()
      .find(t => t.name === MANAGE_ACTORS)!;
    const schema = def.inputSchema as any;
    expect(schema.properties.action.enum).toEqual([
      'list',
      'get',
      'get-entity',
      'export',
      'update',
      'delete',
    ]);
    expect(schema.properties.actorIdentifier.description).toContain('Actor');
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    expect(byAction.get.properties.actorIdentifier).toEqual({ type: 'string' });
    expect(byAction.get.required).toEqual(['action', 'actorIdentifier']);
    expect(byAction.update.properties.actorIdentifier).toEqual({ type: 'string' });
    expect(byAction['get-entity'].required).toEqual([
      'action',
      'actorIdentifier',
      'entityIdentifier',
    ]);
    expect(byAction.export.required).toEqual(['action', 'actorIdentifier', 'localPath']);
    // delete takes the STRICT array, its own leaf
    expect(byAction.delete.required).toEqual(['action', 'identifiers']);
    expect(byAction.delete.properties.identifiers.items.description).toContain('exact');
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'create', actorIdentifier: 'x' })).rejects.toThrow(
      'manage-actors: action must be one of "list", "get", "get-entity", "export", "update", "delete" (got "create").'
    );
    await expect(run({ action: 'get', identifier: 'x' })).rejects.toThrow(
      'manage-actors (action "get"): unknown argument "identifier" — it takes: action, actorIdentifier.'
    );
  });

  it('every definition has an object inputSchema', () => {
    const { tools } = build();
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('definitions with required fields expose a required array', () => {
    const { tools } = build();
    const byName = Object.fromEntries(tools.getToolDefinitions().map(d => [d.name, d]));
    expect(byName['search-actor-contents'].inputSchema.required).toEqual(['characterIdentifier']);
  });
});

// --- export-actor tmp-file plumbing (same pattern as chat.test.ts) ---------
const tmpFiles: string[] = [];
function tmpFile(name: string): string {
  const p = join(tmpdir(), `mcp-actor-test-${name}`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map(p => rm(p, { force: true })));
});

/** A minimal exportActorData bridge response (full-doc `data` + summary fields). */
function exportResponse(overrides: Record<string, any> = {}) {
  return {
    id: 'abc123',
    name: 'Gren',
    type: 'character',
    itemCount: 2,
    effectCount: 1,
    data: {
      _id: 'abc123',
      name: 'Gren',
      type: 'character',
      system: { attributes: { hp: { value: 21, max: 27 } } },
      items: [
        { _id: 'i1', name: 'Wand of Magic Missiles', system: { uses: { value: 4, max: 7 } } },
        { _id: 'i2', name: 'Dagger', system: {} },
      ],
      effects: [{ _id: 'e1', name: 'Bless' }],
      ownership: { default: 0, u1: 3 },
      flags: {
        exportSource: {
          world: 'greenrest',
          system: 'dnd5e',
          coreVersion: '14',
          systemVersion: '5.3.3',
        },
      },
    },
    ...overrides,
  };
}

describe('manage-actors export', () => {
  it('rejects missing localPath and empty identifier (zod)', async () => {
    const { run } = build();
    await expect(run({ action: 'export', actorIdentifier: 'Gren' })).rejects.toThrow();
    await expect(
      run({ action: 'export', actorIdentifier: '', localPath: 'C:\\x.json' })
    ).rejects.toThrow();
  });

  it('refuses a relative localPath before calling the bridge', async () => {
    const { calls, run } = build();
    await expect(
      run({ action: 'export', actorIdentifier: 'Gren', localPath: 'party/gren.json' })
    ).rejects.toThrow(/^Refused: localPath must be an absolute path/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to overwrite an existing file unless overwrite:true', async () => {
    const path = tmpFile('exists.json');
    await writeFile(path, 'sentinel');
    const { calls, run } = build({ exportActorData: exportResponse() });

    await expect(
      run({ action: 'export', actorIdentifier: 'Gren', localPath: path })
    ).rejects.toThrow(/already exists/);
    expect(calls).toHaveLength(0);
    expect(await readFile(path, 'utf8')).toBe('sentinel');

    const replaced = await run({
      action: 'export',
      actorIdentifier: 'Gren',
      localPath: path,
      overwrite: true,
    });
    expect(replaced).toMatch(/^Exported "Gren"/);
    expect(JSON.parse(await readFile(path, 'utf8'))._id).toBe('abc123');
  });

  it('writes the FULL document JSON and summarizes name/type/counts', async () => {
    const path = tmpFile('gren.json');
    const { calls, run } = build({ exportActorData: exportResponse() });

    const res = await run({ action: 'export', actorIdentifier: 'Gren', localPath: path });

    const call = callFor(calls, 'exportActorData');
    expect(call?.[1]).toEqual({ identifier: 'Gren' });

    expect(res).toContain('Exported "Gren" (character, 2 items, 1 effects)');
    expect(res).toContain(path);

    // The file is the untouched full document — uses/charges and ownership survive.
    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.items[0].system.uses).toEqual({ value: 4, max: 7 });
    expect(written.ownership).toEqual({ default: 0, u1: 3 });
    expect(written.flags.exportSource.system).toBe('dnd5e');
  });
});

describe('manage-actors get', () => {
  it('forwards characterName and shapes the formatted response', async () => {
    const { calls, run } = build({
      getCharacterInfo: {
        id: 'actor1',
        name: 'Aria',
        type: 'character',
        img: 'tokens/aria.png',
        system: {
          attributes: { hp: { value: 18, max: 22, temp: 0 }, ac: { value: 15 } },
          details: { level: { value: 3 }, class: 'Wizard', race: 'Elf' },
          abilities: { int: { value: 16, mod: 3 } },
          skills: { arc: { value: 1, ability: 'int' } },
        },
        // saves are attached TOP-LEVEL by getCharacterInfo (page-side extractSaves), not under system
        saves: { str: { value: 0, proficient: 0 }, int: { value: 5, proficient: 1 } },
        items: [
          {
            id: 'i1',
            name: 'Dagger',
            type: 'weapon',
            system: { equipped: true },
            // page payload now carries item flags for get-actor-entity; the toEqual below
            // proves get-actor's minimal projection still drops them (token budget).
            flags: { 'item-piles': { item: {} } },
          },
        ],
        effects: [
          {
            id: 'e1',
            name: 'Mage Armor',
            disabled: false,
            duration: { value: 10, units: 'rounds', remaining: 60 },
            icon: 'x.png',
          },
        ],
        actions: [{ name: 'Firebolt', type: 'spell', itemId: 'i1' }],
        spellcasting: [{ name: 'Wizard Spells', type: 'prepared', ability: 'int' }],
      },
    });

    const out = await run({ action: 'get', actorIdentifier: 'Aria' });

    const c = callFor(calls, 'getCharacterInfo');
    expect(c).toBeTruthy();
    expect(c![1]).toEqual({ characterName: 'Aria' });

    expect(out.id).toBe('actor1');
    expect(out.name).toBe('Aria');
    expect(out.type).toBe('character');
    expect(out.hasImage).toBe(true);
    // basicInfo (extractActorBasicInfo)
    expect(out.basicInfo.hitPoints).toEqual({ current: 18, max: 22, temp: 0 });
    expect(out.basicInfo.armorClass).toBe(15);
    expect(out.basicInfo.level).toBe(3);
    expect(out.basicInfo.class).toBe('Wizard');
    expect(out.basicInfo.race).toBe('Elf');
    // stats (extractActorStats) — the single dnd5e get-actor stats path
    expect(out.stats.name).toBe('Aria');
    expect(out.stats.type).toBe('character');
    expect(out.stats.level).toBe(3);
    expect(out.stats.hitPoints).toEqual({ current: 18, max: 22, temp: 0 });
    expect(out.stats.armorClass).toBe(15);
    expect(out.stats.abilities.int).toEqual({ value: 16, modifier: 3 });
    expect(out.stats.skills.arc).toEqual({ value: 1, modifier: 0, proficient: 1 });
    // saves: derived totals attached top-level page-side (extractSaves) and passed through
    expect(out.stats.saves).toEqual({
      str: { value: 0, proficient: 0 },
      int: { value: 5, proficient: 1 },
    });
    // items / effects / actions / spellcasting
    expect(out.items).toEqual([{ id: 'i1', name: 'Dagger', type: 'weapon', equipped: true }]);
    expect(out.effects).toEqual([
      {
        id: 'e1',
        name: 'Mage Armor',
        disabled: false,
        duration: { value: 10, units: 'rounds', remaining: 60 },
        hasIcon: true,
      },
    ]);
    expect(out.actions).toEqual([{ name: 'Firebolt', type: 'spell', itemId: 'i1' }]);
    expect(out.spellcasting).toEqual([{ name: 'Wizard Spells', type: 'prepared', ability: 'int' }]);
  });

  it("surfaces a weapon's 2024 mastery property and the actor's mastery kinds", async () => {
    const { run } = build({
      getCharacterInfo: {
        id: 'a9',
        name: 'Morgash',
        type: 'character',
        system: {
          traits: { weaponProf: { mastery: { value: ['greatsword'], bonus: [] } } },
        },
        items: [
          {
            id: 'w1',
            name: 'Greatsword',
            type: 'weapon',
            system: { equipped: true, mastery: 'graze' },
          },
          // an empty mastery string (non-weapon or 2014 item) stays off the payload
          { id: 'w2', name: 'Torch', type: 'consumable', system: { equipped: false, mastery: '' } },
        ],
        effects: [],
      },
    });
    const out = await run({ action: 'get', actorIdentifier: 'Morgash' });
    expect(out.stats.weaponMasteries).toEqual(['greatsword']);
    expect(out.items[0].mastery).toBe('graze');
    expect(out.items[1].mastery).toBeUndefined();
  });

  it('collapses an embedded race item to its name and omits empty actions/spellcasting', async () => {
    const { run } = build({
      getCharacterInfo: {
        id: 'a2',
        name: 'Bran',
        type: 'character',
        system: { details: { race: { name: 'Dwarf', _id: 'r1' } } },
        items: [],
        effects: [],
        actions: [],
        spellcasting: [],
      },
    });

    const out = await run({ action: 'get', actorIdentifier: 'Bran' });
    expect(out.basicInfo.race).toBe('Dwarf');
    expect(out.hasImage).toBe(false);
    expect(out.actions).toBeUndefined();
    expect(out.spellcasting).toBeUndefined();
  });

  it('lets a bridge failure bubble to the central mapper (no in-tool re-wrap)', async () => {
    const { foundry, calls } = makeFoundry((method: string) => {
      if (method === 'getWorldInfo') return { system: 'dnd5e' };
      throw new Error('boom');
    });
    void calls;
    const tools = new ActorTools({ foundry, logger: makeLogger() });
    await expect(
      tools.handleManageActors({ action: 'get', actorIdentifier: 'Ghost' })
    ).rejects.toThrow(/boom/);
  });

  it('rejects an empty identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'get', actorIdentifier: '' })).rejects.toThrow();
  });

  it('rejects missing args', async () => {
    const { run } = build();
    await expect(run({ action: 'get' })).rejects.toThrow();
    await expect(run(undefined)).rejects.toThrow();
  });
});

describe('manage-actors get-entity', () => {
  const charWith = (extra: any) => ({
    getCharacterInfo: {
      id: 'c1',
      name: 'Aria',
      items: [],
      actions: [],
      effects: [],
      ...extra,
    },
  });

  it('resolves an item entity by name and returns full item shape', async () => {
    const { calls, run } = build(
      charWith({
        items: [
          {
            id: 'it1',
            name: 'Flaming Sword',
            type: 'weapon',
            img: 'sword.png',
            system: {
              description: { value: 'A burning blade' },
              quantity: 2,
              equipped: true,
              attunement: 1,
            },
          },
        ],
      })
    );

    const out = await run({
      action: 'get-entity',
      actorIdentifier: 'Aria',
      entityIdentifier: 'flaming sword',
    });

    expect(callFor(calls, 'getCharacterInfo')![1]).toEqual({ characterName: 'Aria' });
    expect(out.entityType).toBe('item');
    expect(out.id).toBe('it1');
    expect(out.name).toBe('Flaming Sword');
    expect(out.type).toBe('weapon');
    expect(out.description).toBe('A burning blade');
    expect(out.quantity).toBe(2);
    expect(out.equipped).toBe(true);
    expect(out.attunement).toBe(1);
    expect(out.hasImage).toBe(true);
    expect(out.system).toBeTruthy();
    expect(out.flags).toBeUndefined(); // no flags on the item → key stays off the payload
  });

  it('surfaces item module flags (the flag-forensics read path) when the page reports them', async () => {
    const { run } = build(
      charWith({
        items: [
          {
            id: 'it2',
            name: 'Old Greatsword',
            type: 'weapon',
            system: { equipped: false },
            // the item-piles transfer residue shape from the NaN-attunement forensic
            flags: { 'item-piles': { item: { '-=overheadCost': null } } },
          },
        ],
      })
    );

    const out = await run({
      action: 'get-entity',
      actorIdentifier: 'Aria',
      entityIdentifier: 'Old Greatsword',
    });

    expect(out.entityType).toBe('item');
    expect(out.flags).toEqual({ 'item-piles': { item: { '-=overheadCost': null } } });
  });

  it('resolves an action entity by name', async () => {
    const { run } = build(
      charWith({
        actions: [{ name: 'Power Attack', type: 'action', itemId: 'x' }],
      })
    );
    const out = await run({
      action: 'get-entity',
      actorIdentifier: 'Aria',
      entityIdentifier: 'Power Attack',
    });
    expect(out.entityType).toBe('action');
    expect(out.name).toBe('Power Attack');
    expect(out.itemId).toBe('x');
    expect(out.description).toBe('Action from character strikes/abilities');
  });

  it('resolves an effect entity by name', async () => {
    const { run } = build(
      charWith({
        effects: [{ id: 'ef1', name: 'Blessed', duration: { expiry: 'turnEnd' } }],
      })
    );
    const out = await run({
      action: 'get-entity',
      actorIdentifier: 'Aria',
      entityIdentifier: 'blessed',
    });
    expect(out.entityType).toBe('effect');
    expect(out.id).toBe('ef1');
    expect(out.name).toBe('Blessed');
    expect(out.description).toBe('Blessed'); // falls back to name
  });

  it('throws when the entity is not found anywhere', async () => {
    const { run } = build(charWith({}));
    await expect(
      run({ action: 'get-entity', actorIdentifier: 'Aria', entityIdentifier: 'Nope' })
    ).rejects.toThrow(/not found on actor "Aria"/);
  });

  it('rejects an empty actorIdentifier', async () => {
    const { run } = build();
    await expect(
      run({ action: 'get-entity', actorIdentifier: '', entityIdentifier: 'x' })
    ).rejects.toThrow();
  });

  it('rejects a missing entityIdentifier', async () => {
    const { run } = build();
    await expect(run({ action: 'get-entity', actorIdentifier: 'Aria' })).rejects.toThrow();
  });
});

describe('manage-actors list (the §3 line shape)', () => {
  it('forwards the type + name filters; one line per actor under the column header', async () => {
    const { calls, run } = build({
      listActors: [
        { id: 'a1', name: 'Aria Windrun', type: 'character' },
        { id: 'a2', name: 'Goblin', type: 'npc' },
      ],
    });
    const out = await run({ action: 'list', type: 'character', nameFilter: 'ari' });
    expect(callFor(calls, 'listActors')![1]).toEqual({ type: 'character', nameFilter: 'ari' });
    expect(out).toBe('2 actor(s): id name type\na1 "Aria Windrun" character\na2 Goblin npc');
  });

  it('sends no filter keys when none are supplied; an empty world is the header alone', async () => {
    const { calls, run } = build({ listActors: [] });
    expect(await run({ action: 'list' })).toBe('0 actor(s).');
    expect(callFor(calls, 'listActors')![1]).toEqual({});
  });
});

describe('manage-actors update / delete (the members ride their modules; the dispatch is here)', () => {
  it('update: parses the dnd5e contract, guards the system, confirms on one line', async () => {
    const { calls, run } = build({
      getWorldInfo: { system: 'dnd5e' },
      updateActor: {
        actor: { id: 'a1', name: 'Gren', type: 'npc' },
        applied: ['identity', 'vitals'],
        warnings: ['cr: skipped on a PC'],
      },
    });
    const out = await run({ action: 'update', actorIdentifier: 'Gren', name: 'Gren the Bold' });
    expect(callFor(calls, 'updateActor')![1]).toMatchObject({
      actorIdentifier: 'Gren',
      name: 'Gren the Bold',
    });
    expect(out).toBe(
      'Updated "Gren" (a1, npc): identity, vitals\n\n⚠️ 1 warning(s):\n- cr: skipped on a PC'
    );
  });

  it('delete: the strict identifiers, one line with the removed folders and the not-found tail', async () => {
    const { calls, run } = build({
      deleteActor: {
        success: true,
        deletedCount: 1,
        deleted: [{ id: 'a1', name: 'Gren' }],
        notFound: ['ghost'],
        removedFolders: [{ id: 'f1', name: 'Bandits' }],
      },
    });
    const out = await run({ action: 'delete', identifiers: ['a1', 'ghost'] });
    expect(callFor(calls, 'deleteActor')![1]).toEqual({
      identifiers: ['a1', 'ghost'],
      removeEmptyFolder: true,
    });
    expect(out).toBe(
      'Deleted 1 actor(s): "Gren" (a1) (1 not found: ghost); removed emptied folder(s): Bandits'
    );
  });

  it('delete: rejects an empty identifiers array and an empty-string identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});

describe('handleSearchCharacterItems', () => {
  it('forwards the search params with a default limit of 20', async () => {
    const { tools, calls } = build({
      searchCharacterItems: { characterName: 'Aria', matches: [{ id: 's1' }] },
    });
    const out = await tools.handleSearchCharacterItems({
      characterIdentifier: 'Aria',
      query: 'fire',
      type: 'spell',
    });
    expect(callFor(calls, 'searchCharacterItems')![1]).toEqual({
      characterIdentifier: 'Aria',
      query: 'fire',
      type: 'spell',
      category: undefined,
      limit: 20,
    });
    expect(out).toEqual({ characterName: 'Aria', matches: [{ id: 's1' }] });
  });

  it('passes an explicit limit through', async () => {
    const { tools, calls } = build({ searchCharacterItems: { matches: [] } });
    await tools.handleSearchCharacterItems({ characterIdentifier: 'Aria', limit: 5 });
    expect(callFor(calls, 'searchCharacterItems')![1].limit).toBe(5);
  });

  it('rejects an empty actorIdentifier', async () => {
    const { tools } = build();
    await expect(tools.handleSearchCharacterItems({ characterIdentifier: '' })).rejects.toThrow();
  });

  it('rejects a non-numeric limit', async () => {
    const { tools } = build();
    await expect(
      tools.handleSearchCharacterItems({ characterIdentifier: 'Aria', limit: 'lots' })
    ).rejects.toThrow();
  });
});
