// Task 4 — THE 3.0 SHAPE EXPERIMENT. For three families, measure tools/list bytes today and for
// three consolidated alternatives built from the SAME zod schemas (captured by identity via the
// loader shim; run with: node --import ./scratch/perf-schema-hook-register.mjs scratch/perf-schema-shapes.mjs):
//   (a) one tool per family: kind + op + loose `data` (z.record) + a `describe` op that RETURNS
//       the full JSON schema for one kind on demand — advertised bytes only.
//   (b) one tool per family whose input is a union over kind×op of the existing schemas
//       (each member = today's zod .extend({kind, op})). Measured twice: b1 = member schemas only
//       + one short family description (today's per-tool descriptions DROPPED); b2 = each
//       member also carries today's tool description as its member description (no info lost).
//   (c) the same union emitted with reused:'ref' — raw (as zod 4.4.3 emits it) and "genuine"
//       (single-reference $defs re-inlined, see perf-schema-reused-fixed.mjs).
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes, tokens } from './perf-schema-lib.mjs';

function strip(node) {
  if (Array.isArray(node)) { for (const c of node) strip(c); return; }
  if (node && typeof node === 'object') {
    if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
    if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum;
    for (const k of Object.keys(node)) strip(node[k]);
  }
}
function emit(zod, opts = {}) {
  const json = z.toJSONSchema(zod, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...opts });
  delete json.$schema; strip(json);
  if (!Array.isArray(json.required)) json.required = [];
  if (typeof json.properties !== 'object' || json.properties === null) json.properties = {};
  return json;
}
function countRefs(node, counts) {
  if (Array.isArray(node)) { node.forEach(n => countRefs(n, counts)); return; }
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') counts.set(node.$ref, (counts.get(node.$ref) ?? 0) + 1);
    for (const v of Object.values(node)) countRefs(v, counts);
  }
}
function inlineSingles(json) {
  for (let pass = 0; pass < 10; pass++) {
    if (!json.$defs) return json;
    const counts = new Map(); countRefs(json, counts);
    const singles = Object.keys(json.$defs).filter(k => (counts.get(`#/$defs/${k}`) ?? 0) <= 1);
    const snap = json.$defs;
    if (!singles.length) return json;
    const repl = (node) => {
      if (Array.isArray(node)) return node.map(repl);
      if (node && typeof node === 'object') {
        if (typeof node.$ref === 'string') {
          const k = node.$ref.replace('#/$defs/', '');
          if (singles.includes(k)) { const { $ref, ...rest } = node; return repl({ ...structuredClone(snap[k]), ...rest }); }
        }
        const out = {}; for (const [k, v] of Object.entries(node)) out[k] = repl(v); return out;
      }
      return node;
    };
    const defs = json.$defs; json = repl(json); json.$defs = {};
    for (const [k, v] of Object.entries(defs)) if (!singles.includes(k)) json.$defs[k] = repl(v);
    if (!Object.keys(json.$defs).length) delete json.$defs;
  }
  return json;
}

const { tools, zodOf } = buildWithZod();
const T = new Map(tools.map(t => [t.name, t]));

const DESCRIBE_HINT = ' Before the FIRST create/update of a kind in a session, call op "describe" with the kind: it returns the exact JSON schema for that kind (fields, enums, defaults).';

// kind × op for each family, derived from the tool name.
const FAM = {
  placeables: {
    kinds: ['tiles', 'lights', 'sounds', 'drawings', 'walls', 'tokens', 'notes', 'regions'],
    tools: {
      'create-tiles': ['tiles', 'create'], 'list-tiles': ['tiles', 'list'], 'update-tiles': ['tiles', 'update'], 'delete-tiles': ['tiles', 'delete'],
      'create-lights': ['lights', 'create'], 'list-lights': ['lights', 'list'], 'update-lights': ['lights', 'update'], 'delete-lights': ['lights', 'delete'],
      'create-sounds': ['sounds', 'create'], 'list-sounds': ['sounds', 'list'], 'update-sounds': ['sounds', 'update'], 'delete-sounds': ['sounds', 'delete'],
      'create-drawings': ['drawings', 'create'], 'list-drawings': ['drawings', 'list'], 'update-drawings': ['drawings', 'update'], 'delete-drawings': ['drawings', 'delete'],
      'create-walls': ['walls', 'create'], 'list-walls': ['walls', 'list'], 'update-walls': ['walls', 'update'], 'delete-walls': ['walls', 'delete'],
      'place-tokens': ['tokens', 'create'], 'list-tokens': ['tokens', 'list'], 'update-token': ['tokens', 'update'], 'delete-tokens': ['tokens', 'delete'],
      'create-scene-notes': ['notes', 'create'], 'list-notes': ['notes', 'list'], 'update-note': ['notes', 'update'], 'delete-note': ['notes', 'delete'],
      'create-region': ['regions', 'create'], 'list-regions': ['regions', 'list'], 'update-region': ['regions', 'update'], 'delete-region': ['regions', 'delete'],
      'create-teleporter': ['regions', 'create-teleporter'], 'add-region-behavior': ['regions', 'add-behavior'], 'remap-teleporters': ['regions', 'remap-teleporters'],
    },
    desc: 'Scene placeables: one tool for every placeable kind (tiles, lights, sounds, drawings, walls, tokens, notes, regions) and op (create, list, update, delete; regions also create-teleporter, add-behavior, remap-teleporters). data is the op payload for that kind. list/delete need only sceneIdentifier (+ ids).',
  },
  items: {
    kinds: ['item'],
    tools: { 'create-item': ['item', 'create'], 'list-items': ['item', 'list'], 'get-item': ['item', 'get'], 'update-item': ['item', 'update'], 'delete-item': ['item', 'delete'], 'import-item': ['item', 'import'] },
    desc: 'World (sidebar) Items: create, list, get, update, delete, or import (copy a premium-book compendium entry, never the SRD). data is the op payload.',
  },
  rolltables: {
    kinds: ['rolltable'],
    tools: { 'create-rolltable': ['rolltable', 'create'], 'import-rolltable': ['rolltable', 'import'], 'list-rolltables': ['rolltable', 'list'], 'update-rolltable': ['rolltable', 'update'], 'roll-on-table': ['rolltable', 'roll'], 'get-rolltable': ['rolltable', 'get'], 'delete-rolltable': ['rolltable', 'delete'] },
    desc: 'Roll tables: create, import (from a compendium), list, get, update, roll, delete. data is the op payload (results carry real @UUID links, never the SRD).',
  },
};

