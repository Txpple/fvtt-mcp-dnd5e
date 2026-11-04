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
// info() reports the seat and whether this connect found the world asleep or down (issue #9).
// Issue #6's review: a write waits in this process for the bridge's earlier writes, so its op cap
// never counts the wait (a read never waits); lastWorldId() reads the world without connecting.
// Writes connect before they queue: issued together they share one connect and fail together, and
// a write that arrives while the connect is under way joins it without clearing its page.
// The join's wait for game.ready is watched (2026-11-04): a budget run out says what it saw and
// whether that reads as the link, the server or the world; a timeout on FOUNDRY_URL is retried
// once on FOUNDRY_URL_FALLBACK, a refusal never. dispose() ends the browser at once, a join under
// way included, closes the page of a join that failed, and ends by pid a browser process that
// outlived browser.close(); a browser launched after a dispose began is closed, not kept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from './bridge-error.js';
import { ConnectProblem } from './bridge-error.js';
import {
  chromiumProblem,
  Foundry,
  type FoundryConfig,
  type JoinSample,
  joinWaitVerdict,
  TransportProblem,
} from './foundry.js';
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

describe('the write queue: one write at a time from this bridge (issue #6 review)', () => {
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  it('two writes issued together are evaluated one after the other; a read in between is not delayed', async () => {
    const order: string[] = [];
    const { f, page } = connected({
      answer: async ({ n, a }) => {
        const tag = n === 'getWorldInfo' ? 'read' : `write ${(a as { name: string }).name}`;
        order.push(`${tag} issued`);
        if (n !== 'getWorldInfo') await sleep(30);
        order.push(`${tag} done`);
        return { result: tag };
      },
      probe: async () => true,
    });
    const first = f.call('updateActor', { actorIdentifier: 'a1', name: 'A' });
    const second = f.call('updateActor', { actorIdentifier: 'a1', name: 'B' });
    await sleep(5);
    // B waits in this process, not inside the page (where its op cap would be counting)
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(await f.call('getWorldInfo')).toBe('read');
    expect(await Promise.all([first, second])).toEqual(['write A', 'write B']);
    expect(order).toEqual([
      'write A issued',
      'read issued',
      'read done',
      'write A done',
      'write B issued',
      'write B done',
    ]);
  });

  it('a write that fails releases the queue for the next', async () => {
    const { f } = connected({
      answer: async ({ a }) => {
        if ((a as { name: string }).name === 'A') {
          throw new Error('page.evaluate: PageError:invalid: refused');
        }
        return { result: 'B' };
      },
      probe: async () => true,
    });
    const first = f.call('updateActor', { actorIdentifier: 'a1', name: 'A' }).catch(e => e);
    const second = f.call('updateActor', { actorIdentifier: 'a1', name: 'B' });
    expect(await first).toMatchObject({ code: 'invalid', detail: 'refused' });
    expect(await second).toBe('B');
  });

  it('writes issued together against a connect that fails share that one connect and fail together', async () => {
    // An unreachable box: connect() is the real one, its work (wake, launch, join) fails.
    const f = Object.create(Foundry.prototype) as Foundry;
    const doConnect = vi.fn(async () => {
      await sleep(10);
      throw new Error('connect ECONNREFUSED 127.0.0.1:30000');
    });
    Object.assign(f, {
      cfg: { serverUrl: 'http://localhost:30000', user: 'Bridge', idleLogoutMs: 0 },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ready: false,
      inflight: 0,
      lastUsed: 0,
      doConnect,
    });
    const settled = await Promise.allSettled(
      ['A', 'B', 'C'].map(name => f.call('updateActor', { actorIdentifier: 'a1', name }))
    );
    expect(doConnect).toHaveBeenCalledTimes(1); // queued first, each paid its own connect in turn
    expect(settled.map(s => s.status)).toEqual(['rejected', 'rejected', 'rejected']);
    for (const s of settled) {
      expect((s as PromiseRejectedResult).reason).toMatchObject({
        code: 'connection',
        detail: 'connect ECONNREFUSED 127.0.0.1:30000',
      });
    }
  });

  it('a write that arrives while the connect is under way joins it, and leaves its page alone', async () => {
    // The real connect over a fake page; the wake holds it after the page is open. A call that
    // cleared the page there failed the connect for both writes at its next step.
    let wake: () => void = () => {};
    const woken = new Promise<void>(resolve => {
      wake = resolve;
    });
    const page = {
      setDefaultTimeout: vi.fn(),
      evaluate: vi.fn(async (_fn: unknown, arg?: { a: { name: string } }) =>
        arg ? { result: arg.a.name } : { worldId: 'w', role: 4 }
      ),
      isClosed: () => false,
    };
    const newPage = vi.fn(async () => page);
    const step = vi.fn(async () => {});
    const f = Object.create(Foundry.prototype) as Foundry;
    Object.assign(f, {
      cfg: { serverUrl: 'http://localhost:30000', user: 'Bridge', idleLogoutMs: 0 },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      browser: { isConnected: () => true },
      context: { newPage },
      ready: false,
      inflight: 0,
      lastUsed: 0,
      wake: vi.fn(() => woken),
      ensureWorldReady: step,
      joinWorld: step,
      injectBundle: step,
      markSeat: step,
      warmIndexes: vi.fn(),
      armIdle: vi.fn(),
    });
    const first = f.call('updateActor', { actorIdentifier: 'a1', name: 'A' });
    await sleep(5); // the connect has its page and waits on the wake
    const second = f.call('updateActor', { actorIdentifier: 'a1', name: 'B' });
    await sleep(5);
    wake();
    expect(await Promise.all([first, second])).toEqual(['A', 'B']);
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(f.isReady()).toBe(true);
  });
});

