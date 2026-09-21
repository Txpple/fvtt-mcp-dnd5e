/**
 * Unit tests for OrganizationTools — manage-folders (the M8 union: action create / list / update /
 * delete), move-documents, bulk-delete.
 *
 * Covers the two things these handlers own before the bridge is reached:
 *   1. zod input validation — required fields, enum membership, non-empty
 *      strings/arrays are enforced (bad input throws, never hits the bridge);
 *      for the union, the member selected by `action` and its refusals by name.
 *   2. response formatting — the §3 shapes: the list lines, the one-line confirmations,
 *      a miss as an error.
 */

import { describe, it, expect } from 'vitest';
import { MANAGE_FOLDERS, OrganizationTools } from './organization.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new OrganizationTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handleManageFolders(args);
  return { tools, calls, foundry, run };
}

describe('OrganizationTools.getToolDefinitions', () => {
  it('exposes the folder union and the two batch tools', () => {
    const { tools } = build();
    const names = tools
      .getToolDefinitions()
      .map(t => t.name)
      .sort();
    expect(names).toEqual(['bulk-delete', 'manage-folders', 'move-documents']);
  });

  it('every definition has an object inputSchema with required fields', () => {
    const { tools } = build();
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
      expect(Array.isArray(def.inputSchema.required)).toBe(true);
    }
  });
});

describe('manage-folders (the M8 union: action create / list / update / delete)', () => {
  it('advertises one tool: the action enum, the shared type leaf at the root, closed members', () => {
    const def = build()
      .tools.getToolDefinitions()
      .find(t => t.name === MANAGE_FOLDERS)!;
    const schema = def.inputSchema as any;
    expect(schema.properties.action.enum).toEqual(['create', 'list', 'update', 'delete']);
    expect(schema.properties.type.enum).toContain('JournalEntry');
    expect(schema.anyOf.map((m: any) => m.properties.action.const)).toEqual([
      'create',
      'list',
      'update',
      'delete',
    ]);
    for (const m of schema.anyOf) {
      expect(m.additionalProperties).toBe(false);
      // the shared leaf is bare on every member — the root carries its prose and enum
      expect(m.properties.type).toEqual({ type: 'string' });
    }
    expect(schema.anyOf[0].required).toEqual(['action', 'name', 'type']);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'move' })).rejects.toThrow(
      'manage-folders: action must be one of "create", "list", "update", "delete" (got "move").'
    );
    await expect(run({ action: 'delete', identifiers: ['x'] })).rejects.toThrow(
      'manage-folders (action "delete"): unknown argument "identifiers" — it takes: action, identifier, type, deleteContents.'
    );
  });
});

describe('manage-folders list (the §3 line shape)', () => {
  const tree = {
    success: true,
    total: 3,
    types: ['Actor', 'Scene'],
    folders: [
      {
        id: 'fA',
        name: '_DM',
        type: 'Actor',
        depth: 0,
        path: '_DM',
        color: '#7c4dff',
        parentId: null,
        sort: 100000,
        documentCount: 1,
        subfolderCount: 1,
      },
      {
        id: 'fB',
        name: 'Corpses',
        type: 'Actor',
        depth: 1,
        path: '_DM/Corpses',
        color: null,
        parentId: 'fA',
        sort: 0,
        documentCount: 4,
        subfolderCount: 0,
      },
      {
        id: 'fC',
        name: 'Old Maps',
        type: 'Scene',
        depth: 0,
        path: 'Old Maps',
        color: null,
        parentId: null,
        documentCount: 3,
        subfolderCount: 0,
      },
    ],
  };

  it('one line per folder in the page order under the column header', async () => {
    const { calls, run } = build(tree);
    const out = await run({ action: 'list' });
    expect(calls[0]![0]).toBe('listFolders');
    expect(calls[0]![1]).toEqual({});
    expect(out).toBe(
      '3 folder(s): id name type depth path color sort parent docs subfolders\n' +
        'fA _DM Actor 0 _DM #7c4dff 100000 - 1 1\n' +
        'fB Corpses Actor 1 _DM/Corpses - 0 fA 4 0\n' +
        'fC "Old Maps" Scene 0 "Old Maps" - 0 - 3 0'
    );
  });

  it('forwards the type filter, names it in the header, and an empty result is the header alone', async () => {
    const { calls, run } = build({ success: true, total: 0, types: [], folders: [] });
    const out = await run({ action: 'list', type: 'Playlist' });
    expect(calls[0]![1]).toEqual({ type: 'Playlist' });
    expect(out).toBe('0 Playlist folder(s).');
  });

  it('appends an orphaned column only when a folder dangles', async () => {
    const { run } = build({
      success: true,
      total: 1,
      types: ['Actor'],
      folders: [
        {
          id: 'fX',
          name: 'Lost',
          type: 'Actor',
          depth: 0,
          path: 'Lost',
          color: null,
          parentId: 'gone',
          documentCount: 0,
          subfolderCount: 0,
          orphaned: true,
        },
      ],
    });
    expect(await run({ action: 'list' })).toBe(
      '1 folder(s): id name type depth path color sort parent docs subfolders orphaned\n' +
        'fX Lost Actor 0 Lost - 0 gone 0 0 true'
    );
  });

  it('rejects an unknown type at the schema layer', async () => {
    const { run } = build();
    await expect(run({ action: 'list', type: 'Spellbook' })).rejects.toThrow();
  });
});