const rows = [];
for (const [fam, spec] of Object.entries(FAM)) {
  const names = Object.keys(spec.tools);
  const today = names.map(n => T.get(n));
  const todayBytes = bytes(today);
  const todayDesc = today.reduce((s, t) => s + t.description.length, 0);
  const todaySchema = today.reduce((s, t) => s + bytes(t.inputSchema), 0);
  const ops = [...new Set(names.map(n => spec.tools[n][1]))];

  // (a) loose: kind + op + data(record) + describe
  const A = z.object({
    kind: z.enum(spec.kinds).describe('Which kind.'),
    op: z.enum([...ops, 'describe']).describe('The operation; "describe" returns the JSON schema of the other ops for this kind.'),
    sceneIdentifier: z.string().min(1).optional().describe('Scene id or exact name (placeables only).'),
    ids: z.array(z.string().min(1)).optional().describe('Target ids for update/delete/get.'),
    data: z.record(z.string(), z.unknown()).optional().describe('The op payload, in the shape op "describe" returns for this kind.'),
  });
  const defA = { name: `manage-${fam}`, description: spec.desc + DESCRIBE_HINT, inputSchema: emit(A) };
  const aBytes = bytes([defA]);
  // what "describe" would RETURN per kind (deferred bytes, paid once per kind on demand as a RESULT)
  const deferred = {};
  for (const k of spec.kinds) {
    const members = names.filter(n => spec.tools[n][0] === k).map(n => ({ op: spec.tools[n][1], description: T.get(n).description, inputSchema: T.get(n).inputSchema }));
    deferred[k] = bytes(members);
  }

  // (b) union over kind×op of the existing zod schemas
  const membersB1 = names.map(n => zodOf.get(n).extend({ kind: z.literal(spec.tools[n][0]), op: z.literal(spec.tools[n][1]) }));
  const membersB2 = names.map(n => zodOf.get(n).extend({ kind: z.literal(spec.tools[n][0]), op: z.literal(spec.tools[n][1]) }).describe(T.get(n).description));
  const U1 = z.union(membersB1), U2 = z.union(membersB2);
  const defB1 = { name: `manage-${fam}`, description: spec.desc, inputSchema: emit(U1) };
  const defB2 = { name: `manage-${fam}`, description: spec.desc, inputSchema: emit(U2) };
  const b1Bytes = bytes([defB1]), b2Bytes = bytes([defB2]);

  // (c) same union with reused:'ref' (raw) and with singletons re-inlined (genuine reuse only)
  const cRaw1 = { ...defB1, inputSchema: emit(U1, { reused: 'ref' }) };
  const cGen1 = { ...defB1, inputSchema: inlineSingles(emit(U1, { reused: 'ref' })) };
  const cRaw2 = { ...defB2, inputSchema: emit(U2, { reused: 'ref' }) };
  const cGen2 = { ...defB2, inputSchema: inlineSingles(emit(U2, { reused: 'ref' })) };
  const cRaw1B = bytes([cRaw1]), cGen1B = bytes([cGen1]), cRaw2B = bytes([cRaw2]), cGen2B = bytes([cGen2]);
  // lossless guard: every (c) variant, with $refs fully resolved, must deep-equal the plain union
  const resolveAll = (node, defs) => Array.isArray(node) ? node.map(n => resolveAll(n, defs)) : (node && typeof node === 'object') ? (typeof node.$ref === 'string' ? (({ $ref, ...rest }) => resolveAll({ ...structuredClone(defs[$ref.replace('#/$defs/', '')]), ...rest }, defs))(node) : Object.fromEntries(Object.entries(node).filter(([k]) => k !== '$defs').map(([k, v]) => [k, resolveAll(v, defs)]))) : node;
  const canon = v => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map(k2 => [k2, val[k2]])) : val);
  for (const [label, c, plain] of [['cRaw1', cRaw1, defB1], ['cGen1', cGen1, defB1], ['cRaw2', cRaw2, defB2], ['cGen2', cGen2, defB2]]) {
    const ok = canon(resolveAll(c.inputSchema, c.inputSchema.$defs ?? {})) === canon(plain.inputSchema);
    if (!ok) throw new Error(`${fam} ${label} is NOT lossless`);
  }
  const genDefs = cGen1.inputSchema.$defs ? Object.entries(cGen1.inputSchema.$defs).map(([k, v]) => `${k}(${bytes(v)}b)`) : [];

  rows.push({ fam, tools: names.length, today: todayBytes, todayDesc, todaySchema, a: aBytes, b1: b1Bytes, b2: b2Bytes, cRaw1: cRaw1B, cGen1: cGen1B, cRaw2: cRaw2B, cGen2: cGen2B, removed: names.length - 1, names, genDefs, deferred });
  writeFileSync(`scratch/perf-schema-shapes-${fam}-a.json`, JSON.stringify(defA, null, 1));
  writeFileSync(`scratch/perf-schema-shapes-${fam}-b2.json`, JSON.stringify(defB2, null, 1));
  writeFileSync(`scratch/perf-schema-shapes-${fam}-cGen2.json`, JSON.stringify(cGen2, null, 1));
}

