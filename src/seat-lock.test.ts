/**
 * The seat lock (src/seat-lock.ts): one file per instance, taken by a battery or a suite, read by
 * everything that would join. A live lock refuses another process and names the holder; a stale
 * one (its pid dead, or running another program) is taken over; the holder's own process and the
 * processes it spawned (FVTT_SEAT_HOLDER) pass; `--force=<pid>` overrides only by naming the holder.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeSeatLock,
  forceOf,
  listSeatLocks,
  ownsSeat,
  readSeatLock,
  SEAT_HOLDER_ENV,
  SeatHeldError,
  seatHeldBy,
  seatHolderOf,
  seatLockFile,
  seatLockKey,
  seatLockRecord,
  seatRefusal,
  takeSeatLock,
  updateSeatLock,
} from './seat-lock.js';

const URL = 'http://localhost:30000';
const OTHER_PID = 424242;
const alive = (pid: number) => pid === process.pid || pid === OTHER_PID;
const exeOk = async () => process.execPath;

/** A lock held by another live process, in the shape a battery writes. */
function otherLock(dir: string, extra: Record<string, unknown> = {}) {
  const rec = {
    ...seatLockRecord(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      {},
      new Date('2026-11-04T17:07:17Z')
    ),
    pid: OTHER_PID,
    label: 'Claude Code session local_other',
    argv: ['tools/battery.mjs', '--for', 'v3.4.22..HEAD'],
    status: {
      suite: 'smoke-drop',
      row: 36,
      of: 50,
      runDir: 'dist/battery/2026-11-04T17-07-17',
      at: '2026-11-04T17:35:00Z',
    },
    ...extra,
  };
  writeFileSync(seatLockFile(URL, dir), `${JSON.stringify(rec)}\n`);
  return rec;
}

describe('the key and the file', () => {
  it('is one lock per instance, the trailing slash dropped', () => {
    expect(seatLockKey(URL)).toMatch(/^[0-9a-f]{12}$/);
    expect(seatLockKey(`${URL}/`)).toBe(seatLockKey(URL));
    expect(seatLockKey('http://localhost:30001')).not.toBe(seatLockKey(URL));
    expect(seatLockFile(URL, 'x')).toBe(join('x', `${seatLockKey(URL)}.json`));
  });
});

describe('the record', () => {
  it('names this process, its program, the session and the command line', () => {
    const rec = seatLockRecord(
      { serverUrl: `${URL}/`, kind: 'battery', name: 'battery' },
      { CLAUDE_CODE_SESSION_ID: 'local_s1' },
      new Date('2026-11-04T17:07:17Z')
    );
    expect(rec).toMatchObject({
      pid: process.pid,
      exe: process.execPath,
      label: 'Claude Code session local_s1',
      session: 'local_s1',
      serverUrl: URL,
      kind: 'battery',
      name: 'battery',
      since: '2026-11-04T17:07:17.000Z',
      status: null,
    });
    expect(rec.argv.length).toBeGreaterThan(0);
    expect(rec.cwd).toBe(process.cwd());
  });
});

describe('who owns it', () => {
  it('this process does, and a process the holder spawned does', () => {
    expect(ownsSeat({ pid: process.pid }, {})).toBe(true);
    expect(ownsSeat({ pid: OTHER_PID }, {})).toBe(false);
    expect(ownsSeat({ pid: OTHER_PID }, { [SEAT_HOLDER_ENV]: String(OTHER_PID) })).toBe(true);
    expect(seatHolderOf({ [SEAT_HOLDER_ENV]: 'x' })).toBeNull();
    expect(seatHolderOf({ [SEAT_HOLDER_ENV]: '12' })).toBe(12);
  });
});

