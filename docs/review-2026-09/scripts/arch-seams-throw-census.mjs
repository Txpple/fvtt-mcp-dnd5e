// arch-seams: census of throw sites. Page-side throws ALWAYS reach the client as plain Error
// (foundry.ts:465 wraps them), so every one of them goes through the substring classifier.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const TRIGGERS = ['access denied','permission','connection','websocket','timeout','navigation','net::','target closed','target page','browser','game.ready','not found','invalid','missing','actor creation','create actor','scene','rollback','transaction'];

function census(root, label) {
  const files = walk(root);
  let plain = 0, formatted = 0, plainTriggered = 0;
  const triggered = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/throw new FormattedToolError\(/.test(line)) formatted++;
      if (/throw new Error\(/.test(line)) {
        plain++;
        const snippet = lines.slice(i, i + 3).join(' ').toLowerCase();
        const hit = TRIGGERS.find(t => snippet.includes(t));
        if (hit) { plainTriggered++; triggered.push(`${f.split('\\').join('/')}:${i+1} [${hit}]`); }
      }
    });
  }
  console.log(`\n== ${label}: ${files.length} files — throw new Error: ${plain}; throw new FormattedToolError: ${formatted}; plain throws whose literal trips a heuristic (first 3 lines): ${plainTriggered}`);
  return triggered;
}
const p = census('src/page', 'src/page/**');
const t = census('src/tools', 'src/tools/**');
console.log('\n-- sample page-side triggered (first 25):'); p.slice(0, 25).forEach(x => console.log('  ' + x));
console.log('\n-- sample tool-side triggered (first 15):'); t.slice(0, 15).forEach(x => console.log('  ' + x));
