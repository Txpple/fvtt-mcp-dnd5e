// Live verify for receipts on every write (issue #6): the page's choke point records each write
// tool's documents under the write lock, the registry keeps one receipt per tool call in the store
// and appends its line, and `run-script { undo }` reverses it.
//   FOUNDRY_HOST=local node scripts/verify-receipts.mjs
// Drives buildToolRegistry().dispatchWithReceipt, what the server answers with:
//   - an actor: create-actor-from-compendium → undo (gone) → undo of the undo (back with its id:
//     the redo, once) → manage-actors update of a system field → undo (the prior value) → the
//     same update put back by hand, then undone (nothing to put back; the receipt still marked
//     undone) → manage-actors delete → undo (back with its id, and its folder);
//   - a scene placeable, a light on the active scene: create → undo → create → update → undo →
//     delete → undo;
//   - a journal page: create-quest-journal → undo → create → update-quest-journal → undo (the
//     page's prior content) → manage-journals delete-page → undo (the page back, its id, its content);
//   - a run-script run that creates two actors: the same receipt line, one undo;
//   - two writes in flight at once: two receipts, each with only its own documents, each undo only
//     its own;
//   - the store: the file is there and marked undone after the undo; a wrong id is refused by name;
//   - a write marked UNRECORDED (the seat marker's option) stays out of a receipt;
//   - a partial undo (issue #6's review): a receipt planted in the store whose delete names a parent
//     that does not exist; its undo reverses the rest, says what it could not, and leaves the
//     receipt undoable; a second undo is accepted;
//   - a run-script run abandoned at its 1 s timeout while its createActorFromCompendium (quantity 3)
//     is in flight: the three creates are in the run's own receipt, none in the next call's, and
//     the run's undo removes them;
//   - two run-script calls issued together: the second runs after the first, and its op cap never
//     counts the wait (no "still running" warning from the bridge, no page closed; about 35 s);
//   - the cost of the choke point, timed in the page (printed, not a check).
// Everything is named ZZ-receipts… (the lights are tracked by id) and deleted in finally, through
// the bridge without a receipt; the receipt files this run made are removed from the store.
// Build first: npm run build.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { UNRECORDED } from '../dist/page/_receipts.js';
import { callContext, receiptsDir, receiptWorldKey, saveReceipt } from '../dist/receipts.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const TAG = 'ZZ-receipts';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const env = loadEnv();
const cfg = bridgeConfig(env);
const warned = []; // the bridge's warnings: the op cap's "still running" is one
const quiet = {
  debug() {},
  info() {},
  warn: m => warned.push(m),
  error: m => console.log(`  [bridge] ${m}`),
};
const f = new Foundry(cfg, quiet);
const { dispatchWithReceipt } = buildToolRegistry({
  foundry: f,
  logger: new Logger({ level: 'error', format: 'simple', enableConsole: false, enableFile: false }),
  host: cfg.host,
  serverUrl: cfg.serverUrl,
});

const made = new Set(); // receipt ids this run made: removed from the store at the end
const lights = new Set(); // light ids this run placed on the active scene
let worldKey = '';

