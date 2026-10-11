// Live verify for run-script (issue #4): the page op and the tool against a real world.
//   FOUNDRY_HOST=local node scripts/verify-run-script.mjs
// Reads, a dry run (stubbing by the op table: a remap is a write, an area-sounds list a read), real
// runs whose receipt is the line every write answers with (issue #6: the registry keeps it, the
// page keeps nothing), undo by that id, the caps, the timeout, the shadowed globals, the static
// refusal, and last a synchronous loop cut by the bridge's op cap (the page is closed and the next
// call re-joins: ~40 s plus a join). The runs that need a receipt go through
// buildToolRegistry().dispatchWithReceipt, as the server answers; the page-level checks call the op.
// Temp documents are ZZ-* and deleted in finally, and the receipts this run made leave the store.
// Needs a built dist/ (the registry and the page bundle come from there).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { connectFoundry } from '../dist/client.js';
import { Logger } from '../dist/logger.js';
import { receiptsDir, receiptWorldKey } from '../dist/receipts.js';
import { buildToolRegistry } from '../dist/registry.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};

const { f, host, hostConfig, dispose } = await connectFoundry({
  identity: 'bridge',
  tag: 'verify-run-script',
  watchdogMs: 300_000,
});
const logger = new Logger({
  level: 'error',
  format: 'simple',
  enableConsole: false,
  enableFile: false,
});
const { dispatchWithReceipt } = buildToolRegistry({
  foundry: f,
  logger,
  host,
  serverUrl: hostConfig.serverUrl,
});
const made = new Set(); // receipt ids this run made: removed from the store at the end
/** The tool as the server answers it: its text, its receipt line, the receipt id in that line. */
const tool = async args => {
  const { result, receiptLine } = await dispatchWithReceipt('run-script', args);
  const id = /^receipt (rcpt_[0-9a-z]{6})/.exec(receiptLine ?? '')?.[1] ?? null;
  if (id) made.add(id);
  return { text: String(result), line: receiptLine ?? '', id };
};
/** A run's return value, read back from the tool's text (the JSON after `Result:`). */
const resultOf = text => {
  const at = text.indexOf('\nResult:\n');
  try {
    return at < 0 ? null : JSON.parse(text.slice(at + 9));
  } catch {
    return null;
  }
};
const created = line => Number(/: (\d+) created/.exec(line)?.[1] ?? 0);
const FOLDER = 'ZZ-run-script';
let receiptId = null;
try {
  // 1. A read.
  const read = await f.call('runScript', {
    src: 'const a = await fvtt.listActors({}); log("n", a.length); return a.length;',
  });
  check(
    'a read runs and returns',
    read.ok && typeof read.result === 'number' && read.log[0]?.startsWith('n '),
    JSON.stringify(read.receipt)
  );

  // 2. The habitual globals are shadowed (an accident guard, not a boundary: issue #15).
  const shadow = await f.call('runScript', {
    src: 'return [typeof game, typeof canvas, typeof window, typeof fromUuid, typeof Actor].join(",");',
  });
  check(
    'the shadowed globals read undefined',
    shadow.ok && shadow.result === 'undefined,undefined,undefined,undefined,undefined',
    String(shadow.result)
  );

  // 3. The goblin to copy.
  const found = await f.call('runScript', {
    src: 'const r = await fvtt.searchCompendium({ query: "Goblin", limit: 20 }); return r.results.filter(x => x.type === "npc");',
  });
  const results = Array.isArray(found.result) ? found.result : [];
  const goblin = results.find(r => /^Goblin$/i.test(r.name)) ?? results[0] ?? null;
  check(
    'searchCompendium through the facade finds a creature',
    !!goblin,
    goblin ? `${goblin.name} (${goblin.pack})` : JSON.stringify(found).slice(0, 200)
  );
  const packId = goblin?.pack;
  const itemId = goblin?.id;

  const makeTwo = `const r = await fvtt.createActorFromCompendium({ packId: ${JSON.stringify(packId)}, itemId: ${JSON.stringify(itemId)}, customNames: ["ZZ-run-script A", "ZZ-run-script B"], quantity: 2, folder: ${JSON.stringify(FOLDER)} });
    log("created", r.totalCreated);
    return r.actors.map(a => a.id ?? a._id ?? a);`;

  // 4. A dry run makes nothing.
  const dry = await f.call('runScript', { src: makeTwo, dryRun: true });
  const after = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).length;',
  });
  // The script reads `r.actors` off the stubbed write, so the dry run stops there by design (`ok` false, the writes reached are listed).
  check(
    'a dry run lists the write and makes nothing',
    dry.dryRun?.length === 1 &&
      dry.dryRun[0].fn === 'createActorFromCompendium' &&
      after.result === 0,
    `${dry.dryRun?.length} listed, ${after.result} made, ok=${dry.ok}`
  );

  // 4b. What a dry run stubs is the op table's (issue #14): the teleporter remap is a write, so it
  // is listed and stubbed (a real call answers `success`, `scenesScanned`, … instead) ...
  const remap = await f.call('runScript', {
    src: 'return await fvtt.remapSceneTeleporters({ sourceModule: "ZZ-none" });',
    dryRun: true,
  });
  check(
    'a dry run lists remapSceneTeleporters as a write and stubs it',
    remap.ok &&
      remap.dryRun?.length === 1 &&
      remap.dryRun[0].fn === 'remapSceneTeleporters' &&
      JSON.stringify(remap.result) === JSON.stringify({ dryRun: true }),
    `${JSON.stringify(remap.dryRun)} → ${JSON.stringify(remap.result)}`
  );

  // ... and an area-sounds list is a read, so a dry run runs it and returns the scene's real sets.
  const sounds = await f.call('runScript', {
    src: `const scene = await fvtt.getActiveScene();
    const r = await fvtt.configureAreaSounds({ action: "list", sceneIdentifier: scene.name });
    return { scene: scene.name, listed: r.scene?.name ?? null, sets: Array.isArray(r.sets) ? r.sets.length : null, dryRun: r.dryRun ?? false };`,
    dryRun: true,
  });
  check(
    'a dry run runs an area-sounds list (a read) and returns its real data',
    sounds.ok &&
      sounds.dryRun?.length === 0 &&
      sounds.result?.dryRun === false &&
      sounds.result?.listed === sounds.result?.scene &&
      typeof sounds.result?.sets === 'number',
    JSON.stringify(sounds.result ?? sounds.error)
  );

  // 5. A real run creates two actors; a SECOND run renames one and deletes the other — the
  // receipt of the second run counts an update and a delete of documents it did not create.
  const make = await tool({ script: makeTwo });
  const madeId = make.id;
  const pair = resultOf(make.text) ?? [];
  check(
    'a run that creates answers the receipt line counting the creates',
    /^✅ Done/.test(make.text) && created(make.line) >= 2 && pair.length === 2,
    make.line
  );
  const [a, b] = pair;
  const run = await tool({
    script: `await fvtt.updateActor({ actorIdentifier: ${JSON.stringify(a)}, name: "ZZ-run-script A2" });
    await fvtt.deleteActor({ identifiers: [${JSON.stringify(b)}], removeEmptyFolder: false });
    return true;`,
  });
  receiptId = run.id;
  check(
    'a run that updates and deletes answers a receipt line counting both',
    /: 0 created, 1 updated, 1 deleted \(Actor "ZZ-run-script A": [^;]*\bname\b[^;]*; Actor "ZZ-run-script B"\)/.test(
      run.line
    ),
    run.line
  );
  const live = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).map(a => a.name).sort();',
  });
  check(
    'after the run: A renamed, B gone',
    JSON.stringify(live.result) === JSON.stringify(['ZZ-run-script A2']),
    JSON.stringify(live.result)
  );

  // 6. Undo the second run through the tool: A's name restored, B back (same id); then undo the first: both gone.
  const undone2 = await tool({ undo: receiptId });
  receiptId = null;
  const undone = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).map(a => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name));',
  });
  const names = (undone.result ?? []).map(x => x.name);
  const bBack = (undone.result ?? []).find(x => x.name === 'ZZ-run-script B')?.id === b;
  check(
    'undo restores what the run changed and what it deleted, with its id',
    /reversed/.test(undone2.text) &&
      JSON.stringify(names) === JSON.stringify(['ZZ-run-script A', 'ZZ-run-script B']) &&
      bBack,
    `${undone2.text} → ${JSON.stringify(names)} (B id kept: ${bBack}) | ${undone2.line}`
  );
  const undoMade = madeId ? await tool({ undo: madeId }) : { text: '' };
  const gone = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).length;',
  });
  check(
    'undo of the creating run deletes what it created',
    /reversed/.test(undoMade.text) && gone.result === 0,
    `${undoMade.text} → ${gone.result} left`
  );

  // 7. The caps: a run stopped by one keeps its receipt (the write it made before the cap).
  const capped = await tool({
    script:
      'for (let i = 0; i < 3; i++) await fvtt.createFolder({ name: "ZZ-run-script-cap" + i, type: "Actor" }); return 1;',
    maxWrites: 1,
  });
  check(
    'the write cap stops the second write; the run keeps its receipt',
    /^❌ Failed/.test(capped.text) &&
      /write cap \(1\)/.test(capped.text) &&
      created(capped.line) === 1,
    `${capped.text.split('\n').slice(0, 2).join(' / ')} | ${capped.line}`
  );
  if (capped.id) await tool({ undo: capped.id });

  // 8. The timeout.
  const slow = await f.call('runScript', {
    src: 'await new Promise(r => setTimeout(r, 10000)); return 1;',
    timeoutMs: 1500,
  });
  check('a slow run is abandoned at its timeout', !slow.ok && slow.timedOut, slow.error);

  // 9. The static refusal, in the tool.
  const refused = await tool({ script: 'const m = await import("x"); return 1;' }).then(
    () => '',
    e => e.message
  );
  check(
    'the tool refuses `import` before the script travels',
    /refused: the script uses `import`/.test(refused),
    refused.slice(0, 80)
  );

  // 10. The tool's own output shape: a run that wrote nothing has no receipt.
  const shape = await tool({ script: 'return { n: (await fvtt.listActors({})).length };' });
  check(
    'the tool prints the result, and a run that wrote nothing answers no receipt line',
    /^✅ Done — 1 call\(s\), 0 write\(s\)\./.test(shape.text) &&
      /"n": \d+/.test(shape.text) &&
      shape.line === '',
    shape.text.split('\n')[0]
  );

  // 11. A script stuck in a synchronous loop (issue #16). Its own timeout cannot preempt it, so the
  // bridge's op cap does: the timeout + 30 s, then a 5 s probe the wedged page cannot answer; the
  // page is closed, the op's outcome is unknown, and the next call reconnects on its own. Last,
  // because it re-joins.
  const t0 = Date.now();
  let wedged = '';
  try {
    await f.call('runScript', { src: 'while (true) {}', timeoutMs: 5000 });
    wedged = 'it returned';
  } catch (e) {
    wedged = e.message;
  }
  const cutAt = (Date.now() - t0) / 1000;
  check(
    'a synchronous loop is cut at its timeout + 30 s + the probe, its outcome unknown',
    /outcome of this op is unknown/.test(wedged) && cutAt >= 39 && cutAt < 55 && !f.isReady(),
    `${cutAt.toFixed(1)} s: ${wedged.slice(0, 140)}`
  );
  const t1 = Date.now();
  const info = await f.call('getWorldInfo').catch(e => ({ error: e.message }));
  check(
    'the next call reconnects on its own and answers',
    typeof info?.id === 'string' && info.id.length > 0 && f.isReady(),
    `${((Date.now() - t1) / 1000).toFixed(1)} s to reconnect${info?.error ? `: ${info.error}` : ''}`
  );
} finally {
  if (receiptId) await tool({ undo: receiptId }).catch(() => {});
  await f
    .call('runScript', {
      src: `const zz = (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name));
      if (zz.length) await fvtt.deleteActor({ identifiers: zz.map(a => a.id), removeEmptyFolder: false });
      const folders = await fvtt.listFolders({ type: "Actor" }).catch(() => ({ folders: [] }));
      for (const fo of (folders.folders ?? []).filter(x => /^ZZ-run-script/.test(x.name))) await fvtt.deleteFolder({ identifier: fo.id, type: "Actor", deleteContents: true }).catch(() => {});
      return zz.length;`,
      maxDeletes: 100,
    })
    .catch(e => console.log(`cleanup: ${e.message}`));
  const worldId = await f.worldId().catch(() => '');
  const key = receiptWorldKey(hostConfig.serverUrl, worldId);
  for (const id of made) rmSync(join(receiptsDir(), `${key}-${id}.json`), { force: true });
  await dispose();
}
const passed = checks.filter(c => c.ok).length;
console.log(`\n[verify-run-script] ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
