/**
 * Unit tests for TableTools — manage-rolltables (the M8 union: action create / import / list / get
 * / update / delete) and roll-on-table.
 *
 * Covers the two things these handlers own before the bridge is reached:
 *   1. zod input validation — required fields, non-empty strings/arrays, result-entry shape are
 *      enforced (bad input throws, never hits the bridge); the member selected by `action` and
 *      its refusals by name.
 *   2. response formatting — the §3 shapes: the list lines, the one-line confirmations, a miss as
 *      an error.
 */

import { describe, it, expect } from 'vitest';
import { MANAGE_ROLLTABLES, TableTools } from './tables.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new TableTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handleManageRollTables(args);
  return { tools, calls, foundry, run };
}

describe('TableTools.getToolDefinitions', () => {
  it('exposes the union and roll-on-table', () => {
    const { tools } = build();
    const names = tools
      .getToolDefinitions()
      .map(t => t.name)
      .sort();
    expect(names).toEqual([MANAGE_ROLLTABLES, 'roll-on-table']);
  });

  it('every definition has an object inputSchema', () => {
    const { tools } = build();
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
    }
  });
});

describe('manage-rolltables (the M8 union)', () => {
  it('advertises the action enum, the shared identifier / folderName leaves, closed members', () => {
    const def = build()
      .tools.getToolDefinitions()
      .find(t => t.name === MANAGE_ROLLTABLES)!;
    const schema = def.inputSchema as any;
    expect(schema.properties.action.enum).toEqual([
      'create',
      'import',
      'list',
      'get',
      'update',
      'delete',
    ]);
    expect(schema.properties.identifier.description).toBe('Table id or exact name.');
    expect(schema.properties.folderName.description).toBe('Folder (created if absent).');
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    expect(byAction.get.properties.identifier).toEqual({ type: 'string' });
    expect(byAction.get.required).toEqual(['action', 'identifier']);
    expect(byAction.update.properties.identifier).toEqual({ type: 'string' });
    expect(byAction.create.properties.folderName).toEqual({ type: 'string' });
    // the create member keeps its tuple leaf as 2020-12 prefixItems (the construct that once
    // bricked a live session under draft-7)
    expect(byAction.create.properties.results.items.properties.range.prefixItems).toHaveLength(2);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'roll', identifier: 'x' })).rejects.toThrow(
      'manage-rolltables: action must be one of "create", "import", "list", "get", "update", "delete" (got "roll").'
    );
    await expect(run({ action: 'get', identifiers: ['x'] })).rejects.toThrow(
      'manage-rolltables (action "get"): unknown argument "identifiers" — it takes: action, identifier.'
    );
  });
});

describe('handleCreateRollTable', () => {
  it('forwards a valid request and formats the result', async () => {
    const { calls, run } = build({
      tableName: 'Loot',
      tableId: 't1',
      formula: '1d6',
      resultCount: 3,
    });
    const out = await run({
      action: 'create',
      name: 'Loot',
      results: [{ text: 'Gold' }, { text: 'Sword' }, { text: 'Gem' }],
    });
    expect(calls[0][0]).toBe('createRollTable');
    expect(calls[0][1]).toMatchObject({
      name: 'Loot',
      results: [{ text: 'Gold' }, { text: 'Sword' }, { text: 'Gem' }],
    });
    expect(out).toBe('Created roll table "Loot" (t1): formula 1d6, 3 result(s)');
  });

  it('passes optional fields and weighted/ranged results through', async () => {
    const { calls, run } = build({
      tableName: 'Enc',
      tableId: 'e1',
      formula: '1d20',
      resultCount: 1,
    });
    await run({
      action: 'create',
      name: 'Enc',
      description: 'encounters',
      formula: '1d20',
      replacement: false,
      displayRoll: false,
      folderName: 'Tables',
      results: [{ text: 'Goblin', weight: 2, range: [1, 10] }],
    });
    expect(calls[0][1]).toMatchObject({
      description: 'encounters',
      formula: '1d20',
      replacement: false,
      displayRoll: false,
      folderName: 'Tables',
      results: [{ text: 'Goblin', weight: 2, range: [1, 10] }],
    });
  });

  it('rejects a missing name', async () => {
    const { run } = build();
    await expect(run({ action: 'create', results: [{ text: 'x' }] })).rejects.toThrow();
  });

  it('rejects an empty name', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: '', results: [{ text: 'x' }] })).rejects.toThrow();
  });

  it('rejects an empty results array', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: 'X', results: [] })).rejects.toThrow();
  });

  it('rejects a result with empty text', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: 'X', results: [{ text: '' }] })).rejects.toThrow();
  });

  it('rejects a result with neither text nor uuid', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: 'X', results: [{ weight: 2 }] })).rejects.toThrow();
  });

  it('forwards uuid-referencing results (compendium loot links)', async () => {
    const { calls, run } = build({
      tableName: 'Hoard',
      tableId: 'h1',
      formula: '1d2',
      resultCount: 2,
    });
    await run({
      action: 'create',
      name: 'Hoard',
      results: [
        {
          uuid: 'Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgRubyOfTheWarM',
          name: 'Ruby of the War Mage',
        },
        {
          text: 'A pouch holding {{link}} and 2d6 gp',
          uuid: 'Compendium.dnd-players-handbook.equipment.Item.x',
        },
      ],
    });
    expect(calls[0][0]).toBe('createRollTable');
    expect(calls[0][1].results[0]).toMatchObject({
      uuid: 'Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgRubyOfTheWarM',
      name: 'Ruby of the War Mage',
    });
    expect(calls[0][1].results[1]).toMatchObject({
      text: 'A pouch holding {{link}} and 2d6 gp',
      uuid: 'Compendium.dnd-players-handbook.equipment.Item.x',
    });
  });
});

