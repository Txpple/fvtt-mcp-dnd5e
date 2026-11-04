// THE SEAT LOCK — one process at a time on a Foundry instance, and the file that says who.
//
// Why (2026-11-04): a battery against the sandbox is one GM-capable client for close to an hour,
// and every suite's preflight demands exactly one. That day a sibling session's bridge joined the
// sandbox mid-run for one call and the preflight refused every suite after it (~45 reruns); the
// seat records (src/holders.ts) name who holds the BRIDGE user, but nothing said "a battery owns
// this instance, stay out", and a battery running in another session's background looked like
// nothing at all. Two minor fixes cost most of a day.
//
// The lock is one file per instance under the OS temp dir, keyed by server URL: who holds it (pid,
// the program under that pid, the Claude Code session), what it runs (a battery, a suite, with its
// argv) and, kept current by the holder, where it is (the suite now running, row n of m, the run
// directory) — so the file doubles as the status another session reads before it touches the
// sandbox. A lock whose pid is dead, or now runs another program, is stale: taken over and said so.
//
// Who checks it: the bridge's connect (src/foundry.ts — a session's MCP server, the scribe, a
// verify script, anything on `Foundry`) and the sandbox scripts (`local-foundry.mjs` start / stop /
// restart and the Seer it starts, the installer, the deploy, the mirror) through
// scripts/lib/seat-lock.mjs. Who takes it: By the Books' battery and its harness (tools/battery.mjs,
// tools/harness.mjs). A process the holder spawned rides along: the holder puts its pid in
// FVTT_SEAT_HOLDER, the children inherit it, and a lock held by that pid is their own. A refusal
// names the holder, and `--force=<pid>` overrides it only by naming that pid; the bridge takes no
// override at all.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { exeOf, isAlive, sessionLabel } from './holders.js';

/** The environment variable a holder sets for the processes it spawns: its own pid. */
export const SEAT_HOLDER_ENV = 'FVTT_SEAT_HOLDER';

/** Where the holder is, kept current by the holder (a battery writes it as each row starts). */
export interface SeatStatus {
  /** The suite (or step) running now. */
  suite: string;
  /** Its row in the plan, 1-based, and the plan's length. */
  row: number;
  of: number;
  /** The run directory, relative to the holder's cwd (a battery's `dist/battery/<id>`). */
  runDir?: string | null;
  /** When this status was written. */
  at: string;
}

export interface SeatLockRecord {
  pid: number;
  ppid: number;
  host: string;
  /** The program under `pid` when the lock was taken (`process.execPath`): a reused pid is told by it. */
  exe: string;
  /** What to call the holder: FOUNDRY_BRIDGE_LABEL, else the Claude Code session, else the pid. */
  label: string;
  session: string | null;
  serverUrl: string;
  /** `battery`, `suite`, `job` … — what kind of thing holds the seat. */
  kind: string;
  /** Its name: `battery`, a suite's tag (`saves`). */
  name: string;
  /** The command line, relative to `cwd`, so a reader knows what was started. */
  argv: string[];
  cwd: string;
  since: string;
  status: SeatStatus | null;
}

export interface SeatLock extends SeatLockRecord {
  file: string;
  /** This process holds it, or the process that spawned this one does (FVTT_SEAT_HOLDER names it). */
  own: boolean;
}

/** The lock a taker found held by another live process and did not force. */
export class SeatHeldError extends Error {
  readonly lock: SeatLock;
  constructor(lock: SeatLock, message: string) {
    super(message);
    this.name = 'SeatHeldError';
    this.lock = lock;
  }
}

/** Where the locks live: one directory per machine, beside the seat records. */
export function seatLockDir(): string {
  return join(tmpdir(), 'fvtt-mcp-dnd5e', 'seat-lock');
}

/** One lock per instance: the file is named by its server URL. */
export function seatLockKey(serverUrl: string): string {
  return createHash('sha1').update(serverUrl.replace(/\/+$/, '')).digest('hex').slice(0, 12);
}

export function seatLockFile(serverUrl: string, dir: string = seatLockDir()): string {
  return join(dir, `${seatLockKey(serverUrl)}.json`);
}

