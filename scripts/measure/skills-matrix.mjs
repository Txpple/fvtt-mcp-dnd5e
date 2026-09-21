// The skill × tool matrix: which tools each skill names (SKILL.md + its bundled scripts), which
// tools no skill names, the front-matter description sizes (what every Claude Code prompt
// carries — M3 → ≤ 8,000 chars), and the names that resolve to NO registered tool (M8's
// definition of done: 0 unresolved after a family is renamed, so a skill can never point at a
// tool that no longer exists).
//
//   node scripts/measure/skills-matrix.mjs [--md matrix.md] [--json matrix.json]
//
// A tool "appears" in a skill when its exact hyphenated name occurs as a word, with or without the
// mcp__<registration>__ prefix. Exits 1 when a prefixed reference names an unknown tool.
// Offline (builds the registry from dist/; run `npm run build` first).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toolsetOf } from '../../dist/toolsets.js';
import {
  SKILLS_DIR,
  argValue,
  buildRegistry,
  fmt,
  readSkillDescriptions,
  totalSkillDescriptionChars,
} from './lib.mjs';

const mdOut = argValue('--md');
const jsonOut = argValue('--json');

const toolToSet = toolsetOf();
const ALL_TOOLS = buildRegistry().tools.map(t => t.name);
const KNOWN = new Set(ALL_TOOLS);
// The verbs the registry uses — a backticked `verb-noun` in a skill that starts with one of these
// and is not a registered tool is probably a stale tool name.
const VERBS = new Set(ALL_TOOLS.map(t => t.split('-')[0]));

