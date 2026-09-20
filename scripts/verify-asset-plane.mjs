// Live acceptance: the asset file tools over the HOST's file plane (2.2 — src/hosts).
//
//   FOUNDRY_HOST=local  node scripts/verify-asset-plane.mjs   # the sandbox's Data/ dir (node:fs)
//   FOUNDRY_HOST=molten node scripts/verify-asset-plane.mjs   # prod's WebDAV (writes a ZZ-* folder)
//
// Drives the SAME AssetFileTools the MCP server serves, against the host the env selects, through
// a full cycle on a ZZ-* path: create-asset-folder → upload-asset → asset-info → list-assets →
// asset-url → copy-asset → move-asset (+relink no-op) → download-asset → delete-asset, plus the
// refusals that must hold on every plane (world-DB path, path traversal, no-overwrite). Then it
// connects the bridge and checks get-world-info reports the host block. Everything it creates is
// removed in `finally`.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { AssetFileTools } from '../dist/tools/assets/index.js';
import { SceneTools } from '../dist/tools/scene.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const txt = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
const cfg = bridgeConfig(env);
const host = cfg.host;

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};
const stamp = () => new Date().toISOString().slice(11, 19);
let pass = 0;
let fail = 0;
function check(cond, label, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(
  `host: ${host.kind} (${host.label}) — file plane: ${host.files ? host.files.label : 'NONE'}`
);
if (!host.files) {
  console.log(host.filesNotConfigured('verify-asset-plane'));
  process.exit(2);
}

const ROOT = `ZZ-verify-asset-plane-${Date.now()}`;
const tmp = mkdtempSync(join(tmpdir(), 'verify-asset-plane-'));
const localFile = join(tmp, 'probe.txt');
writeFileSync(localFile, `verify-asset-plane ${new Date().toISOString()}\n`);

const tools = new AssetFileTools({ logger: quiet, host }); // no bridge → delete/move need force
let foundry;
try {
  console.log(`\n[${stamp()}] cycle on Data/${ROOT}`);

  let out = await tools.handleCreateAssetFolder({ remotePath: `${ROOT}/a` });
  check(/Created folder/.test(out), 'create-asset-folder creates nested parents', out);
  out = await tools.handleCreateAssetFolder({ remotePath: `${ROOT}/a` });
  check(/Already exists/.test(out), 'create-asset-folder is idempotent', out);

  out = await tools.handleUploadAsset({ localPath: localFile, remotePath: `${ROOT}/a/probe.txt` });
  check(
    /Uploaded/.test(out) && out.includes(host.publicUrl(`${ROOT}/a/probe.txt`)),
    'upload-asset uploads + reports the public URL',
    out
  );
  out = await tools.handleUploadAsset({ localPath: localFile, remotePath: `${ROOT}/a/probe.txt` });
  check(
    /already exists/.test(out),
    'upload-asset refuses to overwrite without overwrite:true',
    out
  );
  out = await tools.handleUploadAsset({
    localPath: localFile,
    remotePath: `${ROOT}/a/probe.txt`,
    overwrite: true,
  });
  check(/Uploaded/.test(out), 'upload-asset overwrites with overwrite:true', out);

  out = await tools.handleAssetInfo({ remotePath: `${ROOT}/a/probe.txt` });
  check(
    /FILE/.test(out) && /size/.test(out) && /text\/plain/.test(out),
    'asset-info reports size + type',
    out
  );
  out = await tools.handleAssetInfo({ remotePath: `${ROOT}/a` });
  check(/FOLDER/.test(out), 'asset-info reports a folder', out);
  out = await tools.handleAssetInfo({ remotePath: `${ROOT}/nope` });
  check(/Does not exist/.test(out), 'asset-info reports absence', out);

  out = await tools.handleListAssets({ remotePath: ROOT });
  check(
    /1 folder\(s\), 0 file\(s\)/.test(out) && /\[DIR \] a\//.test(out),
    'list-assets lists children (dirs first)',
    out
  );
  out = await tools.handleListAssets({ remotePath: `${ROOT}/a` });
  check(/\[FILE\] probe\.txt/.test(out), 'list-assets lists the uploaded file', out);
  out = await tools.handleListAssets({ remotePath: `${ROOT}/ghost` });
  check(/does not exist/.test(out), 'list-assets reports an absent directory', out);

  out = await tools.handleAssetUrl({ remotePath: `Data/${ROOT}/a/probe.txt` });
  check(out === host.publicUrl(`${ROOT}/a/probe.txt`), 'asset-url maps through the host', out);

  out = await tools.handleCopyAsset({
    fromPath: `${ROOT}/a/probe.txt`,
    toPath: `${ROOT}/b/copy.txt`,
  });
  check(/Copied/.test(out), 'copy-asset creates parents + copies', out);
  out = await tools.handleCopyAsset({
    fromPath: `${ROOT}/a/probe.txt`,
    toPath: `${ROOT}/b/copy.txt`,
  });
  check(/already exists/.test(out), 'copy-asset refuses an existing destination', out);

  out = await tools.handleMoveAsset({
    fromPath: `${ROOT}/b/copy.txt`,
    toPath: `${ROOT}/c/moved.txt`,
  });
  check(
    /Refused: couldn't verify references/.test(out),
    'move-asset refuses without a bridge to reference-check',
    out
  );
  out = await tools.handleMoveAsset({
    fromPath: `${ROOT}/b/copy.txt`,
    toPath: `${ROOT}/c/moved.txt`,
    force: true,
  });
  check(/Moved/.test(out), 'move-asset (force) creates parents + moves', out);
  out = await tools.handleAssetInfo({ remotePath: `${ROOT}/b/copy.txt` });
  check(/Does not exist/.test(out), 'move-asset removed the source', out);

  const dl = join(tmp, 'downloaded.txt');
  out = await tools.handleDownloadAsset({ remotePath: `${ROOT}/c/moved.txt`, localPath: dl });
  check(
    /Downloaded/.test(out) &&
      existsSync(dl) &&
      readFileSync(dl, 'utf8') === readFileSync(localFile, 'utf8'),
    'download-asset round-trips the bytes',
    out
  );

  // Refusals that must hold on every plane.
  out = await tools.handleUploadAsset({
    localPath: localFile,
    remotePath: `worlds/${host.worldId ?? 'w'}/data/actors/x.db`,
  });
  check(/live LevelDB/.test(out), 'upload-asset refuses a live world-DB path', out);
  out = await tools.handleCreateAssetFolder({ remotePath: `worlds/${host.worldId ?? 'w'}/data` });
  check(/live LevelDB/.test(out), 'create-asset-folder refuses the world-DB dir', out);
  let threw = null;
  try {
    await tools.handleAssetInfo({ remotePath: `${ROOT}/../../etc/passwd` });
  } catch (e) {
    threw = e;
  }
  check(
    threw && /traversal/.test(threw.message),
    'a `..` path is refused before any plane op',
    threw?.message
  );

  out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/c/moved.txt` });
  check(
    /Refused: couldn't verify references/.test(out),
    'delete-asset refuses without a bridge to reference-check',
    out
  );
  out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/c/moved.txt`, force: true });
  check(/Deleted/.test(out), 'delete-asset (force) deletes a file', out);
  out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/a` });
  check(/is a directory/.test(out), 'delete-asset refuses a directory without recursive:true', out);

  // --- the bridge: get-world-info reports the host ------------------------------------------
  console.log(`\n[${stamp()}] bridge connect (${cfg.serverUrl})`);
  foundry = new Foundry(cfg, quiet);
  await foundry.connect();
  const scene = new SceneTools({ foundry, logger: quiet, host });
  const info = await scene.handleGetWorldInfo({});
  check(
    info?.host?.kind === host.kind,
    `get-world-info.host.kind = ${host.kind}`,
    JSON.stringify(info?.host)
  );
  check(
    info?.host?.files === host.files.label,
    `get-world-info.host.files = ${host.files.label}`,
    JSON.stringify(info?.host)
  );
  check(
    typeof info?.system?.id === 'string',
    'get-world-info still reports the world',
    JSON.stringify(info?.system)
  );

  // With the bridge attached, a delete on an unreferenced file is allowed without force.
  const withBridge = new AssetFileTools({ logger: quiet, host, foundry });
  await withBridge.handleUploadAsset({ localPath: localFile, remotePath: `${ROOT}/d/unref.txt` });
  out = await withBridge.handleDeleteAsset({ remotePath: `${ROOT}/d/unref.txt` });
  check(
    /Deleted/.test(out),
    'delete-asset reference-checks through the bridge and deletes an unreferenced file',
    out
  );
} finally {
  const out = await tools.handleDeleteAsset({ remotePath: ROOT, recursive: true, force: true });
  console.log(`\ncleanup: ${out}`);
  rmSync(tmp, { recursive: true, force: true });
  if (foundry) await foundry.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