/** Call a tool as the server does: its result, its receipt line and the receipt id in it. */
async function tool(name, args) {
  const { result, receiptLine } = await dispatchWithReceipt(name, args);
  const id = /^receipt (rcpt_[0-9a-z]{6})/.exec(receiptLine ?? '')?.[1] ?? null;
  if (id) made.add(id);
  return { result, line: receiptLine ?? '', id };
}
const undo = id => tool('run-script', { undo: id });
/** A run's return value, read back from the tool's text (the JSON after `Result:`). */
const resultOf = text => {
  const at = text.indexOf('\nResult:\n');
  try {
    return at < 0 ? null : JSON.parse(text.slice(at + 9));
  } catch {
    return null;
  }
};
/** A look at the world (an evaluate: no receipt, no recorder). */
const look = (fn, arg) => f.evaluate(fn, arg);
const stored = id => {
  try {
    return JSON.parse(readFileSync(join(receiptsDir(), `${worldKey}-${id}.json`), 'utf8'));
  } catch {
    return null;
  }
};
const actorsNamed = prefix =>
  look(
    p =>
      game.actors
        .filter(a => a.name.startsWith(p))
        .map(a => ({ id: a.id, name: a.name, folder: a.folder?.name ?? null }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    prefix
  );

try {
  await f.connect();
  const worldId = await f.worldId();
  worldKey = receiptWorldKey(cfg.serverUrl, worldId);
  console.log(`[verify-receipts] connected — world "${worldId}", store ${receiptsDir()}`);

  const found = await f.call('searchCompendium', { query: 'Goblin', limit: 20 });
  const npcs = (found?.results ?? []).filter(r => r.type === 'npc');
  const goblin = npcs.find(r => /^Goblin$/i.test(r.name)) ?? npcs[0];
  if (!goblin) throw new Error('no creature in the compendia to copy');
  const createArgs = names => ({ packId: goblin.pack, itemId: goblin.id, names, folder: TAG });

  // ── 1. An actor ────────────────────────────────────────────────────────────────────────────────
  console.log(`\n# an actor (copies of ${goblin.name}, ${goblin.pack})`);
  const c1 = await tool('create-actor-from-compendium', createArgs([`${TAG} Goblin`]));
  const [actor] = await actorsNamed(`${TAG} Goblin`);
  const kept = !!c1.id && existsSync(join(receiptsDir(), `${worldKey}-${c1.id}.json`));
  check(
    'create-actor-from-compendium answers a receipt line, and the receipt is in the store',
    kept && !!actor && /: [1-9]\d* created, \d+ updated, 0 deleted/.test(c1.line),
    c1.line
  );
  const u1 = await undo(c1.id);
  check(
    'undo deletes what it created (the actor, the folder it made); the receipt is marked undone',
    (await actorsNamed(`${TAG} Goblin`)).length === 0 &&
      stored(c1.id)?.undoneBy === u1.id &&
      new RegExp(
        `^receipt rcpt_\\w{6} \\(reverses ${c1.id}\\): 0 created, 0 updated, [1-9]\\d* deleted`
      ).test(u1.line),
    `${u1.result} | ${u1.line}`
  );
  const r1 = await undo(u1.id);
  const [back] = await actorsNamed(`${TAG} Goblin`);
  check(
    'undo of the undo (the redo) brings the actor back with its id, in its folder',
    back?.id === actor?.id && back?.folder === TAG && /\(reverses /.test(r1.line),
    `${r1.result} | ${r1.line}`
  );
  const twice = await undo(u1.id).then(
    () => 'reversed a second time',
    e => e.message
  );
  check('…once: the same undo is not reversed twice', /already undone by rcpt_/.test(twice), twice);

  const hpOf = id =>
    look(i => game.actors.get(i)?._source?.system?.attributes?.hp?.value ?? null, id);
  const hp0 = await hpOf(actor.id);
  const up = await tool('manage-actors', {
    action: 'update',
    actorIdentifier: actor.id,
    hp: { value: hp0 === 1 ? 2 : 1 },
  });
  const hp1 = await hpOf(actor.id);
  const uu = await undo(up.id);
  const hp2 = await hpOf(actor.id);
  check(
    'manage-actors update names the changed path; undo puts the prior value back',
    hp1 !== hp0 &&
      hp2 === hp0 &&
      /: 0 created, 1 updated, 0 deleted \(Actor "ZZ-receipts Goblin": [^)]*system\.attributes\.hp\.value/.test(
        up.line
      ),
    `hp ${hp0} → ${hp1} → ${hp2} | ${up.line} | ${uu.line}`
  );

  // The value put back by hand before the undo: the undo changes nothing, and still settles it.
  const up2 = await tool('manage-actors', {
    action: 'update',
    actorIdentifier: actor.id,
    hp: { value: hp0 === 1 ? 2 : 1 },
  });
  await tool('manage-actors', { action: 'update', actorIdentifier: actor.id, hp: { value: hp0 } });
  const nu = await undo(up2.id);
  const hp3 = await hpOf(actor.id);
  const settled = await undo(up2.id).then(
    () => 'undone a second time',
    e => e.message
  );
  check(
    'an undo that finds the value already back (put back by hand) says so and marks the receipt undone',
    hp3 === hp0 &&
      nu.id === null &&
      nu.line === `reverses ${up2.id}: nothing to put back (the world already matched)` &&
      stored(up2.id)?.undoneBy === 'nothing to put back' &&
      settled.includes(`receipt ${up2.id} was already undone: the world already matched it.`),
    `${nu.line} | stored: undoneBy ${stored(up2.id)?.undoneBy} | ${settled}`
  );

  const del = await tool('manage-actors', { action: 'delete', identifiers: [actor.id] });
  const deleted = (await actorsNamed(`${TAG} Goblin`)).length === 0;
  const ud = await undo(del.id);
  const [restored] = await actorsNamed(`${TAG} Goblin`);
  check(
    'manage-actors delete → undo: the actor is back with its id, in its folder',
    deleted &&
      restored?.id === actor.id &&
      restored?.folder === TAG &&
      /: 0 created, 0 updated, [1-9]\d* deleted \(Actor "ZZ-receipts Goblin"/.test(del.line),
    `${del.line} | ${ud.line}`
  );

  // ── 2. A scene placeable ───────────────────────────────────────────────────────────────────────
  const scene = await look(() => {
    const s = game.scenes.active;
    return s
      ? { id: s.id, name: s.name, x: s.dimensions?.sceneX ?? 0, y: s.dimensions?.sceneY ?? 0 }
      : null;
  });
  console.log(`\n# a scene placeable (a light on the active scene, "${scene?.name}")`);
  if (!scene) throw new Error('no active scene on the sandbox');
  const lightOf = id =>
    look(
      ({ s, l }) => {
        const d = game.scenes.get(s)?.lights.get(l);
        return d ? { id: d.id, dim: d._source.config.dim } : null;
      },
      { s: scene.id, l: id }
    );
  const place = async () => {
    const r = await tool('manage-placeables', {
      kind: 'lights',
      action: 'create',
      lights: [{ x: scene.x + 150, y: scene.y + 150, dim: 20, bright: 10 }],
    });
    const id = /•\s+(\w{16})/.exec(String(r.result))?.[1] ?? null;
    if (id) lights.add(id);
    return { ...r, lightId: id };
  };
  const l1 = await place();
  const lu1 = await undo(l1.id);
  check(
    'lights create → undo: the light is gone',
    !!l1.lightId && !!l1.id && (await lightOf(l1.lightId)) === null,
    `${l1.line} | ${lu1.line}`
  );
  const l2 = await place();
  const before = await lightOf(l2.lightId);
  const lup = await tool('manage-placeables', {
    kind: 'lights',
    action: 'update',
    lightPatches: [{ id: l2.lightId, dim: 30 }],
  });
  const mid = await lightOf(l2.lightId);
  const luu = await undo(lup.id);
  const after = await lightOf(l2.lightId);
  check(
    'lights update → undo: dim back to its prior value',
    mid?.dim !== before?.dim && after?.dim === before?.dim && /config\.dim/.test(lup.line),
    `dim ${before?.dim} → ${mid?.dim} → ${after?.dim} | ${lup.line} | ${luu.line}`
  );
  const ldel = await tool('manage-placeables', {
    kind: 'lights',
    action: 'delete',
    lightIds: [l2.lightId],
  });
  const dark = (await lightOf(l2.lightId)) === null;
  const ldu = await undo(ldel.id);
  const relit = await lightOf(l2.lightId);
  check(
    'lights delete → undo: the light is back with its id and its config',
    dark && relit?.id === l2.lightId && relit?.dim === before?.dim,
    `${ldel.line} | ${ldu.line}`
  );

  // ── 3. A journal page ──────────────────────────────────────────────────────────────────────────
  console.log('\n# a journal page');
  const quest = {
    title: `${TAG} Quest`,
    pages: [{ name: 'Clues', blocks: [{ type: 'paragraph', html: 'Original words.' }] }],
  };
  const j1 = await tool('create-quest-journal', quest);
  const ju1 = await undo(j1.id);
  check(
    'create-quest-journal → undo: the journal is gone',
    !!j1.result?.journalId &&
      !!j1.id &&
      (await look(id => !game.journal.get(id), j1.result.journalId)),
    `${j1.line} | ${ju1.line}`
  );
  const j2 = await tool('create-quest-journal', quest);
  const journalId = j2.result?.journalId;
  const pageId = j2.result?.pages?.[0]?.id;
  const contentOf = () =>
    look(({ j, p }) => game.journal.get(j)?.pages.get(p)?.text?.content ?? null, {
      j: journalId,
      p: pageId,
    });
  const c0 = await contentOf();
  const jup = await tool('update-quest-journal', {
    journalId,
    pageId,
    blocks: [{ type: 'paragraph', html: 'Appended words.' }],
  });
  const cMid = await contentOf();
  const juu = await undo(jup.id);
  const cBack = await contentOf();
  check(
    "update-quest-journal → undo: the page's prior content",
    typeof c0 === 'string' &&
      cMid?.includes('Appended words.') &&
      cBack === c0 &&
      /JournalEntryPage "Clues": [^)]*text\.content/.test(jup.line),
    `${jup.line} | ${juu.line}`
  );
  const jdel = await tool('manage-journals', { action: 'delete-page', journalId, pageId });
  const pageGone = (await contentOf()) === null;
  const jdu = await undo(jdel.id);
  check(
    'manage-journals delete-page → undo: the page is back with its id and its content',
    pageGone &&
      (await contentOf()) === c0 &&
      /deleted \(JournalEntryPage "Clues"\)/.test(jdel.line),
    `${jdel.line} | ${jdu.line}`
  );

  // ── 4. run-script: one receipt for the run ─────────────────────────────────────────────────────
  console.log('\n# run-script');
  const run = await tool('run-script', {
    script: `const r = await fvtt.createActorFromCompendium({ packId: ${JSON.stringify(goblin.pack)}, itemId: ${JSON.stringify(goblin.id)}, customNames: ["${TAG} Script A", "${TAG} Script B"], quantity: 2, folder: ${JSON.stringify(TAG)} });
    return r.totalCreated;`,
  });
  const pair = (await actorsNamed(`${TAG} Script`)).length;
  const ru = await undo(run.id);
  check(
    'a run that creates two actors answers the same receipt line; one undo removes both',
    pair === 2 &&
      (await actorsNamed(`${TAG} Script`)).length === 0 &&
      /^receipt rcpt_\w{6}: 2 created, \d+ updated, 0 deleted.* · undo: run-script/.test(
        run.line
      ) &&
      /✅ Done/.test(String(run.result)),
    `${String(run.result).split('\n')[0]} | ${run.line} | ${ru.line}`
  );

  // ── 5. Two writes in flight at once ────────────────────────────────────────────────────────────
  console.log("\n# create-pc: the build's own advancement switch is not part of the receipt");
  const pc = await tool('create-pc', {
    name: `${TAG} PC`,
    className: 'Fighter',
    level: 1,
    acceptDefaults: true,
    defaultArt: false,
  });
  check(
    'create-pc answers a receipt with the actor only, not the dnd5e.disableAdvancements switch (4.4.1)',
    !!pc.id && /1 created/.test(pc.line) && !/Setting/.test(pc.line),
    pc.line
  );
  if (pc.id) {
    const pcUndo = await undo(pc.id);
    check(
      'undoing the PC build removes the actor and touches no setting',
      /1 deleted/.test(pcUndo.line) &&
        !/Setting/.test(pcUndo.line) &&
        (await actorsNamed(`${TAG} PC`)).length === 0,
      pcUndo.line
    );
  }

  console.log('\n# two writes in flight');
  const [p, q] = await Promise.all([
    tool('create-actor-from-compendium', createArgs([`${TAG} Pair P`])),
    tool('create-actor-from-compendium', createArgs([`${TAG} Pair Q`])),
  ]);
  const pairs = await actorsNamed(`${TAG} Pair`);
  const idOf = suffix => pairs.find(a => a.name.endsWith(suffix))?.id;
  const onlyOwn = (receipt, mine, other) =>
    !!receipt &&
    receipt.ops.some(o => o.uuid === `Actor.${mine}`) &&
    !receipt.ops.some(o => o.uuid.startsWith(`Actor.${other}`));
  check(
    'two creates at once: two receipts, each with only its own actor',
    !!p.id &&
      !!q.id &&
      p.id !== q.id &&
      onlyOwn(stored(p.id), idOf(' P'), idOf(' Q')) &&
      onlyOwn(stored(q.id), idOf(' Q'), idOf(' P')),
    `${p.line} | ${q.line}`
  );
  await undo(p.id);
  const afterP = (await actorsNamed(`${TAG} Pair`)).map(a => a.name);
  await undo(q.id);
  const afterQ = (await actorsNamed(`${TAG} Pair`)).map(a => a.name);
  check(
    '…and each undo removes only its own',
    JSON.stringify(afterP) === JSON.stringify([`${TAG} Pair Q`]) && afterQ.length === 0,
    `after P's undo ${JSON.stringify(afterP)}, after Q's ${JSON.stringify(afterQ)}`
  );

  // ── 6. The store's refusal ─────────────────────────────────────────────────────────────────────
  console.log('\n# the store');
  const wrong = await undo('rcpt_zzzzzz').then(
    () => 'accepted',
    e => e.message
  );
  check(
    'an undo with a wrong id is refused by name',
    /receipt rcpt_zzzzzz is not in the store/.test(wrong),
    wrong
  );

  // ── 7. UNRECORDED: the seat marker's option keeps a write out of a receipt ─────────────────────
  console.log('\n# UNRECORDED');
  const ctx = { ops: [] };
  const slow = callContext.run(ctx, () =>
    f.call('runScript', { src: 'await new Promise(r => setTimeout(r, 1500)); return 1;' })
  );
  await sleep(400);
  await f.evaluate(async u => {
    await game.user.update({ 'flags.world.zzReceiptMarked': 1 }, { [u]: true });
    await game.user.update({ 'flags.world.zzReceiptUnmarked': 1 });
  }, UNRECORDED);
  await slow;
  const userPaths = ctx.ops
    .filter(o => o.documentName === 'User')
    .flatMap(o => [...Object.keys(o.pre ?? {}), ...(o.absent ?? [])]);
  check(
    "a write marked UNRECORDED stays out of the recording window's receipt; an unmarked one is in it",
    userPaths.includes('flags.world.zzReceiptUnmarked') &&
      !userPaths.includes('flags.world.zzReceiptMarked'),
    JSON.stringify(userPaths)
  );

  // ── 8. A partial undo leaves its receipt undoable (issue #6's review) ──────────────────────────
  console.log('\n# a partial undo');
  const partialId = await look(
    async name => (await CONFIG.Actor.documentClass.create({ name, type: 'npc' })).id,
    `${TAG} Partial`
  );
  const ghost = 'zzzzzzzzzzzzzzzz'; // an actor id the world does not have
  const planted = saveReceipt({
    at: new Date().toISOString(),
    serverUrl: cfg.serverUrl,
    worldId,
    tool: 'verify-receipts',
    ops: [
      {
        kind: 'create',
        documentName: 'Actor',
        uuid: `Actor.${partialId}`,
        label: `${TAG} Partial`,
      },
      {
        kind: 'delete',
        documentName: 'Item',
        uuid: `Actor.${ghost}.Item.${ghost}`,
        label: `${TAG} Ghost`,
        parentUuid: `Actor.${ghost}`,
        pre: { _id: ghost, name: `${TAG} Ghost`, type: 'loot' },
      },
    ],
  });
  made.add(planted.id);
  const pu = await undo(planted.id);
  const afterPartial = stored(planted.id);
  check(
    'an undo that cannot reverse every write says which, and leaves the receipt undoable',
    String(pu.result).includes(`↩️ Receipt ${planted.id}: 1 write(s) reversed.`) &&
      String(pu.result).includes(
        `1 could not be reversed; receipt ${planted.id} stays undoable:`
      ) &&
      String(pu.result).includes(`its parent Actor.${ghost} is gone`) &&
      (await actorsNamed(`${TAG} Partial`)).length === 0 &&
      pu.line.startsWith(
        `receipt ${pu.id} (partly reverses ${planted.id}): 0 created, 0 updated, 1 deleted`
      ) &&
      afterPartial?.undoneBy === undefined &&
      !!afterPartial?.partialUndoBy?.includes(pu.id),
    `${String(pu.result).replaceAll('\n', ' / ')} | ${pu.line} | stored: undoneBy ${afterPartial?.undoneBy}, partialUndoBy ${JSON.stringify(afterPartial?.partialUndoBy)}`
  );
  const pu2 = await undo(planted.id).then(
    r => r,
    e => ({ result: e.message, line: '', id: null })
  );
  check(
    '…and a second undo of it is accepted: what is already back is left alone',
    String(pu2.result).includes(`receipt ${planted.id} stays undoable`) &&
      !String(pu2.result).includes('already undone') &&
      pu2.line === '',
    String(pu2.result).replaceAll('\n', ' / ')
  );

  // ── 9. A run abandoned at its timeout with its creates in flight (issue #6's review) ───────────
  console.log('\n# a run abandoned at its timeout, its creates in flight');
  const lateNames = ['A', 'B', 'C'].map(s => `${TAG} Late ${s}`);
  // the create starts 0.95 s in, so the 1 s timeout comes while its three copies are being made
  const late = await tool('run-script', {
    script: `log("three copies");
      await new Promise(r => setTimeout(r, 950));
      const r = await fvtt.createActorFromCompendium({ packId: ${JSON.stringify(goblin.pack)}, itemId: ${JSON.stringify(goblin.id)}, customNames: ${JSON.stringify(lateNames)}, quantity: 3, folder: ${JSON.stringify(TAG)} });
      return r.totalCreated;`,
    timeoutSeconds: 1,
  });
  const lateActors = await actorsNamed(`${TAG} Late`);
  const lateOps = stored(late.id)?.ops ?? [];
  check(
    'a run abandoned at its timeout waits for its creates in flight: all three are in its own receipt',
    String(late.result).includes('exceeded 1 s and was abandoned') &&
      String(late.result).includes(
        'settled within the 15 s grace: their writes are in the receipt'
      ) &&
      lateActors.length === 3 &&
      lateActors.every(a => lateOps.some(o => o.kind === 'create' && o.uuid === `Actor.${a.id}`)),
    `${String(late.result).split('\n').slice(0, 2).join(' / ')} | ${late.line}`
  );
  const next = await tool('create-actor-from-compendium', createArgs([`${TAG} Next`]));
  const [nextActor] = await actorsNamed(`${TAG} Next`);
  const nextOps = stored(next.id)?.ops ?? [];
  check(
    "…none of them lands in the next call's receipt",
    !!nextActor &&
      nextOps.some(o => o.uuid === `Actor.${nextActor.id}`) &&
      !lateActors.some(a => nextOps.some(o => o.uuid.startsWith(`Actor.${a.id}`))),
    next.line
  );
  await undo(next.id);
  const lateUndo = await undo(late.id);
  check(
    "…and the run's undo removes all three",
    (await actorsNamed(`${TAG} Late`)).length === 0,
    lateUndo.line
  );

  // ── 10. Two run-script calls issued together (issue #6's review) ───────────────────────────────
  // The second's op cap is its 1 s timeout + 30 s; the first takes 33 s. Waiting inside the page for
  // the first, its cap ran out at 31 s and the bridge logged it as still running; waiting in this
  // process, it is issued when the first is done.
  console.log('\n# two run-script calls issued together (about 35 s)');
  warned.length = 0;
  const [first, second] = await Promise.all([
    tool('run-script', {
      script:
        'const start = Date.now(); await new Promise(r => setTimeout(r, 33000)); return { start, end: Date.now() };',
      timeoutSeconds: 60,
    }),
    tool('run-script', { script: 'return { start: Date.now() };', timeoutSeconds: 1 }),
  ]);
  const firstAt = resultOf(String(first.result));
  const secondAt = resultOf(String(second.result));
  const capped = warned.filter(w => /still running after|closed its page/.test(w));
  check(
    "two run-script calls issued together run one after the other; the second's cap never counts the wait",
    String(first.result).startsWith('✅ Done') &&
      String(second.result).startsWith('✅ Done') &&
      typeof firstAt?.end === 'number' &&
      typeof secondAt?.start === 'number' &&
      secondAt.start >= firstAt.end &&
      capped.length === 0 &&
      f.isReady(),
    `first ${firstAt?.end - firstAt?.start} ms, second issued ${secondAt?.start - firstAt?.end} ms after it ended; op-cap warnings ${capped.length}`
  );

  // ── 11. The cost of the choke point, timed in the page ─────────────────────────────────────────
  console.log('\n# the cost (in the page, 20 calls each)');
  const [subject] = await actorsNamed(`${TAG} Goblin`);
  const cost = await look(
    async ({ id, n }) => {
      const call = (record, args) => window.__fvttCall('updateActor', args, { record });
      const per = async (record, argsOf) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) await call(record, argsOf(i));
        return (performance.now() - t0) / n;
      };
      const name = game.actors.get(id).name;
      const hp = game.actors.get(id)._source.system.attributes.hp.value;
      const noop = () => ({ actorIdentifier: id, name });
      const real = i => ({ actorIdentifier: id, hp: { value: (i % 2) + 1 } });
      const out = {
        noopOff: await per(false, noop),
        noopOn: await per(true, noop),
        realOff: await per(false, real),
        realOn: await per(true, real),
      };
      await call(false, { actorIdentifier: id, hp: { value: hp } });
      const classes = Object.keys(CONFIG).filter(
        k => typeof CONFIG[k]?.documentClass === 'function' && k !== 'FogExploration'
      );
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const ids = [];
        for (const c of classes) {
          for (const h of ['preCreate', 'create', 'preUpdate', 'preDelete'])
            ids.push([h + c, Hooks.on(h + c, () => {})]);
        }
        for (const [h, hid] of ids) Hooks.off(h, hid);
      }
      out.hooksOnOff = (performance.now() - t0) / n;
      out.classes = classes.length;
      const doc = game.actors.get(id);
      const t1 = performance.now();
      let chars = 0;
      for (let i = 0; i < n; i++) chars = JSON.stringify(doc.toObject()).length;
      out.deletePreImage = (performance.now() - t1) / n;
      out.actorChars = chars;
      return out;
    },
    { id: subject?.id, n: 20 }
  ).catch(e => ({ error: e.message }));
  const ms = v => (typeof v === 'number' ? `${v.toFixed(2)} ms` : String(v));
  if (cost.error) console.log(`  cost not measured: ${cost.error}`);
  else {
    console.log(
      `  hooks on + off (${cost.classes} classes × 4): ${ms(cost.hooksOnOff)} per write\n` +
        `  a no-op update (no round trip): ${ms(cost.noopOff)} unrecorded, ${ms(cost.noopOn)} recorded\n` +
        `  a real update (one round trip): ${ms(cost.realOff)} unrecorded, ${ms(cost.realOn)} recorded (with its pre-image)\n` +
        `  a delete's pre-image (toObject + size, ${cost.actorChars.toLocaleString('en-US')} chars of actor): ${ms(cost.deletePreImage)}`
    );
  }
} catch (e) {
  check('the run reached its end', false, e?.stack ?? String(e));
} finally {
  const left = await f
    .evaluate(
      async ({ tag, lightIds, u }) => {
        const gone = { actors: 0, journals: 0, folders: 0, lights: 0 };
        const actors = game.actors.filter(a => a.name.startsWith(tag)).map(a => a.id);
        if (actors.length) await CONFIG.Actor.documentClass.deleteDocuments(actors);
        gone.actors = actors.length;
        const journals = game.journal.filter(j => j.name.startsWith(tag)).map(j => j.id);
        if (journals.length) await CONFIG.JournalEntry.documentClass.deleteDocuments(journals);
        gone.journals = journals.length;
        const folders = game.folders.filter(fo => fo.name.startsWith(tag)).map(fo => fo.id);
        if (folders.length) await CONFIG.Folder.documentClass.deleteDocuments(folders);
        gone.folders = folders.length;
        const scene = game.scenes.active;
        const ids = lightIds.filter(id => scene?.lights.get(id));
        if (ids.length) await scene.deleteEmbeddedDocuments('AmbientLight', ids);
        gone.lights = ids.length;
        await game.user.update(
          { 'flags.world.-=zzReceiptMarked': null, 'flags.world.-=zzReceiptUnmarked': null },
          { [u]: true }
        );
        return gone;
      },
      { tag: TAG, lightIds: [...lights], u: UNRECORDED }
    )
    .catch(e => ({ error: e.message }));
  console.log(`\n[verify-receipts] cleanup: ${JSON.stringify(left)}`);
  const remains = await f
    .evaluate(
      ({ tag, lightIds }) => [
        ...game.actors.filter(a => a.name.startsWith(tag)).map(a => a.name),
        ...game.journal.filter(j => j.name.startsWith(tag)).map(j => j.name),
        ...game.folders.filter(fo => fo.name.startsWith(tag)).map(fo => fo.name),
        ...lightIds.filter(id => game.scenes.active?.lights.get(id)),
        ...Object.keys(game.user.flags?.world ?? {}).filter(k => k.startsWith('zzReceipt')),
      ],
      { tag: TAG, lightIds: [...lights] }
    )
    .catch(e => [`(not read: ${e.message})`]);
  for (const id of made) rmSync(join(receiptsDir(), `${worldKey}-${id}.json`), { force: true });
  const files = made.size
    ? [...made].filter(id => existsSync(join(receiptsDir(), `${worldKey}-${id}.json`)))
    : [];
  check(
    'the world is left as found, and the receipts this run made are out of the store',
    remains.length === 0 && files.length === 0,
    `${remains.length} ZZ document(s) left, ${files.length} receipt file(s) left of ${made.size}`
  );
  await f.dispose();
}
const passed = checks.filter(c => c.ok).length;
console.log(`\n[verify-receipts] ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
