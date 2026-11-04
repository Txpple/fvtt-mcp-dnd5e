// Run the LOCAL Foundry sandbox as a HEADLESS server — the desktop app's server code under
// plain Node, no Electron window. The full sandbox process is documented in docs/local-sandbox.md.
//
// Why: the Electron app pays for a full Chromium instance nobody looks at — the MCP bridge talks
// HTTP/WebSocket and a human who wants eyes on the world opens a browser tab. Headless is the
// same server (the install's resources/app/main.js), the same dataPath, the same port; the
// desktop app still works any time this isn't running (the two can't run together — Foundry
// holds an exclusive lock on the dataPath).
//
//   node scripts/local-foundry.mjs start [--no-world]   # boot server, then launch the world
//   node scripts/local-foundry.mjs stop [--force]       # deactivate world, then end the process
//   node scripts/local-foundry.mjs restart [--force]
//   node scripts/local-foundry.mjs status
//
// start is idempotent: already-up just reports (and still launches the world if it's sitting at
// Setup). stop refuses while users are connected (disconnect-bridge first); --force overrides.
// Crystal Ball's Seer, logged in as its own Player-role user for as long as it runs, is not a
// user to wait for: the guard asks the Seer's healthz (scripts/lib/seer.mjs; FOUNDRY_SEER_URL,
// else Foundry's origin under /crystalball, else port 30001 of its host) and discounts that one.
// Server console output appends to <dataPath>/Logs/headless-console.log.
//
// THE SEAT LOCK (src/seat-lock.ts, scripts/lib/seat-lock.mjs): start, stop and restart refuse
// while a battery or a suite holds the sandbox's GM seat, naming the holder and the suite it is
// on; `status` prints the seat (`seat: held by …` or `seat: free`) without touching Foundry, and
// is the line a session reads before any sandbox call. `--force=<pid>` goes ahead only by naming
// the holder; the bare `--force` below is stop's own flag and never this override.
//
// Crystal Ball's Seer rides along: when the module clone sits beside this repo with its seer/.env
// filled in (the suite's layout, ../fvtt-mod-crystalball/seer/.env), `start` also starts the Seer,
// exactly as it starts Foundry (a detached, windowless process, its lines in the module's
// seer/data/seer.log, its pid in <dataPath>/Logs/seer.pid), `stop` ends it before Foundry,
// `restart` does both and `status` shows it. One already answering healthz is left alone and said
// so. Nothing restarts it by itself: a crash or a reboot needs a `start`, as Foundry does. No
// seer/.env there: one line says so and Foundry runs alone. The same code runs on Linux.
//
// The v14 admin API contract (read from resources/app/dist, 2026-08-21 — do not "improve" this
// back to cookies):
//   - sessions.authenticateAdmin reads `adminPassword` from the REQUEST BODY on every route it
//     guards, so admin posts are stateless JSON — no /auth login, no session cookie to carry.
//     Since 14.368 every POST must also look same-origin (Origin header = server origin).
//   - Launching: POST /setup {action:"launchWorld", world, adminPassword}. The /setup action
//     switch only exists while NO world is active (with one running, every action 403s
//     "You lack server administrator permission" no matter who you are).
//   - Stopping a world (14.368, re-read from dist/server/views/setup.mjs 2026-09-20): POST /setup
//     {action:"worldShutdown", adminPassword} — the ONE /setup action that exists while a world IS
//     active. It runs world.deactivate (db.disconnect + world.save — the flush that matters) and
//     answers a 302 to /setup (so post with redirect:'manual' and poll /api/status). The old
//     POST /join {action:"shutdown"} route is gone: the join view now handles only join/loginAs
//     and answers {} to anything else — a silent no-op, which is how it was found. Without an
//     admin password the route falls back to "is this session a GM"; ours is stateless JSON, so
//     FOUNDRY_ADMIN_KEY stays required kit.
//   - There is NO process-exit route in v14; the desktop app quits via its Electron shell. So
//     `stop` deactivates the world first, then terminates the Setup-idle node process. A killed
//     process leaves Config/options.json.lock behind; Foundry treats it as stale after ~10s
//     (mtime-based), so `start` retries once when it hits the lock error.
//
// Config is the `local` host's, through the one env selector (src/hosts/env.ts; the 2.x LOCAL_* names
// are read as aliases): FOUNDRY_DATA_DIR (the Data dir; its parent is the Foundry --dataPath),
// FOUNDRY_URL (default http://localhost:30000), FOUNDRY_ADMIN_KEY (required — see above), the
// world id from FOUNDRY_WORLD_ID or, unset, the ONE world under Data/worlds (several = a refusal
// naming them), and optionally FOUNDRY_APP (alias LOCAL_FOUNDRY_APP) to override the default app
// install path (on Windows the first of Program Files and %LOCALAPPDATA%\Programs that has
// it). `start` exits non-zero unless it leaves a world active (or --no-world). --adminPassword is passed at boot so Foundry (re)writes Config/admin.txt itself
// and the installed hash can never drift from .env.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../dist/env.js';
import { resolveHostConfig } from '../dist/hosts/index.js';
import { foundryApp } from './lib/foundry-app.mjs';
import { seatGuard, seatStatusLines } from './lib/seat-lock.mjs';
import { discountSeer, seerUser } from './lib/seer.mjs';

