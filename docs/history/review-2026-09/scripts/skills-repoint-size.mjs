// Size the 3.0 re-point: how many SKILL.md lines mention a CRUD-family tool name.
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('scratch/skills-matrix.json', 'utf8'));
const fam = m.families;
const toolFam = {};
for (const [f, ts] of Object.entries(fam)) for (const t of ts) toolFam[t] = f;
const SK = '.claude/skills';
let totalLines = 0;
const perSkill = {};
const perFam = {};
for (const s of Object.keys(m.skills)) {
  const lines = readFileSync(`${SK}/${s}/SKILL.md`, 'utf8').split(/\r?\n/);
  let n = 0;
  lines.forEach((l, i) => {
    const hits = Object.keys(toolFam).filter(t => new RegExp(`(?<![A-Za-z0-9_-])${t}(?![A-Za-z0-9_-])`).test(l));
    if (hits.length) {
      n++;
      for (const t of hits) perFam[toolFam[t]] = (perFam[toolFam[t]] ?? 0) + 1;
    }
  });
  perSkill[s] = n;
  totalLines += n;
}
console.log('SKILL.md lines that name a CRUD-family tool:', totalLines);
console.log(Object.entries(perSkill).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('mentions by family:', Object.entries(perFam).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