describe('reading and listing', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seat-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a free seat reads null, a live lock reads whole with its status', () => {
    expect(readSeatLock(URL, { dir, alive })).toBeNull();
    otherLock(dir);
    const lock = readSeatLock(URL, { dir, env: {}, alive });
    expect(lock).toMatchObject({ pid: OTHER_PID, kind: 'battery', own: false });
    expect(lock?.status?.suite).toBe('smoke-drop');
    expect(listSeatLocks({ dir, env: {}, alive }).map(l => l.pid)).toEqual([OTHER_PID]);
  });

  it('a dead holder is a stale lock: removed as it is read', () => {
    otherLock(dir, { pid: 999999 });
    expect(readSeatLock(URL, { dir, alive })).toBeNull();
    expect(existsSync(seatLockFile(URL, dir))).toBe(false);
  });

  it('an unreadable file goes too', () => {
    writeFileSync(seatLockFile(URL, dir), '{not json');
    expect(listSeatLocks({ dir, alive })).toEqual([]);
    expect(existsSync(seatLockFile(URL, dir))).toBe(false);
  });

  it('seatHeldBy: another live process holding it, unless it is ours or spawned us', async () => {
    otherLock(dir);
    const held = await seatHeldBy(URL, { dir, env: {}, alive, exe: exeOk });
    expect(held?.pid).toBe(OTHER_PID);
    const ride = await seatHeldBy(URL, {
      dir,
      env: { [SEAT_HOLDER_ENV]: String(OTHER_PID) },
      alive,
      exe: exeOk,
    });
    expect(ride).toBeNull();
  });

  it('seatHeldBy: a pid that now runs another program is a stale lock, and a lookup that cannot answer trusts the pid', async () => {
    otherLock(dir);
    expect(
      await seatHeldBy(URL, { dir, env: {}, alive, exe: async () => 'C:\\other\\thing.exe' })
    ).toBeNull();
    expect(existsSync(seatLockFile(URL, dir))).toBe(false);
    otherLock(dir);
    expect((await seatHeldBy(URL, { dir, env: {}, alive, exe: async () => null }))?.pid).toBe(
      OTHER_PID
    );
  });
});

describe('the words', () => {
  it('describes the holder, where it is and what it was started as', () => {
    const rec = seatLockRecord(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      {},
      new Date('2026-11-04T17:07:17Z')
    );
    rec.argv = ['tools/battery.mjs', '--for', 'v3.4.22..HEAD'];
    rec.status = {
      suite: 'smoke-drop',
      row: 36,
      of: 50,
      runDir: 'dist/battery/2026-11-04T17-07-17',
      at: 'x',
    };
    const line = describeSeatLock(rec);
    expect(line).toContain('a battery');
    expect(line).toContain(`pid ${process.pid}`);
    expect(line).toContain('now running smoke-drop (row 36 of 50, run 2026-11-04T17-07-17)');
    expect(line).toContain('`tools/battery.mjs --for v3.4.22..HEAD`');
    rec.kind = 'suite';
    rec.name = 'saves';
    rec.status = null;
    expect(describeSeatLock(rec)).toMatch(/^a suite run by hand \(saves\) — pid/);
  });

  it("the refusal names who is refused, how to wait, and the override by the holder's pid", () => {
    const rec = seatLockRecord(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      {},
      new Date()
    );
    const bridge = seatRefusal(rec, { who: 'the bridge "Assistant DM"' });
    expect(bridge).toMatch(
      /^the bridge "Assistant DM" cannot join http:\/\/localhost:30000: its GM seat is held by a battery/
    );
    expect(bridge).toContain('battery-status.mjs');
    expect(bridge).toContain('no override here');
    const script = seatRefusal(rec, { who: 'the installer', force: null });
    expect(script).toContain(`--force=${process.pid}`);
    const wrong = seatRefusal(rec, { who: 'the installer', force: 7 });
    expect(wrong).toContain('--force=7 names another process');
    expect(wrong).toContain(`--force=${process.pid} is the override`);
  });

  it('forceOf reads only --force=<pid>', () => {
    expect(forceOf(['stop', '--force'])).toBeNull();
    expect(forceOf(['--force=41916'])).toBe(41916);
    expect(forceOf(['--force', '41916'])).toBeNull();
    expect(forceOf(['--force=abc'])).toBeNull();
  });
});

