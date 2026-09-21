// siblings-names-cost.mjs — offline: the character cost of the tool NAMES under one/two registrations.
import { buildToolRegistry } from '../dist/registry.js';
const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
const fake = new Proxy({}, { get: () => async () => { throw new Error('offline'); } });
const host = { kind: 'generic', label: 'x', files: null, filesNotConfigured: () => '', publicUrl: p => p, vars: { serverUrl: '', adminKey: '', worldId: '' }, unreachableHint: '', redact: s => s };
const reg = buildToolRegistry({ foundry: fake, logger, host });
const names = reg.tools.map(t => t.name);
const per = (prefix) => names.map(n => `mcp__${prefix}__${n}`);
const sum = arr => arr.reduce((a, s) => a + s.length, 0);
const one = per('foundry-molten5e'), two = [...one, ...per('foundry-local5e')];
console.log(JSON.stringify({
  tools: names.length,
  bareNamesChars: sum(names),
  oneRegistrationChars: sum(one), oneRegistrationApproxTokens: Math.round(sum(one) / 3.6),
  twoRegistrationsChars: sum(two), twoRegistrationsApproxTokens: Math.round(sum(two) / 3.6),
  prefixOverheadPerName: 'mcp__foundry-molten5e__'.length,
  shorterPrefixSavingChars: sum(per('foundry-molten5e')) - sum(per('foundry')),
}, null, 1));
