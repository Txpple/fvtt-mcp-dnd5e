// Does the SDK's own ListToolsResultSchema (what a TS-SDK client parses tools/list with) keep $defs/$ref?
import { ListToolsResultSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
const tool = { name: 'x', description: 'd', inputSchema: { type: 'object', properties: { a: { $ref: '#/$defs/A', description: 'site' }, b: { type: 'string' } }, required: ['a'], $defs: { A: { type: 'object', properties: { q: { type: 'integer' } } } } } };
const r = ListToolsResultSchema.safeParse({ tools: [tool] });
console.log('parse ok:', r.success);
console.log('survives:', JSON.stringify(r.data.tools[0].inputSchema));
console.log('identical to input:', JSON.stringify(r.data.tools[0].inputSchema) === JSON.stringify(tool.inputSchema));
// And a top-level unknown key on the TOOL (not inputSchema) — stripped or kept?
const r2 = ToolSchema.safeParse({ ...tool, bogus: 1 });
console.log('tool-level unknown key kept:', 'bogus' in (r2.data ?? {}));
