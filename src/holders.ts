/**
 * Who holds the bridge seat (issue #12). A Foundry user can be joined by any number of sessions,
 * and the desktop app keeps every open Claude Code session's MCP servers alive, so the sandbox's
 * bridge user kept being found held by a browser nobody in the running session had opened — and
 * the only way to learn whose it was ran through the process table. Each bridge now leaves a
 * record on this machine while it holds a seat: one file per process under the OS temp dir, keyed
 * by server URL and user. A second bridge names the first instead of joining silently,
 * `disconnect-bridge { all: true }` ends every holder on this machine, and the suites' preflight
 * prints "held by pid N, session S, since T" instead of a bare user name. The same facts ride the
 * User document as `flags.world.fvttMcpBridge` (src/foundry.ts) for a reader on another machine.
 *
 * Node-side only: no Playwright, no page. Killing a holder means killing the browser it spawned
 * (its child processes), never the MCP server itself, which reconnects lazily on its next call.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HolderRecord {
  pid: number;
  ppid: number;
  host: string;
  /** What to call this holder: FOUNDRY_BRIDGE_LABEL, else the Claude Code session, else the pid. */
  label: string;
  /** CLAUDE_CODE_SESSION_ID when the server was started by Claude Code. */
  session: string | null;
  since: string;
  serverUrl: string;
  user: string;
}

export interface Holder extends HolderRecord {
  alive: boolean;
  self: boolean;
  file: string;
}

/** Where the records live: one directory per machine, shared by every bridge process on it. */
export function holderDir(): string {
  return join(tmpdir(), 'fvtt-mcp-dnd5e', 'holders');
}

/** One seat = one server URL + one user; the key names the record files. */
export function seatKey(serverUrl: string, user: string): string {
  return createHash('sha1')
    .update(`${serverUrl.replace(/\/+$/, '')}\n${user}`)
    .digest('hex')
    .slice(0, 12);
}

/** The holder's name, from the environment the MCP client started the server with. */
export function sessionLabel(env: NodeJS.ProcessEnv = process.env): {
  session: string | null;
  label: string;
} {
  const session = env.CLAUDE_CODE_SESSION_ID?.trim() || null;
  const label =
    env.FOUNDRY_BRIDGE_LABEL?.trim() ||
    (session ? `Claude Code session ${session}` : `process ${process.pid}`);
  return { session, label };
}

export function holderRecord(
  serverUrl: string,
  user: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): HolderRecord {
  const { session, label } = sessionLabel(env);
  return {
    pid: process.pid,
    ppid: process.ppid,
    host: hostname(),
    label,
    session,
    since: now.toISOString(),
    serverUrl,
    user,
  };
}

function fileOf(dir: string, serverUrl: string, user: string, pid: number): string {
  return join(dir, `${seatKey(serverUrl, user)}-${pid}.json`);
}

/** Write (or refresh) this process's record. Returns the file path. Never throws: a record is a courtesy. */
export function writeHolder(rec: HolderRecord, dir: string = holderDir()): string | null {
  const file = fileOf(dir, rec.serverUrl, rec.user, rec.pid);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    return file;
  } catch {
    return null;
  }
}

export function removeHolder(
  rec: Pick<HolderRecord, 'serverUrl' | 'user' | 'pid'>,
  dir: string = holderDir()
): void {
  try {
    rmSync(fileOf(dir, rec.serverUrl, rec.user, rec.pid), { force: true });
  } catch {
    // best effort
  }
}

/** Is a process with this pid running? (`kill(pid, 0)` probes without signalling.) */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but is not ours — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Every record for this seat on this machine, each marked alive (its pid still runs) and self
 * (it is this process). A dead holder's file is removed as it is read: a record outliving its
 * process is the stale state this exists to end.
 */
export function listHolders(
  serverUrl: string,
  user: string,
  dir: string = holderDir(),
  alive: (pid: number) => boolean = isAlive
): Holder[] {
  const key = seatKey(serverUrl, user);
  let names: string[];
  try {
    names = readdirSync(dir).filter(n => n.startsWith(`${key}-`) && n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Holder[] = [];
  for (const name of names) {
    const file = join(dir, name);
    let rec: HolderRecord;
    try {
      rec = JSON.parse(readFileSync(file, 'utf8')) as HolderRecord;
    } catch {
      rmSync(file, { force: true });
      continue;
    }
    const isUp = alive(rec.pid);
    if (!isUp) {
      rmSync(file, { force: true });
      continue;
    }
    out.push({ ...rec, alive: true, self: rec.pid === process.pid, file });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

/** One line a human can act on: `pid 28560 — Claude Code session 7f3a… — since 2026-10-10T23:21:01Z`. */
export function describeHolder(h: Pick<HolderRecord, 'pid' | 'label' | 'since' | 'host'>): string {
  return `pid ${h.pid} on ${h.host} — ${h.label} — since ${h.since}`;
}

/** The direct children of a process (the headless browser a bridge launched), by pid. */
export function childPids(pid: number): number[] {
  const list = (out: string): number[] =>
    out
      .split(/\s+/)
      .filter(s => /^\d+$/.test(s))
      .map(Number);
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: 'utf8', timeout: 20_000 }
    );
    return list(r.stdout ?? '');
  }
  const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 });
  return list(r.stdout ?? '');
}

/** End a process and everything under it. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 20_000 });
    return;
  }
  for (const kid of childPids(pid)) killTree(kid);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/**
 * Evict a holder: end the browser it spawned (every child of its pid) and drop its record. The
 * holding MCP server itself keeps running and reconnects lazily on its next tool call, exactly as
 * after its own disconnect-bridge. Returns the pids ended.
 */
export function evictHolder(h: Holder, dir: string = holderDir()): number[] {
  const kids = childPids(h.pid);
  for (const kid of kids) killTree(kid);
  removeHolder(h, dir);
  return kids;
}
