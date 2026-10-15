// Live verify for a vetoed delete (2026-10-12): Foundry skips an embedded document whose
// `preDelete<Doc>` hook answers false (a module's veto: By the Books keeps a standing companion's
// effect) and resolves as if all were well. The page ops now prove the delete landed
// (src/page/_shared.ts `deleteEmbeddedStrict`) and refuse with a coded error when it did not.
//   FOUNDRY_HOST=local node scripts/verify-delete-veto.mjs
// A veto is installed on this page for chosen ids (ActiveEffect, Item, JournalEntryPage,
// AmbientLight), registered before the tool call as a module's would be; then, through
// buildToolRegistry().dispatchWithReceipt (what the server answers with):
//   - manage-effect delete of the vetoed effect: an error naming the veto, no receipt, the effect
//     still on the actor; the same call on an effect not vetoed: deleted, with a receipt;
//   - remove-from-actor of a vetoed item and a free one: an error naming the vetoed one, the free
//     one gone, and the receipt line carried on the error holds the one delete that happened;
//   - manage-journals delete-page of a vetoed page and manage-placeables delete of a vetoed light:
//     each an error, no receipt, the document still there.
// Everything is named ZZ-veto… (the light is tracked by id) and deleted in finally with the hooks
// off; the receipt files this run made are removed from the store. Build first: npm run build.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { receiptLineOf, receiptsDir, receiptWorldKey } from '../dist/receipts.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const TAG = 'ZZ-veto';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};

const env = loadEnv();
const cfg = bridgeConfig(env);
const quiet = { debug() {}, info() {}, warn() {}, error: m => console.log(`  [bridge] ${m}`) };
const f = new Foundry(cfg, quiet);
const { dispatchWithReceipt } = buildToolRegistry({
  foundry: f,
  logger: new Logger({ level: 'error', format: 'simple', enableConsole: false, enableFile: false }),
  host: cfg.host,
  serverUrl: cfg.serverUrl,
});

const made = new Set(); // receipt ids this run made: removed from the store at the end
const keep = line => {
  const id = /^receipt (rcpt_[0-9a-z]{6})/.exec(line ?? '')?.[1];
  if (id) made.add(id);
};
const textOf = result => String(result?.content?.[0]?.text ?? JSON.stringify(result));
/** A tool call: its result or its error, and the receipt line either one carried. */
async function tool(name, args) {
  try {
    const { result, receiptLine } = await dispatchWithReceipt(name, args);
    keep(receiptLine);
    return { result: textOf(result), line: receiptLine ?? '' };
  } catch (err) {
    const line = receiptLineOf(err) ?? '';
    keep(line);
    return { error: err?.message ?? String(err), line };
  }
}
/** A look at the world (an evaluate: no receipt, no recorder). */
const look = (fn, arg) => f.evaluate(fn, arg);

