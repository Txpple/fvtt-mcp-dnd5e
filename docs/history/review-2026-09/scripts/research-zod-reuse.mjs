// Measure: per-tool inputSchema size today (reused:'inline') vs reused:'ref', on the REAL registry.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
register(pathToFileURL(path.resolve('scratch/research-zod-hooks.mjs')).href);
const { z } = await import('zod');
const { buildToolRegistry } = await import('../dist/registry.js');
const { createHost, resolveHostConfig } = await import('../dist/hosts/index.js');
const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
const host = createHost(resolveHostConfig({}, 'generic'), logger);
const reg = buildToolRegistry({ foundry: {}, logger, host });
const tools = reg.tools;
const size = (o) => JSON.stringify(o).length;
function strip(json) { delete json.$schema; if (!Array.isArray(json.required)) json.required = []; if (!json.properties) json.properties = {}; return json; }
function countRefs(o, acc = { refs: 0, defs: 0 }) {
  if (Array.isArray(o)) { o.forEach(x => countRefs(x, acc)); return acc; }
  if (o && typeof o === 'object') { if (typeof o.$ref === 'string') acc.refs++; if (o.$defs) acc.defs += Object.keys(o.$defs).length; for (const k of Object.keys(o)) if (k !== '$defs' || true) countRefs(o[k], acc); }
  return acc;
}
let totalInline = 0, totalRef = 0, matched = 0, unmatched = [];
const rows = [];
for (const t of tools) {
  const zs = globalThis.__zodByJson.get(t.inputSchema);
  const inline = size(t.inputSchema);
  totalInline += inline;
  if (!zs) { unmatched.push(t.name); totalRef += inline; continue; }
  matched++;
  const ref = strip(z.toJSONSchema(zs, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', reused: 'ref' }));
  const refSize = size(ref);
  totalRef += refSize;
  const c = countRefs(ref);
  rows.push({ name: t.name, inline, ref: refSize, saved: inline - refSize, defs: c.defs, refs: c.refs });
}
rows.sort((a, b) => b.saved - a.saved);
console.log('tools:', tools.length, 'matched zod:', matched, 'unmatched:', unmatched.join(',') || '-');
console.log('total inputSchema chars  inline:', totalInline, ' reused=ref:', totalRef, ' saved:', totalInline - totalRef, `(${((totalInline - totalRef) / totalInline * 100).toFixed(1)}%)`);
console.log('tools where reused=ref produced any $defs:', rows.filter(r => r.defs > 0).length);
console.log('\ntop 20 by chars saved:');
for (const r of rows.slice(0, 20)) console.log(`  ${r.name.padEnd(28)} inline ${String(r.inline).padStart(6)}  ref ${String(r.ref).padStart(6)}  saved ${String(r.saved).padStart(6)}  $defs ${r.defs}  $ref ${r.refs}`);
// Sanity: full tools/list size as the client sees it (name + description + inputSchema)
const listChars = size(tools);
console.log('\nfull tools/list JSON chars (inline, as advertised):', listChars);
// Also: how the top tool's $defs look (names) under reused:'ref'
const top = rows[0];
if (top) {
  const zs = globalThis.__zodByJson.get(tools.find(t => t.name === top.name).inputSchema);
  const ref = z.toJSONSchema(zs, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', reused: 'ref' });
  console.log(`\n${top.name} $defs keys:`, Object.keys(ref.$defs ?? {}));
  for (const [k, v] of Object.entries(ref.$defs ?? {})) console.log(`  ${k}: ${JSON.stringify(v).slice(0, 160)}…`);
}
