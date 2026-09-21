/**
 * Unit tests for ItemTools — manage-items (the M8 union: action create / list / get / update /
 * delete / import), remove-from-actor, and the un-advertised add-to-actor action add-feature rides.
 *
 * Each handler owns two things around the bridge call:
 *   1. zod input validation — required ids/names, .min(1) non-empty strings/arrays, the member
 *      selected by `action` and its refusals by name, the remove-from-actor refine() (bad input
 *      throws, never hits the bridge).
 *   2. forwarding + the §3 shapes — the bridge method + payload, the list lines, the one-line
 *      confirmations, get's JSON.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ItemTools, MANAGE_ITEMS } from './items.js';
import { makeLogger, makeFoundry } from './test-helpers.js';
import { clearSystemCache } from '../utils/system-detection.js';

/** Build an ItemTools with a method-keyed mock bridge (keys are bare op names, e.g. 'createWorldItems'). */
function build(responses: Record<string, any> = {}) {
  const { foundry, calls } = makeFoundry((method: string) =>
    method === 'getWorldInfo' ? { system: 'dnd5e' } : responses[method]
  );
  const tools = new ItemTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handleManageItems(args);
  return { tools, calls, foundry, run };
}

/** Find the [method, data] pair for a given bare bridge op name. */
function callFor(calls: Array<[string, any]>, bareMethod: string) {
  return calls.find(([m]) => m === bareMethod);
}

beforeEach(() => {
  clearSystemCache();
});

describe('ItemTools.getToolDefinitions', () => {
  it('exposes the union and remove-from-actor', () => {
    const { tools } = build();
    expect(
      tools
        .getToolDefinitions()
        .map(t => t.name)
        .sort()
    ).toEqual([MANAGE_ITEMS, 'remove-from-actor']);
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
      expect(Array.isArray(def.inputSchema.required)).toBe(true);
    }
  });

  it('manage-items: the action enum, the shared folder leaf, closed members', () => {
    const def = build()
      .tools.getToolDefinitions()
      .find(t => t.name === MANAGE_ITEMS)!;
    const schema = def.inputSchema as any;
    expect(schema.properties.action.enum).toEqual([
      'create',
      'list',
      'get',
      'update',
      'delete',
      'import',
    ]);
    expect(schema.properties.folder.description).toContain('Folder name or id');
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    expect(byAction.create.properties.folder).toEqual({ type: 'string' });
    expect(byAction.list.properties.folder).toEqual({ type: 'string' });
    expect(byAction.import.properties.folder).toEqual({ type: 'string' });
    expect(byAction.import.required).toEqual(['action', 'packId', 'itemId']);
    expect(byAction.get.required).toEqual(['action', 'identifier']);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'add-to-actor', items: [] })).rejects.toThrow(
      'manage-items: action must be one of "create", "list", "get", "update", "delete", "import" (got "add-to-actor").'
    );
    await expect(run({ action: 'get', id: 'x' })).rejects.toThrow(
      'manage-items (action "get"): unknown argument "id" — it takes: action, identifier.'
    );
  });
});

describe('manage-items create', () => {
  it('forwards items + folder and confirms on one line with the folder and each id', async () => {
    const { calls, run } = build({
      createWorldItems: {
        folderId: 'f1',
        folderName: 'Loot',
        created: [
          { id: 'w1', name: 'Sword', type: 'weapon' },
          { id: 'w2', name: 'Odd Ring', trueName: 'Ring of Protection', type: 'equipment' },
        ],
      },
    });
    const out = await run({
      action: 'create',
      items: [
        { name: 'Sword', type: 'weapon' },
        { name: 'Ring of Protection', type: 'equipment' },
      ],
      folder: 'Loot',
    });
    expect(callFor(calls, 'createWorldItems')![1]).toEqual({
      items: [
        { name: 'Sword', type: 'weapon' },
        { name: 'Ring of Protection', type: 'equipment' },
      ],
      folder: 'Loot',
    });
    expect(out).toBe(
      'Created 2 world item(s) in folder "Loot" (f1): "Sword" (w1, weapon), ' +
        '"Odd Ring" (w2, equipment, true "Ring of Protection")'
    );
  });

  it('appends the page-side img warnings (bad path substituted)', async () => {
    const { run } = build({
      createWorldItems: {
        folderId: null,
        created: [{ id: 'w1', name: 'Sword', type: 'weapon' }],
        warnings: ['img "icons/nope.webp" did not resolve; substituted a floor icon.'],
      },
    });
    expect(
      await run({
        action: 'create',
        items: [{ name: 'Sword', type: 'weapon', img: 'icons/nope.webp' }],
      })
    ).toBe(
      'Created 1 world item(s): "Sword" (w1, weapon)' +
        '\n\n⚠️ 1 warning(s):\n- img "icons/nope.webp" did not resolve; substituted a floor icon.'
    );
  });

  it('rejects an empty items array and an item missing a type', async () => {
    const { run } = build();
    await expect(run({ action: 'create', items: [] })).rejects.toThrow();
    await expect(run({ action: 'create', items: [{ name: 'X' }] })).rejects.toThrow();
  });
});

