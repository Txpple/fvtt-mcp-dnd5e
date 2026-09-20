// Live acceptance: the asset file tools over the file plane (src/hosts).
//
//   FOUNDRY_HOST=local  node scripts/verify-asset-plane.mjs                 # the direct plane: the
//                                                                            # sandbox's Data/ dir (node:fs)
//   FOUNDRY_HOST=local  node scripts/verify-asset-plane.mjs --plane bridge  # the BRIDGE plane: Foundry's
//                                                                            # own FilePicker through the page
//   FOUNDRY_HOST=molten node scripts/verify-asset-plane.mjs                 # prod's WebDAV (writes a ZZ-* folder)
//
// Drives the SAME AssetFileTools the MCP server serves, against the host the env selects, through
// a full cycle on a ZZ-* path: create-asset-folder → upload-asset → asset-info → list-assets →
// asset-url → copy-asset → move-asset (+relink no-op) → download-asset → delete-asset, plus the
// refusals that must hold on every plane (world-DB path, path traversal, no-overwrite), and checks
// get-world-info reports the plane in use. `--plane bridge` strips the host's direct plane so the
// tools fall back to the bridge plane (what every host without FOUNDRY_DATA_DIR / FOUNDRY_WEBDAV_*
// gets) — there delete / move must refuse by name, and a file copy is a download + upload. The
// direct plane cleans up in `finally` in both modes, so `--plane bridge` needs one configured.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { createHost, filePlaneFor } from '../dist/hosts/index.js';
import { resolveHostConfig, hostKindFromEnv } from '../dist/hosts/index.js';
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
const planeMode = process.argv.includes('--plane')
  ? process.argv[process.argv.indexOf('--plane') + 1]
  : 'direct';
if (!['direct', 'bridge'].includes(planeMode)) {
  console.error('--plane must be direct or bridge');
  process.exit(2);
}
const cfg = bridgeConfig(env);
const directHost = cfg.host;

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

if (!directHost.files) {
  console.log(
    `host: ${directHost.kind} has no direct plane (FOUNDRY_DATA_DIR / FOUNDRY_WEBDAV_*) — needed for cleanup.`
  );
  process.exit(2);
}
// `--plane bridge`: the same host minus its direct plane → the tools compose the bridge plane.
let host = directHost;
if (planeMode === 'bridge') {
  const hostCfg = resolveHostConfig(env, hostKindFromEnv(process.env));
  const { dataDir: _d, webdav: _w, ...bare } = hostCfg;
  host = createHost(bare, quiet);
}

const ROOT = `ZZ-verify-asset-plane-${Date.now()}`;
const tmp = mkdtempSync(join(tmpdir(), 'verify-asset-plane-'));
const localFile = join(tmp, 'probe.txt');
writeFileSync(localFile, `verify-asset-plane ${new Date().toISOString()}\n`);

console.log(`\n[${stamp()}] bridge connect (${cfg.serverUrl})`);
const foundry = new Foundry(cfg, quiet);
await foundry.connect();
const plane = filePlaneFor(host, foundry);
console.log(`host: ${host.kind} (${host.label}) — file plane in use: ${plane.label}`);
const bridged = plane.label.startsWith('bridge');

