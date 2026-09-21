// Link this repo's bundled skills into another project so Claude Code loads them there.
//
//   node scripts/install-skills.mjs <project-dir>        # e.g. ~/my-campaign or ~ (user scope)
//   node scripts/install-skills.mjs <project-dir> --copy  # copy instead of link
//
// Claude Code loads project skills from <cwd>/.claude/skills (and user skills from
// ~/.claude/skills). Running it from this repo needs nothing; from anywhere else, each skill
// directory (and _shared/, which the skills reference relatively) is LINKED into the target's
// .claude/skills — a directory junction on Windows (no admin rights needed), a symlink elsewhere —
// so a `git pull` here updates them in place. --copy snapshots them instead; a copied
// bestiary-builder then needs FVTT_MCP_REPO=<this repo> in the environment to find dist/.
// An existing entry is left alone and reported (delete it to relink).
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(REPO, '.claude', 'skills');
const args = process.argv.slice(2);
const copy = args.includes('--copy');
const target = args.find(a => !a.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/install-skills.mjs <project-dir> [--copy]');
  process.exit(2);
}
const dest = join(resolve(target), '.claude', 'skills');
mkdirSync(dest, { recursive: true });

let linked = 0;
let kept = 0;
for (const name of readdirSync(SKILLS).sort()) {
  const src = join(SKILLS, name);
  if (!statSync(src).isDirectory()) continue;
  const out = join(dest, name);
  if (existsSync(out)) {
    console.log(`  kept    ${name} (already present — delete it to relink)`);
    kept++;
    continue;
  }
  if (copy) cpSync(src, out, { recursive: true });
  else symlinkSync(src, out, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`  ${copy ? 'copied ' : 'linked '} ${name}`);
  linked++;
}
console.log(`${linked} ${copy ? 'copied' : 'linked'}, ${kept} kept → ${dest}`);
if (copy && linked) console.log('bestiary-builder needs FVTT_MCP_REPO=' + REPO + ' when copied.');
