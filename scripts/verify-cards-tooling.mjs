// Live verification — Cards: themed-deck creation (face text + art) + preset import through the
// foundry.call seam, then manage-cards (action create / import / list / delete — the M8 union,
// src/tools/cards.ts) through buildToolRegistry().dispatch.
//
// Drives a real headless Foundry session (exercises the freshly-built dist/page.bundle.js WITHOUT
// a Claude Code restart). Against the live sandbox world it proves:
//   * createCards builds a deck whose cards carry a v14 face — if the face shape { name, text, img }
//     were wrong, CardsClass.create would reject the embedded card on validation, so a clean create
//     with text+img cards proves the shape is accepted;
//   * importCardsPreset instantiates a core PRESET deck headlessly (the poker preset loads a 52-card
//     deck), confirming the preset fetch + create path works;
//   * GUARD: an unknown preset key is refused;
//   * through dispatch: the four per-op tools are gone; create / import / delete answer one-line
//     confirmations; list is the §3 line shape (header + one row per stack); an unknown action / key
//     is refused by name.
// Everything created is cleaned up.
//
// Build first: npm run build. Run: node scripts/verify-cards-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();

const TAG = 'ZZ-CARDS-IT';
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
async function expectThrow(label, fn, re) {
  try {
    await fn();
    fails++;
    console.log(`  FAIL  ${label} — expected a throw, none thrown`);
  } catch (e) {
    const m = e?.message || String(e);
    if (re.test(m)) {
      passes++;
      console.log(`  PASS  ${label} — threw ${JSON.stringify(m.slice(0, 90))}`);
    } else {
      fails++;
      console.log(`  FAIL  ${label} — threw but message didn't match ${re}: ${m.slice(0, 140)}`);
    }
  }
}

const cfg = bridgeConfig(env);
const f = new Foundry(cfg);

