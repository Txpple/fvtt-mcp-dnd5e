// list-packs.mjs — what a creator publishes on foundryvtt.com, and which of it this Foundry
// license owns, through the local server's own /setup admin API (the same index the Setup
// screen's "Install Module" dialog shows, with `owned` set from the license's purchases).
//
//   node scripts/maplib/install/list-packs.mjs list --creator "Forgotten Adventures" --out fa-packages.json
//   node scripts/maplib/install/list-packs.mjs shutdown     # stop the active world (Setup only lists)
//   node scripts/maplib/install/list-packs.mjs status
//
// `--creator` is a case-insensitive regex over each package's authors, title and id. The list is
// written beside this script; install-packs.mjs reads it. Needs FOUNDRY_URL / FOUNDRY_ADMIN_KEY
// from the repo .env and a server at the Setup screen (no world active).
import fs from 'node:fs';

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
const base = env.FOUNDRY_URL || 'http://localhost:30000';
const adminPassword = env.FOUNDRY_ADMIN_KEY;
async function post(path, body, timeoutMs = 60_000) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin },
    body: JSON.stringify({ ...body, adminPassword }),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return { status: res.status, payload };
}
const argv = process.argv.slice(2);
const opt = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cmd = argv[0];
if (cmd === 'shutdown') {
  console.log(await post('/setup', { action: 'worldShutdown' }));
} else if (cmd === 'status') {
  console.log(await (await fetch(`${base}/api/status`)).json());
} else if (cmd === 'list') {
  const creator = opt('--creator');
  const out = opt('--out');
  if (!creator || !out) {
    console.error('list needs --creator "<regex>" and --out <file.json>');
    process.exit(2);
  }
  const re = new RegExp(creator, 'i');
  const r = await post('/setup', { action: 'getPackages', type: 'module' }, 180_000);
  if (!Array.isArray(r.payload)) {
    console.log(r);
    process.exit(1);
  }
  const hits = r.payload.filter(p =>
    re.test([JSON.stringify(p.authors ?? ''), p.title ?? '', p.id ?? ''].join(' | '))
  );
  fs.writeFileSync(new URL(`./${out}`, import.meta.url), JSON.stringify(hits, null, 2));
  console.log(
    `index: ${r.payload.length} modules; matching: ${hits.length}; owned: ${hits.filter(p => p.owned).length}; premium: ${hits.filter(p => p.protected).length}`
  );
  for (const p of hits)
    console.log(
      `${p.owned ? 'OWNED' : p.protected ? '     ' : 'FREE '} ${p.installed ? '[inst]' : '      '} ${p.id}\t${p.title}\tv${p.version}\tmin ${p.compatibility?.minimum}/ver ${p.compatibility?.verified}`
    );
} else {
  console.error(
    'usage: list-packs.mjs list --creator "<regex>" --out <file.json> | shutdown | status'
  );
  process.exit(2);
}
