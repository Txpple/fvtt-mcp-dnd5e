// Live proof of the clue tooling on the sandbox (FOUNDRY_HOST=local): a module item type through
// createWorldItems, and listClues / collectClues / uncollectClues through Clue Board's own API.
// Needs fvtt-mod-clueboard 1.2.0+ active. The scratch Clue is tagged ZZ-* and goes, with its entry,
// in `finally`; the party's own record is never touched otherwise.
//
//   FOUNDRY_HOST=local node scripts/verify-clue-tooling.mjs
import { Foundry, foundryConfig, loadEnv } from '../dist/client.js';

const NAME = 'ZZ-CLUE Verify';
let fails = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

const f = new Foundry(foundryConfig(loadEnv()));
await f.connect();
let id = null;
try {
  const made = await f.call('createWorldItems', {
    items: [
      {
        name: NAME,
        type: 'fvtt-mod-clueboard.clue',
        img: 'icons/sundries/documents/document-sealed-red.webp',
        system: { kind: 'object', text: '<p>A scratch clue.</p>', foundAt: 'Found by the verify script.' },
      },
    ],
    folder: 'Objects',
  });
  id = made?.created?.[0]?.id ?? null;
  assert(!!id, `createWorldItems makes a module-typed Item (${id})`);
  assert(made?.folderName === 'Objects', `filed in "${made?.folderName}"`);

  const before = await f.call('listClues', {});
  assert(before.uncollected.some(c => c.id === id), `listClues lists it uncollected (${before.entries.length} on "${before.party.name}")`);

  const got = await f.call('collectClues', { clues: [NAME], stamp: false });
  assert(got.collected.length === 1 && got.collected[0].id === id, 'collectClues collects it by name');
  assert(got.collected[0].scene === '', 'stamp: false leaves the scene out');
  assert(got.entries === before.entries.length + 1, `the record grew by one (${got.entries})`);

  const again = await f.call('collectClues', { clues: [id] });
  assert(again.collected.length === 0 && again.already.length === 1, 'a second collect reports it already there');

  const gone = await f.call('uncollectClues', { clues: [id] });
  assert(gone.removed.length === 1 && gone.entries === before.entries.length, 'uncollectClues takes it off');

  const bad = await f.call('collectClues', { clues: ['ZZ-CLUE No Such'] }).then(() => null, e => e);
  assert(/No world Clue/.test(String(bad?.message ?? bad)), 'an unknown Clue is refused by name');
} finally {
  if (id) {
    await f
      .evaluate(async i => {
        const api = game.modules.get('fvtt-mod-clueboard')?.api;
        for (const g of api?.parties() ?? []) if (api.entry(g, i)) await api.uncollect(g, i, { confirm: false });
        await game.items.get(i)?.delete();
      }, id)
      .catch(e => console.log(`  cleanup: ${e?.message ?? e}`));
  }
  await f.dispose?.().catch(() => {});
}
console.log(fails ? `RED: ${fails} failed` : 'GREEN');
process.exit(fails ? 1 : 0);