const env = loadEnv();
const HOST = resolveHostConfig(env, 'local');

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');
const noWorld = args.includes('--no-world');

// Failures throw (caught at the bottom) rather than process.exit(): exiting hard with live
// fetch sockets trips a libuv teardown assertion on Windows (observed on Node 24).
class Fail extends Error {}
function die(msg) {
  throw new Fail(msg);
}

const dataRoot = HOST.dataDir ?? '';
if (!dataRoot) die("FOUNDRY_DATA_DIR missing from .env (the local install's Data/ directory)");
const dataPath = dirname(dataRoot); // .../FoundryVTT/Data -> .../FoundryVTT (what --dataPath wants)
const baseUrl = HOST.serverUrl.replace(/\/+$/, '');
const adminKey = HOST.adminKey ?? '';
const app = foundryApp(env);
const appMain = app.main;

/**
 * The world to launch: FOUNDRY_WORLD_ID, else the one world under Data/worlds — the same rule
 * the bridge applies on /setup, read off the disk because this launcher is HTTP-only.
 */
function discoverWorldId() {
  if (HOST.worldId) return HOST.worldId;
  let ids = [];
  try {
    ids = readdirSync(join(dataRoot, 'worlds'), { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(dataRoot, 'worlds', d.name, 'world.json')))
      .map(d => d.name);
  } catch {
    return '';
  }
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    die(`Data/worlds holds ${ids.length} worlds (${ids.join(', ')}) — set FOUNDRY_WORLD_ID`);
  }
  return '';
}
const worldId = discoverWorldId();
const logsDir = join(dataPath, 'Logs');
const consoleLog = join(logsDir, 'headless-console.log');
const pidFile = join(logsDir, 'headless.pid');

function readPid(file = pidFile) {
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearPid(file = pidFile) {
  try {
    unlinkSync(file);
  } catch {}
}

// ---------------------------------------------------------------------------------------------
// Crystal Ball's Seer beside Foundry (see the header): the module clone next to this repo.
// ---------------------------------------------------------------------------------------------
const seerRepo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fvtt-mod-crystalball'
);
const seerEnvFile = join(seerRepo, 'seer', '.env');
const seerLog = join(seerRepo, 'seer', 'data', 'seer.log');
const seerPidFile = join(logsDir, 'seer.pid');

/** Where the Seer beside this Foundry answers healthz, from its own .env (PORT, BASE_PATH). */
function seerHealthz() {
  const e = loadEnv(seerEnvFile);
  const port = Number(e.PORT || 30001);
  const base = (e.BASE_PATH ?? '/crystalball').replace(/\/+$/, '');
  return `http://127.0.0.1:${port}${base}/healthz`;
}

