// maplib/fa-fetch.mjs — download Forgotten Adventures battlemaps the way their own Foundry module
// (FA Battlemaps, github.com/Forgotten-Adventures/FA_Battlemaps) does, without a running world:
// the map list and each map's file list from FA's API, a signed URL per file, the bytes into a
// staging folder laid out like Foundry's Data (fa_battlemaps/...), plus the module itself, whose
// scene compendium holds every map's walls, lights and levels and points at those same paths.
// extract.mjs then builds the Maps_FA library from the two:
//
//   node scripts/maplib/fa-fetch.mjs --staging <dir> [--free-only] [--ids A,B] [--limit N] [--no-hq]
//   node scripts/maplib/extract.mjs --library "<Desktop>\Maps_FA" --module <staging>\module\fa-battlemaps --data-root <staging>\data
//
// Premium maps need the Battlesmith Patreon tier, linked once: `--login` prints a Patreon sign-in
// link for a fresh id; open it in your own browser and approve, and the id (kept in
// <staging>\fa-user-id.txt, never anywhere else) is what FA's API recognises afterwards. Free maps
// need no login. Re-runs skip files already staged at the same size, so an interruption resumes.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const API = 'https://api.forgotten-adventures.net/api/v1';
const MODULE_MANIFEST =
  'https://raw.githubusercontent.com/Forgotten-Adventures/FA_Battlemaps/main/module.json';
// FA's Patreon OAuth client, as their module publishes it (scripts/fa-battlemaps.js).
const PATREON_CLIENT = 'NKDhTqQyf4i2ylsM6JQ1JFxNmjGFShGSwe5wHqbeypvI0JnNt-WcbFLrLDLj6-ey';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = name => argv.includes(name);
const staging = opt('--staging');
if (!staging) {
  console.error('--staging <dir> is required');
  process.exit(2);
}
const dataDir = path.join(staging, 'data');
const moduleDir = path.join(staging, 'module', 'fa-battlemaps');
const idFile = path.join(staging, 'fa-user-id.txt');
fs.mkdirSync(dataDir, { recursive: true });

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url.split('?')[0]}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * One file to dest through node:https, not fetch: undici's fetch kills the process with an internal
 * assertion when a server ends a socket mid-body under backpressure. A per-process .part name keeps
 * two runs (free and premium) from writing the same shared file at once; a short or failed body is
 * retried.
 */
