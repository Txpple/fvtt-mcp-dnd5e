// install-packs.mjs — install, one at a time, the owned (and free) packages a list-packs.mjs list wrote.
// Foundry's installPackage answers once the manifest is fetched and downloads in the background, so
// each pack is waited on (its module.json appears, its .zip goes) before the next is asked for.
//
//   node scripts/maplib/install/install-packs.mjs --packages fa-packages.json [--exclude "<id regex>"]
//
// Resume after an interruption the same way: boot the sandbox to Setup
// (node scripts/local-foundry.mjs start --no-world) and run it again; installed packs are skipped
// and a dead .zip from the cut download is cleared first.
import fs from 'node:fs';
import path from 'node:path';
const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const base = env.FOUNDRY_URL || 'http://localhost:30000',
  adminPassword = env.FOUNDRY_ADMIN_KEY;
const MODS = path.join(env.FOUNDRY_DATA_DIR, 'modules');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasJson = id => fs.existsSync(path.join(MODS, id, 'module.json'));
const hasZip = id => fs.existsSync(path.join(MODS, `${id}.zip`));
async function post(body) {
  const res = await fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin },
    body: JSON.stringify({ ...body, adminPassword }),
    redirect: 'manual',
    signal: AbortSignal.timeout(300_000),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return { status: res.status, payload };
}
async function waitFor(id) {
  const t0 = Date.now();
  let sawZip = hasZip(id),
    quiet = 0;
  while (Date.now() - t0 < 45 * 60_000) {
    if (hasJson(id) && !hasZip(id)) return true;
    if (hasZip(id)) {
      sawZip = true;
      quiet = 0;
    } else if (sawZip) {
      quiet++;
      if (quiet > 30) return hasJson(id);
    } else if (Date.now() - t0 > 5 * 60_000) return false;
    await sleep(2000);
  }
  return hasJson(id);
}
const argv = process.argv.slice(2);
const opt = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const listFile = opt('--packages');
if (!listFile) {
  console.error('--packages <file.json> (from list-packs.mjs list) is required');
  process.exit(2);
}
const exclude = opt('--exclude') ? new RegExp(opt('--exclude'), 'i') : null;
const listed = JSON.parse(fs.readFileSync(new URL(`./${listFile}`, import.meta.url), 'utf8'));
const targets = listed.filter(p => (p.owned || !p.protected) && !exclude?.test(p.id));
// A zip left by an interrupted run is a dead download: Foundry will not resume it. Clear it so
// the pack is requested again instead of waited on.
for (const f of fs.readdirSync(MODS))
  if (f.endsWith('.zip') && Date.now() - fs.statSync(path.join(MODS, f)).mtimeMs > 120_000) {
    fs.rmSync(path.join(MODS, f));
    console.log(`removed stale ${f}`);
  }
const results = [];
for (const [i, p] of targets.entries()) {
  const tag = `[${i + 1}/${targets.length}] ${p.id}`;
  if (hasJson(p.id) && !hasZip(p.id)) {
    console.log(`${tag} already installed`);
    results.push({ id: p.id, ok: true, skipped: true });
    continue;
  }
  const t0 = Date.now();
  if (hasZip(p.id)) {
    process.stdout.write(`${tag} in flight, waiting … `);
  } else {
    process.stdout.write(`${tag} … `);
    try {
      const r = await post({
        action: 'installPackage',
        type: 'module',
        id: p.id,
        manifest: p.manifest,
      });
      if (r.status !== 200 || r.payload?.error) {
        console.log(`FAIL ${r.status} ${JSON.stringify(r.payload).slice(0, 300)}`);
        results.push({ id: p.id, ok: false, error: r.payload?.error ?? r.status });
        continue;
      }
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ id: p.id, ok: false, error: e.message });
      continue;
    }
  }
  const ok = await waitFor(p.id);
  console.log(
    ok ? `ok (${((Date.now() - t0) / 1000) | 0}s)` : `FAILED (no module.json after wait)`
  );
  results.push({ id: p.id, ok });
}
fs.writeFileSync(
  new URL(`./${listFile.replace(/.json$/, '')}-results.json`, import.meta.url),
  JSON.stringify(results, null, 2)
);
console.log(
  `done: ${results.filter(r => r.ok).length} ok, ${results.filter(r => !r.ok).length} failed`
);