describe('taking it', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seat-lock-'));
    env = {};
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a free seat is taken: the file written, the holder env set for children, released by hand', async () => {
    const taken = await takeSeatLock(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      { dir, env, alive, exe: exeOk }
    );
    if ('rideAlong' in taken) throw new Error('took nothing');
    expect(taken.stale).toBeNull();
    expect(taken.forced).toBeNull();
    expect(JSON.parse(readFileSync(taken.file, 'utf8')).pid).toBe(process.pid);
    expect(env[SEAT_HOLDER_ENV]).toBe(String(process.pid));
    taken.release();
    expect(existsSync(taken.file)).toBe(false);
  });

  it("the holder's own process, and a process it spawned, ride along and write nothing", async () => {
    otherLock(dir);
    const under = { [SEAT_HOLDER_ENV]: String(OTHER_PID) };
    const r = await takeSeatLock(
      { serverUrl: URL, kind: 'suite', name: 'saves' },
      { dir, env: under, alive, exe: exeOk }
    );
    expect('rideAlong' in r && r.rideAlong.pid).toBe(OTHER_PID);
    expect(JSON.parse(readFileSync(seatLockFile(URL, dir), 'utf8')).pid).toBe(OTHER_PID);
  });

  it('held by another live process: refused with the holder named, unless --force names that pid', async () => {
    otherLock(dir);
    const opts = { dir, env, alive, exe: exeOk };
    await expect(
      takeSeatLock({ serverUrl: URL, kind: 'battery', name: 'battery' }, opts)
    ).rejects.toThrow(SeatHeldError);
    await expect(
      takeSeatLock({ serverUrl: URL, kind: 'battery', name: 'battery' }, opts)
    ).rejects.toThrow(/held by a battery — pid 424242/);
    await expect(
      takeSeatLock({ serverUrl: URL, kind: 'battery', name: 'battery' }, { ...opts, force: 1 })
    ).rejects.toThrow(/--force=1 names another process/);
    const taken = await takeSeatLock(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      { ...opts, force: OTHER_PID }
    );
    if ('rideAlong' in taken) throw new Error('took nothing');
    expect(taken.forced?.pid).toBe(OTHER_PID);
    expect(JSON.parse(readFileSync(taken.file, 'utf8')).pid).toBe(process.pid);
    taken.release();
  });

  it("a dead holder's lock is taken over and reported as stale", async () => {
    otherLock(dir, { pid: 999999 });
    const taken = await takeSeatLock(
      { serverUrl: URL, kind: 'suite', name: 'hold' },
      { dir, env, alive, exe: exeOk }
    );
    if ('rideAlong' in taken) throw new Error('took nothing');
    expect(taken.stale?.pid).toBe(999999);
    taken.release();
  });

  it("the status is written into the holder's own lock only", async () => {
    expect(updateSeatLock(URL, { suite: 'x', row: 1, of: 2 }, dir)).toBe(false);
    const taken = await takeSeatLock(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      { dir, env, alive, exe: exeOk }
    );
    if ('rideAlong' in taken) throw new Error('took nothing');
    expect(
      updateSeatLock(URL, { suite: 'smoke-saves', row: 3, of: 9, runDir: 'dist/battery/r' }, dir)
    ).toBe(true);
    const lock = readSeatLock(URL, { dir, alive });
    expect(lock?.status).toMatchObject({
      suite: 'smoke-saves',
      row: 3,
      of: 9,
      runDir: 'dist/battery/r',
    });
    expect(lock?.status?.at).toMatch(/^\d{4}-/);
    taken.release();
    otherLock(dir);
    expect(updateSeatLock(URL, { suite: 'y', row: 1, of: 1 }, dir)).toBe(false);
  });

  it('release leaves a lock another process has since written over ours', async () => {
    const taken = await takeSeatLock(
      { serverUrl: URL, kind: 'battery', name: 'battery' },
      { dir, env, alive, exe: exeOk }
    );
    if ('rideAlong' in taken) throw new Error('took nothing');
    otherLock(dir);
    taken.release();
    expect(JSON.parse(readFileSync(seatLockFile(URL, dir), 'utf8')).pid).toBe(OTHER_PID);
  });
});
