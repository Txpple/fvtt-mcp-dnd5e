/**
 * The seat records (issue #12): one file per holding process, listed with liveness, pruned when
 * the process is gone, named from the Claude Code session that started the server. Eviction
 * (issue #17) ends a holder's browser only while its pid still runs the recorded executable, never
 * this bridge's own, and drops a record only when its browser was ended or is gone (the review).
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeHolder,
  evictHolder,
  exeOf,
  type Holder,
  holderRecord,
  listHolders,
  removeHolder,
  seatKey,
  sessionLabel,
  writeHolder,
} from './holders.js';

const URL = 'http://localhost:30000';
const USER = 'Assistant DM';

describe('seatKey', () => {
  it('is stable, short, and the same with or without a trailing slash', () => {
    expect(seatKey(URL, USER)).toMatch(/^[0-9a-f]{12}$/);
    expect(seatKey(`${URL}/`, USER)).toBe(seatKey(URL, USER));
    expect(seatKey(URL, 'Assistant Tester')).not.toBe(seatKey(URL, USER));
  });
});

describe('sessionLabel', () => {
  it('names the Claude Code session when the server was started by one', () => {
    const { session, label } = sessionLabel({ CLAUDE_CODE_SESSION_ID: 'local_abc' });
    expect(session).toBe('local_abc');
    expect(label).toBe('Claude Code session local_abc');
  });
  it('lets FOUNDRY_BRIDGE_LABEL override, and falls back to the pid', () => {
    expect(sessionLabel({ FOUNDRY_BRIDGE_LABEL: 'the battery' }).label).toBe('the battery');
    expect(sessionLabel({}).label).toBe(`process ${process.pid}`);
    expect(sessionLabel({}).session).toBeNull();
  });
});

describe('the records', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'holders-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes this process as a live, self holder and removes it again', () => {
    const rec = holderRecord(
      URL,
      USER,
      { CLAUDE_CODE_SESSION_ID: 's1' },
      new Date('2026-10-10T23:21:01Z')
    );
    expect(rec.pid).toBe(process.pid);
    expect(rec.since).toBe('2026-10-10T23:21:01.000Z');
    expect(rec).toMatchObject({ browserPid: null, browserExe: null }); // the bridge fills them in
    expect(writeHolder(rec, dir)).toMatch(/\.json$/);
    const [h] = listHolders(URL, USER, dir);
    expect(h).toMatchObject({
      pid: process.pid,
      alive: true,
      self: true,
      label: 'Claude Code session s1',
    });
    expect(listHolders(URL, 'someone else', dir)).toEqual([]);
    removeHolder(rec, dir);
    expect(listHolders(URL, USER, dir)).toEqual([]);
  });

  it('prunes a record whose process is gone, and keeps one whose process lives', () => {
    const dead = {
      ...holderRecord(URL, USER, {}),
      pid: 999_999_999,
      since: '2026-10-10T19:21:01.000Z',
    };
    const live = { ...holderRecord(URL, USER, {}), pid: 4242, since: '2026-10-10T20:00:00.000Z' };
    writeHolder(dead, dir);
    writeHolder(live, dir);
    expect(readdirSync(dir)).toHaveLength(2);
    const alive = (pid: number) => pid === 4242;
    const listed = listHolders(URL, USER, dir, alive);
    expect(listed.map(h => h.pid)).toEqual([4242]);
    expect(listed[0]!.self).toBe(false);
    expect(readdirSync(dir)).toHaveLength(1); // the dead one is gone from disk
  });

  it('describes a holder in one line a human can act on', () => {
    const line = describeHolder({
      pid: 28560,
      host: 'box',
      label: 'Claude Code session s1',
      since: '2026-10-10T23:21:01.000Z',
    });
    expect(line).toBe('pid 28560 on box — Claude Code session s1 — since 2026-10-10T23:21:01.000Z');
  });
});

describe('exeOf', () => {
  it("names a running process's executable, and nothing for a pid that runs nothing", async () => {
    const exe = await exeOf(process.pid);
    if (process.platform === 'win32' || process.platform === 'linux') {
      expect(exe?.toLowerCase()).toBe(process.execPath.toLowerCase());
    }
    expect(await exeOf(999_999_999)).toBeNull();
    expect(await exeOf(0)).toBeNull();
    expect(await exeOf(-1)).toBeNull();
  }, 30_000);

  // The connect path asks it for the seat record: a synchronous PowerShell spawn held the event loop
  // through PowerShell's startup, and no timer fired until it returned (issue #17's review).
  it.runIf(process.platform === 'win32')(
    'asks without holding the event loop: timers fire while PowerShell starts',
    async () => {
      let ticks = 0;
      const timer = setInterval(() => ticks++, 10);
      try {
        expect(await exeOf(process.pid)).not.toBeNull();
      } finally {
        clearInterval(timer);
      }
      expect(ticks).toBeGreaterThan(0);
    },
    30_000
  );
});

describe('evictHolder', () => {
  let dir: string;
  const BROWSER = '/opt/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell';
  const holder = (over: Partial<Holder> = {}): Holder => {
    const rec = {
      ...holderRecord(URL, USER, {}),
      pid: 4242,
      browserPid: 5151,
      browserExe: BROWSER,
      ...over,
    };
    const file = writeHolder(rec, dir) ?? '';
    return { ...rec, alive: true, self: false, file };
  };
  /** The OS, injected: whether the browser pid is alive, what it runs, and the kill. */
  const os = (o: { alive?: boolean; exe?: string | null } = {}) => ({
    dir,
    alive: vi.fn((_pid: number) => o.alive ?? true),
    exe: vi.fn(async (_pid: number) => (o.exe === undefined ? BROWSER : o.exe)),
    kill: vi.fn((_pid: number) => {}),
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'holders-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ends the recorded browser while its pid still runs the recorded executable, and drops the record', async () => {
    const o = os();
    const h = holder();
    const e = await evictHolder(h, o);
    expect(o.kill).toHaveBeenCalledWith(5151);
    expect(e).toEqual({ holder: h, ended: 5151, kept: false });
    expect(readdirSync(dir)).toEqual([]); // the record is gone
  });

  it('leaves a reused pid alone: another executable means the recorded browser is gone, so is the record', async () => {
    const o = os({ exe: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' });
    const e = await evictHolder(holder(), o);
    expect(o.kill).not.toHaveBeenCalled();
    expect(e).toMatchObject({ ended: null, kept: false });
    expect(e.skipped).toMatch(/left pid 5151 alone \(it now runs another program/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('drops the record of a browser whose pid is dead, and asks nothing more', async () => {
    const o = os({ alive: false });
    expect(await evictHolder(holder(), o)).toMatchObject({
      ended: null,
      kept: false,
      skipped: 'nothing to end (browser pid 5151 is gone)',
    });
    expect(await evictHolder(holder({ browserExe: null }), o)).toMatchObject({ kept: false });
    expect(o.exe).not.toHaveBeenCalled();
    expect(o.kill).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps a record that names no browser and kills nothing: its holder is still named', async () => {
    const o = os();
    expect(await evictHolder(holder({ browserPid: null }), o)).toMatchObject({
      ended: null,
      kept: true,
      skipped: 'record kept, nothing ended (it names no browser)',
    });
    // a record a server from before issue #17 wrote has neither field
    const { browserPid: _pid, browserExe: _exe, ...old } = holder();
    expect(await evictHolder(old as Holder, o)).toMatchObject({ ended: null, kept: true });
    expect(o.alive).not.toHaveBeenCalled();
    expect(o.exe).not.toHaveBeenCalled();
    expect(o.kill).not.toHaveBeenCalled();
    expect(listHolders(URL, USER, dir, () => true).map(h => h.pid)).toEqual([4242]); // still named
  });

  it('keeps the record of a live browser pid it cannot check: no path recorded, or its program unreadable', async () => {
    const noPath = os();
    expect(await evictHolder(holder({ browserExe: null }), noPath)).toMatchObject({
      ended: null,
      kept: true,
      skipped: 'record kept, left pid 5151 alone (no browser path recorded to check it against)',
    });
    expect(noPath.exe).not.toHaveBeenCalled();
    const unreadable = os({ exe: null }); // the lookup failed, timed out, or this OS has none
    expect(await evictHolder(holder(), unreadable)).toMatchObject({
      ended: null,
      kept: true,
      skipped: 'record kept, left pid 5151 alone (what it runs could not be read)',
    });
    expect(noPath.kill).not.toHaveBeenCalled();
    expect(unreadable.kill).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('drops the record when the lookup finds nothing because the browser exited meanwhile', async () => {
    const o = os({ exe: null });
    o.alive.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(await evictHolder(holder(), o)).toMatchObject({
      kept: false,
      skipped: 'nothing to end (browser pid 5151 is gone)',
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("never ends this bridge's own browser: a record whose browser pid is ours names one that is gone", async () => {
    const o = os(); // the pid runs the recorded executable: the path check alone would end it
    const e = await evictHolder(holder(), { ...o, ownBrowserPid: 5151 });
    expect(o.kill).not.toHaveBeenCalled();
    expect(o.exe).not.toHaveBeenCalled();
    expect(e).toMatchObject({ ended: null, kept: false });
    expect(e.skipped).toBe(
      "left pid 5151 alone (this session's own browser runs under it; the recorded one is gone)"
    );
    expect(readdirSync(dir)).toEqual([]);
    // another holder's browser is still ended beside it
    const other = os();
    const ended = await evictHolder(holder({ browserPid: 6262 }), {
      ...other,
      ownBrowserPid: 5151,
    });
    expect(ended).toMatchObject({ ended: 6262, kept: false });
    expect(other.kill).toHaveBeenCalledWith(6262);
  });
});
