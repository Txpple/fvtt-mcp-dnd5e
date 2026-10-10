// Live verification for the journal de-leak — the page-model deepening (per-page ownership) +
// the pure block renderer round-trip + the @UUID-link / append primitives.
//
// Drives a real headless Foundry session through the foundry.call seam (fresh dist/, no CC restart).
// The TOOL handlers (JournalTools) are unit-tested; this exercises the PAGE primitives they
// compose, against the live `sandbox` world. It asserts:
//   1. DE-RISK per-page ownership — a journal with a playerVisible handout page + a GM-only page;
//      read back the visibility (proves Foundry v14 persists per-page JournalEntryPage ownership);
//   2. the pure block renderer's dnd5e block-kit HTML round-trips as page content, and dnd5e's own
//      stylesheet draws every block class (computed style inside a .dnd5e2-journal container);
//      dnd5e enrichers in the prose are enriched, not left as text;
//   3. NPC-link primitives — findActor resolves a real actor; an appended @UUID[Actor.id] link
//      round-trips and preserves existing content;
//   4. findActor refuses an unknown NPC (the basis of link-quest-to-npc's dead-link guard);
//   5. append a session-recap page from blocks (the session-recap log path);
//   6. manage-journals (action create / list / get / update / delete / delete-page — the M8 union,
//      src/tools/journal.ts) through buildToolRegistry().dispatch: the five per-op tools are gone;
//      create answers one line with each page id; list is the §3 line shape (header + one row per
//      journal); get is the JSON read (the entry, then one page); update / delete-page / delete are
//      one line; an unknown action / key is refused by name; a page miss is an error;
//   7. manage-journals create makes dnd5e page types (map with a location code, rule) with their
//      system data;
//   8. update-quest-journal appends after a page still carrying the pre-4.2 `.mcp-journal` wrapper,
//      never inside it.
// Everything created is namespaced ZZ-JOURNAL-IT and cleaned up.
//
// Build first: npm run build. Run: node scripts/verify-journal-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';
import { renderBlocks } from '../dist/tools/journal/blocks.js';

const env = loadEnv();

const TAG = 'ZZ-JOURNAL-IT';
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

let journalId;
let unionId;
let typedId;

