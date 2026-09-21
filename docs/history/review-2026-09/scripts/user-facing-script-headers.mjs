// Extract the leading comment block (up to 8 lines) of each scripts/*.mjs and print name + line count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'scripts';
const out = [];
for (const f of readdirSync(dir).sort()) {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) continue;
  const text = readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/);
  const head = [];
  for (const l of lines) {
    if (l.startsWith('//') || l.startsWith('/*') || l.startsWith(' *') || l.startsWith('#!')) head.push(l);
    else if (head.length) break;
    if (head.length >= 6) break;
  }
  out.push(`### ${f} (${lines.length} lines)\n${head.join('\n')}`);
}
console.log(out.join('\n\n'));
