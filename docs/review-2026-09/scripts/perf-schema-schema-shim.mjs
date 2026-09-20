// Recording shim for dist/utils/schema.js — records every (zod, json) pair so a scratch script can
// map each advertised tool back to its zod instance and re-emit it with different options.
import { toInputSchema as real } from '../dist/utils/schema.js?real=1';
globalThis.__zodPairs = globalThis.__zodPairs ?? [];
export function toInputSchema(schema) {
  const json = real(schema);
  globalThis.__zodPairs.push({ zod: schema, json });
  return json;
}
