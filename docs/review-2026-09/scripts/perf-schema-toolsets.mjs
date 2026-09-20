// Task 6 — what the 13 toolsets buy: tools/list bytes per single toolset (each registration
// always carries `world`), computed offline from the registry (no server spawned). Also the
// per-prompt cost of tool NAMES in Claude Code (deferred schemas: names are what every prompt
// carries), for one and two registrations.
import { buildTools, bytes, tokens } from './perf-schema-lib.mjs';
import { TOOLSETS, TOOLSET_NAMES } from '../dist/toolsets.js';

const full = buildTools();
const allBytes = bytes(full.tools);
console.log(`unset FOUNDRY_TOOLSETS: ${full.tools.length} tools, ${allBytes} chars ≈ ${tokens(allBytes)} tokens\n`);
const worldOnly = buildTools(['world']);
const worldBytes = bytes(worldOnly.tools);
console.log('toolset | tools (incl. world) | tools/list chars | ~tokens | % of full | own tools | own chars (excl. world) | mean chars/tool');
const rows = [];
for (const name of TOOLSET_NAMES) {
  const r = buildTools([name]);
  const b = bytes(r.tools);
  const own = TOOLSETS[name].length;
  const ownBytes = name === 'world' ? b : b - worldBytes;
  rows.push({ name, tools: r.tools.length, bytes: b, own, ownBytes });
  console.log(`${name} | ${r.tools.length} | ${b} | ${tokens(b)} | ${(100 * b / allBytes).toFixed(1)}% | ${own} | ${ownBytes} | ${Math.round(ownBytes / own)}`);
}
// sanity: own bytes sum to the full list (modulo the array commas)
const ownSum = rows.reduce((s, r) => s + r.ownBytes, 0);
console.log(`\nsum of own chars: ${ownSum} (full list ${allBytes}; difference = array separators)`);
// what the skill-driven combos cost
const combos = [['chat', 'combat'], ['scenes'], ['actors', 'compendium'], ['actors', 'compendium', 'items'], ['scenes', 'assets', 'audio'], ['journals', 'tables', 'cards'], ['world']];
console.log('\ncombos (as FOUNDRY_TOOLSETS would be set):');
for (const c of combos) { const r = buildTools(c); const b = bytes(r.tools); console.log(`  ${c.join(',')}: ${r.tools.length} tools, ${b} chars ≈ ${tokens(b)} tokens (${(100 * b / allBytes).toFixed(1)}%)`); }

// --- the NAME cost (Claude Code: deferred schemas, names in every prompt) ---
const names = full.tools.map(t => t.name);
const rawNames = names.reduce((s, n) => s + n.length, 0);
for (const reg of ['foundry-local5e', 'foundry-molten5e']) {
  const prefixed = names.reduce((s, n) => s + `mcp__${reg}__${n}`.length, 0);
  console.log(`\nnames, registration "${reg}": ${names.length} names, raw ${rawNames} chars, prefixed (mcp__${reg}__<name>) ${prefixed} chars ≈ ${tokens(prefixed)} tokens; as a comma+space list ${prefixed + 2 * (names.length - 1)} chars`);
}
const both = names.reduce((s, n) => s + `mcp__foundry-local5e__${n}`.length + `mcp__foundry-molten5e__${n}`.length, 0) + 2 * (2 * names.length - 1);
console.log(`two registrations (302 names), comma-separated: ${both} chars ≈ ${tokens(both)} tokens per prompt`);
// what each toolset contributes to the name list
console.log('\nname chars per toolset (one registration, prefixed):');
for (const name of TOOLSET_NAMES) { const c = TOOLSETS[name].reduce((s, n) => s + `mcp__foundry-local5e__${n}`.length + 2, 0); console.log(`  ${name}: ${TOOLSETS[name].length} names, ${c} chars`); }
// consolidation effect on the name list: 70 CRUD tools across 17 families -> 17 names
const crud = names.filter(n => /^(list|create|update|delete)-/.test(n));
const crudChars = crud.reduce((s, n) => s + `mcp__foundry-local5e__${n}`.length + 2, 0);
console.log(`\nlist/create/update/delete-* names today: ${crud.length}, ${crudChars} prefixed chars per registration (${(100 * crudChars / (names.reduce((s, n) => s + `mcp__foundry-local5e__${n}`.length + 2, 0))).toFixed(1)}% of the name list)`);