let worldKey = '';
let fx = null;
try {
  await f.connect();
  worldKey = receiptWorldKey(cfg.serverUrl, await f.worldId());
  console.log('[verify-delete-veto] connected');

  fx = await look(async tag => {
    const actor = await Actor.create({ name: `${tag} actor`, type: 'npc' });
    const [eKeep, eGo] = await actor.createEmbeddedDocuments('ActiveEffect', [
      { name: `${tag} keep`, img: 'icons/svg/aura.svg' },
      { name: `${tag} go`, img: 'icons/svg/aura.svg' },
    ]);
    const [iKeep, iGo] = await actor.createEmbeddedDocuments('Item', [
      { name: `${tag} keep`, type: 'loot' },
      { name: `${tag} go`, type: 'loot' },
    ]);
    const journal = await JournalEntry.create({ name: `${tag} journal` });
    const [page] = await journal.createEmbeddedDocuments('JournalEntryPage', [
      { name: `${tag} page`, type: 'text', text: { content: '<p>x</p>' } },
    ]);
    const scene = canvas.scene;
    const [light] = await scene.createEmbeddedDocuments('AmbientLight', [
      { x: scene.dimensions.sceneX + 100, y: scene.dimensions.sceneY + 100, config: { dim: 10 } },
    ]);
    // registered before the tool call, as a module's would be
    const vetoed = new Set([eKeep.id, iKeep.id, page.id, light.id]);
    window.__zzVetoHooks = ['ActiveEffect', 'Item', 'JournalEntryPage', 'AmbientLight'].map(n => [
      `preDelete${n}`,
      Hooks.on(`preDelete${n}`, doc => (vetoed.has(doc.id) ? false : undefined)),
    ]);
    return {
      actorId: actor.id,
      eKeep: eKeep.id,
      eGo: eGo.id,
      iKeep: iKeep.id,
      iGo: iGo.id,
      journalId: journal.id,
      pageId: page.id,
      sceneId: scene.id,
      lightId: light.id,
    };
  }, TAG);

  const has = (kind, id) =>
    look(
      ({ fx, kind, id }) => {
        const a = game.actors.get(fx.actorId);
        if (kind === 'effect') return !!a?.effects.get(id);
        if (kind === 'item') return !!a?.items.get(id);
        if (kind === 'page') return !!game.journal.get(fx.journalId)?.pages.get(id);
        return !!game.scenes.get(fx.sceneId)?.lights.get(id);
      },
      { fx, kind, id }
    );

  const e1 = await tool('manage-effect', {
    action: 'delete',
    actorIdentifier: fx.actorId,
    effectId: fx.eKeep,
  });
  check(
    'manage-effect delete, vetoed: an error naming the veto, no receipt, the effect still there',
    /vetoed it/.test(e1.error ?? '') && !e1.line && (await has('effect', fx.eKeep)),
    e1.error ?? e1.result
  );
  const e2 = await tool('manage-effect', {
    action: 'delete',
    actorIdentifier: fx.actorId,
    effectId: fx.eGo,
  });
  check(
    'manage-effect delete, not vetoed: deleted, with a receipt',
    !e2.error && !!e2.line && !(await has('effect', fx.eGo)),
    `${e2.result ?? e2.error} | ${e2.line}`
  );
  const r = await tool('remove-from-actor', {
    actorIdentifier: fx.actorId,
    itemIds: [fx.iKeep, fx.iGo],
  });
  check(
    'remove-from-actor, one vetoed: an error naming it, the other gone and in the receipt',
    /"ZZ-veto keep" \(\w+\) still on/.test(r.error ?? '') &&
      /1 other item/.test(r.error ?? '') &&
      !!r.line &&
      (await has('item', fx.iKeep)) &&
      !(await has('item', fx.iGo)),
    `${r.error ?? r.result} | ${r.line}`
  );
  const j = await tool('manage-journals', {
    action: 'delete-page',
    journalId: fx.journalId,
    pageId: fx.pageId,
  });
  check(
    'manage-journals delete-page, vetoed: an error, no receipt, the page still there',
    /vetoed it/.test(j.error ?? '') && !j.line && (await has('page', fx.pageId)),
    j.error ?? j.result
  );
  const l = await tool('manage-placeables', {
    kind: 'lights',
    action: 'delete',
    sceneIdentifier: fx.sceneId,
    lightIds: [fx.lightId],
  });
  check(
    'manage-placeables delete, vetoed: an error, no receipt, the light still there',
    /vetoed it/.test(l.error ?? '') && !l.line && (await has('light', fx.lightId)),
    l.error ?? l.result
  );
} catch (err) {
  check('the run threw', false, err?.stack ?? String(err));
} finally {
  try {
    const left = await look(
      async ({ tag, fx }) => {
        for (const [hook, id] of window.__zzVetoHooks ?? []) Hooks.off(hook, id);
        delete window.__zzVetoHooks;
        for (const a of game.actors.filter(x => x.name.startsWith(tag))) await a.delete();
        for (const j of game.journal.filter(x => x.name.startsWith(tag))) await j.delete();
        if (fx) await game.scenes.get(fx.sceneId)?.lights.get(fx.lightId)?.delete();
        return (
          game.actors.filter(x => x.name.startsWith(tag)).length +
          game.journal.filter(x => x.name.startsWith(tag)).length
        );
      },
      { tag: TAG, fx }
    );
    console.log(`\n[verify-delete-veto] cleanup: ${left} ${TAG} documents left`);
  } catch (err) {
    console.log(`[verify-delete-veto] cleanup failed: ${err?.message ?? err}`);
  }
  for (const id of made) rmSync(join(receiptsDir(), `${worldKey}-${id}.json`), { force: true });
  await f.disconnect();
}
const failed = checks.filter(c => !c.ok).length;
console.log(`[verify-delete-veto] ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
