// arch-seams: where do the offline tests live and what do they exercise?
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
const norm = p => p.split(sep).join('/');
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.test.ts')) out.push(norm(p));
  }
  return out;
}
const files = walk('src').concat(walk('tests').filter(f => !f.includes('integration')));
const buckets = {};
let total = 0;
const perFile = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const n = (src.match(/^\s*(it|test)(\.each\([^)]*\))?\(/gm) || []).length;
  total += n;
  const top = f.startsWith('src/page') ? 'src/page' : f.startsWith('src/tools') ? 'src/tools' : f.startsWith('src/hosts') ? 'src/hosts' : f.startsWith('src/utils') ? 'src/utils' : f.startsWith('src/') ? 'src/(root)' : 'tests/';
  buckets[top] = (buckets[top] ?? 0) + n;
  perFile.push([f, n]);
}
console.log('total it()/test() sites:', total);
console.log(buckets);
console.log('\n--- top 15 test files by count');
perFile.sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([f,n])=>console.log(String(n).padStart(5), f));
let mockSeam = 0, schemaOnly = 0, toolTests = 0;
for (const [f] of perFile) {
  if (!f.startsWith('src/tools')) continue;
  toolTests++;
  const src = readFileSync(f, 'utf8');
  if (/makeFoundry|foundry\.call|calls\b/.test(src)) mockSeam++;
  if (/inputSchema|getToolDefinitions/.test(src) && !/makeFoundry/.test(src)) schemaOnly++;
}
console.log('\nsrc/tools test files:', toolTests, '— use the mocked seam (makeFoundry):', mockSeam, '— schema/definition-only:', schemaOnly);
let pageTests = 0, importsPage = 0;
for (const [f] of perFile) {
  if (!f.startsWith('src/page')) continue;
  pageTests++;
  const src = readFileSync(f, 'utf8');
  if (/from '\.\/[a-zA-Z0-9_-]+\.js'|from '\.\.\/[a-zA-Z0-9_/-]+\.js'/.test(src)) importsPage++;
}
console.log('src/page test files:', pageTests, '— import a page module (pure logic):', importsPage);
function walk2(dir, out=[]) { for (const e of readdirSync(dir)) { const p = join(dir,e); if (statSync(p).isDirectory()) walk2(p,out); else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(norm(p)); } return out; }
const mods = walk2('src/page');
const tested = new Set(files.filter(f=>f.startsWith('src/page')).map(f=>f.replace('.test.ts','.ts')));
const untested = mods.filter(m => !tested.has(m));
let untestedLines = 0, totalLines = 0;
const lc = m => readFileSync(m,'utf8').split('\n').length;
for (const m of mods) { const l = lc(m); totalLines += l; if (untested.includes(m)) untestedLines += l; }
console.log(`\nsrc/page modules: ${mods.length} (${totalLines} lines); with NO sibling .test.ts: ${untested.length} (${untestedLines} lines = ${(100*untestedLines/totalLines).toFixed(0)}%)`);
console.log(untested.map(m=>`  ${m} (${lc(m)})`).join('\n'));
// Which page tests import the real page module vs a foundry-doc-mock?
const mockUsers = files.filter(f => f.startsWith('src/page') && /foundry-doc-mock/.test(readFileSync(f,'utf8')));
console.log('\npage tests using foundry-doc-mock (installs Actor/Item/etc on globalThis):', mockUsers.length, mockUsers.join(', '));
