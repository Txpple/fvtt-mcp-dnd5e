import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
register(pathToFileURL(path.resolve('scratch/research-zod-hooks.mjs')).href);
const { z } = await import('zod');
const { buildToolRegistry } = await import('../dist/registry.js');
const { createHost, resolveHostConfig } = await import('../dist/hosts/index.js');
const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
const host = createHost(resolveHostConfig({}, 'generic'), logger);
const { tools } = buildToolRegistry({ foundry: {}, logger, host });
const size = (o) => JSON.stringify(o).length;
function stripInt(n) { if (Array.isArray(n)) { n.forEach(stripInt); return; } if (n && typeof n === 'object') { if (n.maximum === Number.MAX_SAFE_INTEGER) delete n.maximum; if (n.minimum === -Number.MAX_SAFE_INTEGER) delete n.minimum; for (const k of Object.keys(n)) stripInt(n[k]); } }
function gen(zs, extra = {}) { const j = z.toJSONSchema(zs, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...extra }); delete j.$schema; stripInt(j); if (!Array.isArray(j.required)) j.required = []; if (!j.properties) j.properties = {}; return j; }
let inl = 0, ref = 0; const rows = []; const defSizes = [];
for (const t of tools) {
  const zs = globalThis.__zodByJson.get(t.inputSchema);
  const a = gen(zs), b = gen(zs, { reused: 'ref' });
  inl += size(a); ref += size(b);
  const defs = Object.entries(b.$defs ?? {});
  for (const [k, v] of defs) defSizes.push({ tool: t.name, key: k, chars: size(v), refCount: (JSON.stringify(b).match(new RegExp(`#/\$defs/${k}"`, 'g')) || []).length, preview: JSON.stringify(v).slice(0, 90) });
  rows.push({ name: t.name, inline: size(a), ref: size(b), delta: size(b) - size(a), defs: defs.length });
}
console.log('inline total', inl, '| reused=ref total', ref, '| delta', ref - inl, `(${((ref - inl) / inl * 100).toFixed(1)}%)`);
console.log('defs extracted overall:', defSizes.length, '| defs <= 60 chars:', defSizes.filter(d => d.chars <= 60).length, '| defs >= 300 chars:', defSizes.filter(d => d.chars >= 300).length);
rows.sort((a, b) => a.delta - b.delta);
console.log('\nbest 8 (chars saved by ref):'); for (const r of rows.slice(0, 8)) console.log(`  ${r.name.padEnd(28)} inline ${r.inline}  ref ${r.ref}  delta ${r.delta}  defs ${r.defs}`);
console.log('\nworst 8 (chars added by ref):'); for (const r of rows.slice(-8)) console.log(`  ${r.name.padEnd(28)} inline ${r.inline}  ref ${r.ref}  delta ${r.delta}  defs ${r.defs}`);
defSizes.sort((a, b) => b.chars * b.refCount - a.chars * a.refCount);
console.log('\nlargest shared sub-shapes (chars x refs):'); for (const d of defSizes.slice(0, 12)) console.log(`  ${d.tool.padEnd(22)} ${d.key.padEnd(10)} ${String(d.chars).padStart(5)} chars x ${d.refCount} refs  ${d.preview}…`);
// how many distinct zod object instances are described N times: count leaf description reuse
const descCounts = new Map();
function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (n && typeof n === 'object') { if (typeof n.description === 'string' && n.description.length > 40) descCounts.set(n.description, (descCounts.get(n.description) ?? 0) + 1); for (const k of Object.keys(n)) walk(n[k]); } }
for (const t of tools) walk(t.inputSchema);
const dup = [...descCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);
const dupChars = dup.reduce((s, [d, c]) => s + d.length * (c - 1), 0);
console.log(`\nidentical property descriptions (>40 chars) repeated across the whole tools/list: ${dup.length} distinct, ${dupChars} redundant chars`);
for (const [d, c] of dup.slice(0, 10)) console.log(`  x${c}  (${d.length} chars)  ${d.slice(0, 100)}…`);
