import { z } from 'zod';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes } from './perf-schema-lib.mjs';
function strip(node) { if (Array.isArray(node)) { for (const c of node) strip(c); return; } if (node && typeof node === 'object') { if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum; if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum; for (const k of Object.keys(node)) strip(node[k]); } }
function emit(zod, opts) { const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts }); delete json.$schema; strip(json); if (!Array.isArray(json.required)) json.required = []; if (typeof json.properties !== 'object' || json.properties === null) json.properties = {}; return json; }
const { tools, zodOf } = buildWithZod();
const t = tools.find(t => t.name === 'add-feature');
const ref = emit(zodOf.get(t.name), { reused: 'ref' });
// find leaves in advertised that are missing / differ in ref-version (after resolving refs)
function resolve(node, defs) { if (Array.isArray(node)) return node.map(n => resolve(n, defs)); if (node && typeof node === 'object') { if (node.$ref) { const { $ref, ...rest } = node; return resolve({ ...structuredClone(defs[$ref.replace('#/$defs/', '')]), ...rest }, defs); } const o = {}; for (const [k, v] of Object.entries(node)) o[k] = resolve(v, defs); return o; } return node; }
const defs = ref.$defs; const r2 = resolve(ref, defs); delete r2.$defs;
function diff(a, b, path, out) {
  if (typeof a !== typeof b || (a && typeof a === 'object') !== (b && typeof b === 'object')) { out.push(`${path}: ${JSON.stringify(a)?.slice(0,80)} != ${JSON.stringify(b)?.slice(0,80)}`); return; }
  if (a && typeof a === 'object') { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of keys) { if (!(k in a)) out.push(`${path}.${k}: only in ref-version: ${JSON.stringify(b[k]).slice(0,80)}`); else if (!(k in b)) out.push(`${path}.${k}: only in advertised: ${JSON.stringify(a[k]).slice(0,80)}`); else diff(a[k], b[k], `${path}.${k}`, out); } }
  else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
const out = []; diff(t.inputSchema, r2, 'add-feature', out);
console.log('advertised', bytes(t.inputSchema), 'ref-resolved', bytes(r2), 'diffs', out.length);
out.slice(0, 30).forEach(l => console.log('  ' + l));
