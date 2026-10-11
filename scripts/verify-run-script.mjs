// Live verify for run-script (issue #4): the page op and the tool against a real world.
//   FOUNDRY_HOST=local node scripts/verify-run-script.mjs
// Reads, a dry run, a real run with a receipt (create / update / delete), undo, the caps, the
// timeout, the shadowed globals and the static refusal. Temp documents are ZZ-* and deleted in
// finally. Needs a built dist/ (the tool class and the page bundle come from there).
import { connectFoundry } from '../dist/client.js';
import { Logger } from '../dist/logger.js';
import { ScriptTools } from '../dist/tools/script.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};

const { f, dispose } = await connectFoundry({
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
const tool = new ScriptTools({ foundry: f, logger });
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

  // 2. The globals are shadowed.
  const shadow = await f.call('runScript', {
    src: 'return [typeof game, typeof canvas, typeof window, typeof fromUuid, typeof Actor].join(",");',
  });
  check(
    'the globals are out of reach',
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

  // 5. A real run creates two actors; a SECOND run renames one and deletes the other — the
  // receipt of the second run counts an update and a delete of documents it did not create.
  const made = await f.call('runScript', { src: makeTwo });
  const madeId = made.receipt?.id ?? null;
  check(
    'a run that creates returns a receipt counting the creates',
    made.ok && made.receipt.created >= 2 && Array.isArray(made.result) && made.result.length === 2,
    JSON.stringify(made.receipt)
  );
  const [a, b] = made.result ?? [];
  const run = await f.call('runScript', {
    src: `await fvtt.updateActor({ actorIdentifier: ${JSON.stringify(a)}, name: "ZZ-run-script A2" });
    await fvtt.deleteActor({ identifiers: [${JSON.stringify(b)}], removeEmptyFolder: false });
    return true;`,
  });
  receiptId = run.receipt?.id ?? null;
  check(
    'a run that updates and deletes returns a receipt counting both',
    run.ok && run.receipt.updated === 1 && run.receipt.deleted === 1,
    `${JSON.stringify(run.receipt)} ${run.log.join(' | ')}`
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
  const undoText = await tool.handleRunScript({ undo: receiptId });
  receiptId = null;
  const undone = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).map(a => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name));',
  });
  const names = (undone.result ?? []).map(x => x.name);
  const bBack = (undone.result ?? []).find(x => x.name === 'ZZ-run-script B')?.id === b;
  const firstLine = t => String(t).split(/\r?\n/)[0];
  check(
    'undo restores what the run changed and what it deleted, with its id',
    /reversed/.test(undoText) &&
      JSON.stringify(names) === JSON.stringify(['ZZ-run-script A', 'ZZ-run-script B']) &&
      bBack,
    `${firstLine(undoText)} → ${JSON.stringify(names)} (B id kept: ${bBack})`
  );
  const undoMade = madeId ? await tool.handleRunScript({ undo: madeId }) : '';
  const gone = await f.call('runScript', {
    src: 'return (await fvtt.listActors({})).filter(a => /^ZZ-run-script/.test(a.name)).length;',
  });
  check(
    'undo of the creating run deletes what it created',
    /reversed/.test(undoMade) && gone.result === 0,
    `${firstLine(undoMade)} → ${gone.result} left`
  );

  // 7. The caps.
  const capped = await f.call('runScript', {
    src: 'for (let i = 0; i < 3; i++) await fvtt.createFolder({ name: "ZZ-run-script-cap" + i, type: "Actor" }); return 1;',
    maxWrites: 1,
  });
  check(
    'the write cap stops the second write',
    !capped.ok && /write cap \(1\)/.test(capped.error) && capped.receipt.created === 1,
    capped.error
  );
  if (capped.receipt?.id) await tool.handleRunScript({ undo: capped.receipt.id });

  // 8. The timeout.
  const slow = await f.call('runScript', {
    src: 'await new Promise(r => setTimeout(r, 10000)); return 1;',
    timeoutMs: 1500,
  });
  check('a slow run is abandoned at its timeout', !slow.ok && slow.timedOut, slow.error);

  // 9. The static refusal, in the tool.
  let refused = '';
  try {
    await tool.handleRunScript({ script: 'const m = await import("x"); return 1;' });
  } catch (e) {
    refused = e.message;
  }
  check(
    'the tool refuses `import` before the script travels',
    /refused: the script uses `import`/.test(refused),
    refused.slice(0, 80)
  );

  // 10. The tool's own output shape.
  const text = await tool.handleRunScript({
    script: 'return { n: (await fvtt.listActors({})).length };',
  });
  check(
    'the tool prints the receipt line and the result',
    /receipt rcpt_/.test(text) && /"n": \d+/.test(text)
  );
} finally {
  if (receiptId) await tool.handleRunScript({ undo: receiptId }).catch(() => {});
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
  await dispose();
}
const passed = checks.filter(c => c.ok).length;
console.log(`\n[verify-run-script] ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