const createdCardIds = [];
try {
  console.log('[verify-cards] connecting to sandbox…');
  await f.connect();
  console.log('[verify-cards] connected — exercising Cards tooling\n');

  // --- 1. create-cards: a themed deck with face text (+ one with art) ---
  console.log('# createCards: themed deck with face text + art');
  const deck = await f.call('createCards', {
    name: `${TAG} Mini Deck of Many Things`,
    type: 'deck',
    description: 'A small fate deck (verification).',
    cards: [
      {
        name: 'The Sun',
        text: '<p>Gain a wondrous item and 50,000 XP.</p>',
        img: 'icons/svg/sun.svg',
      },
      { name: 'The Void', text: '<p>Your soul is trapped in a distant prison.</p>' },
      { name: 'Balance', text: '<p>Your alignment changes.</p>' },
    ],
  });
  if (deck?.cardsId) createdCardIds.push(deck.cardsId);
  assert(deck?.type === 'deck', `created a deck (${deck?.type})`);
  assert(
    deck?.cardCount === 3,
    `deck has 3 cards — v14 face shape {name,text,img} accepted (${deck?.cardCount})`
  );

  // A hand stack (empty) — type round-trips
  const hand = await f.call('createCards', { name: `${TAG} GM Hand`, type: 'hand' });
  if (hand?.cardsId) createdCardIds.push(hand.cardsId);
  assert(hand?.type === 'hand', `hand stack type round-trips (${hand?.type})`);

  // --- 2. import-cards: a core preset deck (standard 52-card poker deck) ---
  console.log('\n# import-cards: core preset deck');
  const imp = await f.call('importCardsPreset', {
    preset: 'pokerDark',
    name: `${TAG} Standard Deck`,
    folderName: `${TAG} Decks`,
  });
  if (imp?.cardsId) createdCardIds.push(imp.cardsId);
  assert(imp?.preset === 'pokerDark', 'import reports the preset used');
  assert(imp?.cardCount === 52, `preset loaded a standard 52-card deck (${imp?.cardCount})`);
  assert(imp?.cardsName === `${TAG} Standard Deck`, 'imported stack took the supplied name');

  // --- GUARD: unknown preset refused ---
  console.log('\n# guards');
  await expectThrow(
    'importCardsPreset(unknown preset -> refused)',
    () => f.call('importCardsPreset', { preset: 'notARealPreset' }),
    /Unknown card preset/
  );

  // --- manage-cards through the registry (the M8 union: action create / import / list / delete)
  console.log('\n# manage-cards (action) through dispatch');
  const { dispatch, tools } = buildToolRegistry({
    foundry: f,
    logger: new Logger({ level: 'error' }),
    host: cfg.host,
  });
  const names = new Set(tools.map(t => t.name));
  assert(
    names.has('manage-cards') &&
      ['create-cards', 'import-cards', 'list-cards', 'delete-cards'].every(n => !names.has(n)),
    'manage-cards is advertised, the four per-op tools are gone'
  );
  const mc = args => dispatch('manage-cards', args);
  const cr = String(
    await mc({
      action: 'create',
      name: `${TAG} Union Deck`,
      type: 'pile',
      cards: [{ name: 'Omen', text: '<p>A raven.</p>' }],
    })
  );
  const crId = /\((\w+)\)/.exec(cr)?.[1];
  if (crId) createdCardIds.push(crId);
  assert(
    !!crId && cr === `Created pile "${TAG} Union Deck" (${crId}) with 1 card(s)`,
    `create: the one-line confirmation (${cr})`
  );
  const im = String(
    await mc({ action: 'import', preset: 'pokerLight', name: `${TAG} Union Poker` })
  );
  const imId = /\((\w+)\)/.exec(im)?.[1];
  if (imId) createdCardIds.push(imId);
  assert(
    !!imId &&
      im === `Imported deck "${TAG} Union Poker" (${imId}) from preset "pokerLight": 52 card(s)`,
    `import: the one-line confirmation (${im})`
  );
  const lines = String(await mc({ action: 'list' })).split('\n');
  assert(
    /^\d+ stack\(s\): id name type cards$/.test(lines[0] ?? ''),
    `list: the header + the columns (${lines[0]})`
  );
  assert(
    lines.includes(`${crId} "${TAG} Union Deck" pile 1`) &&
      lines.includes(`${imId} "${TAG} Union Poker" deck 52`),
    'list rows: id, quoted name, type, card count for both stacks'
  );
  for (const [args, want] of [
    [{ action: 'draw' }, 'action must be one of "create", "import", "list", "delete"'],
    [
      { action: 'import', preset: 'pokerDark', type: 'hand' },
      'unknown argument "type" — it takes: action, preset, name, folderName',
    ],
  ]) {
    let msg = '';
    try {
      await mc(args);
    } catch (e) {
      msg = e?.message ?? String(e);
    }
    assert(msg.includes(want), `refused by name: ${want.slice(0, 60)}`);
  }
  const del = String(await mc({ action: 'delete', identifiers: [crId, imId, 'ZZ-NOPE-CARDS'] }));
  assert(
    del ===
      `Deleted 2 stack(s): "${TAG} Union Deck" (${crId}), "${TAG} Union Poker" (${imId}) ` +
        '(1 not found: ZZ-NOPE-CARDS)',
    `delete: the one-line confirmation with the not-found tail (${del})`
  );
  createdCardIds.splice(createdCardIds.indexOf(crId), 1);
  createdCardIds.splice(createdCardIds.indexOf(imId), 1);
} catch (e) {
  fails++;
  console.log(`\n[verify-cards] FATAL: ${e?.message || String(e)}`);
} finally {
  if (createdCardIds.length > 0) {
    try {
      await f.call('deleteCards', { identifiers: createdCardIds });
      console.log(`\n[verify-cards] cleaned up ${createdCardIds.length} stack(s)`);
    } catch {
      /* best-effort */
    }
  }
  await f.dispose?.();
}

console.log(`\n==== cards-tooling verification: ${passes} passed, ${fails} failed ====`);
process.exit(fails > 0 ? 1 : 0);
