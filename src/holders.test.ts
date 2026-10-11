/**
 * The seat records (issue #12): one file per holding process, listed with liveness, pruned when
 * the process is gone, named from the Claude Code session that started the server. Eviction
 * (issue #17) ends a holder's browser only while its pid still runs the recorded executable.
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
  it("names a running process's executable, and nothing for a pid that runs nothing", () => {
    const exe = exeOf(process.pid);
    if (process.platform === 'win32' || process.platform === 'linux') {
      expect(exe?.toLowerCase()).toBe(process.execPath.toLowerCase());
    }
    expect(exeOf(999_999_999)).toBeNull();
    expect(exeOf(0)).toBeNull();
    expect(exeOf(-1)).toBeNull();
  }, 30_000);
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
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'holders-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ends the recorded browser while its pid still runs the recorded executable', () => {
    const kill = vi.fn();
    const h = holder();
    const e = evictHolder(h, dir, () => BROWSER, kill);
    expect(kill).toHaveBeenCalledWith(5151);
    expect(e).toEqual({ holder: h, ended: 5151 });
    expect(readdirSync(dir)).toEqual([]); // the record is gone
  });

  it('leaves a reused pid alone: another executable is not the recorded browser', () => {
    const kill = vi.fn();
    const e = evictHolder(
      holder(),
      dir,
      () => 'C:\\Program Files\\Google\\Chrome\\chrome.exe',
      kill
    );
    expect(kill).not.toHaveBeenCalled();
    expect(e.ended).toBeNull();
    expect(e.skipped).toMatch(/left pid 5151 alone \(it now runs another program/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('kills nothing when the browser is gone, or was never recorded', () => {
    const kill = vi.fn();
    expect(evictHolder(holder(), dir, () => null, kill).skipped).toBe(
      'nothing to end (browser pid 5151 is gone)'
    );
    const exe = vi.fn(() => BROWSER);
    expect(evictHolder(holder({ browserPid: null }), dir, exe, kill).skipped).toBe(
      'nothing to end (no browser recorded)'
    );
    expect(evictHolder(holder({ browserExe: null }), dir, exe, kill).skipped).toBe(
      'left pid 5151 alone (no browser path recorded)'
    );
    // a record an older server wrote has neither field
    const { browserPid: _pid, browserExe: _exe, ...old } = holder();
    expect(evictHolder(old as Holder, dir, exe, kill).ended).toBeNull();
    expect(kill).not.toHaveBeenCalled();
    expect(exe).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });
});
