// reused:'ref' but with the spurious single-reference $defs re-inlined — what intra-tool $ref
// would buy if zod only hoisted genuinely reused instances.
import { z } from 'zod';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes, tokens } from './perf-schema-lib.mjs';
function strip(node) { if (Array.isArray(node)) { for (const c of node) strip(c); return; } if (node && typeof node === 'object') { if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum; if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum; for (const k of Object.keys(node)) strip(node[k]); } }
function emit(zod, opts) { const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts }); delete json.$schema; strip(json); if (!Array.isArray(json.required)) json.required = []; if (typeof json.properties !== 'object' || json.properties === null) json.properties = {}; return json; }
function countRefs(node, counts) { if (Array.isArray(node)) { node.forEach(n => countRefs(n, counts)); return; } if (node && typeof node === 'object') { if (typeof node.$ref === 'string') counts.set(node.$ref, (counts.get(node.$ref) ?? 0) + 1); for (const v of Object.values(node)) countRefs(v, counts); } }
function inlineSingles(json) {
  // iterate until stable (a def may reference another)
  for (let pass = 0; pass < 10; pass++) {
    if (!json.$defs) return json;
    const counts = new Map(); countRefs(json, counts);
    const singles = Object.keys(json.$defs).filter(k => (counts.get(`#/$defs/${k}`) ?? 0) <= 1);
    const snap = json.$defs;
    if (!singles.length) return json;
    const repl = (node) => {
      if (Array.isArray(node)) return node.map(repl);
      if (node && typeof node === 'object') {
        if (typeof node.$ref === 'string') { const k = node.$ref.replace('#/$defs/', ''); if (singles.includes(k)) { const { $ref, ...rest } = node; return repl({ ...structuredClone(snap[k]), ...rest }); } }
        const out = {}; for (const [k, v] of Object.entries(node)) out[k] = repl(v); return out;
      }
      return node;
    };
    const defs = json.$defs; json = repl(json); json.$defs = {};
    for (const [k, v] of Object.entries(defs)) if (!singles.includes(k)) json.$defs[k] = repl(v);
    if (!Object.keys(json.$defs).length) delete json.$defs;
  }
  return json;
}
const { tools, zodOf } = buildWithZod();
let before = 0, after = 0, nTools = 0, nDefs = 0; const rows = [];
for (const t of tools) {
  const fixed = inlineSingles(emit(zodOf.get(t.name), { reused: 'ref' }));
  const b = bytes(t.inputSchema), a = bytes(fixed);
  before += b; after += a; const d = fixed.$defs ? Object.keys(fixed.$defs).length : 0; if (d) { nTools++; nDefs += d; }
  rows.push({ name: t.name, before: b, after: a, saved: b - a, defs: d, defKeys: fixed.$defs ? Object.entries(fixed.$defs).map(([k, v]) => `${bytes(v)}b:${JSON.stringify(v).slice(0, 60)}`) : [] });
}
const lb = bytes(tools), la = lb - (before - after);
console.log(`genuine intra-tool reuse only: schemas ${before} → ${after} (saved ${before - after}, ${(100*(before-after)/before).toFixed(2)}%); tools/list ${lb} → ${la} (${(100*(lb-la)/lb).toFixed(2)}%)`);
console.log(`tools with a genuine $defs: ${nTools}; entries: ${nDefs}`);
for (const n of ['manage-activity', 'add-feature', 'manage-effect', 'update-actor']) { const r = rows.find(r => r.name === n); console.log(`  ${n}: ${r.before} → ${r.after} (saved ${r.saved}) defs=${r.defs}`); r.defKeys.forEach(k => console.log(`      ${k}`)); }
console.log('\nall tools with any genuine reuse:');
rows.filter(r => r.defs).sort((a, b) => b.saved - a.saved).forEach(r => console.log(`  ${r.name}: saved ${r.saved} (${r.defs} defs)`));
