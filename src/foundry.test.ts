// The startup browser check (issue #3, item 9). The paths are Playwright's own, read from the
// installed package; only the existence test is stubbed.
// The op cap on a fake page (issue #16): a wedged page is closed and the op is not retried; a slow
// op on a page that answers is never killed; run-script's cap is its timeout + 30 s.
// The role warning at connect, on a fake page (issue #8): a read-only registration wants a Player
// or Trusted Player, a full one a Gamemaster or Assistant GM.
// The receipts' seam (issue #6): the page is asked to record only inside a tool call, and what it
// reports joins that call, a failed write's included. After the page bridge vanished under a call,
// only a read is run again (issue #16's review): a write fails with its outcome unknown.
// Eviction never ends this bridge's own browser while it is connected (issue #17's review).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from './bridge-error.js';
import { chromiumProblem, Foundry, type FoundryConfig } from './foundry.js';
import type { ReceiptOp } from './page/_receipts.js';
import { callContext } from './receipts.js';

describe('chromiumProblem', () => {
  it('asks for the headless shell a headless launch runs, beside the full build', () => {
    const asked: string[] = [];
    expect(
      chromiumProblem(p => {
        asked.push(p);
        return true;
      })
    ).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/chromium_headless_shell-\d+$/);
  });

  it('names the install command when the browser is missing', () => {
    const problem = chromiumProblem(() => false);
    expect(problem).toMatch(/^Playwright's Chromium is not installed \(.+ is missing\)/);
    expect(problem).toContain('`npx playwright install chromium`');
  });
});

/**
 * A connected bridge over a fake page, without a browser: the constructor (which loads the page
 * bundle) is skipped and the fields a connect would set are set by hand. `answer(arg)` serves the
 * op's evaluate (its argument is `{ n, a, r }`, `r` whether the page records; it answers what
 * window.__fvttCall would, `{ result, ops? }`); the probe and the bridge check (an evaluate with no
 * argument) get `probe()`. A reconnect or a recover would be a retry, so both fail the test if
 * reached, unless the test hands its own `recover`.
 */
function connected(opts: {
  answer: (arg: { n: string; a: unknown; r: boolean }) => Promise<unknown>;
  probe: () => Promise<unknown>;
  cfg?: Partial<FoundryConfig>;
  recover?: () => Promise<void>;
}) {
  let closed = false;
  const page = {
    evaluate: vi.fn((_fn: unknown, arg?: { n: string; a: unknown; r: boolean }) =>
      arg === undefined ? opts.probe() : opts.answer(arg)
    ),
    isClosed: () => closed,
    close: vi.fn(async () => {
      closed = true;
    }),
  };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const f = Object.create(Foundry.prototype) as Foundry;
  const retried = vi.fn(async () => {
    throw new Error('the op was retried');
  });
  Object.assign(f, {
    cfg: { serverUrl: 'http://localhost:30000', user: 'Bridge', idleLogoutMs: 0, ...opts.cfg },
    log,
    page,
    ready: true,
    inflight: 0,
    lastUsed: 0,
    recover: opts.recover ?? retried,
    connect: retried,
  });
  return { f, page, log, retried };
}

const never = () => new Promise<never>(() => {});

function watch<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    value => Object.assign(state, { settled: true, value }),
    error => Object.assign(state, { settled: true, error })
  );
  return state;
}