function getOnce(url, part, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120_000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(getOnce(new URL(res.headers.location, url).href, part, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(part);
      res.pipe(out);
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function download(url, dest, size) {
  const part = `${dest}.${process.pid}.part`;
  for (let attempt = 1; ; attempt++) {
    try {
      await getOnce(url, part);
      if (size && fs.statSync(part).size !== size)
        throw new Error(`short file (${fs.statSync(part).size} of ${size} bytes)`);
      fs.renameSync(part, dest);
      return;
    } catch (e) {
      fs.rmSync(part, { force: true });
      if (attempt >= 4) throw new Error(`${path.basename(dest)}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

// ---------- login ----------
let userId = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : null;
if (flag('--login')) {
  userId = randomUUID();
  fs.writeFileSync(idFile, userId);
  // Built exactly as FA's module builds it (redirect_uri unencoded).
  const url = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${PATREON_CLIENT}&redirect_uri=${API}/patreon&scope=identity&state=${userId}`;
  console.log(
    `Open this in your browser while signed in to Patreon, and approve:\n\n${url}\n\nThen run fa-fetch again; it checks the link before downloading.`
  );
  process.exit(0);
}
userId ??= randomUUID(); // anonymous: free maps only
let premium = false;
try {
  const ready = await fetch(`${API}/users/${userId}/ready`).then(r => (r.ok ? r.json() : null));
  premium = !!(ready && !ready.error && ready.expires_in > 0 && ready.has_premium);
  console.log(
    ready && !ready.error
      ? `Patreon linked: premium ${ready.has_premium ? 'yes' : 'no'}, free ${ready.has_free ? 'yes' : 'no'}`
      : 'Patreon not linked: free maps only (run with --login to link)'
  );
} catch {
  console.log('Patreon status unavailable: free maps only');
}

// ---------- the module (scene compendium) ----------
const manifest = await getJson(MODULE_MANIFEST);
const have = fs.existsSync(path.join(moduleDir, 'module.json'))
  ? JSON.parse(fs.readFileSync(path.join(moduleDir, 'module.json'), 'utf8')).version
  : null;
if (have !== manifest.version) {
  console.log(`module fa-battlemaps ${have ?? '(none)'} -> ${manifest.version}`);
  const zip = path.join(staging, 'fa-battlemaps.zip');
  const res = await fetch(manifest.download);
  if (!res.ok) throw new Error(`module download: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));
  fs.rmSync(moduleDir, { recursive: true, force: true });
  fs.mkdirSync(moduleDir, { recursive: true });
  // Windows' own tar (bsdtar) reads zip; Git's GNU tar, often first on PATH, does not.
  const tar =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const t = spawnSync(tar, ['-xf', zip, '-C', moduleDir], { stdio: 'inherit' });
  if (t.status !== 0) throw new Error('could not unzip the module');
  // A zip that wraps everything in one folder: lift it.
  const inner = fs.readdirSync(moduleDir);
  if (inner.length === 1 && fs.existsSync(path.join(moduleDir, inner[0], 'module.json'))) {
    for (const f of fs.readdirSync(path.join(moduleDir, inner[0])))
      fs.renameSync(path.join(moduleDir, inner[0], f), path.join(moduleDir, f));
    fs.rmdirSync(path.join(moduleDir, inner[0]));
  }
  fs.rmSync(zip);
}

// ---------- the maps ----------
const list = await getJson(`${API}/battlemaps/list`);
fs.writeFileSync(path.join(staging, 'fa-maps.json'), JSON.stringify(list, null, 2));
const ids = opt('--ids') ? new Set(opt('--ids').split(',')) : null;
let targets = list.filter(m => (ids ? ids.has(m.id) : true));
if (flag('--free-only') || !premium) targets = targets.filter(m => m.access === 'Free');
else if (flag('--premium-only')) targets = targets.filter(m => m.access === 'Premium');
if (opt('--limit')) targets = targets.slice(0, Number(opt('--limit')));
const hq = !flag('--no-hq');
console.log(
  `${list.length} maps listed (${list.filter(m => m.access === 'Free').length} free); fetching ${targets.length}${hq ? ', high quality' : ''}`
);

const results = [];
let bytes = 0;
for (const [i, m] of targets.entries()) {
  const tag = `[${i + 1}/${targets.length}] ${m.name} (${m.access})`;
  try {
    const listing = await getJson(
      `${API}/battlemaps/list-files/${m.id}?userId=${userId}${hq ? '&hq=true' : ''}`
    );
    // An HQ file is served from .../Maps_HQ/... and saved, as FA's module does, at the standard
    // .../Maps/... path the scenes reference, replacing the normal copy: one file per saved path,
    // the HQ one when offered.
    const saveAs = f => (f.isHQ ? f.path.replace('/Maps_HQ/', '/Maps/') : f.path);
    const byPath = new Map();
    for (const f of [
      ...(listing.files?.animations ?? []),
      ...(listing.files?.audio ?? []),
      ...(listing.files?.images ?? []),
    ]) {
      if (!f.size) continue;
      const prev = byPath.get(saveAs(f));
      if (!prev || (f.isHQ && !prev.isHQ)) byPath.set(saveAs(f), f);
    }
    let got = 0,
      kept = 0;
    for (const [target, f] of byPath) {
      const dest = path.join(dataDir, target);
      if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) {
        kept++;
        continue;
      }
      const details = await getJson(
        `${API}/battlemaps/get-file/${m.id}/${encodeURIComponent(f.path)}?userId=${userId}`
      );
      if (!details?.url) throw new Error(`no download link for ${f.path}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await download(details.url, dest, f.size);
      bytes += f.size;
      got++;
    }
    console.log(`${tag}: ${got} downloaded, ${kept} already staged`);
    results.push({ id: m.id, name: m.name, ok: true, files: byPath.size });
  } catch (e) {
    console.log(`${tag}: FAILED ${e.message}`);
    results.push({ id: m.id, name: m.name, ok: false, error: e.message });
  }
}
// One results file per kind of run, so a free run and a premium run do not overwrite each other;
// extract.mjs --scenes takes each.
const kind = flag('--free-only') || !premium ? 'free' : flag('--premium-only') ? 'premium' : 'all';
fs.writeFileSync(
  path.join(staging, `fa-fetch-results-${kind}.json`),
  JSON.stringify(results, null, 2)
);
console.log(
  `done: ${results.filter(r => r.ok).length} ok, ${results.filter(r => !r.ok).length} failed, ${(bytes / 1e9).toFixed(2)} GB downloaded`
);
