// Helper: build the registry with the shim active, return tools + name→zod map.
import { buildTools } from './perf-schema-lib.mjs';
export function buildWithZod(toolsets = []) {
  const { tools } = buildTools(toolsets);
  const pairs = globalThis.__zodPairs ?? [];
  const zodOf = new Map();
  for (const t of tools) {
    const p = pairs.find(p => p.json === t.inputSchema);
    if (p) zodOf.set(t.name, p.zod);
  }
  return { tools, zodOf, pairs };
}
