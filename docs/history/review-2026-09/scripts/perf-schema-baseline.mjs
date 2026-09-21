import { buildTools, bytes } from './perf-schema-lib.mjs';
const { tools } = buildTools();
console.log('tools:', tools.length);
console.log('tools/list bytes (JSON.stringify(tools).length):', bytes(tools));
console.log('keys on a tool def:', Object.keys(tools[0]));
let desc = 0, schema = 0, name = 0, other = 0;
for (const t of tools) {
  desc += bytes(t.description ?? '');
  schema += bytes(t.inputSchema ?? {});
  name += bytes(t.name);
  const rest = { ...t }; delete rest.description; delete rest.inputSchema; delete rest.name;
  other += bytes(rest);
}
console.log({ desc, schema, name, other, sum: desc + schema + name + other });
