import { z } from 'zod';
const o = { io: 'input', target: 'draft-2020-12', reused: 'ref' };
const cases = {
  'string.optional()': z.object({ a: z.string().optional() }),
  'string.describe().optional()': z.object({ a: z.string().describe('d').optional() }),
  'string.optional().describe()': z.object({ a: z.string().optional().describe('d') }),
  'string.default()': z.object({ a: z.string().default('x') }),
  'string.describe()': z.object({ a: z.string().describe('d') }),
  'string': z.object({ a: z.string() }),
  'string.min(1).optional()': z.object({ a: z.string().min(1).optional() }),
  'enum.optional()': z.object({ a: z.enum(['x','y']).optional() }),
  'shared instance x2': (() => { const s = z.string().min(1).describe('id'); return z.object({ a: s, b: s }); })(),
};
for (const [k, v] of Object.entries(cases)) console.log(k.padEnd(32), JSON.stringify(z.toJSONSchema(v, o)));
// how does .describe work in this build? does it clone?
const s = z.string(); const d = s.describe('x'); console.log('describe clones?', s !== d);
const s2 = z.string(); const opt = s2.optional(); console.log('optional innerType === s2?', opt._zod.def.innerType === s2);