describe('manage-items list (the §3 line shape)', () => {
  it('forwards only the provided filters; one line per item, trueName only when a row has one', async () => {
    const { calls, run } = build({
      listWorldItems: [
        { id: 'w1', name: 'Sword', type: 'weapon', folderName: 'Armory' },
        {
          id: 'w2',
          name: 'Odd Ring',
          trueName: 'Ring of Protection',
          type: 'equipment',
          folderName: null,
        },
      ],
    });
    const out = await run({ action: 'list', type: 'weapon', nameFilter: 'sw' });
    expect(callFor(calls, 'listWorldItems')![1]).toEqual({ type: 'weapon', nameFilter: 'sw' });
    expect(out).toBe(
      '2 item(s): id name type folder trueName\n' +
        'w1 Sword weapon Armory -\n' +
        'w2 "Odd Ring" equipment - "Ring of Protection"'
    );
  });

  it('no trueName column when no row carries one; an empty result is the header alone', async () => {
    expect(
      await build({
        listWorldItems: [{ id: 'w1', name: 'Sword', type: 'weapon', folderName: null }],
      }).run({ action: 'list' })
    ).toBe('1 item(s): id name type folder\nw1 Sword weapon -');
    expect(await build({ listWorldItems: [] }).run({ action: 'list' })).toBe('0 item(s).');
    expect(await build({}).run({ action: 'list', folder: 'Ghost' })).toBe('0 item(s).');
  });
});

describe('manage-items get', () => {
  it('forwards the identifier and returns the item JSON', async () => {
    const item = { id: 'w1', name: 'Sword', type: 'weapon', description: '<p>Sharp.</p>' };
    const { calls, run } = build({ getWorldItem: item });
    expect(await run({ action: 'get', identifier: 'Sword' })).toEqual(item);
    expect(callFor(calls, 'getWorldItem')![1]).toEqual({ identifier: 'Sword' });
  });

  it('rejects an empty identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'get', identifier: '' })).rejects.toThrow();
  });
});

describe('manage-items update', () => {
  it('forwards updates and confirms on one line', async () => {
    const { calls, run } = build({
      updateWorldItems: {
        updated: [{ id: 'w1', name: 'Dawnthorn', trueName: 'Dawnthorn', type: 'weapon' }],
      },
    });
    const out = await run({ action: 'update', updates: [{ id: 'w1', name: 'Dawnthorn' }] });
    expect(callFor(calls, 'updateWorldItems')![1]).toEqual({
      updates: [{ id: 'w1', name: 'Dawnthorn' }],
    });
    expect(out).toBe('Updated 1 world item(s): "Dawnthorn" (w1, weapon, true "Dawnthorn")');
  });

  it('rejects an empty updates array and an entry with an empty id', async () => {
    const { run } = build();
    await expect(run({ action: 'update', updates: [] })).rejects.toThrow();
    await expect(run({ action: 'update', updates: [{ id: '', name: 'X' }] })).rejects.toThrow();
  });
});

