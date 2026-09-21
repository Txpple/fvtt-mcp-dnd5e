// LIVE acceptance for manage-actors export — driven through the TOOL REGISTRY (the soundscape lesson:
// a tool is done when the FORMATTED output is right, not when the page function returns).
//
// Proves the v14 gotcha fix: toObject() pre-defines flags.exportSource as a getter-only
// non-enumerable accessor (14.364), so the page function must rebuild flags as plain data
// before stamping the export envelope — a naive assignment throws.
//
// SAFE: read-only against the world; writes one temp file locally and deletes it.
//
// Build first: npm run build.
// Run: FOUNDRY_HOST=local node scripts/verify-actor-export.mjs [--prod] [--actor "<name>"]
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';
import { hostKindFromEnv } from '../dist/hosts/index.js';
import { buildToolRegistry } from '../dist/registry.js';
import { Logger } from '../dist/logger.js';

const env = loadEnv();

const argv = process.argv.slice(2);
const prod = argv.includes('--prod');
const actorIdx = argv.indexOf('--actor');
const actorArg = actorIdx >= 0 ? argv[actorIdx + 1] : null;

const kind = prod ? 'molten' : process.env.FOUNDRY_HOST ? hostKindFromEnv(process.env) : 'local';
const cfg = bridgeConfig(env, { host: kind, quiet: true });
const f = new Foundry(cfg);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const registry = buildToolRegistry({
  foundry: f,
  host: cfg.host,
  logger: new Logger({ level: 'error', format: 'simple' }),
});

const outPath = join(tmpdir(), `verify-actor-export-${process.pid}.json`);

try {
  console.log(`\n[verify-actor-export] connecting to ${prod ? 'PROD' : 'the LOCAL sandbox'}…`);
  await f.connect();

  // Any actor works; default to the first PC-type actor so the export exercises embedded items.
  const target =
    actorArg ??
    (await f.evaluate(
      () => game.actors.find(a => a.type === 'character')?.name ?? game.actors.contents[0]?.name,
      null
    ));
  check('found a target actor', !!target, 'world has no actors');
  if (!target) throw new Error('no target actor');
  console.log(`[verify-actor-export] target="${target}" → ${outPath}\n`);

  const out = await registry.dispatch('manage-actors', {
    action: 'export',
    actorIdentifier: target,
    localPath: outPath,
    overwrite: true,
  });
  check('formatted output reports the export', /^Exported ".+" \(.+\)/.test(out), out);
  check('formatted output names the file', out.includes(outPath), out);

  const doc = JSON.parse(await readFile(outPath, 'utf8'));
  check('file is the full document (_id + name + type)', !!doc._id && !!doc.name && !!doc.type);
  check('embedded items array present', Array.isArray(doc.items));
  check('effects array present', Array.isArray(doc.effects));
  check('ownership survives (backup fidelity)', doc.ownership && typeof doc.ownership === 'object');
  const es = doc.flags?.exportSource;
  check(
    'exportSource envelope stamped as plain data (the v14 getter fix)',
    !!es && !!es.system && !!es.coreVersion,
    JSON.stringify(es)
  );

  // a refusal is an error (§3), never prose in a success shape
  let refuse = '';
  try {
    await registry.dispatch('manage-actors', {
      action: 'export',
      actorIdentifier: target,
      localPath: outPath,
    });
  } catch (e) {
    refuse = e?.message ?? String(e);
  }
  check('second write without overwrite refuses (an error)', /already exists/.test(refuse), refuse);
} catch (err) {
  fail++;
  console.error(`\n[verify-actor-export] 💥 ${err.message}`);
} finally {
  try {
    rmSync(outPath, { force: true });
  } catch {}
  await f.dispose();
  console.log(`\n[verify-actor-export] ${pass} passed, ${fail} failed.`);
  // The bridge holds a live browser; without this the script hangs instead of exiting.
  process.exit(fail === 0 ? 0 : 1);
}
