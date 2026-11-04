// The seat lock for the sandbox scripts (src/seat-lock.ts): before a script joins, bounces,
// installs on, deploys to or re-images a Foundry instance, it asks who holds that instance's GM
// seat — a battery or a suite in another session — and refuses while someone does, naming them.
// `--force=<pid>` goes ahead only when it names the holder; a bare `--force` is each script's own
// flag and never this override. Shared by local-foundry.mjs (start / stop / restart, and the Seer
// `start` brings up), register-module.mjs, deploy-house-module.mjs and pull-prod-to-local.mjs.
// By namespace: a dist/ built before the seat lock lacks these names, and a script must still run
// then (with no guard, and a line saying so) rather than fail at import.
import * as mcp from '../../dist/client.js';

const BUILT = typeof mcp.seatHeldBy === 'function';
const UNBUILT = 'the seat lock is not in dist/ (npm run build) — no seat read';

/**
 * `{ ok: true, over }` — the seat is free, or `--force=<pid>` named its holder (`over`, to say so);
 * `{ ok: false, refusal }` — held by another process, the refusal text ready to print.
 * @param {string} serverUrl  the instance's base URL (the lock's key)
 * @param {{ who: string, argv?: string[] }} opts  who is asking (`the installer`), and the argv `--force=` is read from
 */
export async function seatGuard(serverUrl, { who, argv = process.argv.slice(2) }) {
  if (!BUILT) {
    console.warn(`⚠ ${UNBUILT}`);
    return { ok: true, over: null };
  }
  const held = await mcp.seatHeldBy(serverUrl);
  if (!held) return { ok: true, over: null };
  const force = mcp.forceOf(argv);
  if (force === held.pid) return { ok: true, over: held };
  return { ok: false, refusal: mcp.seatRefusal(held, { who, force }) };
}

/** One `seat:` line for a status: the lock on `serverUrl`, or `free`, plus any other instance's lock on this machine. */
export function seatStatusLines(serverUrl) {
  if (!BUILT) return [`seat:    unknown (${UNBUILT})`];
  const { describeSeatLock, listSeatLocks } = mcp;
  const key = serverUrl.replace(/\/+$/, '');
  const locks = listSeatLocks();
  const here = locks.find(l => l.serverUrl === key);
  const lines = [
    `seat:    ${here ? `held by ${describeSeatLock(here)}` : 'free (no battery or suite holds it)'}`,
  ];
  for (const l of locks) {
    if (l !== here)
      lines.push(`seat:    (another instance, ${l.serverUrl}) held by ${describeSeatLock(l)}`);
  }
  return lines;
}
