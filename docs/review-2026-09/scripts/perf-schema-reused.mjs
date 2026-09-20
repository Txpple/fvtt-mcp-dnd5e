// Task 3 — re-emit every tool's zod with reused:'ref' (and cycles:'ref') and compare bytes.
// Reproduces toInputSchema's post-processing (strip $schema, int sentinels, required/properties).
import { z } from 'zod';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes, tokens } from './perf-schema-lib.mjs';

function strip(node) {
  if (Array.isArray(node)) { for (const c of node) strip(c); return; }
  if (node && typeof node === 'object') {
    if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
    if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum;
    for (const k of Object.keys(node)) strip(node[k]);
  }
}
function emit(zod, opts) {
  const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts });
  delete json.$schema; strip(json);
  if (!Array.isArray(json.required)) json.required = [];
  if (typeof json.properties !== 'object' || json.properties === null) json.properties = {};
  return json;
}
const { tools, zodOf } = buildWithZod();
const rows = [];
let before = 0, after = 0, defsTools = 0, defsCount = 0;
for (const t of tools) {
  const zod = zodOf.get(t.name);
  const inline = emit(zod, { reused: 'inline' });
  const ref = emit(zod, { reused: 'ref' });
  const b = bytes(t.inputSchema), i = bytes(inline), r = bytes(ref);
  if (b !== i) console.log(`WARN ${t.name}: re-emitted inline (${i}) != advertised (${b})`);
  const nDefs = ref.$defs ? Object.keys(ref.$defs).length : 0;
  if (nDefs) { defsTools++; defsCount += nDefs; }
  before += b; after += r;
  rows.push({ name: t.name, before: b, after: r, saved: b - r, defs: nDefs, refs: JSON.stringify(ref).split('"$ref"').length - 1 });
}
const listBefore = bytes(tools);
const listAfter = listBefore - (before - after);
console.log(`schemas: inline ${before} → reused:'ref' ${after} (saved ${before - after}, ${(100*(before-after)/before).toFixed(2)}% of schema bytes)`);
console.log(`tools/list: ${listBefore} → ${listAfter} (${(100*(listBefore-listAfter)/listBefore).toFixed(2)}%), ≈ ${tokens(listBefore)} → ${tokens(listAfter)} tokens`);
console.log(`tools that gained a $defs block: ${defsTools} of ${tools.length}; total $defs entries: ${defsCount}`);
console.log('\nnamed tools:');
for (const n of ['manage-activity', 'add-feature', 'manage-effect', 'update-actor']) {
  const r = rows.find(r => r.name === n);
  console.log(`  ${n}: ${r.before} → ${r.after} (saved ${r.saved}, ${(100*r.saved/r.before).toFixed(1)}%), $defs=${r.defs}, $ref=${r.refs}`);
}
console.log('\ntop 15 by bytes saved:');
rows.sort((a, b) => b.saved - a.saved).slice(0, 15).forEach(r => console.log(`  ${r.name}: ${r.before} → ${r.after} (saved ${r.saved}), $defs=${r.defs}, $ref=${r.refs}`));
console.log('\ntools where reused:ref GROWS the schema (ref overhead > saving):');
rows.filter(r => r.saved < 0).forEach(r => console.log(`  ${r.name}: ${r.before} → ${r.after} (${r.saved})`));
// sample: what a $defs block looks like for manage-activity
const ma = emit(zodOf.get('manage-activity'), { reused: 'ref' });
console.log('\nmanage-activity $defs keys:', Object.keys(ma.$defs ?? {}));
for (const [k, v] of Object.entries(ma.$defs ?? {})) console.log(`   ${k}: ${bytes(v)} bytes :: ${JSON.stringify(v).slice(0, 120)}`);
// cycles?
let cyc = 0;
for (const t of tools) { try { emit(zodOf.get(t.name), { cycles: 'throw' }); } catch { cyc++; console.log('cycle in', t.name); } }
console.log(`\ntools with cyclic zod (cycles:'throw' throws): ${cyc}`);
