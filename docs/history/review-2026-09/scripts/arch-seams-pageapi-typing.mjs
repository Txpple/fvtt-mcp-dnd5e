// arch-seams: how typed is the page side? For each exported handler bound into `api`, does its
// declared first parameter use `any` / untyped, and does it declare a return type?
import { readFileSync } from 'node:fs';
const idx = readFileSync('src/page/index.ts', 'utf8');
const apiBlock = idx.slice(idx.indexOf('const api = {'), idx.indexOf('} satisfies Record'));
const names = [...apiBlock.matchAll(/^\s+([a-zA-Z0-9_]+),?\s*(?:\/\/.*)?$/gm)].map(m => m[1]);
// find where each is imported from
const imports = [...idx.matchAll(/import \{([^}]+)\} from '\.\/([^']+)\.js';/gs)];
const fileOf = new Map();
for (const [, list, file] of imports) for (const n of list.split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) fileOf.set(n, file);
let anyArg = 0, typedArg = 0, noArg = 0, retDeclared = 0, retInferred = 0, notFound = 0;
const anyArgNames = [];
for (const n of names) {
  const f = fileOf.get(n);
  if (!f) { notFound++; continue; }
  const src = readFileSync(`src/page/${f}.ts`, 'utf8');
  const re = new RegExp(`export (?:async )?function ${n}\s*\(([^)]*)\)\s*(:\s*[^{]+)?\{`, 's');
  const m = src.match(re);
  if (!m) {
    const re2 = new RegExp(`export const ${n}\s*=\s*(?:async )?\(([^)]*)\)\s*(:\s*[^=]+)?=>`, 's');
    const m2 = src.match(re2);
    if (!m2) { notFound++; continue; }
    classify(m2[1], m2[2], n);
    continue;
  }
  classify(m[1], m[2], n);
}
function classify(params, ret, n) {
  const p = params.trim();
  if (!p) noArg++;
  else if (/:\s*any\b/.test(p) || !p.includes(':')) { anyArg++; anyArgNames.push(n); }
  else typedArg++;
  if (ret && ret.trim()) retDeclared++; else retInferred++;
}
console.log({ handlers: names.length, typedArg, anyArg, noArg, retDeclared, retInferred, notFound });
console.log('any/untyped arg handlers:', anyArgNames.join(', '));
