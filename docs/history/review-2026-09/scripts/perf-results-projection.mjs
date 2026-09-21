// perf-results: re-serialize every list-*/search-* body from the 24-call baseline
// (scratch/bodies-2026-09-20/*.txt) in a COMPACT projection — id, name, plus only the fields a
// skill actually filters on or passes onward (grep of .claude/skills/**/SKILL.md, see
// scratch/perf-results-notes.md) — and print per-tool before/after chars plus the 24-call totals.
//
//   node scratch/perf-results-projection.mjs
//
// Offline: reads the captured bodies only. Two truncated bodies (search-compendium-creatures,
// list-actor-ownership) are cut mid-JSON by capResponse; for those the complete records before the
// cut are projected and the per-record ratio is scaled to the pre-cap size the measure run reported
// (186,611 / 227,662 chars), then re-capped at TOOL_RESPONSE_MAX_CHARS so "after" is what a client
// would actually receive.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scratch/bodies-2026-09-20');
const CAP = 20_000;
const MARKER_LEN = 73; // "\n…[N chars omitted — response exceeded toolResponseMaxChars (20000)]" as measured (20,073 - 20,000)
const body = f => readFileSync(path.join(DIR, f), 'utf8');
const J = s => JSON.stringify(s);
const cap = n => (n > CAP ? CAP + MARKER_LEN : n);
const tok = n => Math.round(n / 3.6);

/** Parse the complete top-level records of a truncated JSON array body: `"key":[{...},{...` */
function completeRecords(text, arrayKey) {
  const start = text.indexOf(`"${arrayKey}":[`) + arrayKey.length + 4;
  const recs = [];
  let depth = 0, inStr = false, esc = false, recStart = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) recStart = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && recStart >= 0) { recs.push(JSON.parse(text.slice(recStart, i + 1))); recStart = -1; } }
    else if (c === ']' && depth === 0) break;
  }
  return recs;
}

const rows = [];
function row(tool, before, after, note, fieldsToday, fieldsCompact) {
  rows.push({ tool, before, after, note, fieldsToday, fieldsCompact });
}

