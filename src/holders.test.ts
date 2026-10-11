/**
 * The seat records (issue #12): one file per holding process, listed with liveness, pruned when
 * the process is gone, named from the Claude Code session that started the server.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  childPids,
  describeHolder,
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

describe('childPids', () => {
  it('lists a child this process spawned', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
      stdio: 'ignore',
    });
    try {
      await new Promise(r => setTimeout(r, 300));
      expect(childPids(process.pid)).toContain(child.pid);
    } finally {
      child.kill();
    }
  }, 30_000);
});
