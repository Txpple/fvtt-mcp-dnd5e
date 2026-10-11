// The startup browser check (issue #3, item 9). The paths are Playwright's own, read from the
// installed package; only the existence test is stubbed.
// The op cap on a fake page (issue #16): a wedged page is closed and the op is not retried; a slow
// op on a page that answers is never killed; run-script's cap is its timeout + 30 s.
// The role warning at connect, on a fake page (issue #8): a read-only registration wants a Player
// or Trusted Player, a full one a Gamemaster or Assistant GM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from './bridge-error.js';
import { chromiumProblem, Foundry, type FoundryConfig } from './foundry.js';

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
 * op's evaluate (its argument is `{ n, a }`); the probe (`evaluate(() => 1)`, no argument) gets
 * `probe()`. A reconnect or a recover would be a retry, so both fail the test if reached.
 */
function connected(opts: {
  answer: (arg: { n: string; a: unknown }) => Promise<unknown>;
  probe: () => Promise<unknown>;
  cfg?: Partial<FoundryConfig>;
}) {
  let closed = false;
  const page = {
    evaluate: vi.fn((_fn: unknown, arg?: { n: string; a: unknown }) =>
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
    recover: retried,
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
      answer: () => new Promise(resolve => setTimeout(() => resolve({ id: 'w' }), 3_500)),
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