/** The pid FVTT_SEAT_HOLDER names in `env`, when it names one. */
export function seatHolderOf(env: NodeJS.ProcessEnv = process.env): number | null {
  const pid = Number.parseInt(env[SEAT_HOLDER_ENV] ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Whether `lock` is this process's own, or the holder spawned this process. */
export function ownsSeat(
  lock: Pick<SeatLockRecord, 'pid'>,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return lock.pid === process.pid || lock.pid === seatHolderOf(env);
}

/** A record for this process, before it is written; `argv` is `process.argv` without the node path. */
export function seatLockRecord(
  opts: { serverUrl: string; kind: string; name: string },
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): SeatLockRecord {
  const { session, label } = sessionLabel(env);
  const cwd = process.cwd();
  const argv = process.argv.slice(1).map(a => {
    if (a.startsWith('-') || /:\/\//.test(a)) return a;
    const rel = relative(cwd, a);
    const inside = rel && !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel);
    return inside ? rel.split('\\').join('/') : a;
  });
  return {
    pid: process.pid,
    ppid: process.ppid,
    host: hostname(),
    exe: process.execPath,
    label,
    session,
    serverUrl: opts.serverUrl.replace(/\/+$/, ''),
    kind: opts.kind,
    name: opts.name,
    argv,
    cwd,
    since: now.toISOString(),
    status: null,
  };
}

/** One lock file as a record; null when there is none, or it is unreadable (then it goes). */
function readRecord(file: string): SeatLockRecord | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const rec = JSON.parse(text) as SeatLockRecord;
    if (!Number.isInteger(rec?.pid) || typeof rec.serverUrl !== 'string') throw new Error('shape');
    return rec;
  } catch {
    rmSync(file, { force: true });
    return null;
  }
}

/** How a lock is read; every field defaults to the real thing, so a test injects it. */
export interface SeatReadOptions {
  dir?: string;
  env?: NodeJS.ProcessEnv;
  alive?: (pid: number) => boolean;
  /** The program under a pid, or null when unknown; another program than the recorded one is a stale lock. */
  exe?: (pid: number) => Promise<string | null>;
}

