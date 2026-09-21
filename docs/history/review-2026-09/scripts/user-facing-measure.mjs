// user-facing dimension: reproducible counts for the README, docs, scripts and skills findings.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const rd = p => readFileSync(p, 'utf8');
const lines = p => rd(p).split(/\r?\n/);
const count = (s, re) => (s.match(re) ?? []).length;

const readme = lines('README.md');
const h2 = readme.map((l, i) => [i + 1, l]).filter(([, l]) => /^## /.test(l));
const relStart = h2.find(([, l]) => l.startsWith('## 2.0'))[0];
const relEnd = h2.find(([, l]) => l.startsWith('## Why this shape'))[0];
const reqLine = h2.find(([, l]) => l.startsWith('## Requirements'))[0];
console.log('README lines:', readme.length);
console.log(`README release narratives: lines ${relStart}-${relEnd - 1} = ${relEnd - relStart} lines (${Math.round(100 * (relEnd - relStart) / readme.length)}%)`);
console.log('README lines before "## Requirements":', reqLine - 1);
console.log('README "molten" mentions (ci):', count(rd('README.md'), /molten/gi));
console.log('.env.example "molten" mentions (ci):', count(rd('.env.example'), /molten/gi));
console.log('.env.example MOLTEN_* vars:', new Set(rd('.env.example').match(/\bMOLTEN_[A-Z_]+/g)).size, ' LOCAL_* vars:', new Set(rd('.env.example').match(/\bLOCAL_[A-Z_]+/g)).size, ' FOUNDRY_* vars:', new Set(rd('.env.example').match(/\bFOUNDRY_[A-Z_]+/g)).size);
console.log('README mentions of "skills" (ci):', count(rd('README.md'), /skills?/gi), '; mentions of ".claude/skills":', count(rd('README.md'), /\.claude\/skills/g));

// scripts classification
const S = 'scripts';
const files = readdirSync(S).filter(f => f.endsWith('.mjs'));
const release = ['verify-effects-6','verify-region-effects','verify-activities-6','verify-settings-calendar','verify-item-tooling','verify-actor-tooling','verify-pc-build','verify-teleporter-scene-fields','verify-placeables-tooling','verify-scene-tools','verify-cast-activity','verify-region-tooling'].map(s => s + '.mjs');
const houseVerify = ['verify-landing-scene','verify-lootshelf','verify-partystash','verify-partystash-coin','verify-receipt-settings','verify-soundscape','shot-partystash-coin','audit-partystash-coin-cleanup','clean-stale-ownership','register-partystash'].map(s => s + '.mjs');
const ownerOps = ['deploy-house-module','register-module','configure-modules','uninstall-modules','upload-soundscape-library','remap-soundscape-scene-paths','pull-prod-to-local','reload-clients','party-stats','read-user-avatars','reveal-scene-fog','repair-orphaned-container-refs'].map(s => s + '.mjs');
const spikes = files.filter(f => f.startsWith('spike-'));
const partystashSpikes = ['spike-dialogv2-render','spike-group-currency-dom','spike-group-currency-dom2','spike-group-render-hooks'].map(s => s + '.mjs');
const product = files.filter(f => !houseVerify.includes(f) && !ownerOps.includes(f) && !spikes.includes(f));
const verifies = files.filter(f => f.startsWith('verify-'));
console.log('\nscripts total (.mjs, excl. lib):', files.length, '| verify-*:', verifies.length, '| spike-*:', spikes.length);
console.log('  product (keep):', product.length, '— of which release set:', release.length, ', other tool verifies:', product.filter(f => f.startsWith('verify-') && !release.includes(f)).length, ', infra (local-foundry, measure, prove-bridge, verify-toolsets/wake/asset-plane/reads/read-tools):', product.filter(f => !f.startsWith('verify-')).length);
console.log('  house-module verifies/harness (sibling):', houseVerify.length, houseVerify.join(' '));
console.log('  owner-ops (sibling / ops repo):', ownerOps.length, ownerOps.join(' '));
console.log('  spikes:', spikes.length, '— partystash-bound:', partystashSpikes.length, '; referenced from src/docs:', spikes.filter(f => { try { return require('node:child_process').execSync(`git grep -l -F ${f} -- src docs package.json .claude`, {encoding:'utf8'}).trim().length > 0; } catch { return false; } }).length);
// campaign strings inside product verifies
for (const f of product) {
  const t = rd(join(S, f));
  const hits = t.match(/greenrest|broken-heart|DM Assistant|Eerie Temple|w4bENQ7PaWf8upSo/gi);
  if (hits) console.log('  campaign string in PRODUCT script:', f, '→', [...new Set(hits.map(h => h.toLowerCase()))].join(','));
}
// scripts that hand-parse .env
console.log('\nscripts hand-parsing .env:', files.filter(f => /readFileSync\([^)]*'\.env'/.test(rd(join(S, f)))).length, '+ skills:', ['bestiary-builder/bestiary-entry.mjs'].filter(f => /'\.env'/.test(rd(join('.claude/skills', f)))).length);

// skills
const skills = readdirSync('.claude/skills').filter(d => statSync(join('.claude/skills', d)).isDirectory() && d !== '_shared');
let total = 0;
for (const s of skills) { const t = rd(join('.claude/skills', s, 'SKILL.md')); total += t.length; }
console.log('\nskills:', skills.length, 'SKILL.md bytes total:', total);
for (const s of ['session-scribe','session-audit','plot-drift-check','bestiary-builder','start-session','tom-cartos-import','soundscape-builder']) {
  const t = rd(join('.claude/skills', s, 'SKILL.md'));
  console.log(`  ${s}: ${t.length} chars, ${t.split(/\r?\n/).length} lines; owner/campaign hits: ${count(t, /campaign repo|party-snapshots|owner directive|owner-locked|owner feedback|owner rule|owner default|\(owner|Craig|Discord|Greenrest|DESKTOP-NY|two-machines|fvtt-campaign/gi)}; house-module hits: ${count(t, /fvtt-mod-|battleflow|battle flow|lootshelf|partystash|openserver|autoexplore|combatplus|soundscape/gi)}; molten hits: ${count(t, /molten/gi)}; registration-name hits: ${count(t, /foundry-(molten|local)5e/g)}`);
}
