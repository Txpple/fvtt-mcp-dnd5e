// Near-duplicates: same property-NAME set (ignoring descriptions), across tools. Finds the
// "activity shape", "effect shape", "sourceRules" etc. that repeat with different prose.
import { buildTools, bytes } from './perf-schema-lib.mjs';
const { tools } = buildTools();
const byName = new Map(tools.map(t => [t.name, t]));
// strip descriptions, then hash by structure
const strip = v => Array.isArray(v) ? v.map(strip) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).filter(k => k !== 'description' && k !== 'default').sort().map(k => [k, strip(v[k])])) : v;
const shapes = new Map();
function walk(node, tool, path) {
  if (Array.isArray(node)) { node.forEach((c, i) => walk(c, tool, `${path}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  if (node.properties && typeof node.properties === 'object' && Object.keys(node.properties).length >= 3) {
    const key = JSON.stringify(strip(node));
    if (!shapes.has(key)) shapes.set(key, { occ: [], sizes: [], props: Object.keys(node.properties).length });
    shapes.get(key).occ.push({ tool, path }); shapes.get(key).sizes.push(bytes(node));
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') for (const [pk, pv] of Object.entries(v)) walk(pv, tool, `${path}.${pk}`);
    else if (v && typeof v === 'object') walk(v, tool, `${path}.${k}`);
  }
}
for (const t of tools) walk(t.inputSchema, t.name, t.name);
const near = [...shapes.values()].filter(s => new Set(s.occ.map(o=>o.tool)).size >= 2);
near.sort((a, b) => b.sizes.reduce((x,y)=>x+y,0) - a.sizes.reduce((x,y)=>x+y,0));
console.log(`object shapes (≥3 props) identical in STRUCTURE (descriptions ignored) across ≥2 tools: ${near.length}`);
near.slice(0, 20).forEach((s, i) => console.log(`${i+1} | props=${s.props} | occ=${s.occ.length} | tools=${new Set(s.occ.map(o=>o.tool)).size} | sizes=${s.sizes.join('/')} | ${s.occ.map(o=>o.path).join(', ').slice(0, 200)}`));

// sourceRules — where and how big
console.log('\n--- sourceRules occurrences ---');
let src = 0, srcBytes = 0;
function findKey(node, tool, path, key, out) {
  if (Array.isArray(node)) { node.forEach((c, i) => findKey(c, tool, `${path}[${i}]`, key, out)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties' && v && v[key]) out.push({ tool, path: `${path}.${key}`, size: bytes(v[key]), json: JSON.stringify(v[key]).slice(0, 160) });
    if (v && typeof v === 'object') findKey(v, tool, `${path}.${k}`, key, out);
  }
}
for (const key of ['sourceRules', 'actorIdentifier', 'sceneIdentifier', 'folder', 'dryRun', 'itemIdentifier', 'activityId', 'uuid']) {
  const out = [];
  for (const t of tools) findKey(t.inputSchema, t.name, t.name, key, out);
  const distinct = new Set(out.map(o => o.json)).size;
  console.log(`${key}: ${out.length} occurrences in ${new Set(out.map(o=>o.tool)).size} tools, ${out.reduce((s,o)=>s+o.size,0)} bytes total, ${distinct} distinct texts`);
  if (key === 'sourceRules' || key === 'actorIdentifier') out.slice(0, 40).forEach(o => console.log(`   ${o.size} ${o.tool} :: ${o.json.slice(0, 130)}`));
}
