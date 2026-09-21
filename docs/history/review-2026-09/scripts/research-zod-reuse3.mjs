import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
register(pathToFileURL(path.resolve('scratch/research-zod-hooks.mjs')).href);
const { z } = await import('zod');
const { buildToolRegistry } = await import('../dist/registry.js');
const { createHost, resolveHostConfig } = await import('../dist/hosts/index.js');
const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
const host = createHost(resolveHostConfig({}, 'generic'), logger);
const { tools } = buildToolRegistry({ foundry: {}, logger, host });
const size = (o) => JSON.stringify(o).length;
function stripInt(n) { if (Array.isArray(n)) { n.forEach(stripInt); return; } if (n && typeof n === 'object') { if (n.maximum === Number.MAX_SAFE_INTEGER) delete n.maximum; if (n.minimum === -Number.MAX_SAFE_INTEGER) delete n.minimum; for (const k of Object.keys(n)) stripInt(n[k]); } }
function gen(zs, extra = {}) { const j = z.toJSONSchema(zs, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any', ...extra }); delete j.$schema; stripInt(j); return j; }
function refsTo(node, key, acc = 0) { if (Array.isArray(node)) return node.reduce((a, x) => refsTo(x, key, a), acc); if (node && typeof node === 'object') { if (node.$ref === `#/$defs/${key}`) acc++; for (const k of Object.keys(node)) acc = refsTo(node[k], key, acc); } return acc; }
const big = [];
for (const t of tools) {
  const zs = globalThis.__zodByJson.get(t.inputSchema);
  const b = gen(zs, { reused: 'ref' });
  for (const [k, v] of Object.entries(b.$defs ?? {})) {
    const c = size(v); const r = refsTo(b, k);
    if (c >= 200) big.push({ tool: t.name, key: k, chars: c, refs: r, netSave: c * (r - 1) - r * 28, preview: JSON.stringify(v).slice(0, 110) });
  }
}
big.sort((a, b) => b.netSave - a.netSave);
console.log('shared sub-shapes >= 200 chars (by object identity, intra-tool):', big.length);
console.log('sum of their net saving if ONLY these were $ref-ed (chars):', big.reduce((s, d) => s + Math.max(0, d.netSave), 0));
for (const d of big.slice(0, 25)) console.log(`  ${d.tool.padEnd(22)} ${d.key.padEnd(10)} ${String(d.chars).padStart(5)} chars x ${d.refs} refs  net ${String(d.netSave).padStart(6)}  ${d.preview}…`);
// Selective-ref idea: .meta({id}) on ONLY big shared shapes → extracted regardless of reused setting.
// Demonstrate with a synthetic: same shape used 3x, tagged with id, default reused:'inline'.
const shape = z.object({ x: z.number().describe('x coord'), y: z.number().describe('y coord'), w: z.number(), h: z.number() }).meta({ id: 'Rect' });
const demo = z.object({ a: shape.describe('first'), b: shape.describe('second'), c: z.array(shape) });
console.log('\n.meta({id}) demo (reused default inline):', JSON.stringify(gen(demo)));
