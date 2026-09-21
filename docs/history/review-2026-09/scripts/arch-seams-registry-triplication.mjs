// arch-seams: each tool name is spelled in (1) a class's getToolDefinitions(), (2) registry.ts
// handlers map, (3) toolsets.ts. Does any definition exist with no handler (silently dropped)?
import { readFileSync } from 'node:fs';
import { buildToolRegistry } from '../dist/registry.js';
import { createHost, resolveHostConfig } from '../dist/hosts/index.js';
import { Logger } from '../dist/logger.js';
import { TOOLSETS } from '../dist/toolsets.js';

const logger = new Logger({ level: 'error', format: 'simple', enableConsole: false, enableFile: false });
const host = createHost(resolveHostConfig({}, 'generic'), logger);
const foundry = { call: async () => ({}), screenshot: async () => {}, isReady: () => true, dispose: async () => {} };
const reg = buildToolRegistry({ foundry, logger, host });
const handlerNames = new Set(Object.keys(reg.handlers));

// Collect every definition name by instantiating every tool class the registry imports.
const src = readFileSync('src/registry.ts', 'utf8');
const imports = [...src.matchAll(/import \{ ([A-Za-z0-9_]+) \} from '\.\/tools\/([^']+)\.js';/g)];
const defNames = new Map();
for (const [, cls, path] of imports) {
  const mod = await import(`../dist/tools/${path}.js`);
  const C = mod[cls];
  if (typeof C !== 'function') continue;
  let inst;
  try { inst = C.prototype ? new C({ foundry, logger, host }) : C(); } catch (e) { try { inst = C(); } catch { continue; } }
  const defs = typeof inst?.getToolDefinitions === 'function' ? inst.getToolDefinitions() : (inst?.name ? [inst] : []);
  for (const d of defs) defNames.set(d.name, `${cls} (${path})`);
}
const orphanDefs = [...defNames.keys()].filter(n => !handlerNames.has(n));
const toolsetNames = new Set(Object.values(TOOLSETS).flat());
console.log('definitions collected:', defNames.size, '| handlers:', handlerNames.size, '| toolset entries:', toolsetNames.size);
console.log('definitions with NO handler (silently dropped by registry.ts):', orphanDefs);
console.log('handlers not in toolsets:', [...handlerNames].filter(n => !toolsetNames.has(n)));
// spell count: how many times does each tool name literal appear across src (non-test)?
const names = [...handlerNames];
console.log('\nname literal occurrences (src non-test) for 5 sample tools:');
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p); } return out; }
const files = walk('src').map(f => [f.split(sep).join('/'), readFileSync(f, 'utf8')]);
for (const n of ['create-tiles', 'get-actor', 'manage-effect', 'upload-asset', 'list-cards']) {
  const hits = files.filter(([, s]) => s.includes(`'${n}'`)).map(([f]) => f);
  console.log(`  ${n}: ${hits.length} files → ${hits.join(', ')}`);
}
