// Live verification for manage-folders (action create / list / update / delete — the M8 union,
// src/tools/organization.ts) and the folder-tree read under it (src/page/organization.ts).
//
// Drives a real headless Foundry session (fresh dist/, no CC restart): builds a small colored
// folder tree (parent + child + a doc inside the child), then proves listFolders reads it back —
// tree order + depth + path, the hex color, parent linkage, direct document/subfolder counts, and
// the type filter — and then the union through buildToolRegistry().dispatch: the four per-op tools
// are gone; create / update / delete answer one-line confirmations; list is the §3 line shape
// (header naming the type filter + the columns, one row per folder in DFS order, the update read
// back); an unknown action / key is refused by name against the selected member, a folder miss
// is an error, a non-empty delete is refused. Everything created is deleted in `finally`.
//
// Build first: npm run build.  Run: node scripts/verify-folder-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();

const TAG = 'ZZ-FOLDER-IT';
let passes = 0;
let fails = 0;
function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL  ${msg}`);
  }
}

const cfg = bridgeConfig(env);
const f = new Foundry(cfg);

let parentId;
let tableId;

try {
  console.log('[verify-folders] connecting…');
  await f.connect();
  console.log('[verify-folders] connected\n');

  // Fixture: RollTable folders (a quiet corner of the sidebar) — parent (colored) > child, with
  // one table inside the child.
  const parent = await f.call('createFolder', {
    name: `${TAG} Parent`,
    type: 'RollTable',
    color: '#7c4dff',
  });
  parentId = parent?.folderId;
  const child = await f.call('createFolder', {
    name: `${TAG} Child`,
    type: 'RollTable',
    parentFolder: parentId,
  });
  const made = await f.call('createRollTable', {
    name: `${TAG} Table`,
    folderName: `${TAG} Child`,
    results: [{ text: 'probe entry' }],
  });
  tableId = made?.tableId;

  console.log('# listFolders (all types)');
  const all = await f.call('listFolders', {});
  assert(all?.success === true && all?.total >= 2, `lists the sidebar (${all?.total} folders)`);
  const p = (all?.folders ?? []).find(x => x.id === parentId);
  const c = (all?.folders ?? []).find(x => x.id === child?.folderId);
  assert(!!p && !!c, 'both fixture folders appear');
  assert(p?.depth === 0 && c?.depth === 1, `tree depth read back (parent 0, child ${c?.depth})`);
  assert(
    c?.path === `${TAG} Parent/${TAG} Child` && c?.parentId === parentId,
    `child carries its /-joined path + parent link ("${c?.path}")`
  );
  assert(
    (all?.folders ?? []).indexOf(p) < (all?.folders ?? []).indexOf(c),
    'DFS order — the parent line precedes its child'
  );
  assert(
    typeof p?.color === 'string' && p.color.toLowerCase() === '#7c4dff',
    `the folder COLOR reads back as hex (${p?.color})`
  );
  assert(
    p?.subfolderCount === 1 && p?.documentCount === 0,
    `parent counts its subfolder (${p?.subfolderCount}) and no direct docs`
  );
  assert(c?.documentCount === 1, `child counts its 1 direct document (${c?.documentCount})`);

  console.log('\n# listFolders (type filter)');
  const filtered = await f.call('listFolders', { type: 'RollTable' });
  assert(
    (filtered?.folders ?? []).every(x => x.type === 'RollTable'),
    'type filter returns only RollTable folders'
  );
  assert(
    (filtered?.folders ?? []).some(x => x.id === parentId),
    'filtered list still contains the fixture'
  );
  const actorsOnly = await f.call('listFolders', { type: 'Actor' });
  assert(
    (actorsOnly?.folders ?? []).every(x => x.type === 'Actor'),
    'an Actor filter excludes the RollTable fixture'
  );

  // --- manage-folders through the registry (the M8 union: action create / list / update / delete)
  console.log('\n# manage-folders (action) through dispatch');
  const { dispatch, tools } = buildToolRegistry({
    foundry: f,
    logger: new Logger({ level: 'error' }),
    host: cfg.host,
  });
  const names = new Set(tools.map(t => t.name));
  assert(
    names.has('manage-folders') &&
      ['list-folders', 'create-folder', 'update-folder', 'delete-folder'].every(n => !names.has(n)),
    'manage-folders is advertised, the four per-op tools are gone'
  );
  const mf = args => dispatch('manage-folders', args);
  const cr = String(
    await mf({
      action: 'create',
      name: `${TAG} Union`,
      type: 'RollTable',
      parentFolder: parentId,
      color: '#123456',
    })
  );
  const unionId = /\((\w+)\)$/.exec(cr)?.[1];
  assert(
    !!unionId && cr === `Created RollTable folder "${TAG} Union" (${unionId})`,
    `create: the one-line confirmation (${cr})`
  );
  const listed = String(await mf({ action: 'list', type: 'RollTable' })).split('\n');
  assert(
    /^\d+ RollTable folder\(s\): id name type depth path color sort parent docs subfolders$/.test(
      listed[0] ?? ''
    ),
    `list: the header names the type filter and the columns (${listed[0]})`
  );
  const unionRow = listed.find(x => x.startsWith(`${unionId} `)) ?? '';
  assert(
    unionRow ===
      `${unionId} "${TAG} Union" RollTable 1 "${TAG} Parent/${TAG} Union" #123456 0 ${parentId} 0 0`,
    `list row: depth 1 under the parent, the path, the color, the parent id (${unionRow})`
  );
  const parentRow = listed.find(x => x.startsWith(`${parentId} `)) ?? '';
  assert(
    parentRow.endsWith(' 0 2') && parentRow.includes(' - 0 '),
    `list row: the parent counts its two subfolders, root parent, sort 0 (${parentRow})`
  );
  assert(
    listed.indexOf(parentRow) < listed.indexOf(unionRow),
    'list: DFS order — the parent line precedes its child'
  );
  const up = String(
    await mf({
      action: 'update',
      identifier: unionId,
      type: 'RollTable',
      name: `${TAG} Union 2`,
      parentFolder: '',
      sort: 5,
    })
  );
  assert(
    up === `Updated RollTable folder → "${TAG} Union 2" (${unionId}) [sort 5]`,
    `update: rename + reparent to the root + sort on one line (${up})`
  );
  const rootRow =
    String(await mf({ action: 'list', type: 'RollTable' }))
      .split('\n')
      .find(x => x.startsWith(`${unionId} `)) ?? '';
  assert(
    rootRow === `${unionId} "${TAG} Union 2" RollTable 0 "${TAG} Union 2" #123456 5 - 0 0`,
    `list reads the update back: depth 0, root parent, sort 5 (${rootRow})`
  );
  for (const [args, want] of [
    [
      { action: 'move', identifier: 'x' },
      'action must be one of "create", "list", "update", "delete"',
    ],
    [
      { action: 'delete', identifiers: ['x'] },
      'unknown argument "identifiers" — it takes: action, identifier, type, deleteContents',
    ],
    [
      { action: 'update', identifier: 'ZZ-no-such-folder', type: 'RollTable', name: 'x' },
      'Folder not found: "ZZ-no-such-folder" (type RollTable). Nothing changed.',
    ],
    [
      { action: 'delete', identifier: 'ZZ-no-such-folder', type: 'RollTable' },
      'Folder not found: "ZZ-no-such-folder" (type RollTable). Nothing deleted.',
    ],
    [
      { action: 'delete', identifier: parentId, type: 'RollTable' },
      'is not empty (0 document(s), 1 subfolder(s))',
    ],
  ]) {
    let msg = '';
    try {
      await mf(args);
    } catch (e) {
      msg = e?.message ?? String(e);
    }
    assert(msg.includes(want), `refused by name / a miss is an error: ${want.slice(0, 60)}`);
  }
  const del = String(await mf({ action: 'delete', identifier: unionId, type: 'RollTable' }));
  assert(
    del === `Deleted RollTable folder "${TAG} Union 2" (${unionId}) (was empty)`,
    `delete: the one-line confirmation (${del})`
  );
} catch (e) {
  fails++;
  console.log(`\n[verify-folders] FATAL: ${e?.stack || e?.message || String(e)}`);
} finally {
  try {
    if (tableId) await f.call('deleteRollTables', { identifiers: [tableId] });
    if (parentId) {
      await f.call('deleteFolder', {
        identifier: parentId,
        type: 'RollTable',
        deleteContents: true,
      });
    }
    console.log('\n[verify-folders] cleaned up fixture folders + table');
  } catch (e) {
    console.log(`\n[verify-folders] cleanup note: ${e?.message || e}`);
  }
  await f.dispose?.();
}

console.log(`\n==== folder-tooling verification: ${passes} passed, ${fails} failed ====`);
process.exit(fails > 0 ? 1 : 0);
