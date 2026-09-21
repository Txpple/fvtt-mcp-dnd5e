// Task 5 — the 68k chars of tool descriptions: how much is boilerplate repeated across tools
// (sentences appearing in >= 3 descriptions), and how much is field-level detail (sentences that
// name a parameter in backticks / quotes, or start with a field name) that belongs in the schema's
// own leaf descriptions or in docs. Also runs the same repeat analysis over the 122k of leaf
// (.describe()) prose, where phrase-level boilerplate lives.
import { writeFileSync } from 'node:fs';
import { buildTools, bytes } from './perf-schema-lib.mjs';

const { tools } = buildTools();

const norm = s => s.replace(/\s+/g, ' ').trim();
function sentences(text) {
  // split on sentence enders followed by whitespace+capital/quote/backtick, keep >= 20 chars
  return norm(text).split(/(?<=[.!?;])\s+(?=[A-Z"`(\[])/).map(norm).filter(s => s.length >= 20);
}

// --- tool descriptions ---
const descTotal = tools.reduce((s, t) => s + t.description.length, 0);
const sentByText = new Map(); // sentence -> Set(tool)
for (const t of tools) for (const s of new Set(sentences(t.description))) {
  if (!sentByText.has(s)) sentByText.set(s, new Set());
  sentByText.get(s).add(t.name);
}
const repeated = [...sentByText.entries()].filter(([, set]) => set.size >= 3).map(([s, set]) => ({ s, n: set.size, bytes: s.length * set.size, tools: [...set] })).sort((a, b) => b.bytes - a.bytes);
const repeatedBytes = repeated.reduce((s, r) => s + r.bytes, 0);
const repeated2 = [...sentByText.entries()].filter(([, set]) => set.size === 2).reduce((s, [t, set]) => s + t.length * 2, 0);
console.log(`tool descriptions: ${tools.length} tools, ${descTotal} chars; mean ${Math.round(descTotal / tools.length)}, max ${Math.max(...tools.map(t => t.description.length))} (${tools.reduce((a, t) => t.description.length > a.description.length ? t : a).name})`);
console.log(`  exact sentences repeated in >=3 descriptions: ${repeated.length} sentences, ${repeatedBytes} chars (${(100 * repeatedBytes / descTotal).toFixed(1)}% of description bytes)`);
console.log(`  exact sentences repeated in exactly 2 descriptions: ${repeated2} chars (${(100 * repeated2 / descTotal).toFixed(1)}%)`);
console.log('  top repeated sentences:');
repeated.slice(0, 12).forEach(r => console.log(`    ${r.n}x ${r.s.length}ch = ${r.bytes}: "${r.s.slice(0, 110)}" [${r.tools.slice(0, 5).join(', ')}${r.tools.length > 5 ? ', …' : ''}]`));

// near-boilerplate: recurring PHRASES (8-word shingles) across >= 3 descriptions
const shingles = new Map();
for (const t of tools) {
  const words = norm(t.description).toLowerCase().split(' ');
  const seen = new Set();
  for (let i = 0; i + 8 <= words.length; i++) { const sh = words.slice(i, i + 8).join(' '); if (seen.has(sh)) continue; seen.add(sh); if (!shingles.has(sh)) shingles.set(sh, new Set()); shingles.get(sh).add(t.name); }
}
const hot = [...shingles.entries()].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size);
console.log(`  8-word phrases shared by >=3 descriptions: ${hot.length}; top:`);
hot.slice(0, 10).forEach(([sh, s]) => console.log(`    ${s.size}x "${sh}"`));

// field-level detail: sentences that mention a parameter by name
const fieldRe = /`[a-zA-Z_.\[\]]+`|"[a-zA-Z_]+":|\b(param|parameter|field|arg|argument|option)s?\b|\b(pass|set|omit|use)\s+`?[a-z][a-zA-Z]+`?\s*(=|:|to|as)\b/;
let fieldBytes = 0, fieldSent = 0, allSent = 0;
const perTool = [];
for (const t of tools) {
  const ss = sentences(t.description);
  allSent += ss.length;
  const props = new Set(Object.keys(t.inputSchema?.properties ?? {}));
  let fb = 0;
  for (const s of ss) {
    const namesProp = [...props].some(p => p.length >= 4 && new RegExp(`(^|[^a-zA-Z])${p}([^a-zA-Z]|$)`).test(s));
    if (fieldRe.test(s) || namesProp) { fb += s.length; fieldSent++; }
  }
  fieldBytes += fb;
  perTool.push({ name: t.name, desc: t.description.length, field: fb, ratio: t.description.length ? fb / t.description.length : 0 });
}
console.log(`  field-level sentences (name a parameter of the tool, or say param/field/pass/omit …): ${fieldSent} of ${allSent} sentences, ${fieldBytes} chars (${(100 * fieldBytes / descTotal).toFixed(1)}% of description bytes)`);
console.log('  tools whose description is mostly field-level detail (>= 60%, desc >= 500):');
perTool.filter(p => p.ratio >= 0.6 && p.desc >= 500).sort((a, b) => b.field - a.field).slice(0, 15).forEach(p => console.log(`    ${p.name}: ${p.field}/${p.desc} (${Math.round(100 * p.ratio)}%)`));
// long descriptions
console.log('  10 longest descriptions:');
[...tools].sort((a, b) => b.description.length - a.description.length).slice(0, 10).forEach(t => console.log(`    ${t.name}: ${t.description.length}`));
// descriptions that embed an example JSON / call
const withExample = tools.filter(t => /e\.g\.|example|\{"|\{ ?[a-z]+:/i.test(t.description));
console.log(`  descriptions containing an example / e.g.: ${withExample.length} tools`);

// --- leaf descriptions (schema prose): repeated phrases ---
const leaves = [];
(function walk(node, tool) { if (Array.isArray(node)) return node.forEach(n => walk(n, tool)); if (node && typeof node === 'object') { if (typeof node.description === 'string') leaves.push({ tool, text: norm(node.description) }); for (const v of Object.values(node)) walk(v, tool); } })(tools.map(t => t.inputSchema), null);
for (const t of tools) (function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (node && typeof node === 'object') { if (typeof node.description === 'string') leaves[leaves.findIndex(l => l.tool === null && l.text === norm(node.description))] = { tool: t.name, text: norm(node.description) }; for (const v of Object.values(node)) walk(v); } })(t.inputSchema);
const leafTotal = leaves.reduce((s, l) => s + l.text.length, 0);
const leafByText = new Map();
for (const l of leaves) { if (!leafByText.has(l.text)) leafByText.set(l.text, []); leafByText.get(l.text).push(l.tool); }
const leafRep = [...leafByText.entries()].filter(([, a]) => a.length >= 3).map(([s, a]) => ({ s, n: a.length, tools: new Set(a).size, bytes: s.length * a.length })).sort((a, b) => b.bytes - a.bytes);
console.log(`\nleaf (.describe) prose: ${leaves.length} strings, ${leafTotal} chars; ${leafByText.size} distinct`);
console.log(`  identical leaf strings used >= 3 times: ${leafRep.length} strings, ${leafRep.reduce((s, r) => s + r.bytes, 0)} chars; if each were emitted once: save ${leafRep.reduce((s, r) => s + r.s.length * (r.n - 1), 0)}`);
leafRep.slice(0, 10).forEach(r => console.log(`    ${r.n}x (${r.tools} tools) ${r.s.length}ch: "${r.s.slice(0, 100)}"`));
// recurring phrases inside leaf prose
const leafSh = new Map();
for (const l of leaves) { const w = l.text.toLowerCase().split(' '); const seen = new Set(); for (let i = 0; i + 6 <= w.length; i++) { const sh = w.slice(i, i + 6).join(' '); if (seen.has(sh)) continue; seen.add(sh); leafSh.set(sh, (leafSh.get(sh) ?? 0) + 1); } }
const leafHot = [...leafSh.entries()].filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]);
console.log(`  6-word phrases occurring >= 6 times in leaf prose: ${leafHot.length}; top:`);
leafHot.slice(0, 12).forEach(([sh, n]) => console.log(`    ${n}x "${sh}"`));
// leaf descriptions that are long (>= 300 chars) — candidates for docs
const longLeaves = leaves.filter(l => l.text.length >= 300);
console.log(`  leaf descriptions >= 300 chars: ${longLeaves.length}, ${longLeaves.reduce((s, l) => s + l.text.length, 0)} chars (${(100 * longLeaves.reduce((s, l) => s + l.text.length, 0) / leafTotal).toFixed(1)}% of leaf prose); >= 200: ${leaves.filter(l => l.text.length >= 200).length} / ${leaves.filter(l => l.text.length >= 200).reduce((s, l) => s + l.text.length, 0)} chars`);
console.log('  longest leaf descriptions:');
[...leaves].sort((a, b) => b.text.length - a.text.length).slice(0, 6).forEach(l => console.log(`    ${l.tool} ${l.text.length}: "${l.text.slice(0, 120)}…"`));
writeFileSync('scratch/perf-schema-descriptions.json', JSON.stringify({ descTotal, repeated: repeated.slice(0, 50), hot: hot.slice(0, 50).map(([s, t]) => [s, [...t]]), perTool, leafRep: leafRep.slice(0, 50), leafHot: leafHot.slice(0, 50) }, null, 1));