const skills = readSkillDescriptions();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== '__pycache__' && entry !== 'node_modules') out.push(...walk(p));
    } else if (!p.endsWith('.pyc')) out.push(p);
  }
  return out;
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = new Map(
  ALL_TOOLS.map(t => [t, new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(t)}(?![A-Za-z0-9_-])`)])
);

const matrix = {};
const unresolved = []; // { skill, file, name } — mcp__…__<name> with no such tool
const candidates = []; // { skill, file, name } — `verb-noun` in backticks, not a tool
for (const { skill } of skills) {
  const rec = { tools: new Set(), byFile: {} };
  for (const file of walk(join(SKILLS_DIR, skill))) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(SKILLS_DIR, file).replace(/\\/g, '/');
    const found = new Set();
    for (const [t, re] of wordRe) if (re.test(text)) found.add(t);
    if (found.size) rec.byFile[rel] = [...found].sort();
    for (const t of found) rec.tools.add(t);
    for (const m of text.matchAll(/mcp__[A-Za-z0-9-]+__([a-z0-9-]+)/g)) {
      if (!KNOWN.has(m[1])) unresolved.push({ skill, file: rel, name: m[1] });
    }
    for (const m of text.matchAll(/`([a-z]+(?:-[a-z0-9]+)+)`/g)) {
      if (VERBS.has(m[1].split('-')[0]) && !KNOWN.has(m[1])) {
        candidates.push({ skill, file: rel, name: m[1] });
      }
    }
  }
  matrix[skill] = { tools: [...rec.tools].sort(), byFile: rec.byFile };
}

const toolSkills = Object.fromEntries(
  ALL_TOOLS.map(t => [t, skills.map(s => s.skill).filter(s => matrix[s].tools.includes(t))])
);
const usedTools = ALL_TOOLS.filter(t => toolSkills[t].length);
const unusedTools = ALL_TOOLS.filter(t => !toolSkills[t].length);
const descTotal = totalSkillDescriptionChars(skills);
const bodyTotal = skills.reduce((s, x) => s + x.bodyChars, 0);
const uniq = rows => [...new Map(rows.map(r => [`${r.file}:${r.name}`, r])).values()];
const unresolvedRows = uniq(unresolved);
const candidateRows = uniq(candidates);

// The 17 CRUD families M8 consolidates — one commit each, every skill line re-pointed in it. A
// consolidated family is its one tool (tiles / lights / walls / drawings / sounds / notes →
// manage-placeables).
const FAMILIES = {
  placeables: ['manage-placeables'],
  tokens: ['list-tokens', 'place-tokens', 'update-token', 'delete-tokens'],
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
  journals: [
    'create-journal',
    'update-journal',
    'list-journals',
    'delete-journal',
    'delete-journal-page',
  ],
  actors: ['list-actors', 'get-actor', 'update-actor', 'delete-actor'],
  folders: ['list-folders', 'create-folder', 'update-folder', 'delete-folder'],
  scenes: ['create-scene', 'list-scenes', 'update-scene', 'delete-scene'],
  playlists: ['create-playlist', 'list-playlists', 'update-playlist', 'delete-playlist'],
  cards: ['create-cards', 'import-cards', 'list-cards', 'delete-cards'],
  macros: ['create-macro', 'list-macros', 'delete-macro'],
};

// --- the report ---
console.log(
  `tools=${ALL_TOOLS.length} named-by-a-skill=${usedTools.length} unnamed=${unusedTools.length} ` +
    `skills=${skills.length} descriptions=${fmt(descTotal)} chars (M3 → ≤ 8,000) bodies=${fmt(bodyTotal)}`
);
for (const s of skills) {
  console.log(
    `  ${s.skill.padEnd(22)} tools=${String(matrix[s.skill].tools.length).padStart(3)} ` +
      `desc=${String(s.chars).padStart(5)} body=${fmt(s.bodyChars)}`
  );
}
console.log(`\nunresolved mcp__…__<name> references: ${unresolvedRows.length}`);
for (const r of unresolvedRows) console.log(`  ${r.file}: ${r.name}`);
console.log(`stale-looking \`verb-noun\` names (not a registered tool): ${candidateRows.length}`);
for (const r of candidateRows) console.log(`  ${r.file}: ${r.name}`);

if (mdOut) {
  let md = `# Skill × tool matrix\n\nSource: \`scripts/measure/skills-matrix.mjs\` over \`.claude/skills/*/**\` (SKILL.md + bundled scripts) and the registry (${ALL_TOOLS.length} tools). A tool counts when its exact hyphenated name appears as a word.\n\n`;
  md += `## Summary\n\n- Registered tools: ${ALL_TOOLS.length}\n- Named by at least one skill: ${usedTools.length}\n- Named by no skill: ${unusedTools.length}\n- Unresolved \`mcp__…__<name>\` references: ${unresolvedRows.length}\n\n`;
  md += `## Skill → tools\n\n| skill | distinct tools | tools |\n|---|---|---|\n`;
  for (const s of skills)
    md += `| ${s.skill} | ${matrix[s.skill].tools.length} | ${matrix[s.skill].tools.join(', ')} |\n`;
  md += `\n## Tool → skills\n\n| tool | toolset | #skills | skills |\n|---|---|---|---|\n`;
  for (const t of ALL_TOOLS)
    md += `| ${t} | ${toolToSet.get(t)} | ${toolSkills[t].length} | ${toolSkills[t].join(', ')} |\n`;
  md += `\n## Tools no skill names (${unusedTools.length})\n\n`;
  const bySet = {};
  for (const t of unusedTools) (bySet[toolToSet.get(t)] ??= []).push(t);
  for (const [set, ts] of Object.entries(bySet))
    md += `- **${set}** (${ts.length}): ${ts.join(', ')}\n`;
  md += `\n## Re-point checklist — the 17 CRUD families (M8)\n\n| family | tool | skills naming it |\n|---|---|---|\n`;
  for (const [fam, tools] of Object.entries(FAMILIES))
    for (const t of tools) md += `| ${fam} | ${t} | ${toolSkills[t]?.join(', ') || '—'} |\n`;
  md += `\n## Front-matter description sizes (chars, folded)\n\n| skill | description | body |\n|---|---|---|\n`;
  for (const s of [...skills].sort((a, b) => b.chars - a.chars))
    md += `| ${s.skill} | ${s.chars} | ${s.bodyChars} |\n`;
  md += `| **total** | **${descTotal}** | **${bodyTotal}** |\n`;
  if (unresolvedRows.length || candidateRows.length) {
    md += `\n## Unresolved names\n\n`;
    for (const r of unresolvedRows) md += `- \`${r.file}\`: \`mcp__…__${r.name}\`\n`;
    for (const r of candidateRows) md += `- \`${r.file}\`: \`${r.name}\` (stale-looking)\n`;
  }
  writeFileSync(mdOut, md);
  console.log(`written ${mdOut}`);
}
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        skills: Object.fromEntries(
          skills.map(s => [
            s.skill,
            { ...matrix[s.skill], description: { chars: s.chars, text: s.description } },
          ])
        ),
        toolSkills,
        unusedTools,
        unresolved: unresolvedRows,
        candidates: candidateRows,
        families: FAMILIES,
      },
      null,
      2
    )
  );
  console.log(`written ${jsonOut}`);
}
process.exitCode = unresolvedRows.length ? 1 : 0;
