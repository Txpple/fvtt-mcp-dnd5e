import { z } from 'zod';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes } from './perf-schema-lib.mjs';
function strip(node) { if (Array.isArray(node)) { for (const c of node) strip(c); return; } if (node && typeof node === 'object') { if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum; if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum; for (const k of Object.keys(node)) strip(node[k]); } }
function emit(zod, opts = {}) { const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts }); delete json.$schema; strip(json); return json; }
function resolveAll(node, defs) { if (Array.isArray(node)) return node.map(n => resolveAll(n, defs)); if (node && typeof node === 'object') { if (typeof node.$ref === 'string') { const { $ref, ...rest } = node; return resolveAll({ ...structuredClone(defs[$ref.replace('#/$defs/', '')]), ...rest }, defs); } const o = {}; for (const [k, v] of Object.entries(node)) if (k !== '$defs') o[k] = resolveAll(v, defs); return o; } return node; }
const canon = v => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map(k2 => [k2, val[k2]])) : val);
const { zodOf } = buildWithZod();
const names = ['create-rolltable','import-rolltable','list-rolltables','update-rolltable','roll-on-table','get-rolltable','delete-rolltable'];
const members = names.map((n, i) => zodOf.get(n).extend({ kind: z.literal('rolltable'), op: z.literal(n) }));
const U = z.union(members);
const plain = emit(U);
const ref = emit(U, { reused: 'ref' });
const resolved = resolveAll(ref, ref.$defs ?? {});
console.log('plain', bytes(plain), 'ref raw', bytes(ref), 'ref resolved', bytes(resolved), 'deep-equal(plain, resolved):', canon(plain) === canon(resolved));
// where do they differ?
function diff(a, b, path, out) { if (typeof a !== typeof b || (a && typeof a === 'object') !== (b && typeof b === 'object')) { out.push(`${path}: ${JSON.stringify(a)?.slice(0,60)} != ${JSON.stringify(b)?.slice(0,60)}`); return; } if (a && typeof a === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (!(k in a)) out.push(`${path}.${k}: only in resolved: ${JSON.stringify(b[k])?.slice(0,60)}`); else if (!(k in b)) out.push(`${path}.${k}: only in plain: ${JSON.stringify(a[k])?.slice(0,60)}`); else diff(a[k], b[k], `${path}.${k}`, out); } } else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const out = []; diff(plain, resolved, 'U', out); out.slice(0, 15).forEach(l => console.log('  ' + l)); console.log('diff lines:', out.length);
// same for the individual tool: does emit(create-rolltable) with ref, resolved, equal the plain?
for (const n of ['create-rolltable', 'update-rolltable']) { const p = emit(zodOf.get(n)); const r = emit(zodOf.get(n), { reused: 'ref' }); const rr = resolveAll(r, r.$defs ?? {}); console.log(n, bytes(p), bytes(r), bytes(rr), canon(p) === canon(rr)); }
