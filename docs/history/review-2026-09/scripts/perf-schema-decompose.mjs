// Task 1 — decompose the tools/list payload: per tool, description vs inputSchema; inside the
// inputSchema, bytes in leaf "description" strings (zod .describe() prose), bytes in enum lists,
// and the structural remainder. Also counts default/const/examples/title bytes as sub-buckets.
import { writeFileSync } from 'node:fs';
import { buildTools, bytes, tokens } from './perf-schema-lib.mjs';

const { tools } = buildTools();

// Walk a JSON-schema node; attribute bytes to buckets. "bytes" of a key/value pair = the JSON
// length of `"key":value` (+1 for the separating comma, approximated by counting the pair itself).
function walk(node, acc) {
  if (Array.isArray(node)) {
    for (const c of node) walk(c, acc);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description' && typeof v === 'string') {
      acc.leafDesc += bytes(k) + 1 + bytes(v);
      acc.leafDescCount++;
    } else if (k === 'enum' && Array.isArray(v)) {
      acc.enum += bytes(k) + 1 + bytes(v);
      acc.enumCount++;
      acc.enumValues += v.length;
    } else if (k === 'default') {
      acc.default += bytes(k) + 1 + bytes(v);
    } else if (k === 'const') {
      acc.const += bytes(k) + 1 + bytes(v);
    } else if (k === 'examples') {
      acc.examples += bytes(k) + 1 + bytes(v);
    } else {
      // structural key: count the key + its scalar value; descend into objects/arrays
      if (v && typeof v === 'object') {
        acc.structKeys += bytes(k) + 1;
        walk(v, acc);
      } else {
        acc.structKeys += bytes(k) + 1 + bytes(v);
      }
    }
  }
}

const rows = [];
const total = { desc: 0, schema: 0, leafDesc: 0, enum: 0, default: 0, const: 0, examples: 0, struct: 0, leafDescCount: 0, enumCount: 0, enumValues: 0 };
for (const t of tools) {
  const acc = { leafDesc: 0, leafDescCount: 0, enum: 0, enumCount: 0, enumValues: 0, default: 0, const: 0, examples: 0, structKeys: 0 };
  walk(t.inputSchema, acc);
  const schema = bytes(t.inputSchema);
  const desc = bytes(t.description ?? '') - 2; // raw chars, no quotes
  const structural = schema - acc.leafDesc - acc.enum - acc.default - acc.const - acc.examples;
  rows.push({ name: t.name, total: bytes(t), desc, schema, leafDesc: acc.leafDesc, leafDescCount: acc.leafDescCount, enum: acc.enum, enumCount: acc.enumCount, enumValues: acc.enumValues, default: acc.default, const: acc.const, examples: acc.examples, structural });
  total.desc += desc; total.schema += schema; total.leafDesc += acc.leafDesc; total.enum += acc.enum;
  total.default += acc.default; total.const += acc.const; total.examples += acc.examples; total.struct += structural;
  total.leafDescCount += acc.leafDescCount; total.enumCount += acc.enumCount; total.enumValues += acc.enumValues;
}
rows.sort((a, b) => b.total - a.total);
const all = bytes(tools);
console.log(`tools/list: ${tools.length} tools, ${all} chars ≈ ${tokens(all)} tokens`);
console.log(`  tool descriptions (raw chars): ${total.desc} (${(100*total.desc/all).toFixed(1)}%)`);
console.log(`  inputSchema total:             ${total.schema} (${(100*total.schema/all).toFixed(1)}%)`);
console.log(`    leaf "description" strings:  ${total.leafDesc} (${(100*total.leafDesc/all).toFixed(1)}% of list, ${(100*total.leafDesc/total.schema).toFixed(1)}% of schema) in ${total.leafDescCount} fields`);
console.log(`    enum lists:                  ${total.enum} (${(100*total.enum/all).toFixed(1)}% of list) in ${total.enumCount} enums / ${total.enumValues} values`);
console.log(`    default:                     ${total.default}`);
console.log(`    const:                       ${total.const}`);
console.log(`    examples:                    ${total.examples}`);
console.log(`    structural (type/properties/required/additionalProperties/items/anyOf/…): ${total.struct} (${(100*total.struct/all).toFixed(1)}% of list)`);
console.log(`  JSON envelope + names:         ${all - total.desc - total.schema}`);
console.log('');
console.log('Top 15 tools by total advertised bytes:');
console.log('rank | tool | total | desc | schema | leafDesc(n) | enum(n/values) | default | structural');
rows.slice(0, 15).forEach((r, i) => {
  console.log(`${i + 1} | ${r.name} | ${r.total} | ${r.desc} | ${r.schema} | ${r.leafDesc}(${r.leafDescCount}) | ${r.enum}(${r.enumCount}/${r.enumValues}) | ${r.default} | ${r.structural}`);
});
const top15 = rows.slice(0, 15).reduce((s, r) => s + r.total, 0);
console.log(`Top 15 sum: ${top15} (${(100*top15/all).toFixed(1)}% of the list); top 30: ${rows.slice(0,30).reduce((s,r)=>s+r.total,0)}`);
console.log('');
console.log('Bottom 10 (cheapest tools):');
rows.slice(-10).forEach(r => console.log(`  ${r.name} ${r.total}`));
// Distribution
const sorted = rows.map(r => r.total).sort((a, b) => a - b);
console.log(`median tool: ${sorted[Math.floor(sorted.length/2)]}, mean: ${Math.round(all/tools.length)}, p90: ${sorted[Math.floor(sorted.length*0.9)]}`);
writeFileSync('scratch/perf-schema-decompose.json', JSON.stringify({ all, total, rows }, null, 1));
