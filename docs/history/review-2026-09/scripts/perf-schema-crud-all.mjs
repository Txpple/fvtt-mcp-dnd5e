// The 82 list/create/update/delete-* tools across all families: bytes today, grouped by family
// suffix, so the 3-family shape experiment can be read against the whole CRUD surface.
import { buildTools, bytes, tokens } from './perf-schema-lib.mjs';
const { tools } = buildTools();
const all = bytes(tools);
const crud = tools.filter(t => /^(list|create|update|delete)-/.test(t.name));
const fam = new Map();
for (const t of crud) {
  const f = t.name.replace(/^(list|create|update|delete)-/, '').replace(/^(scene-)?(notes?|tokens?|regions?)$/, '$2').replace(/s$/, '');
  if (!fam.has(f)) fam.set(f, []);
  fam.get(f).push(t);
}
let sum = 0;
console.log('family | tools | chars | desc chars | schema chars');
for (const [f, ts] of [...fam.entries()].sort((a, b) => bytes(b[1]) - bytes(a[1]))) {
  const b = bytes(ts); sum += b;
  console.log(`${f} | ${ts.length} (${ts.map(t => t.name.split('-')[0][0]).join('')}) | ${b} | ${ts.reduce((s, t) => s + t.description.length, 0)} | ${ts.reduce((s, t) => s + bytes(t.inputSchema), 0)}`);
}
console.log(`\n${crud.length} CRUD-named tools in ${fam.size} families: ${sum} chars = ${(100 * sum / all).toFixed(1)}% of the ${all}-char list ≈ ${tokens(sum)} tokens`);
console.log(`if every family became one (a)-style tool of ~1,200 chars: ${fam.size * 1200} chars → list ≈ ${all - sum + fam.size * 1200} (${(100 * (all - sum + fam.size * 1200) / all).toFixed(1)}%), with ${sum} chars deferred behind describe`);
const nonCrud = tools.filter(t => !/^(list|create|update|delete)-/.test(t.name));
console.log(`the other ${nonCrud.length} tools: ${bytes(nonCrud)} chars (${(100 * bytes(nonCrud) / all).toFixed(1)}%); top 5: ${[...nonCrud].sort((a, b) => bytes(b) - bytes(a)).slice(0, 5).map(t => `${t.name}=${bytes(t)}`).join(', ')}`);