describe('manage-items delete', () => {
  it('forwards identifiers and confirms with the not-found tail', async () => {
    const { calls, run } = build({
      deleteWorldItems: {
        deletedCount: 1,
        deleted: [{ id: 'w1', name: 'Sword', type: 'weapon' }],
        notFound: ['ghost'],
      },
    });
    const out = await run({ action: 'delete', identifiers: ['w1', 'ghost'] });
    expect(callFor(calls, 'deleteWorldItems')![1]).toEqual({ identifiers: ['w1', 'ghost'] });
    expect(out).toBe('Deleted 1 world item(s): "Sword" (w1) (1 not found: ghost)');
  });

  it('rejects an empty identifiers array and an empty-string identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});

describe('manage-items import (the compendium copy — dnd5e-guarded)', () => {
  it('forwards the parsed payload to importItemFromCompendium and confirms an actor copy', async () => {
    const { calls, run } = build({
      importItemFromCompendium: {
        success: true,
        source: { packId: 'dnd-players-handbook.equipment', itemId: 'phbMace', name: 'Mace' },
        target: { type: 'actor', id: 'a1', name: 'Rhogar' },
        item: { id: 'i1', name: 'Mace', type: 'weapon' },
      },
    });
    const out = await run({
      action: 'import',
      packId: 'dnd-players-handbook.equipment',
      itemId: 'phbMace',
      actorIdentifier: 'Rhogar',
      equipped: true,
    });
    expect(callFor(calls, 'importItemFromCompendium')![1]).toMatchObject({
      packId: 'dnd-players-handbook.equipment',
      itemId: 'phbMace',
      actorIdentifier: 'Rhogar',
      equipped: true,
    });
    expect(out).toBe('Copied "Mace" onto actor "Rhogar": id i1, type weapon');
  });

  it('notes the rename, the world target with its folder, and the loot copy', async () => {
    const { run } = build({
      importItemFromCompendium: {
        source: { packId: 'p', itemId: 'x', name: 'Shield' },
        target: { type: 'world', folderName: 'Armory' },
        item: { id: 'i2', name: 'Shield +1', type: 'equipment' },
        lootCopy: { id: 'l1', name: 'Shield +1', folderName: 'Loot' },
      },
    });
    expect(await run({ action: 'import', packId: 'p', itemId: 'x', name: 'Shield +1' })).toBe(
      'Copied "Shield +1" (from "Shield") onto world Items (folder "Armory"): id i2, type equipment; ' +
        'loot copy "Shield +1" (l1) in folder "Loot"'
    );
  });

  it('appends an unresolved @scale token the page reports on the copy', async () => {
    const { run } = build({
      importItemFromCompendium: {
        source: { packId: 'p', itemId: 'x', name: 'Staff' },
        target: { type: 'actor', name: 'Rhogar' },
        item: { id: 'i3', name: 'Staff', type: 'weapon' },
        unresolvedScale: [{ path: 'system.damage.base', formula: '@scale.monk.die' }],
      },
    });
    const out = String(await run({ action: 'import', packId: 'p', itemId: 'x' }));
    expect(out.startsWith('Copied "Staff" onto actor "Rhogar": id i3, type weapon')).toBe(true);
    expect(out).toContain('1 unresolved `@scale` token(s)');
    expect(out).toContain('Staff — `system.damage.base` = `@scale.monk.die`');
  });

  it('rejects a missing packId / itemId and an SRD pack', async () => {
    const { run } = build();
    await expect(run({ action: 'import', itemId: 'x' })).rejects.toThrow();
    await expect(run({ action: 'import', packId: 'p' })).rejects.toThrow();
    await expect(run({ action: 'import', packId: 'dnd5e.items', itemId: 'x' })).rejects.toThrow(
      /SRD/
    );
  });
});

describe('handleAddActorItems (add-feature mode "items" rides it; not advertised)', () => {
  it('forwards actorIdentifier + items and returns the bridge result', async () => {
    const { tools, calls } = build({
      addActorItems: { actorName: 'Aria', created: [{ id: 'n1' }] },
    });
    const out = await tools.handleAddActorItems({
      actorIdentifier: 'Aria',
      items: [{ name: 'Potion', type: 'consumable' }],
    });
    expect(callFor(calls, 'addActorItems')![1]).toEqual({
      actorIdentifier: 'Aria',
      items: [{ name: 'Potion', type: 'consumable' }],
    });
    expect(out).toEqual({ actorName: 'Aria', created: [{ id: 'n1' }] });
  });

  it('rejects an empty items array, an item with an empty name, a missing actorIdentifier', async () => {
    const { tools } = build();
    await expect(
      tools.handleAddActorItems({ actorIdentifier: 'Aria', items: [] })
    ).rejects.toThrow();
    await expect(
      tools.handleAddActorItems({ actorIdentifier: 'Aria', items: [{ name: '', type: 'weapon' }] })
    ).rejects.toThrow();
    await expect(
      tools.handleAddActorItems({ items: [{ name: 'X', type: 'weapon' }] })
    ).rejects.toThrow();
  });
});

describe('handleRemoveActorItems', () => {
  it('forwards actorIdentifier + itemIds and returns the bridge result', async () => {
    const { tools, calls } = build({
      removeActorItems: { actorName: 'Aria', removed: [{ id: 'r1' }] },
    });
    const out = await tools.handleRemoveActorItems({ actorIdentifier: 'Aria', itemIds: ['r1'] });
    expect(callFor(calls, 'removeActorItems')![1]).toEqual({
      actorIdentifier: 'Aria',
      itemIds: ['r1'],
    });
    expect(out).toEqual({ actorName: 'Aria', removed: [{ id: 'r1' }] });
  });

  it('omits undefined itemNames/type from the payload', async () => {
    const { tools, calls } = build({ removeActorItems: { removed: [] } });
    await tools.handleRemoveActorItems({ actorIdentifier: 'Aria', itemNames: ['Dagger'] });
    expect(callFor(calls, 'removeActorItems')![1]).toEqual({
      actorIdentifier: 'Aria',
      itemNames: ['Dagger'],
    });
  });

  it('rejects when neither itemIds nor itemNames is provided (refine), and an empty actorIdentifier', async () => {
    const { tools } = build();
    await expect(tools.handleRemoveActorItems({ actorIdentifier: 'Aria' })).rejects.toThrow();
    await expect(
      tools.handleRemoveActorItems({ actorIdentifier: '', itemIds: ['x'] })
    ).rejects.toThrow();
  });
});
