// Hot-deploy a house module into a Foundry's Data/modules through the host's own file plane,
// and prove the bytes landed. Generalizes scripts/deploy-partystash.mjs + scripts/check-prod-bytes.mjs,
// which were written per-module and had to be cloned for every new one.
//
//   node scripts/deploy-house-module.mjs fvtt-mod-battleflow --local     (the LOCAL sandbox)
//   FOUNDRY_HOST=molten node scripts/deploy-house-module.mjs fvtt-mod-lootshelf
//   FOUNDRY_HOST=molten node scripts/deploy-house-module.mjs fvtt-mod-partystash --check   (compare only)
//
// TARGETS: the host FOUNDRY_HOST selects (src/hosts/env.ts), through its DIRECT file plane — the
// WebDAV plane on a managed box, the Data/ directory of an install on this machine; a host with
// neither is refused by name. `--local` is shorthand for the local sandbox (docs/local-sandbox.md):
// a plain filesystem copy with the same byte read-back proof, and it never touches prod. That is
// the loop a sister module repo wants: build → --local → test against the sandbox → only then
// deploy for real. ⚠️ A sandbox REFRESH (pull-prod-to-local.mjs) mirrors prod's modules/
// and will overwrite or delete a locally-deployed module — re-run --local after every refresh.
//
// WHAT IT UPLOADS: module.json plus everything the module SERVES — scripts/, styles/,
// templates/, lang/. Not the README, the design docs, or tools/: those never leave the repo.
// The file list is walked from disk rather than read out of module.json, because a module's
// ESM graph pulls in files the manifest never names (an `import "./receipts.js"` is invisible
// to `esmodules`), and a template is fetched by path at runtime.
//
// WHAT REGISTRATION IS FOR: the package registry is scanned at server PROCESS boot, so a
// BRAND-NEW module has to go in through Foundry's own installPackage (scripts/register-
// module.mjs) — this script only refreshes the files of an already-registered one. Their
// content is served off disk per request, so overwriting them and reloading the world is
// enough for scripts, styles and templates. The manifest is the exception: `game.modules` is
// built from that boot-time scan, so a module.json edit (a new version string, a new `styles`
// entry) does NOT take effect until the process next restarts. It is uploaded anyway, so the
// box is right whenever that happens, and the lag is REPORTED rather than pretended away.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from '../dist/env.js';
import { createHost, hostKindFromEnv, resolveHostConfig } from '../dist/hosts/index.js';
import { quietLogger, targetLabel } from '../dist/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const toLocal = args.includes('--local');
const moduleId = args.find(a => !a.startsWith('--'));
if (!moduleId) {
  console.error('usage: node scripts/deploy-house-module.mjs <module-id> [--check] [--local]');
  process.exit(2);
}

const REPO = join(__dirname, '..', '..', moduleId);
if (!existsSync(join(REPO, 'module.json'))) {
  console.error(`No module.json at ${REPO} — is the repo cloned beside this one?`);
  process.exit(2);
}

/** Directories whose contents the module serves at runtime (recipes/: fxstudio's corpus, fetched at boot). */
const SERVED_DIRS = ['scripts', 'styles', 'templates', 'lang', 'recipes'];
const CONTENT_TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.hbs': 'text/plain',
  '.html': 'text/html',
};

/** Every served file in the repo, as repo-relative posix paths. */
function servedFiles() {
  const out = ['module.json'];
  const walk = rel => {
    for (const entry of readdirSync(join(REPO, rel)).sort()) {
      const child = posix.join(rel, entry);
      if (statSync(join(REPO, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  for (const dir of SERVED_DIRS) if (existsSync(join(REPO, dir))) walk(dir);
  return out;
}

const env = loadEnv();
/**
 * The write/read-back target: the selected host's direct file plane (src/hosts — WebDAV on a
 * managed box, the Data/ directory of a local install), so the deploy loop below is the same
 * code on every host. It re-READS what it wrote — a successful write is not proof the bytes
 * landed.
 */
const kind = toLocal ? 'local' : hostKindFromEnv(process.env);
const hostCfg = resolveHostConfig(env, kind);
const plane = createHost(hostCfg, quietLogger()).files;
if (!plane) {
  console.error(
    `the ${kind} host has no direct file plane — set FOUNDRY_DATA_DIR (an install on this ` +
      'machine) or FOUNDRY_WEBDAV_URL / _USER / _PASSWORD (a WebDAV endpoint over Data/) in .env.'
  );
  process.exit(2);
}
if (kind === 'local' && hostCfg.dataDir && !existsSync(hostCfg.dataDir)) {
  console.error(`FOUNDRY_DATA_DIR does not exist: ${hostCfg.dataDir}`);
  process.exit(2);
}
const target = {
  label: `${targetLabel(kind)} (${plane.label}${hostCfg.dataDir ? `: ${hostCfg.dataDir}` : ''})`,
  ensureParents: rel => plane.ensureParents(rel),
  put: (rel, body, contentType) => plane.write(rel, body, contentType),
  get: rel => plane.read(rel),
  liveHint:
    kind === 'local'
      ? 'Restart the local Foundry process to pick up module.json changes; a world reload is ' +
        'enough for scripts, styles and templates.'
      : 'Scripts, styles and templates are live on the next world reload. module.json (version ' +
        'string, esmodules/styles lists) keeps vending the OLD values until the Foundry PROCESS ' +
        'restarts — expected, not a failure.',
};

const sha = buf => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const asBuffer = raw => (Buffer.isBuffer(raw) ? raw : Buffer.from(raw));

const files = servedFiles();
const manifest = JSON.parse(readFileSync(join(REPO, 'module.json'), 'utf8'));
console.log(
  `${checkOnly ? 'Checking' : 'Deploying'} ${moduleId} v${manifest.version} ` +
    `(${files.length} files) -> ${target.label}\n`
);

let fails = 0;
for (const rel of files) {
  const dest = `modules/${moduleId}/${rel}`;
  const local = readFileSync(join(REPO, rel));
  try {
    if (!checkOnly) {
      const ext = rel.slice(rel.lastIndexOf('.'));
      await target.ensureParents(dest);
      await target.put(dest, local, CONTENT_TYPES[ext] ?? 'application/octet-stream');
    }
    // Read it straight back — a 2xx on PUT is not proof the bytes landed intact.
    const remote = asBuffer(await target.get(dest));
    const ok = sha(local) === sha(remote);
    if (!ok) fails++;
    console.log(
      `  ${ok ? 'MATCH ' : 'DIFFER'} ${rel} (${local.length} bytes)` +
        (ok ? '' : ` — local=${sha(local)} deployed=${sha(remote)}`)
    );
  } catch (err) {
    console.error(`  FAIL   ${rel}: ${err?.message || err}`);
    fails++;
  }
}

const where = kind === 'local' ? 'the sandbox' : targetLabel(kind);
if (fails) {
  console.log(`\n${fails} file(s) did not match.`);
} else if (checkOnly) {
  console.log(`\n${where} is byte-identical to the local v${manifest.version}.`);
} else {
  console.log(`\nDeployed ${moduleId} v${manifest.version}; ${where} is byte-identical.`);
  console.log(target.liveHint);
  if (kind === 'local') {
    console.log(
      '⚠ A sandbox refresh (pull-prod-to-local.mjs) mirrors prod and will overwrite this — ' +
        're-run --local after every refresh.'
    );
  }
}
process.exit(fails ? 1 : 0);
