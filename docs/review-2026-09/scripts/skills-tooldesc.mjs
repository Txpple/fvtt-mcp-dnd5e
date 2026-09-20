// dump every advertised tool description + schema description text, grep for judgment words
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = process.cwd();
const { buildToolRegistry } = await import(pathToFileURL(join(ROOT, "dist", "registry.js")).href);
const noop = new Proxy({}, { get: () => () => { throw new Error('offline'); } });
const mkLogger = () => ({ info(){}, warn(){}, error(){}, debug(){}, child(){ return mkLogger(); } });
let reg;
try { reg = buildToolRegistry({ foundry: noop, logger: mkLogger(), host: { name: "generic", filePlane: null, wake: null } }); }
catch (e) { console.error('registry ctor failed:', e.message); process.exit(1); }
const JUDG = /\b(prefer|preferred|house|owner|table rule|always|never|should|recommended|best practice|don'?t|do not|by default we|the party|greenrest|molten|webdav|magic-url|dm assistant)\b/i;
const out = [];
for (const t of reg.tools) {
  const d = t.description ?? '';
  const schemaText = JSON.stringify(t.inputSchema);
  const hits = [];
  for (const m of d.matchAll(new RegExp(JUDG.source, 'gi'))) hits.push(m[0].toLowerCase());
  out.push({ name: t.name, descChars: d.length, schemaChars: schemaText.length, hits: [...new Set(hits)], desc: d });
}
writeFileSync(join(ROOT, 'scratch', 'skills-tooldesc.json'), JSON.stringify(out, null, 2));
const byHits = out.filter(o => o.hits.length).sort((a,b)=>b.hits.length-a.hits.length);
console.log(`tools=${out.length} withJudgmentWords=${byHits.length} totalDescChars=${out.reduce((a,o)=>a+o.descChars,0)}`);
for (const o of byHits.slice(0, 40)) console.log(o.name.padEnd(30), String(o.descChars).padStart(5), o.hits.join(','));