const allList = bytes(tools);
console.log(`whole tools/list today: ${tools.length} tools, ${allList} chars\n`);
console.log('family | tools today | bytes today (desc/schema) | (a) loose+describe | (b1) union, per-tool descs dropped | (b2) union, descs kept | (c) b1+reused:ref raw | (c) b1 genuine | (c) b2 raw | (c) b2 genuine | names removed');
for (const r of rows) {
  const pct = v => `${v} (${(100 * v / r.today).toFixed(1)}%)`;
  console.log(`${r.fam} | ${r.tools} | ${r.today} (${r.todayDesc}/${r.todaySchema}) | ${pct(r.a)} | ${pct(r.b1)} | ${pct(r.b2)} | ${pct(r.cRaw1)} | ${pct(r.cGen1)} | ${pct(r.cRaw2)} | ${pct(r.cGen2)} | ${r.removed}`);
}
console.log('\n(c) genuine $defs actually hoisted in the b1 union:');
for (const r of rows) console.log(`  ${r.fam}: ${r.genDefs.length ? r.genDefs.join(', ') : '(none)'}`);
console.log('\n(a) deferred bytes a "describe" call would RETURN per kind (paid once per kind, on demand, as a tool RESULT):');
for (const r of rows) console.log(`  ${r.fam}: ${Object.entries(r.deferred).map(([k, v]) => `${k}=${v}`).join(', ')}  (sum ${Object.values(r.deferred).reduce((s, v) => s + v, 0)})`);

const sum = key => rows.reduce((s, r) => s + r[key], 0);
const sumToday = sum('today'), sumA = sum('a'), sumB1 = sum('b1'), sumB2 = sum('b2'), sumC1 = sum('cGen1'), sumC2 = sum('cGen2');
const sumTools = sum('tools');
const p = v => `${v} (${(100 * v / sumToday).toFixed(1)}%)`;
console.log(`\nTOTAL over the 3 families: ${sumTools} tools -> 3 tools (${sumTools - 3} names removed)`);
console.log(`  today ${sumToday} | (a) ${p(sumA)}, saves ${sumToday - sumA} | (b1) ${p(sumB1)} | (b2) ${p(sumB2)} | (c1 genuine) ${p(sumC1)} | (c2 genuine) ${p(sumC2)}`);
const whole = v => `${allList - sumToday + v} (${(100 * (allList - sumToday + v) / allList).toFixed(1)}% of today, ~${tokens(allList - sumToday + v)} tokens)`;
console.log(`  whole list if (a) applied to these 3 families: ${whole(sumA)}`);
console.log(`  whole list if (b1) applied: ${whole(sumB1)}`);
console.log(`  whole list if (b2) applied: ${whole(sumB2)}`);
console.log(`  whole list if (c2 genuine) applied: ${whole(sumC2)}`);
const envelope = rows.map(r => r.names.reduce((s, n) => s + bytes(T.get(n)) - T.get(n).description.length - bytes(T.get(n).inputSchema), 0));
console.log(`\nper-tool envelope bytes (name + JSON keys + quotes) today: ${rows.map((r, i) => `${r.fam}=${envelope[i]} (${Math.round(envelope[i] / r.tools)}/tool)`).join(', ')}`);
writeFileSync('scratch/perf-schema-shapes.json', JSON.stringify(rows, null, 1));