const tools = new AssetFileTools({ logger: quiet, host, foundry });
/** The same tools with a bridge that is DOWN: reference checks must then refuse without force. */
const downBridge = { call: async () => Promise.reject(new Error('bridge down')) };
const toolsNoBridge = new AssetFileTools({ logger: quiet, host, foundry: downBridge });
const cleanup = new AssetFileTools({ logger: quiet, host: directHost, foundry });
const worldId = await foundry.worldId();
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
  check(/\d+ B[,)]/.test(out), 'list-assets reports the file size', out);
  out = await tools.handleListAssets({ remotePath: `${ROOT}/ghost` });
  check(/does not exist/.test(out), 'list-assets reports an absent directory', out);

  out = await tools.handleAssetUrl({ remotePath: `Data/${ROOT}/a/probe.txt` });
  check(out === host.publicUrl(`${ROOT}/a/probe.txt`), 'asset-url maps through the host', out);

  out = await tools.handleCopyAsset({
    fromPath: `${ROOT}/a/probe.txt`,
    toPath: `${ROOT}/b/copy.txt`,
  });
  check(/Copied/.test(out), 'copy-asset creates parents + copies a file', out);
  out = await tools.handleCopyAsset({
    fromPath: `${ROOT}/a/probe.txt`,
    toPath: `${ROOT}/b/copy.txt`,
  });
  check(/already exists/.test(out), 'copy-asset refuses an existing destination', out);

  if (!bridged) {
    // (On the bridge plane a down bridge is the plane itself — nothing to reference-check with.)
    out = await toolsNoBridge.handleMoveAsset({
      fromPath: `${ROOT}/b/copy.txt`,
      toPath: `${ROOT}/c/moved.txt`,
    });
    check(
      /Refused: couldn't verify references/.test(out),
      'move-asset refuses while the bridge is down (no reference check)',
      out
    );
  }
  out = await tools.handleMoveAsset({
    fromPath: `${ROOT}/b/copy.txt`,
    toPath: `${ROOT}/c/moved.txt`,
    force: true,
  });
  if (bridged) {
    check(
      /cannot move .* through the bridge plane/.test(out) && /FOUNDRY_DATA_DIR/.test(out),
      'move-asset refuses by name on the bridge plane (FilePicker cannot move)',
      out
    );
    out = await tools.handleCopyAsset({
      fromPath: `${ROOT}/b/copy.txt`,
      toPath: `${ROOT}/c/moved.txt`,
    });
    check(/Copied/.test(out), 'copy-asset (bridge: download + upload) into a new folder', out);
  } else {
    check(/Moved/.test(out), 'move-asset (force) creates parents + moves', out);
    out = await tools.handleAssetInfo({ remotePath: `${ROOT}/b/copy.txt` });
    check(/Does not exist/.test(out), 'move-asset removed the source', out);
  }

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
    remotePath: `worlds/${worldId}/data/actors/x.db`,
  });
  check(/live LevelDB/.test(out), 'upload-asset refuses a live world-DB path', out);
  out = await tools.handleCreateAssetFolder({ remotePath: `worlds/${worldId}/data` });
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
  if (bridged) {
    const html = join(tmp, 'page.html');
    writeFileSync(html, '<p>x</p>');
    out = await tools.handleUploadAsset({ localPath: html, remotePath: `${ROOT}/a/page.html` });
    check(
      /cannot be uploaded through the bridge plane/.test(out) && /\.html/.test(out),
      'upload-asset (bridge) refuses a non-uploadable extension by name',
      out
    );
  }

  if (!bridged) {
    out = await toolsNoBridge.handleDeleteAsset({ remotePath: `${ROOT}/c/moved.txt` });
    check(
      /Refused: couldn't verify references/.test(out),
      'delete-asset refuses while the bridge is down (no reference check)',
      out
    );
  }
  out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/c/moved.txt`, force: true });
  if (bridged) {
    check(
      /cannot delete .* through the bridge plane/.test(out) && /FOUNDRY_WEBDAV_URL/.test(out),
      'delete-asset refuses by name on the bridge plane (FilePicker cannot delete)',
      out
    );
  } else {
    check(/Deleted/.test(out), 'delete-asset (force) deletes a file', out);
  }
  out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/a` });
  check(/is a directory/.test(out), 'delete-asset refuses a directory without recursive:true', out);

  // --- get-world-info reports the plane in use --------------------------------------------
  const scene = new SceneTools({ foundry, logger: quiet, host });
  const info = await scene.handleGetWorldInfo({});
  check(
    info?.host?.kind === host.kind,
    `get-world-info.host.kind = ${host.kind}`,
    JSON.stringify(info?.host)
  );
  check(
    info?.host?.files === plane.label,
    `get-world-info.host.files = ${plane.label}`,
    JSON.stringify(info?.host)
  );
  check(
    typeof info?.system?.id === 'string',
    'get-world-info still reports the world',
    JSON.stringify(info?.system)
  );

  // With the bridge up, a delete on an unreferenced file needs no force (direct plane only).
  if (!bridged) {
    await tools.handleUploadAsset({ localPath: localFile, remotePath: `${ROOT}/d/unref.txt` });
    out = await tools.handleDeleteAsset({ remotePath: `${ROOT}/d/unref.txt` });
    check(
      /Deleted/.test(out),
      'delete-asset reference-checks through the bridge and deletes an unreferenced file',
      out
    );
  }
} finally {
  const out = await cleanup.handleDeleteAsset({ remotePath: ROOT, recursive: true, force: true });
  console.log(`\ncleanup (${directHost.files.label}): ${out}`);
  rmSync(tmp, { recursive: true, force: true });
  await foundry.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