describe('lastWorldId(): the world of the last connect, read without connecting (issue #6 review)', () => {
  it('answers the cached id, never connects, and is undefined before the first connect', () => {
    const { f, retried } = connected({ answer: never, probe: never });
    expect(f.lastWorldId()).toBeUndefined();
    Object.assign(f, { liveWorldId: 'w', ready: false });
    expect(f.lastWorldId()).toBe('w');
    expect(retried).not.toHaveBeenCalled();
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

describe('info(): the seat and the wake, for the bridge block (issue #9)', () => {
  /** A bridge whose /join probes answer `states` in turn (then joinable); nothing else is real. */
  function probing(states: string[]) {
    const f = Object.create(Foundry.prototype) as Foundry;
    const queue = [...states];
    Object.assign(f, {
      cfg: { serverUrl: 'http://foundry.unit.test', user: 'Bridge', wakeTimeoutMs: 60_000 },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      seatSince: null,
      woken: false,
      probeJoinState: vi.fn(async () => queue.shift() ?? 'joinable'),
      wake: vi.fn(async () => {}),
    });
    return f;
  }
  const page = { waitForTimeout: vi.fn(async () => {}) };

  it("woken: this connect's first /join probe found no world to join", async () => {
    const cold = probing(['booting', 'booting', 'joinable']);
    await (cold as any).ensureWorldReady(page);
    expect(cold.info()).toEqual({
      serverUrl: 'http://foundry.unit.test',
      fallbackUrl: null,
      url: 'http://foundry.unit.test',
      user: 'Bridge',
      since: null,
      woken: true,
    });
    const warm = probing(['joinable']);
    await (warm as any).ensureWorldReady(page);
    expect(warm.info().woken).toBe(false);
    // the next connect that finds the world up says so, whatever the one before found
    await (cold as any).ensureWorldReady(page);
    expect(cold.info().woken).toBe(false);
  });

  it('since: the seat record of this connection, gone once the seat is cleared', async () => {
    const f = probing([]);
    Object.assign(f, { seatSince: '2026-10-11T13:05:00.000Z' });
    expect(f.info().since).toBe('2026-10-11T13:05:00.000Z');
    await (f as any).clearSeat();
    expect(f.info().since).toBeNull();
  });
});

describe('joinWaitVerdict: what a join that ran out its budget reads as (2026-11-04)', () => {
  const sample = (at: number, over: Partial<JoinSample> = {}): JoinSample => ({
    at,
    ready: false,
    readyState: 'complete',
    worldId: 'w',
    canvasLoading: true,
    loading: null,
    errors: [],
    requests: 0,
    inflight: 0,
    bytes: 0,
    ...over,
  });
  const every5s = (fill: (t: number) => Partial<JoinSample>) => {
    const samples: JoinSample[] = [];
    for (let t = 0; t <= 300_000; t += 5_000) samples.push(sample(t, fill(t)));
    return samples;
  };

  it('bytes still arriving with requests pending: the link is slow, not the server', () => {
    // the world's data arrived at 12 s; 35 bytes/ms (2.1 MB/min) keep coming; 38 requests pending
    const v = joinWaitVerdict(
      every5s(t => ({
        worldId: t >= 12_000 ? 'w' : null,
        requests: 40 + t / 5_000,
        inflight: 38,
        bytes: t * 35,
        loading: 'Loading Scene Assets',
      })),
      300_000,
      'https://foundry.example.org'
    );
    expect(v.transport).toBe(true);
    expect(v.message).toContain(
      'Join did not reach game.ready within 300 s on https://foundry.example.org: world data vended at 00:15, 38 requests still in flight, 2.0 MB/min over the last minute (10.0 MB in 100 requests in all)'
    );
    expect(v.message).toContain('the loading bar at "Loading Scene Assets"');
    expect(v.message).toContain('the link is slow, not the server');
    expect(v.message).toContain('FOUNDRY_URL_FALLBACK');
  });

  it('nothing vended and nothing arriving: the server never answered the join', () => {
    const v = joinWaitVerdict(
      every5s(() => ({ worldId: null, requests: 1, inflight: 1, bytes: 0, readyState: 'loading' })),
      300_000,
      'https://a'
    );
    expect(v.transport).toBe(true);
    expect(v.message).toContain('no world data arrived, 1 request still in flight');
    expect(v.message).toContain('the server never answered the join');
  });

  it("vended, nothing in flight, nothing arriving: the world's own load, not the link", () => {
    const v = joinWaitVerdict(
      every5s(t => ({ requests: 90, inflight: 0, bytes: Math.min(t, 30_000) * 100 })),
      300_000,
      'https://a'
    );
    expect(v.transport).toBe(false);
    expect(v.message).toContain('0 requests still in flight, 0.0 MB/min over the last minute');
    expect(v.message).toContain("stuck in the world's own load");
    expect(v.message).not.toContain('FOUNDRY_URL_FALLBACK');
  });

  it('requests pending with nothing arriving for the last minute: the path stalled', () => {
    const v = joinWaitVerdict(
      every5s(t => ({ requests: 90, inflight: 3, bytes: Math.min(t, 30_000) * 100 })),
      300_000,
      'https://a'
    );
    expect(v.transport).toBe(true);
    expect(v.message).toContain('the path stalled');
  });

  it('a wait shorter than a minute rates the whole of it', () => {
    const v = joinWaitVerdict(
      [
        sample(0, { worldId: null, inflight: 2 }),
        sample(10_000, { worldId: null, inflight: 2, bytes: 1_048_576 }),
      ],
      10_000,
      'https://a'
    );
    expect(v.message).toContain('6.0 MB/min');
    expect(v.transport).toBe(true);
  });
});

/**
 * A page the join wait looks at: `looks` answers each evaluate in turn (the last one repeats);
 * waitForTimeout is a real timer, so the test drives it with fake timers.
 */
function waitingPage(looks: Array<Partial<ReturnType<typeof look>>>) {
  const queue = [...looks];
  let closed = false;
  const page = {
    isClosed: () => closed,
    close: vi.fn(async () => {
      closed = true;
    }),
    evaluate: vi.fn(async () => ({ ...look(), ...(queue.length > 1 ? queue.shift() : queue[0]) })),
    waitForTimeout: vi.fn((ms: number) => new Promise<void>(r => setTimeout(r, ms))),
  };
  return page;
}
function look() {
  return {
    ready: false,
    readyState: 'complete',
    worldId: null as string | null,
    canvasLoading: null as boolean | null,
    loading: null as string | null,
    errors: [] as string[],
  };
}
const traffic = (inflight: number, bytes = 0) => ({
  counts: () => ({ requests: inflight + 2, inflight, bytes }),
  stop: vi.fn(),
});

describe('the wait for game.ready is watched (2026-11-04)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  function waiting(readyTimeoutMs: number) {
    const f = Object.create(Foundry.prototype) as Foundry;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    Object.assign(f, { cfg: { serverUrl: 'https://a', user: 'Bridge', readyTimeoutMs }, log });
    return { f: f as any, log };
  }

  it('answers once game.ready is true, logging what it saw meanwhile at debug', async () => {
    const { f, log } = waiting(60_000);
    const page = waitingPage([
      { readyState: 'loading' },
      { worldId: 'w', loading: 'Loading Scene Assets' },
      { worldId: 'w', ready: true },
    ]);
    const run = watch(f.awaitReady(page, traffic(4, 2_097_152)));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(run.settled).toBe(true);
    expect(run.error).toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith(
      'join wait 00:00: no world data yet, 4 in flight, 2.0 MB received, document loading'
    );
    expect(log.debug).toHaveBeenCalledTimes(1); // the next line would come at 5 s
  });

  it('fails at once on an error banner, as before', async () => {
    const { f } = waiting(60_000);
    const page = waitingPage([{}, { errors: ['Join failed: no such user'] }]);
    const run = watch(f.awaitReady(page, traffic(0)));
    await vi.advanceTimersByTimeAsync(1_500);
    expect((run.error as Error).message).toBe(
      'Join did not reach game.ready (error: Join failed: no such user).'
    );
    expect(run.error).not.toBeInstanceOf(TransportProblem);
  });

  it('the budget run out is a TransportProblem naming what was seen when the path is the likely cause', async () => {
    const { f } = waiting(3_000);
    const page = waitingPage([{ readyState: 'loading' }]);
    const run = watch(f.awaitReady(page, traffic(1)));
    await vi.advanceTimersByTimeAsync(3_500);
    expect(run.error).toBeInstanceOf(TransportProblem);
    expect((run.error as Error).message).toContain(
      'Join did not reach game.ready within 3 s on https://a: no world data arrived, 1 request still in flight'
    );
    expect((run.error as Error).message).toContain('the server never answered the join');
    expect(page.evaluate).toHaveBeenCalledTimes(4); // at 0, 1, 2 and 3 s
  });

  it('a page closed under the wait (a dispose) ends it', async () => {
    const { f } = waiting(60_000);
    const page = waitingPage([{}]);
    const run = watch(f.awaitReady(page, traffic(1)));
    await vi.advanceTimersByTimeAsync(500);
    await page.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((run.error as Error).message).toContain('the page closed while the join waited');
  });
});

/**
 * A connect over fake Playwright objects: the launch, the context and the page are stubs whose
 * close() is recorded; the context's close closes the page, as Playwright's does. The steps are
 * stubbed as in `connecting`, the join by the test.
 */
function launching(opts: {
  joinWorld: (this: any, page: any) => Promise<void>;
  cfg?: Partial<FoundryConfig>;
  launch?: () => Promise<any>;
  ensureWorldReady?: (this: any) => Promise<void>;
}) {
  const pages: any[] = [];
  const newPage = vi.fn(async () => {
    let closed = false;
    const waiters: Array<() => void> = [];
    const page = {
      setDefaultTimeout: vi.fn(),
      isClosed: () => closed,
      close: vi.fn(async () => {
        closed = true;
        for (const w of waiters) w();
      }),
      /** Resolves when the page is closed (a wait the dispose cuts short). */
      onceClosed: () => new Promise<void>(r => (closed ? r() : waiters.push(r))),
      evaluate: vi.fn(async () => ({ worldId: 'w', role: 4 })),
    };
    pages.push(page);
    return page;
  });
  const context = {
    newPage,
    close: vi.fn(async () => {
      for (const pg of pages) await pg.close();
    }),
  };
  const browser = {
    isConnected: () => true,
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const os = { alive: vi.fn(() => false), exe: vi.fn(async () => null), kill: vi.fn() };
  const f = Object.create(Foundry.prototype) as Foundry;
  Object.assign(f, {
    cfg: { serverUrl: 'https://primary.example.org', user: 'Bridge', idleLogoutMs: 0, ...opts.cfg },
    log,
    os,
    ready: false,
    inflight: 0,
    lastUsed: 0,
    generation: 0,
    launchBrowser: vi.fn(opts.launch ?? (async () => browser)),
    browserPid: vi.fn(async () => 4242),
    wake: vi.fn(async () => {}),
    ensureWorldReady: vi.fn(opts.ensureWorldReady ?? (async () => {})),
    joinWorld: vi.fn(opts.joinWorld),
    injectBundle: vi.fn(async () => {}),
    markSeat: vi.fn(async () => {}),
    clearSeat: vi.fn(async () => {}),
    warmIndexes: vi.fn(),
    armIdle: vi.fn(),
  });
  return { f, pages, context, browser, log, os };
}
const settle = () => new Promise(r => setTimeout(r, 5));

describe('dispose() ends the browser at once, a join under way included (2026-11-04)', () => {
  it('cuts a join that never reaches game.ready short: the browser is ended now, the connect fails, nothing is kept', async () => {
    const { f, pages, context, browser } = launching({
      // the join waits until its page is closed under it, then fails as Playwright would
      joinWorld: async page => {
        await page.onceClosed();
        throw new Error('page.waitForTimeout: Target page, context or browser has been closed');
      },
    });
    const call = f.connect().catch(e => e);
    await settle();
    expect(pages).toHaveLength(1);
    const outcome = await f.dispose();
    expect(outcome).toEqual({ endedBrowser: true, wasConnecting: true });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    const err = await call;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.detail).toBe('the bridge was disposed while it was connecting');
    expect(f.isReady()).toBe(false);
    expect((f as any).browser).toBeUndefined();
  });

  it('a connect that fails at the join closes the page it opened (its socket with it); the browser stays for the next', async () => {
    const { f, pages, browser } = launching({
      joinWorld: async () => {
        throw new Error('Join did not reach game.ready (error: no such user).');
      },
    });
    const err = await f.connect().catch(e => e);
    expect(err.detail).toBe('Join did not reach game.ready (error: no such user).');
    expect(pages[0].close).toHaveBeenCalledTimes(1);
    expect((f as any).page).toBeUndefined();
    expect(browser.close).not.toHaveBeenCalled();
    // and a dispose then ends that browser, saying so
    expect(await f.dispose()).toEqual({ endedBrowser: true, wasConnecting: false });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('a browser launched after the dispose began is closed, never kept', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    const late = { isConnected: () => true, newContext: vi.fn(), close: vi.fn(async () => {}) };
    const { f } = launching({
      joinWorld: async () => {},
      launch: async () => {
        await gate;
        return late;
      },
    });
    const call = f.connect().catch(e => e);
    await settle();
    const disposing = f.dispose();
    await settle();
    release();
    const [outcome, err] = await Promise.all([disposing, call]);
    expect(outcome).toEqual({ endedBrowser: false, wasConnecting: true });
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(late.newContext).not.toHaveBeenCalled();
    expect(err.detail).toBe('the bridge was disposed while it was connecting');
    expect((f as any).browser).toBeUndefined();
  });

  it('a browser process that outlives browser.close() is ended by pid; another program under that pid is left alone', async () => {
    vi.useFakeTimers();
    try {
      const { f, os, log } = launching({ joinWorld: async () => {} });
      await f.connect();
      os.alive.mockReturnValue(true);
      os.exe.mockResolvedValue(
        'C:\\pw\\chromium_headless_shell-1228\\chrome-win\\chrome-headless-shell.exe'
      );
      const disposing = f.dispose();
      await vi.advanceTimersByTimeAsync(3_500);
      expect(await disposing).toEqual({ endedBrowser: true, wasConnecting: false });
      expect(os.kill).toHaveBeenCalledWith(4242);
      expect(log.warn).toHaveBeenCalledWith('browser pid 4242 outlived browser.close() — ended it');

      const other = launching({ joinWorld: async () => {} });
      await other.f.connect();
      other.os.alive.mockReturnValue(true);
      other.os.exe.mockResolvedValue('C:\\Windows\\notepad.exe');
      const again = other.f.dispose();
      await vi.advanceTimersByTimeAsync(3_500);
      await again;
      expect(other.os.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FOUNDRY_URL_FALLBACK: a timeout on the primary is retried once on the fallback', () => {
  const cfg = { fallbackUrl: 'http://box.example.org:30000/' };

  it('joins through the fallback on a fresh page, and get-world-info says so', async () => {
    const bases: string[] = [];
    let joins = 0;
    const { f, pages, log } = launching({
      cfg,
      ensureWorldReady: async function (this: any) {
        bases.push(this.base);
      },
      joinWorld: async () => {
        if (joins++ === 0)
          throw new TransportProblem(
            'Join did not reach game.ready within 300 s on https://primary.example.org: …'
          );
      },
    });
    await f.connect();
    expect(bases).toEqual(['https://primary.example.org', 'http://box.example.org:30000']);
    expect(pages).toHaveLength(2);
    expect(pages[0].close).toHaveBeenCalledTimes(1); // the primary's page, its socket with it
    expect(pages[1].close).not.toHaveBeenCalled();
    expect(f.isReady()).toBe(true);
    expect(f.info()).toMatchObject({
      serverUrl: 'https://primary.example.org',
      fallbackUrl: 'http://box.example.org:30000/',
      url: 'http://box.example.org:30000',
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'timed out before game.ready — trying FOUNDRY_URL_FALLBACK http://box.example.org:30000 once'
      )
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('through http://box.example.org:30000, FOUNDRY_URL_FALLBACK')
    );
  });

  it('the next connect starts on the primary again', async () => {
    let joins = 0;
    const { f } = launching({
      cfg,
      joinWorld: async () => {
        if (joins++ === 0) throw new TransportProblem('timed out');
      },
    });
    await f.connect();
    expect(f.info().url).toBe('http://box.example.org:30000');
    Object.assign(f, { ready: false, page: undefined });
    await f.connect();
    expect(f.info().url).toBe('https://primary.example.org');
  });

  it('a refusal is never retried: the same user is missing on every path', async () => {
    const { f, pages } = launching({
      cfg,
      joinWorld: async () => {
        throw new ConnectProblem('FOUNDRY_USER "Bridge" is not a user of this world');
      },
    });
    const err = await f.connect().catch(e => e);
    expect(err).toMatchObject({ code: 'connection', explained: true });
    expect(pages).toHaveLength(1);
  });

  it('a timeout on the fallback too names both', async () => {
    const { f } = launching({
      cfg,
      joinWorld: async function (this: any) {
        throw new TransportProblem(`Foundry /join form never appeared on ${this.base}`);
      },
    });
    const err = await f.connect().catch(e => e);
    expect(err.detail).toBe(
      'Foundry /join form never appeared on http://box.example.org:30000 (on FOUNDRY_URL_FALLBACK ' +
        'http://box.example.org:30000; FOUNDRY_URL https://primary.example.org failed first: ' +
        'Foundry /join form never appeared on https://primary.example.org)'
    );
  });

  it('without a fallback, a timeout is the error, on the primary', async () => {
    const { f, pages } = launching({
      joinWorld: async () => {
        throw new TransportProblem('timed out');
      },
    });
    const err = await f.connect().catch(e => e);
    expect(err.detail).toBe('timed out');
    expect(pages).toHaveLength(1);
    expect(f.info().fallbackUrl).toBeNull();
  });
});