/** The Seer's healthz body, or null when nothing answers there. */
async function seerHealth(timeoutMs = 3000) {
  try {
    const res = await fetch(seerHealthz(), { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The Seer's recorded pid while that process is alive; a dead pid is a stale file, and goes. */
function seerPid() {
  const pid = readPid(seerPidFile);
  if (!pid) return null;
  if (pidAlive(pid)) return pid;
  clearPid(seerPidFile);
  return null;
}

function seerLogTail(lines = 12) {
  try {
    return readFileSync(seerLog, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
  } catch {
    return '(no seer log)';
  }
}

/** One line on the Seer for `status` and after `start`. */
async function printSeerStatus() {
  if (!existsSync(seerEnvFile)) {
    console.log('seer:    none (no fvtt-mod-crystalball/seer/.env beside this repo)');
    return;
  }
  const pid = seerPid();
  const up = await seerHealth();
  const who = pid ? ` (pid ${pid})` : ' (started outside this launcher)';
  console.log(
    up
      ? `seer:    up, ${up.version} at ${seerHealthz()}, foundry ${up.foundry?.connected ? `connected to ${up.foundry.world}` : 'not connected'}${who}`
      : `seer:    down${pid ? ` (pid ${pid} alive, not answering)` : ''}`
  );
}

/** Start the Seer as Foundry is started: detached, windowless, its lines to its log, its pid kept. */
async function startSeer() {
  if (!existsSync(seerEnvFile)) {
    console.log(
      'seer:    none (no fvtt-mod-crystalball/seer/.env beside this repo) — Foundry runs alone.'
    );
    return;
  }
  if (await seerHealth()) {
    await printSeerStatus();
    return;
  }
  mkdirSync(dirname(seerLog), { recursive: true });
  // One log per start; the last run's is kept as .1.
  if (existsSync(seerLog)) {
    try {
      renameSync(seerLog, `${seerLog}.1`);
    } catch {}
  }
  const fd = openSync(seerLog, 'a');
  writeFileSync(
    fd,
    `${new Date().toISOString()} INFO launcher: starting the Seer from ${seerRepo}\n`
  );
  const child = spawn(process.execPath, ['--env-file=seer/.env', 'seer/src/main.js'], {
    cwd: seerRepo,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  closeSync(fd);
  writeFileSync(seerPidFile, String(child.pid));
  console.log(`spawned the Seer (pid ${child.pid}), waiting for ${seerHealthz()}…`);
  const health = await poll(() => seerHealth(1500), 20_000, 1000);
  if (!health) {
    const hint = pidAlive(child.pid) ? 'process is alive but not answering' : 'process exited';
    clearPid(seerPidFile);
    die(`the Seer did not answer within 20s (${hint}) — tail of its log:\n${seerLogTail()}`);
  }
  await printSeerStatus();
}

/**
 * End the Seer this launcher started: only a recorded pid that is alive while healthz answers, and
 * only that process. One started elsewhere (a terminal's `npm run seer:dev`) is left alone and named.
 */
async function stopSeer() {
  if (!existsSync(seerEnvFile)) return;
  const pid = seerPid();
  const up = await seerHealth();
  if (!pid) {
    if (up)
      console.log(
        `seer:    answering at ${seerHealthz()} but not started by this launcher — leaving it.`
      );
    else console.log('seer:    not running.');
    return;
  }
  if (!up) {
    console.log(
      `seer:    pid ${pid} is alive but ${seerHealthz()} does not answer — leaving it; see ${seerLog}`
    );
    return;
  }
  console.log(`ending the Seer (pid ${pid})…`);
  try {
    process.kill(pid);
  } catch {}
  const gone = await poll(
    async () => (!pidAlive(pid) && (await seerHealth(1000)) === null ? true : null),
    15_000,
    1000
  );
  if (!gone) {
    die(
      pidAlive(pid)
        ? `the Seer (pid ${pid}) would not exit — investigate`
        : `pid ${pid} is gone but ${seerHealthz()} still answers — another Seer is up; investigate`
    );
  }
  clearPid(seerPidFile);
  console.log('seer:    stopped.');
}

function logTail(lines = 25) {
  try {
    return readFileSync(consoleLog, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
  } catch {
    return '(no console log)';
  }
}

async function apiStatus(timeoutMs = 3000) {
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** The users to wait for, Crystal Ball's Seer discounted: `{ users, note }`. */
async function connected(status) {
  const seer = await seerUser(baseUrl, env.FOUNDRY_SEER_URL);
  return discountSeer(status, seer);
}

async function connectedNote(status) {
  return (await connected(status)).note;
}

async function poll(check, deadlineMs, intervalMs = 2000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    // Foundry 14.368+ rejects every POST whose Sec-Fetch-Site is not same-origin and whose
    // Origin does not match the server's own origin (400 "The request could not be processed.").
    // Node's fetch sends neither, so state the origin explicitly.
    headers: { 'Content-Type': 'application/json', Origin: new URL(baseUrl).origin },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return { status: res.status, payload, location: res.headers.get('location') };
}

function requireAdminKey() {
  if (!adminKey) die('FOUNDRY_ADMIN_KEY missing from .env — launch/stop are admin-gated');
}

async function printStatus(status) {
  if (!status) {
    console.log(`server:  down (${baseUrl})`);
    return;
  }
  console.log(`server:  up (${baseUrl}) — Foundry v${status.version ?? '?'}`);
  console.log(
    status.active
      ? `world:   ACTIVE — ${status.world ?? worldId} (${status.system ?? '?'} ${status.systemVersion ?? ''})`.trimEnd()
      : 'world:   none (Setup screen)'
  );
  if (status.users !== undefined) console.log(`users:   ${await connectedNote(status)}`);
}

async function launchWorld() {
  if (!worldId) die('no world id — no world under Data/worlds; set FOUNDRY_WORLD_ID');
  requireAdminKey();
  console.log(`launching world "${worldId}"…`);
  const { status, payload } = await postJson('/setup', {
    action: 'launchWorld',
    world: worldId,
    adminPassword: adminKey,
  });
  if (status === 403 || payload?.error)
    die(`launchWorld refused: HTTP ${status} ${JSON.stringify(payload)}`);
  const active = await poll(
    async () => {
      const s = await apiStatus();
      return s?.active ? s : null;
    },
    150_000,
    3000
  );
  if (!active) die(`world did not become active within 150s — tail of server log:\n${logTail()}`);
  return active;
}

function spawnServer() {
  mkdirSync(logsDir, { recursive: true });
  const fd = openSync(consoleLog, 'a');
  writeFileSync(fd, `\n===== headless start ${new Date().toISOString()} =====\n`);
  const serverArgs = [appMain, `--dataPath=${dataPath}`];
  if (adminKey) serverArgs.push(`--adminPassword=${adminKey}`);
  // cwd: the data folder, never the caller's. A server started from inside a repo pins that folder for
  // its whole life (Windows refuses to rename a directory a process is in), which blocked the
  // 2026-10-11 rename of Battle Flow's clone until the server was stopped.
  const child = spawn(process.execPath, serverArgs, {
    cwd: dataPath,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`spawned headless server (pid ${child.pid}), waiting for ${baseUrl}…`);
  return child.pid;
}

async function start() {
  let status = await apiStatus();
  if (status) {
    console.log('already running.');
  } else {
    if (!app.found) {
      die(`Foundry app not found (tried ${app.tried.join(', ')}) — set FOUNDRY_APP in .env`);
    }
    if (!existsSync(dataRoot)) die(`local Data dir not found: ${dataRoot}`);
    let pid = spawnServer();
    status = await poll(apiStatus, 60_000);
    if (!status && !pidAlive(pid) && logTail(4).includes('already locked')) {
      // A killed predecessor's options.json.lock goes stale after ~10s — wait it out, once.
      console.log('dataPath lock from a dead process — waiting 12s for it to go stale…');
      await new Promise(r => setTimeout(r, 12_000));
      pid = spawnServer();
      status = await poll(apiStatus, 60_000);
    }
    if (!status) {
      const hint = pidAlive(pid) ? 'process is alive but not answering' : 'process exited';
      clearPid();
      die(`server did not come up within 60s (${hint}) — tail of server log:\n${logTail()}`);
    }
  }
  if (!status.active && !noWorld) status = await launchWorld();
  await printStatus(status);
  // `start` promises a live world (unless --no-world): anything less is a failure for the caller.
  if (!status?.active && !noWorld) die('the world is not active — see the lines above');
  await startSeer();
}

async function stop() {
  const status = await apiStatus();
  const pid = readPid();
  if (!status) {
    await stopSeer();
    if (pidAlive(pid)) console.log(`port quiet but pid ${pid} alive — leaving it; check manually.`);
    else {
      clearPid();
      console.log('not running.');
    }
    return;
  }
  if (status.active) {
    const { users, note } = await connected(status);
    if (users > 0 && !force)
      die(`${note} — disconnect-bridge / check no human is mid-session, or --force`);
  }
  await stopSeer();
  if (status.active) {
    requireAdminKey();
    console.log('deactivating world…');
    const {
      status: http,
      payload,
      location,
    } = await postJson('/setup', {
      action: 'worldShutdown',
      adminPassword: adminKey,
    });
    // Success is the redirect back to the setup screen; a JSON body means it was refused.
    if (http !== 302 || !(location ?? '').endsWith('/setup'))
      die(`world shutdown refused: HTTP ${http} ${JSON.stringify(payload)}`);
    const idle = await poll(
      async () => {
        const s = await apiStatus(1500);
        return s && !s.active ? s : null;
      },
      30_000,
      1500
    );
    if (!idle) die('world still active 30s after successful shutdown — investigate');
  }
  // World DB is disconnected and saved (deactivate did the flush); v14 has no process-exit
  // route, so ending the Setup-idle process is the intended exit.
  if (pidAlive(pid)) {
    console.log(`ending server process (pid ${pid})…`);
    try {
      process.kill(pid);
    } catch {}
    await poll(async () => !pidAlive(pid), 15_000, 1000);
    if (pidAlive(pid)) {
      if (!force) die(`pid ${pid} would not exit — retry with --force for taskkill /F`);
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    }
  } else {
    console.log(
      'no tracked pid (server started outside this launcher?) — world deactivated; the process is still up.'
    );
    if (!force)
      die(
        'refusing to guess which process to end — close it yourself, or --force after setting a pid file'
      );
  }
  const gone = await poll(
    async () => ((await apiStatus(1500)) === null ? true : null),
    15_000,
    1500
  );
  if (!gone) die('port still answering after process end — investigate');
  clearPid();
  console.log('stopped.');
}

/** The seat lock, before anything that joins or bounces the sandbox: a refusal names the holder. */
async function requireSeat() {
  const seat = await seatGuard(baseUrl, { who: `local-foundry ${command}` });
  if (!seat.ok) die(seat.refusal);
  if (seat.over) {
    console.warn(
      `⚠ --force=${seat.over.pid}: going ahead over the seat's holder (${seat.over.kind} ${seat.over.name}, since ${seat.over.since})`
    );
  }
}

try {
  switch (command) {
    case 'start':
      await requireSeat();
      await start();
      break;
    case 'stop':
      await requireSeat();
      await stop();
      break;
    case 'restart':
      await requireSeat();
      await stop();
      await start();
      break;
    case 'status': {
      const status = await apiStatus();
      await printStatus(status);
      const pid = readPid();
      if (pid) console.log(`pid:     ${pid}${pidAlive(pid) ? '' : ' (stale)'}`);
      await printSeerStatus();
      for (const line of seatStatusLines(baseUrl)) console.log(line);
      break;
    }
    default:
      console.error(
        'usage: node scripts/local-foundry.mjs <start [--no-world] | stop [--force] | restart | status> [--force=<pid of the seat holder>]'
      );
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Fail ? `✗ ${err.message}` : err);
  process.exitCode = 1;
}