describe('the op cap (issue #16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a page that stops answering is closed, the op fails with its outcome unknown, and is not retried', async () => {
    const { f, page, log, retried } = connected({
      answer: never,
      probe: never,
      cfg: { opCapMs: 1_000 },
    });
    const run = watch(f.call('getWorldInfo'));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(run.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.error).toBeInstanceOf(BridgeError);
    const message = (run.error as Error).message;
    expect(message).toContain("'getWorldInfo' did not finish within 6 s");
    expect(message).toContain('the page stopped answering');
    expect(message).toContain('the next call reconnects');
    expect(message).toContain('The outcome of this op is unknown');
    expect(page.evaluate).toHaveBeenCalledTimes(2); // the op and one probe — nothing after
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(retried).not.toHaveBeenCalled();
    expect(f.isReady()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('closed its page'));
  });

  it('a slow op on a page that answers is never killed', async () => {
    const { f, page, retried } = connected({
      answer: () =>
        new Promise(resolve => setTimeout(() => resolve({ result: { id: 'w' } }), 3_500)),
      probe: async () => 1,
      cfg: { opCapMs: 1_000 },
    });
    const run = watch(f.call('getWorldInfo'));
    await vi.advanceTimersByTimeAsync(3_500);
    expect(run).toMatchObject({ settled: true, value: { id: 'w' } });
    expect(page.evaluate).toHaveBeenCalledTimes(4); // the op and a probe at 1, 2 and 3 s
    expect(page.close).not.toHaveBeenCalled();
    expect(retried).not.toHaveBeenCalled();
    expect(f.isReady()).toBe(true);
  });

  it("run-script's cap is its own timeout + 30 s, then the probe", async () => {
    const { f, page } = connected({ answer: never, probe: never });
    const run = watch(f.call('runScript', { src: 'while (true) {}', timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(39_999);
    expect(run.settled).toBe(false);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // the probe went out at 35 s
    await vi.advanceTimersByTimeAsync(1);
    expect((run.error as Error).message).toContain("'runScript' did not finish within 40 s");
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("run-script with no timeout of its own: the page's 60 s + 30 s", async () => {
    const { f } = connected({ answer: never, probe: never });
    const run = watch(f.call('runScript', { src: 'while (true) {}' }));
    await vi.advanceTimersByTimeAsync(94_999);
    expect(run.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((run.error as Error).message).toContain("'runScript' did not finish within 95 s");
  });

  it("an op's own error passes through untouched, and a live page is not recovered", async () => {
    // the bridge check after the throw is an argument-less evaluate too: it answers, so no recover
    const { f, page, retried } = connected({
      answer: async () => {
        throw new Error('page.evaluate: PageError:not-found: Actor "Gren" not found');
      },
      probe: async () => true,
    });
    const run = watch(f.call('getWorldInfo'));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.error).toBeInstanceOf(BridgeError);
    expect(run.error).toMatchObject({ code: 'not-found', detail: 'Actor "Gren" not found' });
    expect(page.close).not.toHaveBeenCalled();
    expect(retried).not.toHaveBeenCalled();
  });
});

/**
 * A connect over a fake page, without a browser: the steps before the role read (wake, the world
 * check, the join, the inject) and after it (the seat record, the index warm-up, the idle timer)
 * are stubbed; the page answers the role read with `role`.
 */
function connecting(role: number, cfg: Partial<FoundryConfig>) {
  const page = {
    setDefaultTimeout: vi.fn(),
    evaluate: vi.fn(async () => ({ worldId: 'w', role })),
    isClosed: () => false,
  };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const f = Object.create(Foundry.prototype) as Foundry;
  const step = vi.fn(async () => {});
  Object.assign(f, {
    cfg: { serverUrl: 'http://localhost:30000', user: 'Bridge', idleLogoutMs: 0, ...cfg },
    log,
    browser: { isConnected: () => true },
    context: { newPage: async () => page },
    ready: false,
    inflight: 0,
    lastUsed: 0,
    wake: step,
    ensureWorldReady: step,
    joinWorld: step,
    injectBundle: step,
    markSeat: step,
    warmIndexes: vi.fn(),
    armIdle: vi.fn(),
  });
  return { f, log };
}

describe('the role warning at connect (issue #8)', () => {
  it('a read-only registration joined as a Gamemaster or Assistant GM is warned: the role is the boundary', async () => {
    for (const role of [3, 4]) {
      const { f, log } = connecting(role, { expectReadOnly: true });
      await f.connect();
      expect(f.isReady()).toBe(true);
      expect(log.warn).toHaveBeenCalledTimes(1);
      const warning = log.warn.mock.calls[0]![0] as string;
      expect(warning).toContain('on a read-only registration (FOUNDRY_TOOLSETS=readonly)');
      expect(warning).toContain('the role of the join user is the real boundary');
      expect(warning).toContain('Player or Trusted Player');
    }
  });

  it('a read-only registration joined as a Player or Trusted Player is the pairing: no warning', async () => {
    for (const role of [1, 2]) {
      const { f, log } = connecting(role, { expectReadOnly: true });
      await f.connect();
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it('a full registration still wants a Gamemaster or Assistant GM', async () => {
    const player = connecting(1, {});
    await player.f.connect();
    expect(player.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('(below Assistant GM) — every write tool will be refused by Foundry')
    );
    const gm = connecting(4, {});
    await gm.f.connect();
    expect(gm.log.warn).not.toHaveBeenCalled();
  });
});

const UPDATE: ReceiptOp = {
  kind: 'update',
  documentName: 'Actor',
  uuid: 'Actor.a1',
  label: 'Goblin',
  pre: { name: 'Goblin' },
};

describe('receipts through the seam (issue #6)', () => {
  it('outside a tool call the page records nothing; inside one, the writes it reports join the call', async () => {
    const asked: boolean[] = [];
    const { f } = connected({
      answer: async ({ r }) => {
        asked.push(r);
        return r ? { result: { ok: true }, ops: [UPDATE] } : { result: { ok: true } };
      },
      probe: async () => true,
    });
    expect(await f.call('updateActor', { actorIdentifier: 'a1', name: 'Hob' })).toEqual({
      ok: true,
    });
    const ctx = { ops: [] as ReceiptOp[] };
    const inside = await callContext.run(ctx, () =>
      f.call('updateActor', { actorIdentifier: 'a1', name: 'Hob' })
    );
    expect(inside).toEqual({ ok: true });
    expect(asked).toEqual([false, true]);
    expect(ctx.ops).toEqual([UPDATE]);
  });

  it('a write that failed after it wrote: its writes join the call, its error keeps its code', async () => {
    const { f } = connected({
      answer: async () => ({
        error: {
          name: 'PageError:not-found',
          message: 'Actor "Gren" not found',
          stack: 'PageError:not-found: Actor "Gren" not found\n    at deleteActor (eval:1:2)',
        },
        ops: [UPDATE],
      }),
      probe: async () => true,
    });
    const ctx = { ops: [] as ReceiptOp[] };
    const err = await callContext
      .run(ctx, () => f.call('deleteActor', { identifiers: ['Gren'] }))
      .catch(e => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err).toMatchObject({
      code: 'not-found',
      fn: 'deleteActor',
      detail: 'Actor "Gren" not found',
    });
    expect(err.pageStack).toContain('at deleteActor');
    expect(ctx.ops).toEqual([UPDATE]);
  });
});

describe('a vanished page bridge: only a read is run again (issue #16 review)', () => {
  /** A page whose bridge is gone on the first call (a reload under it), back after the recover. */
  function vanishing() {
    let first = true;
    const recover = vi.fn(async () => {});
    const answer = vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error('page.evaluate: Execution context was destroyed');
      }
      return { result: { id: 'w' } };
    });
    const { f, log } = connected({ answer, probe: async () => false, recover });
    return { f, log, recover, answer };
  }

  it('a read is recovered and run again', async () => {
    const { f, recover, answer } = vanishing();
    expect(await f.call('getWorldInfo')).toEqual({ id: 'w' });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it('a write is recovered but not run again: it fails as a connection error, its outcome unknown', async () => {
    const { f, log, recover, answer } = vanishing();
    const err = await f.call('updateActor', { actorIdentifier: 'a1', name: 'Hob' }).catch(e => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe('connection');
    expect(err.explained).toBe(true); // the detail is the whole answer, no generic connect hint
    expect(err.detail).toContain("the page went away under 'updateActor'");
    expect(err.detail).toContain('its outcome is unknown, a write may or may not have landed');
    expect(recover).toHaveBeenCalledTimes(1); // the next call finds a working bridge
    expect(answer).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('a write is not run again'));
    // a configure call naming no field is a read by its page tag, so it is run again
    const again = vanishing();
    expect(await again.f.call('configurePrimaryParty', {})).toEqual({ id: 'w' });
    expect(again.answer).toHaveBeenCalledTimes(2);
  });
});

describe("evictOtherHolders never ends this bridge's own browser (issue #17 review)", () => {
  // Another server's record whose browser pid our own headless shell now runs under: the same
  // executable, so the path check alone would end our browser. A seat no real bridge holds.
  const other = {
    pid: 4242,
    ppid: 1,
    host: 'box',
    label: 'B',
    session: null,
    since: '2026-10-11T00:00:00.000Z',
    serverUrl: 'http://foundry.unit.test',
    user: 'Bridge',
    browserPid: 999_999_998,
    browserExe: '/x/chromium_headless_shell-1228/chrome-linux/headless_shell',
    alive: true,
    self: false,
    file: 'x.json',
  };
  function bridge(connected: boolean) {
    const f = Object.create(Foundry.prototype) as Foundry;
    Object.assign(f, {
      browser: { isConnected: () => connected },
      ownBrowserPid: other.browserPid,
      holders: () => [{ ...other, pid: process.pid, self: true }, other],
    });
    return f;
  }

  it('while our browser is connected, a record naming its pid is left alone, and dropped', async () => {
    const evictions = await bridge(true).evictOtherHolders();
    expect(evictions).toHaveLength(1); // our own record is never a candidate
    expect(evictions[0]).toMatchObject({ ended: null, kept: false });
    expect(evictions[0]!.skipped).toContain("this session's own browser runs under it");
  });

  it('once our browser is gone the guard is off: the record is judged on its own', async () => {
    const [e] = await bridge(false).evictOtherHolders();
    expect(e!.skipped).toBe('nothing to end (browser pid 999999998 is gone)');
  });
});
