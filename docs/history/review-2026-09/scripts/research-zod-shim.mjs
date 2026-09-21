// Same logic as src/utils/schema.ts (inline), plus: remember which zod schema produced which JSON object.
import { z } from 'zod';
globalThis.__zodByJson = new WeakMap();
globalThis.__zodCaptured = [];
function stripIntSentinels(node) {
  if (Array.isArray(node)) { for (const c of node) stripIntSentinels(c); return; }
  if (node && typeof node === 'object') {
    if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
    if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum;
    for (const k of Object.keys(node)) stripIntSentinels(node[k]);
  }
}
export function toInputSchema(schema) {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any' });
  delete json.$schema;
  stripIntSentinels(json);
  if (!Array.isArray(json.required)) json.required = [];
  if (typeof json.properties !== 'object' || json.properties === null) json.properties = {};
  globalThis.__zodByJson.set(json, schema);
  globalThis.__zodCaptured.push({ schema, json });
  return json;
}
