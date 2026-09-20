// siblings-toolnames-in-siblings.mjs — which of THIS repo's 151 tool names appear, verbatim, in sibling files.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildToolRegistry } from '../dist/registry.js';
const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
const fake = new Proxy({}, { get: () => async () => { throw new Error('offline'); } });
const host = { kind: 'generic', label: 'x', files: null, filesNotConfigured: () => '', publicUrl: p => p, vars: { serverUrl: '', adminKey: '', worldId: '' }, unreachableHint: '', redact: s => s };
const names = buildToolRegistry({ foundry: fake, logger, host }).tools.map(t => t.name);
const ROOT = 'D:/Workbench/FVTT/Repos';
const REPOS = ['fvtt-mod-autoexplore','fvtt-mod-battleflow','fvtt-mod-combatplus','fvtt-mod-fxstudio','fvtt-mod-lootshelf','fvtt-mod-miscpatches','fvtt-mod-openserver','fvtt-mod-partystash','fvtt-mod-soundscape','fvtt-mod-soundscape-sfx','fvtt-mcp-artificer','fvtt-campaign-greenrest'];
const out = {};
for (const repo of REPOS) {
  const files = execSync('git ls-files', { cwd: join(ROOT, repo), encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  for (const rel of files) {
    if (/\.(png|jpg|jpeg|webp|ogg|mp3|wav|zip|pdf|ico|woff2?)$/i.test(rel) || rel.includes('node_modules')) continue;
    let text; try { text = readFileSync(join(ROOT, repo, rel), 'utf8'); } catch { continue; }
    const hits = names.filter(n => new RegExp(`(^|[^a-z0-9-])${n}([^a-z0-9-]|$)`).test(text));
    if (hits.length) (out[repo] ??= {})[rel] = hits;
  }
}
for (const [repo, files] of Object.entries(out)) {
  const all = new Set(Object.values(files).flat());
  console.log(`\n=== ${repo}: ${Object.keys(files).length} files, ${all.size} distinct tool names: ${[...all].sort().join(' ')}`);
  for (const [f, hits] of Object.entries(files)) console.log(`  ${f}: ${hits.join(' ')}`);
}
