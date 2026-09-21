import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.cwd();
const { TOOLSETS } = await import(pathToFileURL(join(ROOT, 'dist', 'toolsets.js')).href);
const ALL = new Set(Object.values(TOOLSETS).flat());
const VERBS = /^(get|list|create|update|delete|add|remove|set|search|import|export|manage|apply|configure|place|pull|activate|screenshot|request|send|post|roll|link|inspect|level|author|duplicate|bulk|content|read|remap|upload|download|copy|move|find|relink|asset|disconnect|cutout|generate|edit|parse|wait)-/;
const SK = join(ROOT, '.claude', 'skills');
const hits = {};
for (const s of readdirSync(SK).filter(d => !d.startsWith('_'))) {
  const t = readFileSync(join(SK, s, 'SKILL.md'), 'utf8');
  for (const m of t.matchAll(/(?<![A-Za-z0-9_-])([a-z]+(?:-[a-z0-9]+)+)(?![A-Za-z0-9_-])/g)) {
    const n = m[1];
    if (ALL.has(n) || !VERBS.test(n)) continue;
    (hits[n] ??= new Set()).add(s);
  }
}
for (const [n, ss] of Object.entries(hits).sort()) console.log(n.padEnd(28), [...ss].join(', '));
