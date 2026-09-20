// arch-seams: the scripts/ directory as architecture — what they import from dist/ (the library
// seam), whether they go through scripts/lib/bridge-config.mjs, and which read MOLTEN_* directly.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
const norm = p => p.split(sep).join('/');
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(norm(p));
  }
  return out;
}
const all = walk('scripts');
const js = all.filter(f => /\.(mjs|js|cjs|ts)$/.test(f));
const by = pfx => js.filter(f => f.split('/').pop().startsWith(pfx));
console.log('scripts/ files:', all.length, '| js-ish:', js.length, '| verify-*:', by('verify-').length, '| spike-*:', by('spike-').length, '| measure-*:', by('measure-').length, '| lib/:', js.filter(f=>f.startsWith('scripts/lib/')).length);
const distImports = new Map();
let viaBridgeConfig = 0, ownFoundry = 0, moltenDirect = 0, dotenvHand = 0, usesLoadEnv = 0;
const moltenDirectFiles = [], ownFoundryFiles = [], distModules = new Map();
for (const f of js) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+['"](?:\.\.\/)+dist\/([^'"]+)['"]/g)) {
    distModules.set(m[1], (distModules.get(m[1]) ?? 0) + 1);
  }
  if (/dist\//.test(src)) distImports.set(f, true);
  if (/bridge-config\.mjs/.test(src)) viaBridgeConfig++;
  if (/new Foundry\(/.test(src)) { ownFoundry++; ownFoundryFiles.push(f); }
  if (/env\.MOLTEN_|process\.env\.MOLTEN_/.test(src)) { moltenDirect++; moltenDirectFiles.push(f); }
  if (/loadEnv\(/.test(src)) usesLoadEnv++;
}
console.log('\nscripts importing from dist/:', distImports.size);
console.log('dist modules imported (module: #scripts):');
[...distModules.entries()].sort((a,b)=>b[1]-a[1]).forEach(([m,n])=>console.log('  ', String(n).padStart(3), m));
console.log('\nscripts using scripts/lib/bridge-config.mjs:', viaBridgeConfig);
console.log('scripts calling new Foundry( themselves:', ownFoundry);
console.log('scripts reading MOLTEN_* env directly:', moltenDirect);
moltenDirectFiles.forEach(f => console.log('   ', f));
// verify scripts: how many run cleanup in finally, how many print counts
let finallyN = 0, countsN = 0;
for (const f of by('verify-')) {
  const src = readFileSync(f, 'utf8');
  if (/finally\s*\{/.test(src)) finallyN++;
  if (/passed|PASS|ok:|✓|checks?/i.test(src)) countsN++;
}
console.log(`\nverify-*: ${by('verify-').length}; with a finally{} cleanup: ${finallyN}; printing pass/check counts: ${countsN}`);
// total lines in verify + spike
const lines = arr => arr.reduce((n,f)=>n+readFileSync(f,'utf8').split('\n').length,0);
console.log('lines: verify-* =', lines(by('verify-')), '| spike-* =', lines(by('spike-')), '| all scripts =', lines(js));
// tests/integration size
const it = walk('tests/integration').filter(f=>f.endsWith('.ts'));
console.log('\ntests/integration files:', it.length, 'lines:', lines(it));
it.forEach(f => console.log('  ', f, readFileSync(f,'utf8').split('\n').length, 'lines,', (readFileSync(f,'utf8').match(/^\s*(it|test)\(/gm)||[]).length, 'it()'));