/** Windows paths compare without case; elsewhere exactly. */
function sameExe(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The lock on `serverUrl`, read without asking the OS what runs under its pid: a live pid is a
 * live lock. Synchronous, for a status line; `seatHeldBy` is the reading a decision rests on.
 * A dead holder's file is removed as it is read. Null when the seat is free.
 */
export function readSeatLock(serverUrl: string, opts: SeatReadOptions = {}): SeatLock | null {
  const { dir = seatLockDir(), env = process.env, alive = isAlive } = opts;
  const file = seatLockFile(serverUrl, dir);
  const rec = readRecord(file);
  if (!rec) return null;
  if (!alive(rec.pid)) {
    rmSync(file, { force: true });
    return null;
  }
  return { ...rec, file, own: ownsSeat(rec, env) };
}

/** Every live lock on this machine, whatever the instance, oldest first: a status names them all. */
export function listSeatLocks(opts: SeatReadOptions = {}): SeatLock[] {
  const { dir = seatLockDir(), env = process.env, alive = isAlive } = opts;
  let names: string[];
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SeatLock[] = [];
  for (const name of names) {
    const file = join(dir, name);
    const rec = readRecord(file);
    if (!rec) continue;
    if (!alive(rec.pid)) {
      rmSync(file, { force: true });
      continue;
    }
    out.push({ ...rec, file, own: ownsSeat(rec, env) });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

/**
 * The lock a process must respect before it joins `serverUrl`: held by a live process that is
 * not this one and did not spawn it, and whose pid still runs the program that took it (a pid
 * reused by another program is a stale lock, removed here; a lookup that cannot answer trusts
 * the pid). Null when the seat is free or the lock is this process's own.
 */
export async function seatHeldBy(
  serverUrl: string,
  opts: SeatReadOptions = {}
): Promise<SeatLock | null> {
  const lock = readSeatLock(serverUrl, opts);
  if (!lock || lock.own) return null;
  const exe = opts.exe ?? exeOf;
  const live = await exe(lock.pid);
  if (live !== null && lock.exe && !sameExe(live, lock.exe)) {
    rmSync(lock.file, { force: true });
    return null;
  }
  return lock;
}

/** The holder in one line a reader can act on: what it is, who started it, where it is. */
export function describeSeatLock(lock: SeatLockRecord): string {
  const what = lock.kind === 'battery' ? 'a battery' : `a ${lock.kind} run by hand (${lock.name})`;
  const cmd = lock.argv.join(' ');
  const where = lock.status
    ? `, now running ${lock.status.suite} (row ${lock.status.row} of ${lock.status.of}${
        lock.status.runDir ? `, run ${basename(lock.status.runDir)}` : ''
      })`
    : '';
  return (
    `${what} — pid ${lock.pid} on ${lock.host} — ${lock.label} — since ${lock.since}` +
    `${where}; started as \`${cmd.length > 160 ? `${cmd.slice(0, 157)}…` : cmd}\` in ${lock.cwd}`
  );
}

/**
 * The refusal, whole: who is refused, who holds the seat, how to wait, and the override — `force`
 * undefined when the caller takes none (the bridge), null when `--force=<pid>` was not given, a
 * number when it named a pid that is not the holder's.
 */
export function seatRefusal(
  lock: SeatLockRecord,
  { who = 'this process', force }: { who?: string; force?: number | null } = {}
): string {
  const lines = [
    `${who} cannot join ${lock.serverUrl}: its GM seat is held by ${describeSeatLock(lock)}.`,
    'Wait for it (`node tools/battery-status.mjs` in fvtt-mod-bythebooks draws its bar; ' +
      '`node scripts/local-foundry.mjs status` in fvtt-mcp-dnd5e shows the seat), or end that process.',
  ];
  if (force === undefined) {
    lines.push(
      'There is no override here: a client that joins mid-run is what the lock exists to stop.'
    );
  } else if (force === null) {
    lines.push(`To go ahead anyway, name the holder: --force=${lock.pid}.`);
  } else {
    lines.push(
      `--force=${force} names another process; the holder is pid ${lock.pid}, and --force=${lock.pid} is the override.`
    );
  }
  return lines.join('\n');
}

/** `--force=<pid>` off an argv: the pid, or null when absent or not a pid (a bare `--force` is not this). */
export function forceOf(argv: string[]): number | null {
  for (const a of argv) {
    const m = /^--force=(\d+)$/.exec(a);
    if (m) return Number(m[1]);
  }
  return null;
}

/** What `takeSeatLock` did: the lock written, and the live or dead lock it replaced, if any. */
export interface SeatTaken {
  lock: SeatLockRecord;
  file: string;
  /** The live lock `--force=<pid>` overrode, or null. */
  forced: SeatLock | null;
  /** The dead holder's lock taken over, or null. */
  stale: SeatLockRecord | null;
  release: () => void;
}

export interface SeatTakeOptions extends SeatReadOptions {
  /** `--force=<pid>`: override a live lock, only when it names the holder's pid. */
  force?: number | null;
}

/**
 * Take the lock on `serverUrl` for this process. Held by a live process that is not ours and not
 * forced by its own pid: a `SeatHeldError` carrying the lock (its message is the refusal). Held by
 * this process already, or by the process that spawned this one: nothing is written and
 * `{ rideAlong }` answers, so a suite under the battery never takes its parent's lock. A dead
 * holder's lock is taken over and answered as `stale`. The taker sets FVTT_SEAT_HOLDER for what it
 * spawns and releases on exit, SIGINT, SIGTERM and SIGHUP (a lock that outlives a hard kill is
 * stale by its pid).
 */
export async function takeSeatLock(
  opts: { serverUrl: string; kind: string; name: string; who?: string },
  take: SeatTakeOptions = {}
): Promise<SeatTaken | { rideAlong: SeatLock }> {
  const { dir = seatLockDir(), env = process.env, force = null, alive = isAlive } = take;
  const file = seatLockFile(opts.serverUrl, dir);
  // The file as it stands, before a read prunes a dead holder's: that one is reported as taken over.
  const raw = readRecord(file);
  let forced: SeatLock | null = null;
  let stale: SeatLockRecord | null = null;
  if (raw && !alive(raw.pid)) stale = raw;
  else if (raw && ownsSeat(raw, env)) return { rideAlong: { ...raw, file, own: true } };
  else if (raw) {
    const held = await seatHeldBy(opts.serverUrl, take);
    if (held && force !== held.pid) {
      const who = opts.who ?? `this ${opts.kind}`;
      throw new SeatHeldError(held, seatRefusal(held, { who, force }));
    }
    // A pid that now runs another program is a stale lock, as `seatHeldBy` read it.
    if (held) forced = held;
    else stale = raw;
  }
  const rec = seatLockRecord(opts, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  env[SEAT_HOLDER_ENV] = String(process.pid);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Only this process's own file goes: a holder that forced its way in wrote its record over ours.
    const now = readRecord(file);
    if (now && now.pid !== process.pid) return;
    rmSync(file, { force: true });
  };
  process.once('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      release();
      process.exit(130);
    });
  }
  return { lock: rec, file, forced, stale, release };
}

/**
 * Write where the holder is into its own lock (a battery, as each row starts). Only this process's
 * lock is rewritten; a lock another process holds, or none, is left as it is and `false` answers.
 */
export function updateSeatLock(
  serverUrl: string,
  status: Omit<SeatStatus, 'at'> & { at?: string },
  dir: string = seatLockDir()
): boolean {
  const file = seatLockFile(serverUrl, dir);
  const rec = readRecord(file);
  if (!rec || rec.pid !== process.pid) return false;
  rec.status = { ...status, at: status.at ?? new Date().toISOString() };
  try {
    writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}
