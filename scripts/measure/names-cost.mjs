// The per-prompt cost of the tool NAMES in Claude Code — with deferred schemas, the names are
// what every prompt carries, once per registration in the `mcp__<registration>__<name>` form.
// Two full-surface registrations (a campaign world + a sandbox) is the plan's baseline (11,147
// at 2.2.0); M8 (the CRUD consolidation) takes it to ≤ 7,000.
//
//   node scripts/measure/names-cost.mjs [--registrations foundry-campaign,foundry-sandbox]
//
// Offline (builds the registry from dist/; run `npm run build` first).
import {
  DEFAULT_REGISTRATIONS,
  approxTokens,
  argValue,
  buildRegistry,
  fmt,
  measureNames,
} from './lib.mjs';

const registrations = argValue('--registrations', DEFAULT_REGISTRATIONS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const { tools } = buildRegistry();
const names = measureNames(tools, registrations);

console.log(`${names.count} tool names, ${fmt(names.bareChars)} chars bare`);
for (const [registration, chars] of Object.entries(names.perRegistration)) {
  console.log(
    `  mcp__${registration}__<name>: ${fmt(chars)} chars ≈ ${fmt(approxTokens(chars))} tokens per prompt`
  );
}
console.log(
  `${registrations.length} registration(s): ${fmt(names.prefixedChars)} chars ≈ ${fmt(approxTokens(names.prefixedChars))} tokens per prompt (M8 → ≤ 7,000 for two)`
);

// The consolidation's lever: the list/create/update/delete-* names → one name per family.
const crud = tools.map(t => t.name).filter(n => /^(list|create|update|delete)-/.test(n));
const crudChars = crud.reduce((s, n) => s + `mcp__${registrations[0]}__${n}`.length, 0);
const first = names.perRegistration[registrations[0]];
console.log(
  `\nlist/create/update/delete-* names: ${crud.length} of ${names.count}, ${fmt(crudChars)} of ${fmt(first)} prefixed chars per registration (${((100 * crudChars) / first).toFixed(1)}%)`
);