describe('handleImportRollTable', () => {
  it('forwards a valid import and formats the result', async () => {
    const { calls, run } = build({
      tableName: 'Arcana - Common',
      tableId: 'imp1',
      formula: '1d100',
      resultCount: 50,
    });
    const out = await run({
      action: 'import',
      packId: 'dnd-dungeon-masters-guide.tables',
      itemId: 'dmgArcanaCommon0',
      folderName: 'DMG Treasure',
    });
    expect(calls[0][0]).toBe('importRollTable');
    expect(calls[0][1]).toMatchObject({
      packId: 'dnd-dungeon-masters-guide.tables',
      itemId: 'dmgArcanaCommon0',
      folderName: 'DMG Treasure',
    });
    expect(out).toBe('Imported roll table "Arcana - Common" (imp1): formula 1d100, 50 result(s)');
  });

  it('rejects a missing packId', async () => {
    const { run } = build();
    await expect(run({ action: 'import', itemId: 'x' })).rejects.toThrow();
  });

  it('rejects a missing itemId', async () => {
    const { run } = build();
    await expect(
      run({ action: 'import', packId: 'dnd-dungeon-masters-guide.tables' })
    ).rejects.toThrow();
  });
});

describe('manage-rolltables list (the §3 line shape)', () => {
  it('one line per table under the column header', async () => {
    const { calls, run } = build([
      { name: 'Loot', id: 't1', formula: '1d6', resultCount: 3 },
      { name: 'Enc', id: 'e1', formula: '1d20', resultCount: 5 },
    ]);
    const out = await run({ action: 'list' });
    expect(calls[0][0]).toBe('listRollTables');
    expect(out).toBe('2 table(s): id name formula results\nt1 Loot 1d6 3\ne1 Enc 1d20 5');
  });

  it('an empty world (or a null result) is the header alone', async () => {
    expect(await build([]).run({ action: 'list' })).toBe('0 table(s).');
    expect(await build(null).run({ action: 'list' })).toBe('0 table(s).');
  });
});

describe('handleUpdateRollTable', () => {
  it('forwards a valid update and formats the result', async () => {
    const { calls, run } = build({
      tableName: 'Loot v2',
      tableId: 't1',
      resultCount: 4,
    });
    const out = await run({ action: 'update', identifier: 't1', name: 'Loot v2' });
    expect(calls[0][0]).toBe('updateRollTable');
    expect(calls[0][1]).toMatchObject({ identifier: 't1', name: 'Loot v2' });
    expect(out).toBe('Updated roll table "Loot v2" (t1): 4 result(s)');
  });

  it('a table that does not resolve is an error (§3), never prose in a success shape', async () => {
    const { run } = build({ updated: false, notFound: 'Ghost Table' });
    await expect(run({ action: 'update', identifier: 'Ghost Table' })).rejects.toThrow(
      'Roll table not found: "Ghost Table". Nothing changed.'
    );
  });

  it('falls back to the identifier when notFound is absent', async () => {
    const { run } = build({ updated: false });
    await expect(run({ action: 'update', identifier: 'missing' })).rejects.toThrow(
      'Roll table not found: "missing". Nothing changed.'
    );
  });

  it('rejects a missing identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'update', name: 'X' })).rejects.toThrow();
  });

  it('rejects an empty identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'update', identifier: '' })).rejects.toThrow();
  });

  it('rejects a result with empty text', async () => {
    const { run } = build();
    await expect(
      run({ action: 'update', identifier: 't1', results: [{ text: '' }] })
    ).rejects.toThrow();
  });
});

