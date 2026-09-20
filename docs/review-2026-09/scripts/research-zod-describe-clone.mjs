import { z } from 'zod';
const SHARED = z.object({ id: z.string().describe('doc id'), name: z.string() });
const s = z.object({ a: SHARED.describe('as a'), b: SHARED.describe('as b') });
const inline = z.toJSONSchema(s, { io: 'input' });
const ref = z.toJSONSchema(s, { io: 'input', reused: 'ref' });
console.log('inline:', JSON.stringify(inline).length, 'chars');
console.log('ref   :', JSON.stringify(ref).length, 'chars ->', JSON.stringify(ref));
// unrepresentable: function form on 4.4.3?
try { const j = z.toJSONSchema(z.object({ d: z.date() }), { unrepresentable: () => ({ type: 'string' }) }); console.log('unrepresentable fn:', JSON.stringify(j.properties.d)); } catch (e) { console.log('unrepresentable fn threw:', e.message); }
