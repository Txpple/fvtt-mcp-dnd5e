// siblings-census.mjs — per-file census of how the sibling repos consume this repo.
// Read-only; prints JSON to stdout + a summary table to stderr. Tracked files only (git ls-files),
// excluding node_modules and binary assets.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/Workbench/FVTT/Repos';
const REPOS = ['fvtt-mod-autoexplore','fvtt-mod-battleflow','fvtt-mod-combatplus','fvtt-mod-fxstudio','fvtt-mod-lootshelf','fvtt-mod-miscpatches','fvtt-mod-openserver','fvtt-mod-partystash','fvtt-mod-soundscape','fvtt-mod-soundscape-sfx','fvtt-mcp-artificer','fvtt-campaign-greenrest'];

const SEP = '[/\\\\]';
const PROBES = {
  oldName: /fvtt-mcp-molten5e/g,
  newName: /fvtt-mcp-dnd5e/g,
  absOldPath: new RegExp(`D:${SEP}Workbench${SEP}FVTT${SEP}Repos${SEP}fvtt-mcp-molten5e`, 'g'),
  relOldPath: new RegExp(`\\.\\.${SEP}fvtt-mcp-molten5e`, 'g'),
  importFoundryClass: /import\s*\{[^}]*\bFoundry\b[^}]*\}\s*from\s*['"][^'"]*dist\/foundry\.js['"]/g,
  dynImportFoundry: /import\(toUrl\([^)]*foundry\.js[^)]*\)\)/g,
  readsDotEnv: /[/\\`'"]\.env['"`]/g,
  envKeys: /\b(LOCAL_SERVER_URL|LOCAL_ADMIN_KEY|LOCAL_WORLD_ID|LOCAL_FOUNDRY_USER|LOCAL_FOUNDRY_PASSWORD|MOLTEN_SERVER_URL|MOLTEN_MAGIC_URL|MOLTEN_ADMIN_KEY|MOLTEN_WORLD_ID|MOLTEN_TEST_USER|MOLTEN_TEST_PASSWORD|MOLTEN_WEBDAV_[A-Z_]+|FOUNDRY_USER|FOUNDRY_PASSWORD|FOUNDRY_HOST|FOUNDRY_SERVER_URL|BF_SUITE_USER|BF_SUITE_PASSWORD|FOUNDRY_DATA|FOUNDRY_TOOLSETS|FXS_MCP_REPO)\b/g,
  scripts: /\b(local-foundry|deploy-house-module|configure-modules|upload-soundscape-library|pull-prod-to-local|register-module|uninstall-modules|reload-clients|remap-soundscape-scene-paths|verify-wake|world-snapshot)\.mjs/g,
  regNames: /\b(foundry-molten5e|foundry-local5e)\b/g,
  mcpToolPrefix: /mcp__foundry[-_][a-z0-9]+__[a-z-]+/g,
  toolNames: /\b(get-world-info|disconnect-bridge|send-chat-message|create-scene|upload-asset|set-actor-art|add-journal-image|screenshot-scene|list-actors|get-actor|search-compendium(?:-\w+)?|import-item|create-journal|update-journal|list-scenes|list-tokens|configure-soundscape|list-assets|copy-asset|delete-asset|move-asset|list-users|update-user|set-user-avatar|export-actor|list-chat-messages|export-chat-log|delete-chat-messages)\b/g,
  fMembers: /\bf\.(evaluate|call|page|dispose|disconnect|connect|context|browser|screenshot)\b/g,
};
const LIST_KEYS = new Set(['envKeys','scripts','regNames','toolNames','fMembers','mcpToolPrefix']);

const out = {};
for (const repo of REPOS) {
  let files;
  try { files = execSync('git ls-files', { cwd: join(ROOT, repo), encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); }
  catch { continue; }
  const rows = [];
  for (const rel of files) {
    if (rel.includes('node_modules') || rel.startsWith('.claude/worktrees')) continue;
    if (/\.(png|jpg|jpeg|webp|ogg|mp3|wav|zip|pdf|ico|woff2?|json)$/i.test(rel) && !rel.endsWith('package.json') && !rel.endsWith('.mcp.json')) continue;
    let text; try { text = readFileSync(join(ROOT, repo, rel), 'utf8'); } catch { continue; }
    const hit = {};
    for (const [k, re] of Object.entries(PROBES)) {
      const m = text.match(re);
      if (m) hit[k] = LIST_KEYS.has(k) ? [...new Set(m)].sort() : m.length;
    }
    if (Object.keys(hit).length) rows.push({ file: rel, ...hit });
  }
  if (rows.length) out[repo] = rows;
}
console.log(JSON.stringify(out, null, 1));
console.error('\n=== SUMMARY (number of FILES per repo touching each probe)');
for (const [repo, rows] of Object.entries(out)) {
  const c = {};
  for (const r of rows) for (const k of Object.keys(r)) if (k !== 'file') c[k] = (c[k] ?? 0) + 1;
  console.error(repo.padEnd(26), JSON.stringify(c));
}
console.error('\n=== ENV KEYS read by hand (distinct, per repo)');
for (const [repo, rows] of Object.entries(out)) {
  const s = new Set(); for (const r of rows) for (const k of r.envKeys ?? []) s.add(k);
  if (s.size) console.error(repo.padEnd(26), [...s].sort().join(' '));
}
console.error('\n=== SCRIPTS named (distinct, per repo)');
for (const [repo, rows] of Object.entries(out)) {
  const s = new Set(); for (const r of rows) for (const k of r.scripts ?? []) s.add(k);
  if (s.size) console.error(repo.padEnd(26), [...s].sort().join(' '));
}
console.error('\n=== TOOL NAMES named (distinct, per repo)');
for (const [repo, rows] of Object.entries(out)) {
  const s = new Set(); for (const r of rows) for (const k of r.toolNames ?? []) s.add(k);
  if (s.size) console.error(repo.padEnd(26), [...s].sort().join(' '));
}
console.error('\n=== Foundry members used (distinct, per repo)');
for (const [repo, rows] of Object.entries(out)) {
  const s = new Set(); for (const r of rows) for (const k of r.fMembers ?? []) s.add(k);
  if (s.size) console.error(repo.padEnd(26), [...s].sort().join(' '));
}
