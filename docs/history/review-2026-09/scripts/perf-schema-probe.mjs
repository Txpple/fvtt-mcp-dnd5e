import { buildWithZod } from './perf-schema-zodmap.mjs';
const { tools, zodOf, pairs } = buildWithZod();
console.log('tools', tools.length, 'pairs recorded', pairs.length, 'mapped by identity', zodOf.size);
console.log('unmapped:', tools.filter(t => !zodOf.has(t.name)).map(t => t.name).join(', '));
