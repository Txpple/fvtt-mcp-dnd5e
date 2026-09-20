import { z } from 'zod';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes } from './perf-schema-lib.mjs';
function emit(zod, opts = {}) { const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts }); delete json.$schema; return json; }
const { zodOf } = buildWithZod();
const names = ['create-rolltable','import-rolltable','list-rolltables','update-rolltable','roll-on-table','get-rolltable','delete-rolltable'];
const U = z.union(names.map(n => zodOf.get(n).extend({ kind: z.literal('rolltable'), op: z.literal(n) })));
const ref = emit(U, { reused: 'ref' });
const counts = new Map();
(function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (node && typeof node === 'object') { if (typeof node.$ref === 'string') counts.set(node.$ref, (counts.get(node.$ref) ?? 0) + 1); Object.values(node).forEach(walk); } })(ref);
console.log('defs:', Object.keys(ref.$defs).length);
for (const [k, v] of Object.entries(ref.$defs)) console.log(`  ${k}: ${bytes(v)}b refs=${counts.get('#/$defs/' + k) ?? 0} :: ${JSON.stringify(v).slice(0, 90)}`);
