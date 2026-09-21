// Task 2 — hash every object subtree of every inputSchema (canonical JSON) and count identical
// subtrees that appear ≥ 2 times across tools. Reports bytes × occurrences, and the deduplicable
// bytes if each such subtree were emitted once and referenced ($ref). Only counts MAXIMAL
// duplicates for the "savings" figure (a subtree nested inside a bigger duplicated subtree is not
// double-counted).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildTools, bytes } from './perf-schema-lib.mjs';

const { tools } = buildTools();
const canon = v => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map(k2 => [k2, val[k2]])) : val);

// map hash -> { json, size, occurrences: [{tool, path}] }
const seen = new Map();
function walk(node, tool, path, isSchemaNode) {
  if (Array.isArray(node)) { node.forEach((c, i) => walk(c, tool, `${path}[${i}]`, isSchemaNode)); return; }
  if (!node || typeof node !== 'object') return;
  // only hash nodes that look like schema nodes (have type / anyOf / oneOf / properties / enum / $ref)
  const looksSchema = 'type' in node || 'anyOf' in node || 'oneOf' in node || 'allOf' in node || 'properties' in node || 'enum' in node || 'const' in node || 'items' in node;
  if (looksSchema) {
    const j = canon(node);
    const h = createHash('sha1').update(j).digest('hex').slice(0, 12);
    if (!seen.has(h)) seen.set(h, { json: j, size: j.length, occ: [], keys: Object.keys(node) });
    seen.get(h).occ.push({ tool, path });
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v)) walk(pv, tool, `${path}.${pk}`, true);
    } else if (v && typeof v === 'object') {
      walk(v, tool, `${path}.${k}`, true);
    }
  }
}
for (const t of tools) walk(t.inputSchema, t.name, t.name, true);

const dupes = [...seen.values()].filter(d => d.occ.length >= 2);
// Distinct-tool count for each
for (const d of dupes) {
  d.toolSet = new Set(d.occ.map(o => o.tool));
  d.totalBytes = d.size * d.occ.length;
  d.savings = d.size * (d.occ.length - 1); // if emitted once + $ref (ignoring ref overhead ~30 chars/occ)
}
dupes.sort((a, b) => b.totalBytes - a.totalBytes);

// Maximal duplicates: exclude a dupe whose every occurrence path is a strict descendant of another dupe's occurrence path
function isInside(path, otherPaths) { return otherPaths.some(p => path !== p && path.startsWith(p + '.') || path !== p && path.startsWith(p + '[')); }
const allDupePaths = dupes.flatMap(d => d.occ.map(o => o.path));
for (const d of dupes) {
  d.maximal = !d.occ.every(o => isInside(o.path, allDupePaths.filter(p => !d.occ.some(oo => oo.path === p))));
}
// Simpler: greedy — sort by size desc, keep a dupe only if none of its occurrence paths lie inside an already-kept dupe's occurrence path
const kept = [];
const keptPaths = [];
for (const d of [...dupes].sort((a, b) => b.size - a.size)) {
  const inside = d.occ.every(o => keptPaths.some(p => o.path.startsWith(p + '.') || o.path.startsWith(p + '[')));
  if (inside) { d.covered = true; continue; }
  // partially covered: count only the uncovered occurrences
  d.freeOcc = d.occ.filter(o => !keptPaths.some(p => o.path.startsWith(p + '.') || o.path.startsWith(p + '[')));
  if (d.freeOcc.length >= 2) { kept.push(d); keptPaths.push(...d.freeOcc.map(o => o.path)); }
}
const maximalSavings = kept.reduce((s, d) => s + d.size * (d.freeOcc.length - 1), 0);
const refOverhead = kept.reduce((s, d) => s + d.freeOcc.length * 30, 0); // {"$ref":"#/$defs/xN"} ≈ 25-30 chars
const totalBytes = bytes(tools);
console.log(`distinct schema subtrees: ${seen.size}; duplicated (≥2 occ): ${dupes.length}`);
console.log(`bytes in ALL duplicated occurrences (overlapping, double-counts nesting): ${dupes.reduce((s, d) => s + d.totalBytes, 0)}`);
console.log(`maximal (non-nested) duplicate set: ${kept.length} subtrees; theoretical savings if each emitted once = ${maximalSavings} chars (${(100*maximalSavings/totalBytes).toFixed(1)}% of ${totalBytes}); minus $ref overhead ≈ ${maximalSavings - refOverhead}`);
console.log('');
console.log('Top 25 duplicated subtrees by size × occurrences (all, incl. nested):');
console.log('rank | size | occ | tools | bytes×occ | first path | preview');
dupes.slice(0, 25).forEach((d, i) => {
  const preview = d.json.slice(0, 110).replace(/\s+/g, ' ');
  console.log(`${i+1} | ${d.size} | ${d.occ.length} | ${d.toolSet.size} | ${d.totalBytes} | ${d.occ[0].path} | ${preview}`);
});
console.log('');
console.log('Top 20 MAXIMAL duplicates (what a $ref/$defs pass would actually collapse):');
console.log('rank | size | freeOcc | tools | savings | first path | preview');
kept.sort((a, b) => b.size * (b.freeOcc.length - 1) - a.size * (a.freeOcc.length - 1));
kept.slice(0, 20).forEach((d, i) => {
  const preview = d.json.slice(0, 100).replace(/\s+/g, ' ');
  console.log(`${i+1} | ${d.size} | ${d.freeOcc.length} | ${new Set(d.freeOcc.map(o=>o.tool)).size} | ${d.size*(d.freeOcc.length-1)} | ${d.freeOcc[0].path} | ${preview}`);
});
// Enum-only dupes
const enumDupes = dupes.filter(d => d.keys.includes('enum'));
console.log('');
console.log(`duplicated enum-bearing nodes: ${enumDupes.length}; top 10:`);
enumDupes.slice(0, 10).forEach(d => console.log(`  ${d.size} × ${d.occ.length} (${d.toolSet.size} tools) ${d.occ[0].path} :: ${d.json.slice(0, 120)}`));
writeFileSync('scratch/perf-schema-dupes.json', JSON.stringify({ kept: kept.map(d => ({ size: d.size, occ: d.freeOcc, json: d.json })), top: dupes.slice(0, 60).map(d => ({ size: d.size, occ: d.occ, json: d.json })) }, null, 1));
