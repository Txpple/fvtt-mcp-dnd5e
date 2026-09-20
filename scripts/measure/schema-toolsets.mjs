// What each toolset buys: tools/list bytes per single toolset (every registration always carries
// `world`), computed offline from the registry, plus the skill-driven combinations a narrow
// registration would set in FOUNDRY_TOOLSETS. The always-on set's size is M7's ≤ 2,100 target.
//
//   node scripts/measure/schema-toolsets.mjs
//
// Offline (builds the registry from dist/; run `npm run build` first).
import { ALWAYS_ON, TOOLSET_NAMES, TOOLSETS } from '../../dist/toolsets.js';
import { approxTokens, buildRegistry, fmt, jsonChars, pct } from './lib.mjs';

const full = buildRegistry().tools;
const allBytes = jsonChars(full);
console.log(
  `unset FOUNDRY_TOOLSETS: ${full.length} tools, ${fmt(allBytes)} chars ≈ ${fmt(approxTokens(allBytes))} tokens\n`
);

const alwaysOn = [ALWAYS_ON];
const alwaysOnBytes = jsonChars(buildRegistry(alwaysOn).tools);
console.log(
  'toolset | tools (incl. always-on) | tools/list chars | ~tokens | % of full | own tools | own chars | mean chars/tool'
);
let ownSum = 0;
for (const name of TOOLSET_NAMES) {
  const tools = buildRegistry([name]).tools;
  const bytes = jsonChars(tools);
  const own = TOOLSETS[name].length;
  const ownBytes = alwaysOn.includes(name) ? bytes : bytes - alwaysOnBytes;
  ownSum += ownBytes;
  console.log(
    `${name} | ${tools.length} | ${fmt(bytes)} | ${fmt(approxTokens(bytes))} | ${pct(bytes, allBytes)} | ${own} | ${fmt(ownBytes)} | ${Math.round(ownBytes / own)}`
  );
}
console.log(
  `\nsum of own chars: ${fmt(ownSum)} (full list ${fmt(allBytes)}; the difference is array separators)`
);
console.log(
  `always-on (${alwaysOn.join(',')}): ${fmt(alwaysOnBytes)} chars — every registration carries this (M7 → ≤ 2,100)`
);

const combos = [
  ['chat', 'combat'],
  ['scenes'],
  ['actors', 'compendium'],
  ['actors', 'compendium', 'items'],
  ['scenes', 'assets', 'audio'],
  ['journals', 'tables', 'cards'],
  alwaysOn,
];
console.log('\ncombinations (as FOUNDRY_TOOLSETS would be set):');
for (const combo of combos) {
  const tools = buildRegistry(combo).tools;
  const bytes = jsonChars(tools);
  console.log(
    `  ${combo.join(',')}: ${tools.length} tools, ${fmt(bytes)} chars ≈ ${fmt(approxTokens(bytes))} tokens (${pct(bytes, allBytes)})`
  );
}

// The name list per toolset — what a Claude Code prompt carries for a registration of that set.
console.log('\nname chars per toolset (one registration, mcp__foundry-sandbox__<name>):');
for (const name of TOOLSET_NAMES) {
  const chars = TOOLSETS[name].reduce((s, n) => s + `mcp__foundry-sandbox__${n}`.length, 0);
  console.log(`  ${name}: ${TOOLSETS[name].length} names, ${fmt(chars)} chars`);
}