describe('handleUpdateRollTable — editResults (targeted per-entry edits)', () => {
  it('forwards edits and reports the edited-in-place count', async () => {
    const { calls, run } = build({
      tableName: 'Travellers',
      tableId: 't1',
      resultCount: 12,
      edited: 1,
    });
    const out = await run({
      action: 'update',
      identifier: 't1',
      editResults: [{ roll: 7, text: 'GM note: the Dreamer stirs.' }],
    });
    expect(calls[0][0]).toBe('updateRollTable');
    expect(calls[0][1]).toMatchObject({
      identifier: 't1',
      editResults: [{ roll: 7, text: 'GM note: the Dreamer stirs.' }],
    });
    expect(out).toBe('Updated roll table "Travellers" (t1): 12 result(s), 1 entry edited in place');
  });

  it('surfaces isolated edit errors and layout warnings from the page result', async () => {
    const { run } = build({
      tableName: 'Travellers',
      tableId: 't1',
      resultCount: 12,
      edited: 1,
      errors: ['editResults[0]: no entry covers roll 99 (see get-rolltable for the ranges)'],
      warnings: [
        'ranges overlap after this edit: [1-2] and [2-3] — rolls in the overlap match two entries',
      ],
    });
    const out = await run({
      action: 'update',
      identifier: 't1',
      editResults: [
        { roll: 99, text: 'x' },
        { roll: 2, range: [1, 2] },
      ],
    });
    expect(out).toContain('1 entry edited in place');
    expect(out).toContain('⚠ editResults[0]: no entry covers roll 99');
    expect(out).toContain('ranges overlap');
  });

  it('accepts resultId targeting with weight/range-only patches', async () => {
    const { calls, run } = build({ tableName: 'T', tableId: 't1', resultCount: 3, edited: 1 });
    await run({
      action: 'update',
      identifier: 't1',
      editResults: [{ resultId: 'rC', weight: 2, range: [4, 5] }],
    });
    expect(calls[0][1].editResults[0]).toEqual({ resultId: 'rC', weight: 2, range: [4, 5] });
  });

  it('rejects an edit with BOTH roll and resultId, or NEITHER (refine)', async () => {
    const { run } = build();
    await expect(
      run({
        action: 'update',
        identifier: 't1',
        editResults: [{ roll: 3, resultId: 'rA', text: 'x' }],
      })
    ).rejects.toThrow();
    await expect(
      run({ action: 'update', identifier: 't1', editResults: [{ text: 'x' }] })
    ).rejects.toThrow();
  });

  it('rejects an edit with no editable field (refine)', async () => {
    const { run } = build();
    await expect(
      run({ action: 'update', identifier: 't1', editResults: [{ roll: 3 }] })
    ).rejects.toThrow();
  });

  it('rejects results + editResults together (mutually exclusive modes)', async () => {
    const { run } = build();
    await expect(
      run({
        action: 'update',
        identifier: 't1',
        results: [{ text: 'whole new set' }],
        editResults: [{ roll: 1, text: 'targeted' }],
      })
    ).rejects.toThrow(/not both/);
  });
});

