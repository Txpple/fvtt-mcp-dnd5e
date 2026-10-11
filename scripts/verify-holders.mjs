// Live verify for the seat records' eviction (issue #17): two bridges hold one seat, and
// disconnect-bridge { "all": true } from one (the tool class) ends the other's browser by its
// recorded pid and executable, and names it; a record whose pid runs another program is left
// alone; both bridges' next calls re-join on their own.
//   FOUNDRY_HOST=local node scripts/verify-holders.mjs
// Bridge A runs in this process, bridge B in a forked child (a seat record is per process); both
// join as the bridge user and both leave in finally. A decoy (a sleeping node process) stands in
// for a reused pid. No world document is touched. Needs a built dist/.
import { fork, spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectFoundry, quietLogger } from '../dist/client.js';
import { holderRecord, isAlive, removeHolder, writeHolder } from '../dist/holders.js';
import { BridgeTools } from '../dist/tools/bridge.js';

const WATCHDOG_MS = 300_000;

if (process.argv.includes('--child')) {
  // Bridge B: connect, say so, then answer the parent over IPC.
  process.env.FOUNDRY_BRIDGE_LABEL = 'verify-holders B';
  const { f, dispose } = await connectFoundry({
    identity: 'bridge',
    tag: 'verify-holders B',
    watchdogMs: WATCHDOG_MS,
    announce: false,
  });
  process.on('message', async msg => {
    if (msg === 'state') {
      process.send({ ready: f.isReady() });
    } else if (msg === 'call') {
      const t = Date.now();
      try {
        const info = await f.call('getWorldInfo');
        process.send({ ok: typeof info?.id === 'string', ready: f.isReady(), ms: Date.now() - t });
      } catch (e) {
        process.send({ ok: false, error: e.message, ms: Date.now() - t });
      }
    } else if (msg === 'exit') {
      await dispose();
      process.send({ bye: true });
      process.exit(0);
    }
  });
  process.send({ up: true, pid: process.pid });
} else {
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok });
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
  };
  const poll = async (fn, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await fn()) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return !!(await fn());
  };

  process.env.FOUNDRY_BRIDGE_LABEL = 'verify-holders A';
  const child = fork(fileURLToPath(import.meta.url), ['--child'], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let childExited = false;
  child.on('exit', () => {
    childExited = true;
  });
  const ask = (msg, ms = 120_000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`B did not answer "${msg}"`)), ms);
      child.once('message', m => {
        clearTimeout(timer);
        resolve(m);
      });
      child.send(msg);
    });
  const up = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', code => reject(new Error(`B exited (${code}) before it joined`)));
  });

  // The decoy: a live process with a pid, running node, not a browser.
  const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
    stdio: 'ignore',
  });
  let A = null;
  let seat = null;
  try {
    A = await connectFoundry({
      identity: 'bridge',
      tag: 'verify-holders A',
      watchdogMs: WATCHDOG_MS,
    });
    const { f } = A;

    // 1. Both records name their browser.
    const me = f.holders().find(h => h.self);
    seat = me ? { serverUrl: me.serverUrl, user: me.user } : null;
    const b = f.holders().find(h => !h.self && h.pid === up.pid);
    check('A lists B as another holder of the seat', !!b, b ? `pid ${b.pid}, ${b.label}` : '');
    const named = h =>
      Number.isInteger(h?.browserPid) &&
      h.browserPid > 0 &&
      typeof h.browserExe === 'string' &&
      /headless|chrom/i.test(basename(h.browserExe));
    check(
      'each record names its browser by pid and executable',
      named(b) && named(me) && b.browserPid !== me.browserPid,
      `A ${me?.browserPid} ${basename(me?.browserExe ?? '?')}, B ${b?.browserPid} ${basename(b?.browserExe ?? '?')}`
    );

    // 2. A stale record whose pid now runs another program (the decoy), as after a pid reuse.
    writeHolder({
      ...holderRecord(seat.serverUrl, seat.user, { FOUNDRY_BRIDGE_LABEL: 'verify-holders decoy' }),
      pid: decoy.pid,
      browserPid: decoy.pid,
      browserExe: b?.browserExe ?? null,
    });
    check(
      'the decoy record is listed beside B',
      f.holders().some(h => h.pid === decoy.pid && !h.self)
    );

    // 3. disconnect-bridge { "all": true } from A, through the tool: A logs out, then every other
    // holder is evicted and named.
    const tool = new BridgeTools({ foundry: f, logger: quietLogger() });
    const text = await tool.handleDisconnectBridge({ all: true });
    const lineOf = pid => text.split('\n').find(l => l.includes(`pid ${pid} on `)) ?? '';
    // Echoed with the machine's name masked, so the output can be pasted into a public issue.
    console.log(
      text.replaceAll(` on ${hostname()} — `, ' on <host> — ').replace(/^/gm, '      | ')
    );
    check(
      'disconnect-bridge names B and the browser pid it ended',
      text.includes('Ended 1 of 2 other holder(s)') &&
        lineOf(up.pid).includes('verify-holders B') &&
        lineOf(up.pid).endsWith(`browser pid ${b?.browserPid} ended`)
    );
    check(
      'disconnect-bridge leaves the decoy alone and says why',
      /left pid \d+ alone \(it now runs another program/.test(lineOf(decoy.pid)) &&
        isAlive(decoy.pid)
    );
    check(
      "B's browser process is gone",
      await poll(() => !isAlive(b?.browserPid ?? -1), 10_000),
      `pid ${b?.browserPid}`
    );
    check(
      "every record is cleared: B's and the decoy's by the eviction, A's by its logout",
      !f.holders().some(h => h.pid === up.pid || h.pid === decoy.pid || h.self)
    );

    // 4. B notices, and its next call re-joins on its own; so does A's.
    const state = await ask('state');
    check("B's bridge is no longer ready", state.ready === false);
    const call = await ask('call');
    check(
      "B's next call re-joins with a new browser and answers",
      call.ok === true && call.ready === true,
      `${call.ms} ms${call.error ? `: ${call.error}` : ''}`
    );
    const b2 = f.holders().find(h => !h.self && h.pid === up.pid);
    check(
      'B is recorded again, with its new browser',
      named(b2) && b2.browserPid !== b?.browserPid,
      `pid ${b2?.browserPid}`
    );
    const info = await f.call('getWorldInfo').catch(e => ({ error: e.message }));
    check(
      "A's next call reconnects after its own logout",
      typeof info?.id === 'string' && f.isReady(),
      info?.error ?? ''
    );
  } finally {
    if (seat) removeHolder({ ...seat, pid: decoy.pid });
    decoy.kill();
    if (!childExited) await ask('exit', 30_000).catch(e => console.log(`B: ${e.message}`));
    await A?.dispose();
  }
  const passed = checks.filter(c => c.ok).length;
  console.log(`\n[verify-holders] ${passed}/${checks.length}`);
  process.exit(passed === checks.length ? 0 : 1);
}