try {
  console.log('[verify-journal] connecting to sandbox…');
  await f.connect();
  console.log('[verify-journal] connected — exercising journal page primitives\n');

  // --- 1. DE-RISK per-page ownership ---------------------------------------
  console.log('# create: handout (player-visible) + GM-only page');
  const handoutHtml = renderBlocks([
    { type: 'lead', html: 'A note nailed to the tavern door.' },
    { type: 'readaloud', html: '<p>WANTED: whoever cursed the Thorned Grove.</p>' },
    { type: 'notable', title: 'Bounty', html: '50 gp, paid at the Stag.' },
    { type: 'advice', title: 'Pacing', html: 'Let them haggle.', img: 'icons/svg/book.svg' },
    { type: 'quest', title: 'Find the Hag', html: 'In the grove.' },
    { type: 'quote', html: 'The grove remembers.', author: 'Old Tam' },
    { type: 'grid', columns: [{ heading: 'Details', items: ['Type: Side'] }] },
    {
      type: 'paragraph',
      html: 'Thorns: [[/save dex 13]], [[/damage 1d6 piercing]] and &Reference[restrained].',
    },
  ]);
  const gmHtml = renderBlocks([
    { type: 'gmnote', html: '<p>The druid IS the green hag in disguise.</p>' },
    { type: 'list', items: ['DC 15 Insight to notice the glamour'] },
  ]);
  const created = await f.call('createJournal', {
    name: `${TAG} The Thorned Grove`,
    pages: [
      { name: 'Player Handout', content: handoutHtml, ownership: { default: 2 } },
      { name: 'GM Notes', content: gmHtml }, // omitted ownership -> GM-only
    ],
    folderName: `${TAG} Journals`,
  });
  journalId = created?.id;
  assert(Boolean(journalId), 'journal created');
  assert(created?.pageCount === 2, `journal has 2 pages (${created?.pageCount})`);

  console.log('\n# read back per-page visibility (the key de-risk)');
  const list = await f.call('listJournals', {});
  const entry = (Array.isArray(list) ? list : []).find(j => j.id === journalId);
  assert(Boolean(entry), 'journal appears in listJournals');
  const handout = entry?.pages?.find(p => p.name === 'Player Handout');
  const gmPage = entry?.pages?.find(p => p.name === 'GM Notes');
  assert(
    handout?.playerVisible === true,
    'handout page is player-visible — Foundry v14 PERSISTED per-page ownership'
  );
  assert(gmPage?.playerVisible === false, 'GM Notes page is GM-only');

  // --- 1b. the ENTRY-level half of the ownership contract ------------------
  // A player-visible PAGE inside a GM-only ENTRY is unreachable: the journal never appears in a
  // player's sidebar. createJournal must therefore open the entry when any page is a handout, and
  // pin the other pages GM-only so they don't inherit that open entry.
  console.log('\n# entry-level ownership contract');
  const perms = await f.evaluate(id => {
    const j = game.journal.get(id);
    const player = game.users.find(u => !u.isGM);
    return {
      entryDefault: j?.ownership?.default,
      playerSeesJournal: j?.testUserPermission(player, 'LIMITED') ?? null,
      pages: [...(j?.pages ?? [])].map(p => ({
        name: p.name,
        raw: p.ownership?.default,
        playerSees: p.testUserPermission(player, 'OBSERVER'),
      })),
    };
  }, journalId);
  assert(perms.entryDefault === 2, `entry opened to players (default ${perms.entryDefault})`);
  assert(perms.playerSeesJournal === true, 'a player can actually SEE the journal');
  const gmPerm = perms.pages.find(p => p.name === 'GM Notes');
  assert(
    gmPerm?.raw === 0,
    `GM page pinned explicitly GM-only, not inheriting (raw ${gmPerm?.raw})`
  );
  assert(gmPerm?.playerSees === false, 'GM page stays hidden inside the open entry');
  assert(
    perms.pages.find(p => p.name === 'Player Handout')?.playerSees === true,
    'handout page is reachable by a player'
  );

  // --- 2. block renderer round-trips on the page content -------------------
  console.log('\n# block renderer round-trip');
  const handoutContent =
    (await f.call('getJournalPageContent', { journalId, pageId: handout.id }))?.content || '';
  assert(!handoutContent.includes('mcp-journal'), 'no house wrapper on the page');
  assert(handoutContent.includes('WANTED: whoever cursed'), 'page carries the caller words');
  for (const cls of [
    'fvtt narrative',
    'notable',
    'fvtt advice',
    'fvtt quest',
    'quote-lg float-right',
    'quote-author',
  ]) {
    assert(handoutContent.includes(`class="${cls}"`), `block class "${cls}" round-trips`);
  }
  // dnd5e's stylesheet scopes the kit to its journal sheet (.dnd5e2-journal; the colour tokens the
  // borders use live on .dnd5e2, which the sheet also carries): mount the stored HTML in such a
  // container and read the computed style each block class gets from the system's CSS.
  const styled = await f.evaluate(async html => {
    const TE = foundry.applications.ux.TextEditor.implementation;
    const host = document.createElement('div');
    host.className = 'dnd5e2 dnd5e2-journal';
    host.innerHTML = await TE.enrichHTML(html, { secrets: false });
    document.body.appendChild(host);
    const cs = sel => {
      const el = host.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    const out = {
      narrative: cs('.narrative')?.borderLeftStyle,
      notable: cs('.notable')?.borderTopStyle,
      advice: cs('.advice')?.borderTopStyle,
      quest: cs('.quest')?.borderTopStyle,
      icon: cs('.advice > figure')?.position,
      quote: cs('.quote-lg')?.display,
      float: cs('.quote-lg')?.float,
      enriched: host.innerHTML,
    };
    host.remove();
    return out;
  }, handoutContent);
  assert(styled.narrative === 'solid', `dnd5e draws the narrative box (${styled.narrative})`);
  assert(styled.notable === 'solid', `dnd5e draws the notable callout (${styled.notable})`);
  assert(
    styled.advice === 'solid' && styled.quest === 'solid' && styled.icon === 'absolute',
    `dnd5e draws the advice / quest cards and the icon (${styled.advice}/${styled.quest}/${styled.icon})`
  );
  assert(
    styled.quote === 'grid' && styled.float === 'right',
    `dnd5e draws the pull quote, floated (${styled.quote}/${styled.float})`
  );
  assert(
    !styled.enriched.includes('[[/save') &&
      !styled.enriched.includes('[[/damage') &&
      !styled.enriched.includes('Reference['),
    'dnd5e enrichers in the prose were enriched'
  );
  assert(!handoutContent.includes('approaches the party'), 'no fabricated prose present');
  const gmContent =
    (await f.call('getJournalPageContent', { journalId, pageId: gmPage.id }))?.content || '';
  assert(
    /<section class="secret" id="secret-[A-Za-z0-9]{16}">/.test(gmContent),
    'gmnote persisted as a core secret section with its id'
  );
  const enriched = await f.evaluate(async html => {
    const TE = foundry.applications.ux.TextEditor.implementation;
    return {
      owner: await TE.enrichHTML(html, { secrets: true }),
      player: await TE.enrichHTML(html, { secrets: false }),
    };
  }, gmContent);
  assert(enriched.owner.includes('green hag'), 'secret text shown to an owner (secrets: true)');
  assert(!enriched.player.includes('green hag'), 'secret text removed for a non-owner');

  // --- 3. NPC-link primitives ---------------------------------------------
  console.log('\n# NPC @UUID link primitives');
  const actors = await f.call('listActors', {});
  const actor = (Array.isArray(actors) ? actors : [])[0];
  if (actor?.id) {
    const resolved = await f.call('findActor', { identifier: actor.name });
    assert(resolved?.id === actor.id, `findActor resolves "${actor.name}" -> its id`);
    const link = `@UUID[Actor.${resolved.id}]{${resolved.name}}`;
    const before =
      (await f.call('getJournalPageContent', { journalId, pageId: gmPage.id }))?.content || '';
    await f.call('updateJournalContent', {
      journalId,
      pageId: gmPage.id,
      content:
        before +
        renderBlocks([
          { type: 'gmnote', html: `<p><strong>Related NPC:</strong> ${link} — quest giver</p>` },
        ]),
    });
    const after =
      (await f.call('getJournalPageContent', { journalId, pageId: gmPage.id }))?.content || '';
    assert(after.includes(`@UUID[Actor.${resolved.id}]`), '@UUID link appended + round-trips');
    assert(after.includes('green hag in disguise'), 'append preserved the existing GM content');
  } else {
    console.log('  SKIP  no world actor available to link');
  }

  // --- 4. dead-link guard basis -------------------------------------------
  console.log('\n# dead-link guard');
  const ghost = await f.call('findActor', { identifier: 'ZZ-NoSuchActor-XYZ-9999' });
  assert(
    ghost === null,
    'findActor returns null for an unknown NPC (link-quest-to-npc would throw)'
  );

  // --- 5. append a session-recap page (the session-recap log path) -------------------
  console.log('\n# session-recap append (new page from blocks)');
  const recap = await f.call('updateJournalContent', {
    journalId,
    content: renderBlocks([
      { type: 'heading', text: 'Session 1' },
      { type: 'paragraph', html: 'The party found the note and set out for the grove.' },
    ]),
    newPageName: 'Campaign Log',
  });
  assert(Boolean(recap?.success && recap?.pageId), 'session-recap page appended');
  const recapContent =
    (await f.call('getJournalPageContent', { journalId, pageId: recap.pageId }))?.content || '';
  assert(
    recapContent.includes('Session 1') && recapContent.includes('set out for the grove'),
    'recap content round-trips'
  );

  // --- 6. manage-journals through the registry (the M8 union) ---------------
  console.log('\n# 6) manage-journals (action) through dispatch');
  const { dispatch, tools } = buildToolRegistry({
    foundry: f,
    logger: new Logger({ level: 'error' }),
    host: cfg.host,
  });
  const names = new Set(tools.map(t => t.name));
  assert(
    names.has('manage-journals') &&
      [
        'create-journal',
        'update-journal',
        'list-journals',
        'delete-journal',
        'delete-journal-page',
      ].every(n => !names.has(n)),
    '6 — manage-journals is advertised, the five per-op tools are gone'
  );
  const mj = args => dispatch('manage-journals', args);
  const cr = String(
    await mj({
      action: 'create',
      name: `${TAG} Union`,
      pages: [
        { name: 'Overview', content: '<p>The grove.</p>' },
        { name: 'Handout', content: '<p>For the players.</p>', playerVisible: true },
      ],
    })
  );
  unionId = /\((\w{16})\): 2 page/.exec(cr)?.[1];
  const pageIds = [...cr.matchAll(/"(?:Overview|Handout)" \((\w{16})\)/g)].map(m => m[1]);
  assert(
    !!unionId &&
      pageIds.length === 2 &&
      cr ===
        `Created journal "${TAG} Union" (${unionId}): 2 page(s): "Overview" (${pageIds[0]}), "Handout" (${pageIds[1]})`,
    `6 — create: one line with each page id (${cr})`
  );
  const lines = String(await mj({ action: 'list', nameFilter: TAG })).split('\n');
  assert(
    /^\d+ journal\(s\): id name pages$/.test(lines[0] ?? '') &&
      lines.includes(`${unionId} "${TAG} Union" 2`),
    `6 — list: the header + the row (${lines[0]} / ${lines.find(x => x.startsWith(unionId))})`
  );
  const got = await mj({ action: 'get', journalId: `${TAG} Union` });
  assert(
    got?.content === '<p>The grove.</p>' &&
      got?.pageCount === 2 &&
      got?.pages?.[1]?.playerVisible === true &&
      got?.pages?.[1]?.id === pageIds[1],
    `6 — get by exact name: the first text page, the page list with visibility (${JSON.stringify(got?.pages)})`
  );
  const gotPage = await mj({ action: 'get', journalId: unionId, pageId: pageIds[1] });
  assert(gotPage?.page?.content === '<p>For the players.</p>', '6 — get with pageId: that page');
  const up = String(
    await mj({
      action: 'update',
      journalId: unionId,
      name: `${TAG} Union 2`,
      content: '<p>Rewritten.</p>',
      pageId: pageIds[0],
    })
  );
  assert(
    up ===
      `Updated journal ${unionId}: renamed to "${TAG} Union 2"; page "Overview" (${pageIds[0]}) written`,
    `6 — update: rename + the page written on one line (${up})`
  );
  const dp = String(await mj({ action: 'delete-page', journalId: unionId, pageId: pageIds[1] }));
  assert(
    dp === `Deleted page "Handout" (${pageIds[1]}) of journal ${unionId}`,
    `6 — delete-page: one line (${dp})`
  );
  for (const [args, want] of [
    [
      { action: 'search', journalId: unionId },
      'action must be one of "create", "list", "get", "update", "delete", "delete-page"',
    ],
    [
      { action: 'list', journalId: unionId },
      'unknown argument "journalId" — it takes: action, nameFilter, filterQuests',
    ],
    [
      { action: 'delete-page', journalId: unionId, pageId: 'ZZ-no-such-page' },
      'Page not found: "ZZ-no-such-page". Nothing deleted.',
    ],
    [{ action: 'get', journalId: 'ZZ-no-such-journal' }, 'not found'],
  ]) {
    let msg = '';
    try {
      await mj(args);
    } catch (e) {
      msg = e?.message ?? String(e);
    }
    assert(msg.includes(want), `6 — refused by name / a miss is an error: ${want.slice(0, 60)}`);
  }
  // --- 7. dnd5e page types through manage-journals create ----------------
  console.log('\n# 7) dnd5e page types (map location, rule)');
  const typed = String(
    await mj({
      action: 'create',
      name: `${TAG} Typed`,
      pages: [
        { name: 'Gatehouse', kind: 'map', content: '<p>Two guards.</p>', system: { code: 'A1' } },
        {
          name: 'Thorns',
          kind: 'rule',
          content: '<p>Thorns cut.</p>',
          system: { tooltip: '<p>Cut.</p>' },
        },
      ],
    })
  );
  typedId = /\((\w{16})\): 2 page/.exec(typed)?.[1];
  const typedPages = await f.evaluate(id => {
    const j = game.journal.get(id);
    return [...(j?.pages ?? [])].map(p => ({
      name: p.name,
      type: p.type,
      code: p.system?.code,
      tooltip: p.system?.tooltip,
      ruleType: p.system?.type,
      text: p.text?.content,
    }));
  }, typedId);
  const gate = typedPages.find(p => p.name === 'Gatehouse');
  const rule = typedPages.find(p => p.name === 'Thorns');
  assert(
    gate?.type === 'map' && gate?.code === 'A1' && gate?.text === '<p>Two guards.</p>',
    `7 — a Map Location page with its code and body (${JSON.stringify(gate)})`
  );
  assert(
    rule?.type === 'rule' && rule?.tooltip === '<p>Cut.</p>' && rule?.ruleType === 'rule',
    `7 — a Rule page with its tooltip (${JSON.stringify(rule)})`
  );

  // --- 8. append after legacy markup ------------------------------------
  console.log('\n# 8) update-quest-journal on a page with the pre-4.2 wrapper');
  const legacy =
    '<section class="mcp-journal"><div class="wrap"><div class="readaloud"><p>Old words.</p></div></div></section>';
  const legacyPage = await f.call('updateJournalContent', {
    journalId: typedId,
    content: legacy,
    newPageName: 'Legacy',
  });
  await dispatch('update-quest-journal', {
    journalId: typedId,
    pageId: legacyPage.pageId,
    blocks: [{ type: 'readaloud', html: 'New words.' }],
  });
  const appended =
    (await f.call('getJournalPageContent', { journalId: typedId, pageId: legacyPage.pageId }))
      ?.content || '';
  const legacyEnd = appended.lastIndexOf('</section>');
  const newAt = appended.indexOf('<div class="fvtt narrative"><p>New words.</p></div>');
  assert(
    appended.includes('Old words.') && newAt > legacyEnd && legacyEnd > 0,
    `8 — the new section sits after the old wrapper, not inside it (${appended.slice(-120)})`
  );

  const del = String(await mj({ action: 'delete', identifiers: [unionId, 'ZZ-NOPE-JOURNAL'] }));
  assert(
    del === `Deleted 1 journal(s): "${TAG} Union 2" (${unionId}) (1 not found: ZZ-NOPE-JOURNAL)`,
    `6 — delete: one line with the not-found tail (${del})`
  );
  unionId = undefined;
} catch (e) {
  fails++;
  console.log(`\n[verify-journal] FATAL: ${e?.message || String(e)}`);
} finally {
  const strays = [journalId, unionId, typedId].filter(Boolean);
  if (strays.length) {
    try {
      await f.call('deleteJournals', { identifiers: strays });
      console.log('\n[verify-journal] cleaned up journal(s)');
    } catch {
      /* best-effort */
    }
  }
  await f.dispose?.();
}

console.log(`\n==== journal-tooling verification: ${passes} passed, ${fails} failed ====`);
process.exit(fails > 0 ? 1 : 0);
