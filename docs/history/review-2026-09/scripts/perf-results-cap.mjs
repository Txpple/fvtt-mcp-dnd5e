// perf-results: prototype of a RECORD-LEVEL cap (cut whole records, report how many were omitted,
// never mid-JSON) against the two baseline results capResponse truncated mid-document.
//
//   node scratch/perf-results-cap.mjs
//
// The raw (uncapped) bodies were not captured, so each is rebuilt from the complete records visible
// before the cut, repeated to the record count the pre-cap size implies (list-actor-ownership: the
// 168 actors list-actors returned in the same run; creatures: 186,611 chars / 379 chars per record).

import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scratch/bodies-2026-09-20');
const CAP = 20_000;

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

/**
 * The proposed central cap (src/index.ts): for an OBJECT result whose largest property is an array,
 * drop trailing records until JSON.stringify fits, and stamp `truncation: {kept, omitted, of}`.
 * For a STRING result, cut at the last newline under the cap and append a one-line marker.
 * Anything else falls back to the character cut (never expected once every list tool is an array).
 */
export function capRecords(result, maxChars) {
  if (typeof result === 'string') {
    if (result.length <= maxChars) return { text: result, omitted: 0 };
    const head = result.slice(0, maxChars);
    const nl = head.lastIndexOf('\n');
    const kept = nl > 0 ? head.slice(0, nl) : head;
    const omittedLines = result.slice(kept.length).split('\n').length - 1;
    return { text: `${kept}\n…[${omittedLines} more line(s) omitted — response exceeded toolResponseMaxChars (${maxChars})]`, omitted: omittedLines };
  }
  const full = JSON.stringify(result);
  if (full.length <= maxChars) return { text: full, omitted: 0 };
  // find the largest array property
  let key = null, best = 0;
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v) && JSON.stringify(v).length > best) { best = JSON.stringify(v).length; key = k; }
  }
  if (!key) return { text: `${full.slice(0, maxChars)}\n…[${full.length - maxChars} chars omitted]`, omitted: -1 };
  const arr = result[key];
  const overhead = full.length - best; // everything except the array
  let kept = arr.length, lo = 0, hi = arr.length;
  // binary search the largest prefix that fits with the stamp
  const fits = n => JSON.stringify({ ...result, [key]: arr.slice(0, n), truncation: { kept: n, omitted: arr.length - n, of: arr.length, note: `${key} cut at ${n} of ${arr.length} records — narrow the query or raise the limit/cap` } }).length <= maxChars;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  kept = lo;
  const out = { ...result, [key]: arr.slice(0, kept), truncation: { kept, omitted: arr.length - kept, of: arr.length, note: `${key} cut at ${kept} of ${arr.length} records — narrow the query or raise the limit/cap` } };
  return { text: JSON.stringify(out), omitted: arr.length - kept, overhead };
}

function rebuild(file, key, n) {
  const recs = completeRecords(readFileSync(path.join(DIR, file), 'utf8'), key);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...recs[i % recs.length], id: `${recs[i % recs.length].id}${i}` });
  return { recs, arr: out };
}

// list-actor-ownership: today's shape, 168 actors
{
  const { arr } = rebuild('list-actor-ownership.txt', 'ownership', 168);
  const result = { success: true, ownership: arr };
  const raw = JSON.stringify(result).length;
  const c = capRecords(result, CAP);
  console.log(`list-actor-ownership (today's record shape, 168 actors): raw ${raw} chars -> record-cap keeps ${168 - c.omitted}/168 actors in ${c.text.length} chars; character cut kept 14 complete + 1 partial record and lost the count`);
  // compact shape
  const compact = arr.map(a => { const ex = Object.fromEntries(a.ownership.filter(o => o.source === 'explicit').map(o => [o.userName, o.permission])); return { id: a.id, name: a.name, default: a.defaultPermission, ...(Object.keys(ex).length ? { explicit: ex } : {}) }; });
  const c2 = capRecords({ ownership: compact }, CAP);
  console.log(`list-actor-ownership (compact shape): raw ${JSON.stringify({ ownership: compact }).length} chars -> fits, ${c2.omitted} omitted`);
}
// search-compendium-creatures: today's shape, ~493 records (the default limit is 500)
{
  const { arr } = rebuild('search-compendium-creatures.txt', 'results', 493);
  const result = { documentType: 'creature', criteriaDescription: 'no criteria', results: arr, totalFound: 493, criteria: { limit: 500 }, note: 'Premium book creatures only — the SRD is never a source (design.md §2.3). Use creature names to pick candidates, then get-compendium-entry for full stat blocks.' };
  const raw = JSON.stringify(result).length;
  const c = capRecords(result, CAP);
  console.log(`search-compendium-creatures (today's shape, 493 hits): raw ${raw} chars -> record-cap keeps ${493 - c.omitted}/493 hits in ${c.text.length} chars, totalFound + note preserved`);
  const A = arr.map(r => ({ id: r.id, name: r.name, pack: r.pack, cr: r.facets.challengeRating, type: r.facets.creatureType, size: r.facets.size, ...(r.facets.hasSpells ? { spells: true } : {}), ...(r.facets.hasLegendaryActions ? { legendary: true } : {}) }));
  const cA = capRecords({ results: A, totalFound: 493 }, CAP);
  console.log(`search-compendium-creatures (compact A): raw ${JSON.stringify({ results: A, totalFound: 493 }).length} chars -> record-cap keeps ${493 - cA.omitted}/493 hits`);
  const tsv = `uuid\tname\tcr\ttype\tsize\tflags\n${arr.map(r => `${r.uuid}\t${r.name}\t${r.facets.challengeRating}\t${r.facets.creatureType}\t${r.facets.size}\t${[r.facets.hasSpells && 'spells', r.facets.hasLegendaryActions && 'legendary'].filter(Boolean).join(',')}`).join('\n')}`;
  const cT = capRecords(tsv, CAP);
  console.log(`search-compendium-creatures (TSV lines): raw ${tsv.length} chars -> line-cap keeps ${493 - cT.omitted}/493 hits`);
}
// a markdown list under the line cap: list-macros doubled to force a cut
{
  const t = readFileSync(path.join(DIR, 'list-macros.txt'), 'utf8');
  const big = `${t}\n${t.split('\n').slice(1).join('\n')}\n${t.split('\n').slice(1).join('\n')}`;
  const c = capRecords(big, CAP);
  console.log(`markdown list (list-macros x3 = ${big.length} chars): line-cap omitted ${c.omitted} line(s); tail = ${JSON.stringify(c.text.slice(-90))}`);
}
