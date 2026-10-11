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
 * Node-side only: no Playwright, no page. Killing a holder means killing the browser it launched,
 * never the MCP server itself, which reconnects lazily on its next call. The record names that
 * browser by pid AND executable path (issue #17): a pid alone can be reused by an unrelated
 * process after a hard-killed server leaves its record behind, so a pid is ended only while the
 * process running under it is still the recorded executable. A record goes only when its browser
 * was ended or is gone: one that names no browser, or whose browser cannot be checked, stays, so
 * the holder is still named (issue #17's review).
 */
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readlink } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
  /** The pid of the browser this holder launched (its CDP `SystemInfo`); null when unknown. */
  browserPid: number | null;
  /** That browser's executable path when the record was written (`exeOf`); null when unknown. */
  browserExe: string | null;
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
    browserPid: null,
    browserExe: null,
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

/**
 * The executable a running process was started from, or null when there is no answer: no such
 * process, not readable, a lookup that failed or ran out of time, or a platform with neither
 * lookup. Windows asks CIM (~0.25 s, most of it PowerShell's startup); Linux reads
 * `/proc/<pid>/exe`; elsewhere it answers null. Asynchronous: the connect path asks it for the seat
 * record, where a synchronous spawn held the event loop through PowerShell's startup on every
 * connect (issue #17's review). Never throws. A null is not proof the process is gone; eviction
 * asks `isAlive` before it drops a record on one.
 */
export async function exeOf(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ExecutablePath`,
        ],
        { encoding: 'utf8', timeout: 20_000, windowsHide: true }
      );
      return stdout.trim() || null;
    }
    return (await readlink(`/proc/${pid}/exe`)) || null;
  } catch {
    return null;
  }
}

/** Windows paths compare without case; elsewhere exactly. */
function sameExe(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * End a bridge's browser and the processes under it: the tree on Windows (`taskkill /T /F`), the
 * process group elsewhere (Playwright launches the browser as a group leader), the pid alone if
 * the group cannot be signalled. Never throws.
 */
export function killBrowser(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 20_000,
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** What evicting one holder did: the browser pid it ended, or why it ended none, and its record. */
export interface Eviction {
  holder: Holder;
  /** The browser pid ended; null when nothing was killed. */
  ended: number | null;
  /** Why nothing was killed, when nothing was. */
  skipped?: string;
  /**
   * The record stays: nothing showed its browser ended or gone (it names no browser, or no path to
   * check one against, or what the pid runs could not be read), so its holder is still named.
   */
  kept: boolean;
}

/** How `evictHolder` reaches the OS; every field defaults to the real thing, so a test injects it. */
export interface EvictOptions {
  /** This bridge's own browser, while it is connected: never ended, whatever a record says. */
  ownBrowserPid?: number | null;
  dir?: string;
  exe?: (pid: number) => Promise<string | null>;
  kill?: (pid: number) => void;
  alive?: (pid: number) => boolean;
}

/**
 * Evict a holder: end the browser it launched, but only while its pid still runs the recorded
 * executable. The record is dropped only when that browser was ended or is gone (its pid is dead,
 * or now runs another program). When nothing can be known (no browser or no path recorded, as by
 * a server from before the check or a lookup that failed at its connect, or what the pid runs
 * cannot be read) nothing is killed and the record stays, so the next preflight still names the
 * holder. A record whose browser pid is this bridge's own is never acted on: our browser runs under
 * that pid, so the one it recorded is gone, and the record goes (issue #17's review). The holding
 * MCP server itself keeps running and reconnects lazily on its next tool call, exactly as after
 * its own disconnect-bridge.
 */
export async function evictHolder(h: Holder, opts: EvictOptions = {}): Promise<Eviction> {
  const { dir = holderDir(), exe = exeOf, kill = killBrowser, alive = isAlive } = opts;
  const pid = h.browserPid ?? null;
  const recorded = h.browserExe ?? null;
  const keep = (skipped: string): Eviction => ({ holder: h, ended: null, skipped, kept: true });
  const drop = (ended: number | null, skipped?: string): Eviction => {
    removeHolder(h, dir);
    return { holder: h, ended, ...(skipped === undefined ? {} : { skipped }), kept: false };
  };
  const gone = `nothing to end (browser pid ${pid} is gone)`;

  if (pid === null) return keep('record kept, nothing ended (it names no browser)');
  if (pid === opts.ownBrowserPid) {
    return drop(
      null,
      `left pid ${pid} alone (this session's own browser runs under it; the recorded one is gone)`
    );
  }
  if (!alive(pid)) return drop(null, gone);
  if (recorded === null) {
    return keep(
      `record kept, left pid ${pid} alone (no browser path recorded to check it against)`
    );
  }
  const live = await exe(pid);
  if (live === null) {
    // It was alive a moment ago: it has exited since, or the lookup failed.
    return alive(pid)
      ? keep(`record kept, left pid ${pid} alone (what it runs could not be read)`)
      : drop(null, gone);
  }
  if (!sameExe(live, recorded)) {
    return drop(
      null,
      `left pid ${pid} alone (it now runs another program, not the recorded browser)`
    );
  }
  kill(pid);
  return drop(pid);
}
