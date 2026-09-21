// How much of the 17 descriptions is "Composes …" tool lists / "The tools own correctness … this skill owns …" boilerplate
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('scratch/skills-matrix.json', 'utf8'));
let comp = 0, own = 0, total = 0;
const rows = [];
for (const [k, v] of Object.entries(m.skills)) {
  const d = v.desc.desc;
  total += d.length;
  const c = /Composes[^.]*\./.exec(d)?.[0] ?? '';
  const o = /(The tools? own[^.]*\.|the tools? (only )?(STRUCTURE|hold|themselves hold)[^.]*\.|this skill (owns|keeps)[^.]*\.|YOU decide[^.]*\.|the script owns[^.]*\.)/gi;
  let oc = 0;
  for (const mm of d.matchAll(o)) oc += mm[0].length;
  comp += c.length; own += oc;
  rows.push({ skill: k, chars: d.length, composes: c.length, ownership: oc, pct: Math.round(((c.length + oc) / d.length) * 100) });
}
console.table(rows.sort((a, b) => b.pct - a.pct));
console.log(`total=${total} composes=${comp} ownership-boilerplate=${own} => ${comp + own} chars (${Math.round(((comp + own) / total) * 100)}%)`);