describe('handleRollOnTable', () => {
  it('forwards a valid roll and formats the drawn results', async () => {
    const { tools, calls } = build({
      total: 7,
      tableName: 'Loot',
      results: [{ text: 'Gold' }, { text: 'Gem' }],
    });
    const out = await tools.handleRollOnTable({ identifier: 'Loot' });
    expect(calls[0][0]).toBe('rollOnTable');
    expect(calls[0][1]).toEqual({ identifier: 'Loot' });
    expect(out).toBe('Rolled 7 on "Loot" → "Gold", "Gem"');
  });

  it('reports "(no result matched)" when no results come back', async () => {
    const { tools } = build({ total: 3, tableName: 'Loot', results: [] });
    const out = await tools.handleRollOnTable({ identifier: 'Loot' });
    expect(out).toBe('Rolled 3 on "Loot" → (no result matched)');
  });

  it('prettifies @UUID enrichers and lists importable item links', async () => {
    const uuid = 'Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgRubyOfTheWarM';
    const { tools } = build({
      total: 68,
      tableName: 'Arcana - Common',
      results: [
        {
          text: `@UUID[${uuid}]{Ruby of the War Mage}`,
          links: [{ uuid, label: 'Ruby of the War Mage' }],
        },
      ],
    });
    const out = await tools.handleRollOnTable({ identifier: 'Arcana - Common' });
    expect(out).toBe(
      'Rolled 68 on "Arcana - Common" → "Ruby of the War Mage"\n' +
        `  importable: Ruby of the War Mage [${uuid}]`
    );
  });

  it('a table that does not resolve is an error (§3)', async () => {
    const { tools } = build({ rolled: false, notFound: 'Ghost' });
    await expect(tools.handleRollOnTable({ identifier: 'Ghost' })).rejects.toThrow(
      'Roll table not found: "Ghost". Nothing rolled.'
    );
  });

  it('rejects a missing identifier', async () => {
    const { tools } = build();
    await expect(tools.handleRollOnTable({})).rejects.toThrow();
  });

  it('rejects an empty identifier', async () => {
    const { tools } = build();
    await expect(tools.handleRollOnTable({ identifier: '' })).rejects.toThrow();
  });
});

describe('handleGetRollTable', () => {
  it('formats the table header and every entry, prettifying links', async () => {
    const { calls, run } = build({
      found: true,
      id: 't1',
      name: 'Loot',
      formula: '1d3',
      replacement: true,
      displayRoll: true,
      description: '',
      results: [
        { range: [1, 1], text: 'Gold', links: [] },
        { range: [2, 3], text: '@UUID[u]{Ruby}', links: [{ uuid: 'u', label: 'Ruby' }] },
      ],
    });
    const out = await run({ action: 'get', identifier: 'Loot' });
    expect(calls[0][0]).toBe('getRollTable');
    expect(calls[0][1]).toEqual({ identifier: 'Loot' });
    expect(out).toBe(
      'Roll table "Loot" (t1) — 1d3, 2 result(s) [replacement on, displayRoll on]\n' +
        '  [1] Gold\n' +
        '  [2-3] Ruby\n' +
        '      → Ruby [u]'
    );
  });

  it('shows a description line and the no-replacement flag', async () => {
    const { run } = build({
      found: true,
      id: 't2',
      name: 'Rumors',
      formula: '1d4',
      replacement: false,
      displayRoll: true,
      description: 'Tavern <em>gossip</em>.',
      results: [{ range: [1, 4], text: 'A rumor', links: [] }],
    });
    const out = await run({ action: 'get', identifier: 't2' });
    expect(out).toBe(
      'Roll table "Rumors" (t2) — 1d4, 1 result(s) [replacement off, displayRoll on]\n' +
        'Tavern <em>gossip</em>.\n' +
        '  [1-4] A rumor'
    );
  });

  it('a table that does not resolve is an error (§3)', async () => {
    const { run } = build({ found: false, notFound: 'Ghost' });
    await expect(run({ action: 'get', identifier: 'Ghost' })).rejects.toThrow(
      'Roll table not found: "Ghost". Nothing read.'
    );
  });

  it('rejects a missing identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'get' })).rejects.toThrow();
  });

  it('rejects an empty identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'get', identifier: '' })).rejects.toThrow();
  });
});

describe('handleDeleteRollTable', () => {
  it('forwards a valid delete and lists the removed tables', async () => {
    const { calls, run } = build({
      deletedCount: 2,
      deleted: [
        { name: 'Loot', id: 't1' },
        { name: 'Enc', id: 'e1' },
      ],
      notFound: [],
    });
    const out = await run({ action: 'delete', identifiers: ['t1', 'e1'] });
    expect(calls[0][0]).toBe('deleteRollTables');
    expect(calls[0][1]).toEqual({ identifiers: ['t1', 'e1'] });
    expect(out).toBe('Deleted 2 roll table(s): "Loot" (t1), "Enc" (e1)');
  });

  it('appends a not-found list when ids do not resolve', async () => {
    const { run } = build({
      deletedCount: 0,
      deleted: [],
      notFound: ['nope'],
    });
    const out = await run({ action: 'delete', identifiers: ['nope'] });
    expect(out).toBe('Deleted 0 roll table(s) (1 not found: nope)');
  });

  it('rejects a missing identifiers array', async () => {
    const { run } = build();
    await expect(run({ action: 'delete' })).rejects.toThrow();
  });

  it('rejects an empty identifiers array', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
  });

  it('rejects an identifier that is an empty string', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});
