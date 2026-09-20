import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('scratch/skills-matrix.json', 'utf8'));
const src = readFileSync('scratch/skills-desc-budget.mjs', 'utf8');
const NEW = {};
const re = /'([a-z-]+)':\s*\n\s*'((?:[^'\\]|\\.)*)'/g;
for (const mm of src.matchAll(re)) NEW[mm[1]] = mm[2].replace(/\\'/g, "'");
for (const [k, d] of Object.entries(NEW)) {
  const orig = m.skills[k].desc.desc;
  const phrases = [...orig.matchAll(/"([^"]+)"/g)].map(x => x[1]);
  const missing = phrases.filter(p => !d.includes(p));
  console.log(
    `${k}: ${phrases.length} quoted triggers in original, missing in new: ${missing.length}${missing.length ? ' -> ' + JSON.stringify(missing) : ''}`
  );
}
