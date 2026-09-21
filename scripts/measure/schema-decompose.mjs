// Decompose the tools/list payload — what an EAGER client loads at connect — into where the
// bytes go: per tool, the description vs the inputSchema; inside the schema, the leaf
// "description" strings (zod .describe() prose), the enum lists, defaults/consts, and the
// structural remainder. This is the number M7 (the prose diet) is defined on: tools/list
// ≤ 230,000 chars, every leaf ≤ 120, every description ≤ 400.
//
//   node scripts/measure/schema-decompose.mjs [--top 15] [--json out.json]
//
// Offline (builds the registry from dist/; run `npm run build` first).
import { writeFileSync } from 'node:fs';
import {
  PROSE_BUDGET,
  approxTokens,
  argValue,
  buildRegistry,
  decomposeToolsList,
  fmt,
  pct,
  proseOffenders,
} from './lib.mjs';

const top = Number(argValue('--top', '15'));
const jsonOut = argValue('--json');

const { tools } = buildRegistry();
const list = decomposeToolsList(tools);
const { chars: all, totals: t } = list;

console.log(
  `tools/list: ${list.count} tools, ${fmt(all)} chars ≈ ${fmt(approxTokens(all))} tokens`
);
console.log(`  tool descriptions:             ${fmt(t.description)} (${pct(t.description, all)})`);
console.log(`  inputSchema total:             ${fmt(t.schema)} (${pct(t.schema, all)})`);
console.log(
  `    union member descriptions:   ${fmt(t.memberDescriptions)} (${pct(t.memberDescriptions, all)} of list — the consolidated families' per-op descriptions, M8)`
);
console.log(
  `    leaf "description" strings:  ${fmt(t.leafDescriptions)} (${pct(t.leafDescriptions, all)} of list, ` +
    `${pct(t.leafDescriptions, t.schema)} of schema) in ${fmt(t.leafDescriptionCount)} fields; longest ${t.longestLeafDescription}`
);
console.log(
  `    enum lists:                  ${fmt(t.enums)} (${pct(t.enums, all)} of list) in ${t.enumCount} enums / ${t.enumValues} values`
);
console.log(`    default:                     ${fmt(t.defaults)}`);
console.log(`    const:                       ${fmt(t.consts)}`);
console.log(`    examples:                    ${fmt(t.examples)}`);
console.log(
  `    structural (type/properties/required/items/anyOf/…): ${fmt(t.structural)} (${pct(t.structural, all)} of list)`
);
console.log(`  JSON envelope + names:         ${fmt(all - t.description - t.schema)}`);

console.log(`\nTop ${top} tools by advertised bytes:`);
console.log(
  'rank | tool | total | desc | schema | leafDesc(n) | enum(n/values) | default | structural'
);
list.tools.slice(0, top).forEach((r, i) => {
  console.log(
    `${i + 1} | ${r.name} | ${r.total} | ${r.description} | ${r.schema} | ${r.leafDescriptions}(${r.leafDescriptionCount}) | ` +
      `${r.enums}(${r.enumCount}/${r.enumValues}) | ${r.defaults} | ${r.structural}`
  );
});
const sum = rows => rows.reduce((s, r) => s + r.total, 0);
console.log(
  `Top ${top} sum: ${fmt(sum(list.tools.slice(0, top)))} (${pct(sum(list.tools.slice(0, top)), all)} of the list); ` +
    `top 30: ${fmt(sum(list.tools.slice(0, 30)))}`
);

console.log('\nCheapest 10:');
for (const r of list.tools.slice(-10)) console.log(`  ${r.name} ${r.total}`);
const sizes = list.tools.map(r => r.total).sort((a, b) => a - b);
console.log(
  `median tool: ${sizes[Math.floor(sizes.length / 2)]}, mean: ${Math.round(all / list.count)}, p90: ${sizes[Math.floor(sizes.length * 0.9)]}`
);

// The M7 prose budget (src/measure.test.ts enforces it): who is over, and by how much.
const offenders = proseOffenders(tools);
const overLeaf = offenders.filter(o => o.leaves.length);
const overDesc = offenders.filter(o => o.description);
console.log(
  `\nprose budget (M7: leaf ≤ ${PROSE_BUDGET.leaf}, description ≤ ${PROSE_BUDGET.description}): ` +
    `${overLeaf.length} tools with a leaf over; ${overDesc.length} descriptions over`
);
for (const o of offenders) {
  const bits = [];
  if (o.description) bits.push(`description ${o.description}`);
  for (const l of o.leaves) bits.push(`${l.path} ${l.length}`);
  console.log(`  ${o.name}: ${bits.join(' · ')}`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(list, null, 1));
  console.log(`written ${jsonOut}`);
}
