// Usage: node madcart.mjs list | shutdown | install <id...> | install-all
import fs from 'node:fs';
const env = Object.fromEntries(
  fs
    .readFileSync(
      'C:/Users/sippelmc/Documents/Repos/FVTT/fvtt-suite-openroll5e/fvtt-mcp-dnd5e/.env',
      'utf8'
    )
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
const isMad = p =>
  /mad\s*cartographer/i.test(JSON.stringify(p.authors ?? '')) ||
  /madcartographer|mad-cartographer/i.test(p.id ?? '') ||
  /mad cartographer/i.test(p.title ?? '');
const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'shutdown') {
  console.log(await post('/setup', { action: 'worldShutdown' }));
} else if (cmd === 'status') {
  console.log(await (await fetch(`${base}/api/status`)).json());
} else if (cmd === 'list') {
  const r = await post('/setup', { action: 'getPackages', type: 'module' }, 180_000);
  if (!Array.isArray(r.payload)) {
    console.log(r);
    process.exit(1);
  }
  const mad = r.payload.filter(isMad);
  fs.writeFileSync(
    new URL('./madcart-packages.json', import.meta.url),
    JSON.stringify(mad, null, 2)
  );
  console.log(
    `index: ${r.payload.length} modules; MAD Cartographer: ${mad.length}; owned: ${mad.filter(p => p.owned).length}; protected: ${mad.filter(p => p.protected).length}`
  );
  for (const p of mad)
    console.log(
      `${p.owned ? 'OWNED ' : '      '} ${p.installed ? '[inst]' : '      '} ${p.id}\t${p.title}\tv${p.version}\tmin ${p.compatibility?.minimum}/ver ${p.compatibility?.verified}`
    );
} else if (cmd === 'install' || cmd === 'install-all') {
  const mad = JSON.parse(
    fs.readFileSync(new URL('./madcart-packages.json', import.meta.url), 'utf8')
  );
  const targets =
    cmd === 'install-all'
      ? mad.filter(p => (p.owned || !p.protected) && !p.installed)
      : mad.filter(p => args.includes(p.id));
  console.log(`installing ${targets.length} packages`);
  const results = [];
  for (const [i, p] of targets.entries()) {
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${targets.length}] ${p.id} … `);
    try {
      const r = await post(
        '/setup',
        { action: 'installPackage', type: 'module', id: p.id, manifest: p.manifest },
        1_800_000
      );
      const ok = r.status === 200 && !r.payload?.error;
      console.log(
        ok
          ? `ok (${((Date.now() - t0) / 1000) | 0}s)`
          : `FAIL ${r.status} ${JSON.stringify(r.payload).slice(0, 300)}`
      );
      results.push({ id: p.id, ok, status: r.status, error: r.payload?.error });
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ id: p.id, ok: false, error: e.message });
    }
  }
  fs.writeFileSync(
    new URL('./madcart-results.json', import.meta.url),
    JSON.stringify(results, null, 2)
  );
  console.log(
    `done: ${results.filter(r => r.ok).length} ok, ${results.filter(r => !r.ok).length} failed`
  );
}
