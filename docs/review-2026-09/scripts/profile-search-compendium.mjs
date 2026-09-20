// Live profile of search-compendium: where the seconds go. Read-only. FOUNDRY_HOST=local.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from '../scripts/lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  if (line.trimStart().startsWith('#')) continue;
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2];
}
const f = new Foundry(bridgeConfig(env));
const t = async (label, fn) => { const t0 = Date.now(); const r = await fn(); console.log(`${label.padEnd(48)} ${String(Date.now() - t0).padStart(6)} ms`); return r; };
try {
  await t('connect', () => f.connect());
  const packs = await f.evaluate(() => Array.from(game.packs.values()).map(p => ({ id: p.metadata.id, type: p.metadata.type, indexed: p.indexed, size: p.index?.size ?? 0 })));
  const srd = packs.filter(p => p.id.startsWith('dnd5e.'));
  console.log(`packs: ${packs.length} total; ${srd.length} dnd5e.* (SRD, excluded); ${packs.filter(p => p.type === 'Scene').length} Scene; indexed at connect: ${packs.filter(p => p.indexed).length}`);
  // Per-pack index build cost (what the first search-compendium pays), sequential like the tool.
  const perPack = await f.evaluate(async () => {
    const out = [];
    for (const p of game.packs.values()) {
      if (p.metadata.type === 'Scene' || p.metadata.id.startsWith('dnd5e.')) continue;
      const t0 = performance.now();
      const was = p.indexed;
      if (!p.indexed) await p.getIndex({});
      out.push({ id: p.metadata.id, wasIndexed: was, ms: Math.round(performance.now() - t0), entries: p.index.size });
    }
    return out;
  });
  const total = perPack.reduce((n, p) => n + p.ms, 0);
  console.log(`getIndex over ${perPack.length} searched packs: ${total} ms total, ${perPack.reduce((n, p) => n + p.entries, 0)} entries`);
  for (const p of perPack.sort((a, b) => b.ms - a.ms).slice(0, 12)) console.log(`   ${p.id.padEnd(48)} ${String(p.ms).padStart(6)} ms  ${String(p.entries).padStart(6)} entries${p.wasIndexed ? '  (already indexed)' : ''}`);
  const a = await t('searchCompendium sword (indexes warm now)', () => f.call('searchCompendium', { query: 'sword' }));
  console.log(`   ${a.length} results`);
  await t('searchCompendium sword (2nd)', () => f.call('searchCompendium', { query: 'sword' }));
  await t('searchCompendiumFaceted goblin (creatures)', () => f.call('searchCompendiumFaceted', { query: 'goblin', kind: 'creatures' }).catch(e => { console.log('   (faceted args differ: ' + e.message.slice(0, 80) + ')'); }));
  const modPacks = perPack.filter(p => !/^dnd-(monster-manual|players-handbook|dungeon-masters-guide)\./.test(p.id));
  console.log(`non-book packs searched: ${modPacks.length} (${modPacks.reduce((n, p) => n + p.ms, 0)} ms of index)`);
} finally {
  await f.dispose();
}