// ---------------------------------------------------------------- list-actors (x2, JSON)
{
  for (const f of ['list-actors.txt', 'list-actors.2.txt']) {
    const t = body(f); const j = JSON.parse(t);
    const compact = j.characters.map(c => ({ id: c.id, name: c.name, type: c.type }));
    row(f.replace('.txt', ''), t.length, J({ actors: compact, total: j.total }).length,
      `${j.characters.length} records; drop hasImage + the "filtered" prose`,
      Object.keys(j.characters[0]).join(','), 'id,name,type');
  }
}
// ---------------------------------------------------------------- list-items (JSON)
{
  const t = body('list-items.txt'); const j = JSON.parse(t);
  const compact = j.items.map(i => ({ id: i.id, name: i.name, type: i.type, folder: i.folderName ?? null }));
  row('list-items', t.length, J({ items: compact, total: j.total }).length,
    `${j.items.length} records; drop img (avg ${Math.round(j.items.reduce((n, i) => n + (i.img?.length ?? 0), 0) / j.items.length)} chars) + folderId`,
    Object.keys(j.items[0]).join(','), 'id,name,type,folder');
}
// ---------------------------------------------------------------- list-journals (JSON)
{
  const t = body('list-journals.txt'); const j = JSON.parse(t);
  const compact = j.journals.map(x => ({ id: x.id, name: x.name, pages: x.pages.map(p => ({ id: p.id, name: p.name, ...(p.type !== 'text' ? { type: p.type } : {}), ...(p.playerVisible ? { playerVisible: true } : {}) })) }));
  row('list-journals', t.length, J({ journals: compact, total: j.total }).length,
    `${j.journals.length} journals / ${j.journals.reduce((n, x) => n + x.pages.length, 0)} pages; drop constant type:"JournalEntry", pageCount, page type when "text", playerVisible when false, the success/mode envelope`,
    'id,name,type,pageCount,pages[id,name,type,playerVisible]', 'id,name,pages[id,name,type?,playerVisible?]');
}
// ---------------------------------------------------------------- list-scenes (markdown)
{
  const t = body('list-scenes.txt');
  const lines = t.split('\n').filter(l => l.startsWith('  - '));
  const compact = lines.map(l => l.replace(/px, grid /, ' g')).join('\n');
  row('list-scenes', t.length, `Scenes (${lines.length}):\n${compact}`.length,
    `${lines.length} scenes; drop the background path line (avg ${Math.round((t.length - lines.join('\n').length) / lines.length)} chars/scene)`,
    'name,id,[active],WxH,grid,background', 'name,id,[active],WxH,grid');
}
// ---------------------------------------------------------------- list-folders (markdown)
{
  const t = body('list-folders.txt');
  const compact = t.replace(/ — #[0-9a-f]{6}, sort -?\d+,/g, ' —').replace(/ doc\(s\)/g, 'd').replace(/ subfolder\(s\)/g, 'sub');
  row('list-folders', t.length, compact.length, '79 folders; drop color + sort, abbreviate counts', 'name,id,color,sort,docCount,subfolderCount,nesting', 'name,id,docCount,subfolderCount,nesting');
}
// ---------------------------------------------------------------- list-macros (markdown)
{
  const t = body('list-macros.txt');
  const lines = t.split('\n');
  const compactA = lines.map(l => l.replace(/ · hotbar: .*$/, m => ` · pinned ×${(m.match(/slot/g) || []).length}`)).join('\n');
  const compactB = lines.map(l => l.replace(/ · hotbar: .*$/, '').replace(/ · by /, ' · ')).join('\n');
  row('list-macros', t.length, compactA.length, '105 macros; hotbar detail -> a pin count', 'name,id,type,author,hotbar[user slot…]', 'name,id,type,author,pinCount');
  row('list-macros (no hotbar)', t.length, compactB.length, 'same, hotbar dropped entirely (opt-in via a flag)', 'name,id,type,author,hotbar[user slot…]', 'name,id,type,author');
}
// ---------------------------------------------------------------- list-chat-messages (markdown)
{
  const t = body('list-chat-messages.txt');
  row('list-chat-messages', t.length, t.length, '50 messages, 80-char preview each — already compact; keep', 'id,time,alias,whisper,preview80', 'same');
}
// ---------------------------------------------------------------- list-compendium-packs (JSON)
{
  const t = body('list-compendium-packs.txt'); const j = JSON.parse(t);
  const compact = j.packs.map(p => ({ id: p.id, label: p.label, type: p.type }));
  row('list-compendium-packs', t.length, J({ packs: compact, total: j.total }).length, `${j.packs.length} packs; drop constant system:"dnd5e", availableTypes`, 'id,label,type,system', 'id,label,type');
}
// ---------------------------------------------------------------- get-world-info (JSON)
{
  const t = body('get-world-info.txt'); const j = JSON.parse(t);
  const compact = { id: j.id, title: j.title, system: j.system, foundry: j.foundry, host: j.host, users: j.users, activeUsers: j.activeUsers };
  row('get-world-info', t.length, J(compact).length, `drop description (${j.description.length} chars of HTML), background, automation (${Object.keys(j.automation).length} keys; that is configure-dnd5e-settings' read)`, Object.keys(j).join(','), 'id,title,system,foundry,host,users,activeUsers');
}
// ---------------------------------------------------------------- get-current-scene (JSON)
{
  const t = body('get-current-scene.txt'); const j = JSON.parse(t);
  const compact = { ...j, tokens: j.tokens.map(k => ({ id: k.id, name: k.name, x: k.position.x, y: k.position.y, actorId: k.actorId, disposition: k.disposition, ...(k.hidden ? { hidden: true } : {}), ...(k.size.width !== 1 || k.size.height !== 1 ? { size: k.size } : {}) })) };
  row('get-current-scene', t.length, J(compact).length, `${j.tokens.length} tokens; flatten position, drop hasImage, hidden:false, 1x1 size`, 'tokens[id,name,position{x,y},size{w,h},actorId,disposition,hidden,hasImage]', 'tokens[id,name,x,y,actorId,disposition,hidden?,size?]');
}
// ---------------------------------------------------------------- list-users / playlists / rolltables / cards (markdown, tiny)
for (const f of ['list-users', 'list-playlists', 'list-rolltables', 'list-cards']) {
  const t = body(`${f}.txt`);
  row(f, t.length, t.length, 'tiny; keep', '(markdown line per record)', 'same');
}
// ---------------------------------------------------------------- the 5 placeable errors
for (const f of ['list-tokens', 'list-walls', 'list-lights', 'list-regions', 'list-notes']) {
  const t = body(`${f}.txt`);
  row(f, t.length, t.length, 'zod error (sceneIdentifier required) — 185 chars; unchanged by projection', 'error', 'error');
}
// ---------------------------------------------------------------- search-compendium (JSON)
{
  const t = body('search-compendium.txt'); const j = JSON.parse(t);
  const empties = j.results.filter(r => r.description === '').length;
  const compact = j.results.map(r => ({ id: r.id, name: r.name, type: r.type, pack: r.pack.id }));
  row('search-compendium', t.length, J({ query: j.query, results: compact, totalFound: j.totalFound, hasMore: j.hasMore }).length,
    `${j.results.length} hits; description is "" on ${empties}/${j.results.length} (index has none), summary derivable, drop hasImage + pack.label + gameSystem`,
    'id,name,type,pack{id,label},description,hasImage,summary', 'id,name,type,pack');
}
// ---------------------------------------------------------------- search-compendium-spells (JSON, not truncated)
{
  const t = body('search-compendium-spells.txt'); const j = JSON.parse(t);
  const A = j.results.map(r => ({ id: r.id, name: r.name, pack: r.pack, facets: r.facets }));
  const B = j.results.map(r => ({ uuid: r.uuid, name: r.name, lvl: r.facets.spellLevel, school: r.facets.spellSchool }));
  row('search-compendium-spells (A)', t.length, J({ results: A, totalFound: j.totalFound }).length, `${j.results.length} hits; drop uuid (= pack+id), packLabel, img, type (constant), the criteria echo + note`, 'id,name,type,uuid,pack,packLabel,img,facets{spellLevel,spellSchool}', 'id,name,pack,facets');
  row('search-compendium-spells (B)', t.length, J({ results: B, totalFound: j.totalFound }).length, 'uuid-only variant with short facet keys (skills pass uuid)', 'same', 'uuid,name,lvl,school');
}
// ---------------------------------------------------------------- search-compendium-creatures (JSON, TRUNCATED)
{
  const t = body('search-compendium-creatures.txt');
  const recs = completeRecords(t, 'results');
  const rawTotal = 186_611; // 20,000 shown + 166,538 omitted + marker — from the measure run's cap marker
  const perRecToday = J(recs).length / recs.length;
  const A = recs.map(r => ({ id: r.id, name: r.name, pack: r.pack, cr: r.facets.challengeRating, type: r.facets.creatureType, size: r.facets.size, ...(r.facets.hasSpells ? { spells: true } : {}), ...(r.facets.hasLegendaryActions ? { legendary: true } : {}) }));
  const B = recs.map(r => ({ uuid: r.uuid, name: r.name, cr: r.facets.challengeRating, type: r.facets.creatureType, size: r.facets.size, ...(r.facets.hasSpells ? { spells: true } : {}), ...(r.facets.hasLegendaryActions ? { legendary: true } : {}) }));
  const perRecA = J(A).length / recs.length, perRecB = J(B).length / recs.length;
  const nRecs = Math.round(rawTotal / perRecToday);
  row('search-compendium-creatures (A) [uncapped est.]', rawTotal, Math.round(nRecs * perRecA), `${recs.length} complete records visible before the cap (${perRecToday.toFixed(0)} chars each) -> ~${nRecs} records in the 186,611-char raw result; A = ${perRecA.toFixed(0)} chars/record`, 'id,name,type,uuid,pack,packLabel,img,facets{challengeRating,creatureType,size,hasSpells,hasLegendaryActions}', 'id,name,pack,cr,type,size,spells?,legendary?');
  row('search-compendium-creatures (A) [as received, capped]', cap(rawTotal), cap(Math.round(nRecs * perRecA)), 'both sides still exceed the 20,000 cap -> the client receives 20,073 either way; only a record cap / real name filter changes this', '', '');
  row('search-compendium-creatures (B) [uncapped est.]', rawTotal, Math.round(nRecs * perRecB), `B = ${perRecB.toFixed(0)} chars/record (uuid-only)`, '', 'uuid,name,cr,type,size,spells?,legendary?');
}
// ---------------------------------------------------------------- list-actor-ownership (JSON, TRUNCATED)
{
  const t = body('list-actor-ownership.txt');
  const recs = completeRecords(t, 'ownership');
  const rawTotal = 227_662;
  const perRecToday = J(recs).length / recs.length;
  const nActors = 168; // list-actors total in the same run
  const compact = recs.map(a => {
    const explicit = Object.fromEntries(a.ownership.filter(o => o.source === 'explicit').map(o => [o.userName, o.permission]));
    return { id: a.id, name: a.name, default: a.defaultPermission, ...(Object.keys(explicit).length ? { explicit } : {}) };
  });
  const perRecA = J(compact).length / recs.length;
  const nExplicit = recs.filter(a => a.ownership.some(o => o.source === 'explicit')).length;
  row('list-actor-ownership (A) [uncapped est.]', rawTotal, Math.round(nActors * perRecA), `${recs.length} complete actors visible (${perRecToday.toFixed(0)} chars each = 7 user rows x ~190 chars); ${nExplicit}/${recs.length} have ANY explicit entry; A = one row per actor, explicit entries only, ${perRecA.toFixed(0)} chars`, 'id,name,type,defaultPermission,numericDefaultPermission,ownership[userId,userName,permission,numericPermission,source,explicitPermission,numericExplicitPermission] x7 users', 'id,name,default,explicit{user:level}?');
  row('list-actor-ownership (A) [as received, capped]', cap(rawTotal), cap(Math.round(nActors * perRecA)), `${nActors} actors x ${perRecA.toFixed(0)} chars fits under the cap`, '', '');
  // Variant B: only actors that have an explicit entry or a non-NONE default (the ones worth reporting)
  const perRecB = J(compact.filter(a => a.explicit || a.default !== 'NONE')).length / Math.max(1, recs.filter(a => a.ownership.some(o => o.source === 'explicit') || a.defaultPermission !== 'NONE').length);
  row('list-actor-ownership (B) [uncapped est.]', rawTotal, Math.round(nActors * (nExplicit / recs.length) * (Number.isFinite(perRecB) ? perRecB : perRecA)), `B = report only actors with an explicit entry or a non-NONE default (${nExplicit}/${recs.length} of the visible sample) + a one-line count of the rest`, '', 'id,name,default,explicit{user:level}');
}

// ---------------------------------------------------------------- print
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('tool', 52) + pad('before', 9) + pad('after', 9) + pad('saved', 7) + ' note');
for (const r of rows) {
  const saved = r.before ? Math.round((1 - r.after / r.before) * 100) : 0;
  console.log(pad(r.tool, 52) + pad(r.before, 9) + pad(r.after, 9) + pad(`${saved}%`, 7) + ' ' + r.note);
}
// 24-call totals: one row per baseline call (variant A, "as received" for the two capped ones)
const baseline = ['list-actors', 'list-actors.2', 'list-items', 'list-journals', 'list-scenes', 'list-folders', 'list-macros', 'list-chat-messages', 'list-compendium-packs', 'get-world-info', 'get-current-scene', 'list-users', 'list-playlists', 'list-rolltables', 'list-cards', 'list-tokens', 'list-walls', 'list-lights', 'list-regions', 'list-notes', 'search-compendium', 'search-compendium-spells (A)', 'search-compendium-creatures (A) [as received, capped]', 'list-actor-ownership (A) [as received, capped]'];
const pick = n => rows.find(r => r.tool === n);
const before = baseline.reduce((n, k) => n + pick(k).before, 0);
const after = baseline.reduce((n, k) => n + pick(k).after, 0);
console.log(`\n24-call total (as a client receives it, variant A): before ${before} chars ≈ ${tok(before)} tokens -> after ${after} chars ≈ ${tok(after)} tokens (${Math.round((1 - after / before) * 100)}% smaller)`);
const listOnly = baseline.filter(k => !/^(get-|list-(tokens|walls|lights|regions|notes)|list-chat|list-users|list-playlists|list-rolltables|list-cards)/.test(k));
const b2 = listOnly.reduce((n, k) => n + pick(k).before, 0), a2 = listOnly.reduce((n, k) => n + pick(k).after, 0);
console.log(`list/search bodies that actually change (${listOnly.length} calls): before ${b2} -> after ${a2} (${Math.round((1 - a2 / b2) * 100)}% smaller)`);
console.log('\nFields today vs compact:');
for (const r of rows) if (r.fieldsToday) console.log(`  ${pad(r.tool, 52)} today: ${r.fieldsToday}\n  ${pad('', 52)} compact: ${r.fieldsCompact}`);