describe('manage-folders create', () => {
  it('forwards a valid folder request and confirms on one line', async () => {
    const { calls, run } = build({ type: 'Actor', folderName: 'NPCs', folderId: 'abc123' });
    const out = await run({ action: 'create', name: 'NPCs', type: 'Actor' });
    expect(calls[0]![0]).toBe('createFolder');
    expect(calls[0]![1]).toMatchObject({ name: 'NPCs', type: 'Actor' });
    expect(out).toBe('Created Actor folder "NPCs" (abc123)');
  });

  it('passes optional parentFolder and color through', async () => {
    const { calls, run } = build({ type: 'Item', folderName: 'Loot', folderId: 'x' });
    await run({
      action: 'create',
      name: 'Loot',
      type: 'Item',
      parentFolder: 'root-id',
      color: '#4a90e2',
    });
    expect(calls[0]![1]).toMatchObject({ parentFolder: 'root-id', color: '#4a90e2' });
  });

  it('rejects an empty name, a missing type and an unknown document type', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: '', type: 'Actor' })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'X' })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'X', type: 'Widget' })).rejects.toThrow();
  });
});

describe('manage-folders update', () => {
  it('forwards a rename and confirms on one line', async () => {
    const { calls, run } = build({
      updated: true,
      folder: { id: 'f1', name: 'Player Handouts', type: 'JournalEntry' },
    });
    const out = await run({
      action: 'update',
      identifier: 'Maps',
      type: 'JournalEntry',
      name: 'Player Handouts',
    });
    expect(calls[0]![0]).toBe('updateFolder');
    expect(calls[0]![1]).toMatchObject({
      identifier: 'Maps',
      type: 'JournalEntry',
      name: 'Player Handouts',
    });
    expect(out).toBe('Updated JournalEntry folder → "Player Handouts" (f1)');
  });

  it('passes color and parentFolder through; type defaults to Actor', async () => {
    const { calls, run } = build({
      updated: true,
      folder: { id: 'f2', name: 'Loot', type: 'Item' },
    });
    await run({
      action: 'update',
      identifier: 'Loot',
      type: 'Item',
      color: '#4a90e2',
      parentFolder: 'Treasure',
    });
    expect(calls[0]![1]).toMatchObject({ color: '#4a90e2', parentFolder: 'Treasure' });
    await run({ action: 'update', identifier: 'Loot', name: 'Loot 2' });
    expect(calls[1]![1]).toMatchObject({ type: 'Actor' });
  });

  it('passes sort through (alone is enough) and echoes the resulting position', async () => {
    const { calls, run } = build({
      updated: true,
      folder: { id: 'f3', name: '0? - Hag Encounters', type: 'Scene', sort: 900000 },
    });
    const out = await run({ action: 'update', identifier: 'f3', type: 'Scene', sort: 900000 });
    expect(calls[0]![1]).toMatchObject({ sort: 900000 });
    expect(out).toBe('Updated Scene folder → "0? - Hag Encounters" (f3) [sort 900000]');
  });

  it('omits the sort suffix when sort was not requested', async () => {
    const { run } = build({
      updated: true,
      folder: { id: 'f5', name: 'Loot', type: 'Item', sort: 400000 },
    });
    expect(await run({ action: 'update', identifier: 'Loot', type: 'Item', name: 'Loot' })).toBe(
      'Updated Item folder → "Loot" (f5)'
    );
  });

  it('a folder that does not resolve is an error (§3), never prose in a success shape', async () => {
    const { run } = build({ updated: false, notFound: 'Ghost' });
    await expect(
      run({ action: 'update', identifier: 'Ghost', type: 'Scene', name: 'X' })
    ).rejects.toThrow('Folder not found: "Ghost" (type Scene). Nothing changed.');
  });

  it('rejects a non-integer sort, no updatable field, and an empty identifier', async () => {
    const { run } = build();
    await expect(
      run({ action: 'update', identifier: 'Maps', type: 'Scene', sort: 1.5 })
    ).rejects.toThrow();
    await expect(run({ action: 'update', identifier: 'Maps', type: 'Scene' })).rejects.toThrow(
      'Provide at least one of: name, color, parentFolder, sort'
    );
    await expect(run({ action: 'update', identifier: '', name: 'X' })).rejects.toThrow();
  });
});

