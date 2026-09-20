// skills-matrix.mjs — skill × tool matrix for the 2026-09 review (skills dimension).
// Reads every .claude/skills/*/SKILL.md (+ bundled scripts) and the authoritative tool list from
// dist/toolsets.js. A tool "appears" in a skill when its exact hyphenated name occurs as a word
// (with or without the mcp__foundry-…__ prefix). Shorthand forms ("list-scenes/-tokens",
// "search-compendium-*", "list/get-rolltable") are detected separately and reported.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { TOOLSETS } = await import(pathToFileURL(join(ROOT, 'dist', 'toolsets.js')).href);
const toolToSet = new Map();
for (const [set, tools] of Object.entries(TOOLSETS)) for (const t of tools) toolToSet.set(t, set);
const ALL_TOOLS = [...toolToSet.keys()];

const SK = join(ROOT, '.claude', 'skills');
const skills = readdirSync(SK)
  .filter(d => !d.startsWith('_') && statSync(join(SK, d)).isDirectory())
  .sort();

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '__pycache__') out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matrix = {};
const descs = {};
const bodies = {};
for (const s of skills) {
  const files = walk(join(SK, s)).filter(f => !f.endsWith('.pyc'));
  const rec = { tools: new Set(), byFile: {}, shorthand: [], mdOnly: new Set() };
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = f.slice(SK.length + 1).replace(/\\/g, '/');
    const found = new Set();
    for (const t of ALL_TOOLS) {
      const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(t)}(?![A-Za-z0-9_-])`);
      if (re.test(text)) found.add(t);
    }
    if (found.size) rec.byFile[rel] = found;
    for (const t of found) {
      rec.tools.add(t);
      if (rel.endsWith('SKILL.md')) rec.mdOnly.add(t);
    }
    if (rel.endsWith('SKILL.md')) {
      for (const m of text.matchAll(/\b([a-z]+-[a-z-]+)((?:\/-[a-z-]+)+)/g)) rec.shorthand.push(m[0]);
      for (const m of text.matchAll(/\b(list|get|search)\/(get|list|search)-([a-z-]+)/g))
        rec.shorthand.push(m[0]);
      for (const m of text.matchAll(/\bsearch-compendium-\*/g)) rec.shorthand.push(m[0]);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const dm = fm && /description:\s*>-?\s*\r?\n([\s\S]*?)(?=\r?\n[a-z]+:|$)/.exec(fm[1]);
      let d = dm ? dm[1] : '';
      d = d
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ');
      descs[s] = { chars: d.length, desc: d };
      bodies[s] = text.length - (fm ? fm[0].length : 0);
    }
  }
  matrix[s] = rec;
}

const toolSkills = {};
for (const t of ALL_TOOLS) toolSkills[t] = skills.filter(s => matrix[s].tools.has(t));
const usedTools = ALL_TOOLS.filter(t => toolSkills[t].length);
const unusedTools = ALL_TOOLS.filter(t => !toolSkills[t].length);
const usedMdOnly = new Set();
for (const s of skills) for (const t of matrix[s].mdOnly) usedMdOnly.add(t);

const FAMILIES = {
  tiles: ['create-tiles', 'list-tiles', 'update-tiles', 'delete-tiles'],
  lights: ['create-lights', 'list-lights', 'update-lights', 'delete-lights'],
  sounds: ['create-sounds', 'list-sounds', 'update-sounds', 'delete-sounds'],
  drawings: ['create-drawings', 'list-drawings', 'update-drawings', 'delete-drawings'],
  walls: ['create-walls', 'list-walls', 'update-walls', 'delete-walls'],
  tokens: ['list-tokens', 'place-tokens', 'update-token', 'delete-tokens'],
  notes: ['create-scene-notes', 'list-notes', 'update-note', 'delete-note'],
  regions: [
    'create-region',
    'list-regions',
    'update-region',
    'delete-region',
    'create-teleporter',
    'add-region-behavior',
    'remap-teleporters',
  ],
  items: ['create-item', 'list-items', 'get-item', 'update-item', 'delete-item', 'import-item'],
  tables: [
    'create-rolltable',
    'import-rolltable',
    'list-rolltables',
    'update-rolltable',
    'get-rolltable',
    'delete-rolltable',
  ],
  journals: ['create-journal', 'update-journal', 'list-journals', 'delete-journal', 'delete-journal-page'],
  actors: ['list-actors', 'get-actor', 'update-actor', 'delete-actor'],
  folders: ['list-folders', 'create-folder', 'update-folder', 'delete-folder'],
  scenes: ['create-scene', 'list-scenes', 'update-scene', 'delete-scene'],
  playlists: ['create-playlist', 'list-playlists', 'update-playlist', 'delete-playlist'],
  cards: ['create-cards', 'import-cards', 'list-cards', 'delete-cards'],
  macros: ['create-macro', 'list-macros', 'delete-macro'],
};

let md = `# Skill × tool matrix — 2026-09-20 (skills dimension)\n\n`;
md += `Source: \`scratch/skills-matrix.mjs\` over \`.claude/skills/*/**\` (SKILL.md + bundled scripts) and \`dist/toolsets.js\` (${ALL_TOOLS.length} tools). A tool counts when its exact hyphenated name appears as a word.\n\n`;
md += `## Summary\n\n`;
md += `- Registered tools: ${ALL_TOOLS.length}\n- Distinct tools named by at least one skill (SKILL.md or bundled script): ${usedTools.length}\n- Distinct tools named in SKILL.md text only: ${usedMdOnly.size}\n- Tools no skill names: ${unusedTools.length}\n\n`;
md += `## Skill → tools\n\n| skill | distinct tools | tools |\n|---|---|---|\n`;
for (const s of skills)
  md += `| ${s} | ${matrix[s].tools.size} | ${[...matrix[s].tools].sort().join(', ')} |\n`;
md += `\n### Shorthand forms found in SKILL.md (not counted above)\n\n`;
for (const s of skills)
  if (matrix[s].shorthand.length) md += `- ${s}: ${[...new Set(matrix[s].shorthand)].join(' · ')}\n`;
md += `\n## Tool → skills\n\n| tool | toolset | #skills | skills |\n|---|---|---|---|\n`;
for (const t of ALL_TOOLS)
  md += `| ${t} | ${toolToSet.get(t)} | ${toolSkills[t].length} | ${toolSkills[t].join(', ')} |\n`;
md += `\n## Tools no skill names (${unusedTools.length})\n\n`;
const byset = {};
for (const t of unusedTools) (byset[toolToSet.get(t)] ??= []).push(t);
for (const [set, ts] of Object.entries(byset)) md += `- **${set}** (${ts.length}): ${ts.join(', ')}\n`;
md += `\n## 3.0 re-point checklist — the 17 CRUD families\n\n| family | tool | skills naming it |\n|---|---|---|\n`;
for (const [fam, tools] of Object.entries(FAMILIES))
  for (const t of tools) md += `| ${fam} | ${t} | ${toolSkills[t].join(', ') || '—'} |\n`;
md += `\n### Family → skills (union)\n\n| family | skills that name any tool in the family | tools in family unnamed by any skill |\n|---|---|---|\n`;
for (const [fam, tools] of Object.entries(FAMILIES)) {
  const ss = new Set();
  for (const t of tools) for (const s of toolSkills[t]) ss.add(s);
  md += `| ${fam} | ${[...ss].join(', ') || '—'} | ${tools.filter(t => !toolSkills[t].length).join(', ') || '—'} |\n`;
}
md += `\n## Front-matter description sizes (chars, folded)\n\n| skill | description chars | body chars |\n|---|---|---|\n`;
let total = 0;
let btotal = 0;
for (const s of [...skills].sort((a, b) => descs[b].chars - descs[a].chars)) {
  total += descs[s].chars;
  btotal += bodies[s];
  md += `| ${s} | ${descs[s].chars} | ${bodies[s]} |\n`;
}
md += `| **total** | **${total}** | **${btotal}** |\n`;
writeFileSync(join(ROOT, 'scratch', 'skills-tool-matrix.md'), md);
writeFileSync(
  join(ROOT, 'scratch', 'skills-matrix.json'),
  JSON.stringify(
    {
      skills: Object.fromEntries(
        skills.map(s => [
          s,
          {
            tools: [...matrix[s].tools].sort(),
            byFile: Object.fromEntries(
              Object.entries(matrix[s].byFile).map(([k, v]) => [k, [...v].sort()])
            ),
            shorthand: [...new Set(matrix[s].shorthand)],
            desc: descs[s],
          },
        ])
      ),
      toolSkills,
      unusedTools,
      families: FAMILIES,
    },
    null,
    2
  )
);
console.log(
  `tools=${ALL_TOOLS.length} used=${usedTools.length} usedMdOnly=${usedMdOnly.size} unused=${unusedTools.length} descTotal=${total} bodyTotal=${btotal}`
);
for (const s of skills)
  console.log(
    `${s.padEnd(22)} tools=${String(matrix[s].tools.size).padStart(3)} desc=${String(descs[s].chars).padStart(5)} body=${bodies[s]}`
  );