// ---------------------------------------------------------------- addendum: JSON-key overhead vs a line format
{
  const a = JSON.parse(body('list-actors.txt'));
  const tsv = a.characters.map(c => `${c.id}\t${c.name}\t${c.type}`).join('\n');
  const md = a.characters.map(c => `- ${c.name} (${c.id}) ${c.type}`).join('\n');
  const jsonCompact = J(a.characters.map(c => ({ id: c.id, name: c.name, type: c.type })));
  console.log(`\nlist-actors 168 records — today JSON ${body('list-actors.txt').length} · compact JSON ${jsonCompact.length} · markdown lines ${md.length} · TSV ${tsv.length}`);
  const i = JSON.parse(body('list-items.txt'));
  const itsv = i.items.map(c => `${c.id}\t${c.name}\t${c.type}\t${c.folderName ?? ''}`).join('\n');
  const ijson = J(i.items.map(c => ({ id: c.id, name: c.name, type: c.type, folder: c.folderName ?? null })));
  console.log(`list-items 84 records — today JSON ${body('list-items.txt').length} · compact JSON ${ijson.length} · TSV ${itsv.length}`);
  const cr = completeRecords(body('search-compendium-creatures.txt'), 'results');
  const ctsv = cr.map(r => `${r.uuid}\t${r.name}\tCR${r.facets.challengeRating}\t${r.facets.creatureType}\t${r.facets.size}${r.facets.hasSpells ? '\tspells' : ''}${r.facets.hasLegendaryActions ? '\tlegendary' : ''}`).join('\n');
  console.log(`search-compendium-creatures ${cr.length} visible records — today ${J(cr).length} (${(J(cr).length / cr.length).toFixed(0)}/rec) · TSV ${ctsv.length} (${(ctsv.length / cr.length).toFixed(0)}/rec) -> 500-record survey ≈ ${Math.round(500 * ctsv.length / cr.length)} chars as TSV vs ${Math.round(500 * J(cr).length / cr.length)} today`);
}