describe('manage-folders delete', () => {
  it('forwards the deleteFolder call with the type / deleteContents defaults', async () => {
    const { calls, run } = build({
      success: true,
      deleted: true,
      folder: { name: 'Loot', id: 'f1', type: 'Actor' },
    });
    const out = await run({ action: 'delete', identifier: 'Loot' });
    expect(calls[0]![0]).toBe('deleteFolder');
    expect(calls[0]![1]).toMatchObject({
      identifier: 'Loot',
      type: 'Actor',
      deleteContents: false,
    });
    expect(out).toBe('Deleted Actor folder "Loot" (f1) (was empty)');
  });

  it('reports the removed contents when deleteContents was applied', async () => {
    const { calls, run } = build({
      success: true,
      deleted: true,
      deletedContents: true,
      folder: { name: 'Old', id: 'f9', type: 'JournalEntry' },
      removedDocuments: 3,
      removedSubfolders: 1,
    });
    const out = await run({
      action: 'delete',
      identifier: 'Old',
      type: 'JournalEntry',
      deleteContents: true,
    });
    expect(calls[0]![1]).toMatchObject({ type: 'JournalEntry', deleteContents: true });
    expect(out).toBe(
      'Deleted JournalEntry folder "Old" (f9); also 3 document(s) and 1 subfolder(s) inside it'
    );
  });

  it('a folder that does not resolve is an error (§3)', async () => {
    const { run } = build({ success: true, deleted: false, notFound: 'Ghost Folder' });
    await expect(run({ action: 'delete', identifier: 'Ghost Folder' })).rejects.toThrow(
      'Folder not found: "Ghost Folder" (type Actor). Nothing deleted.'
    );
  });

  it('rejects an empty or missing identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifier: '' })).rejects.toThrow();
    await expect(run({ action: 'delete' })).rejects.toThrow();
  });
});

describe('handleMoveDocuments', () => {
  it('forwards a valid move and reports destination + count', async () => {
    const { tools, calls } = build({
      movedCount: 2,
      targetFolderName: 'Archive',
      targetFolderId: 'fold9',
      notFound: [],
    });
    const out = await tools.handleMoveDocuments({
      documentType: 'JournalEntry',
      identifiers: ['a', 'b'],
      targetFolder: 'Archive',
    });
    expect(calls[0][0]).toBe('moveDocuments');
    expect(out).toBe('Moved 2 JournalEntry document(s) → "Archive" (fold9).');
  });

  it('reports "root" when no target folder name comes back', async () => {
    const { tools } = build({ movedCount: 1, notFound: [] });
    const out = await tools.handleMoveDocuments({
      documentType: 'Scene',
      identifiers: ['s1'],
    });
    expect(out).toBe('Moved 1 Scene document(s) → root.');
  });

  it('appends a not-found list when the bridge reports misses', async () => {
    const { tools } = build({ movedCount: 1, notFound: ['ghost'] });
    const out = await tools.handleMoveDocuments({
      documentType: 'Actor',
      identifiers: ['real', 'ghost'],
    });
    expect(out).toContain('not found: ghost');
  });

  it('rejects an empty identifiers array', async () => {
    const { tools } = build();
    await expect(
      tools.handleMoveDocuments({ documentType: 'Actor', identifiers: [] })
    ).rejects.toThrow();
  });

  it('rejects an identifier that is an empty string', async () => {
    const { tools } = build();
    await expect(
      tools.handleMoveDocuments({ documentType: 'Actor', identifiers: [''] })
    ).rejects.toThrow();
  });
});

describe('handleBulkDelete', () => {
  it('forwards a valid delete and lists the removed documents', async () => {
    const { tools, calls } = build({
      deletedCount: 2,
      deleted: [
        { name: 'Goblin', id: 'g1' },
        { name: 'Kobold', id: 'k1' },
      ],
      notFound: [],
    });
    const out = await tools.handleBulkDelete({
      documentType: 'Actor',
      identifiers: ['g1', 'k1'],
    });
    expect(calls[0][0]).toBe('bulkDelete');
    expect(out).toContain('Deleted 2 Actor document(s)');
    expect(out).toContain('"Goblin" (g1)');
    expect(out).toContain('"Kobold" (k1)');
  });

  it('appends a not-found list when ids do not resolve', async () => {
    const { tools } = build({
      deletedCount: 0,
      deleted: [],
      notFound: ['nope'],
    });
    const out = await tools.handleBulkDelete({
      documentType: 'Item',
      identifiers: ['nope'],
    });
    expect(out).toContain('not found: nope');
  });

  it('renders a dry-run preview without claiming anything was deleted', async () => {
    const { tools, calls } = build({
      dryRun: true,
      deletedCount: 0,
      deleted: [],
      wouldDelete: [
        { name: 'Goblin', id: 'g1' },
        { name: 'Kobold', id: 'k1' },
      ],
    });
    const out = await tools.handleBulkDelete({
      documentType: 'Actor',
      identifiers: ['g1', 'k1'],
      dryRun: true,
    });
    expect(calls[0][1].dryRun).toBe(true);
    expect(out).toContain('Dry run — would delete 2 Actor document(s)');
    expect(out).toContain('Goblin (g1)');
    expect(out).not.toContain('Deleted');
  });

  it('rejects a missing documentType', async () => {
    const { tools } = build();
    await expect(tools.handleBulkDelete({ identifiers: ['x'] })).rejects.toThrow();
  });

  it('rejects an empty identifiers array', async () => {
    const { tools } = build();
    await expect(
      tools.handleBulkDelete({ documentType: 'Item', identifiers: [] })
    ).rejects.toThrow();
  });
});
