/**
 * The cap on one page op (issue #16), on fake promises and fake timers: the fast path, a slow op on
 * a page that answers (never killed), a page that stops answering (given up at cap + probe), the
 * ceiling, and an op that settles after the wait was given up (no unhandled rejection).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpCapError, raceWithCap } from './op-cap.js';

/** A promise that settles after `ms` of fake time. */
const settleAfter = <T>(ms: number, value: T, fail = false) =>
  new Promise<T>((resolve, reject) => {
    setTimeout(() => (fail ? reject(value) : resolve(value)), ms);
  });
const never = () => new Promise<never>(() => {});

/** Watch a promise settle without awaiting it. */
function watch<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    value => Object.assign(state, { settled: true, value }),
    error => Object.assign(state, { settled: true, error })
  );
  return state;
}

const CAP = { capMs: 1_000, probeMs: 500, hardMs: 10_000 };

describe('raceWithCap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the fast path: the op answers before its cap, and the page is never asked', async () => {
    const probe = vi.fn(async () => 1);
    const run = watch(raceWithCap(settleAfter(100, 'done'), probe, CAP));
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toMatchObject({ settled: true, value: 'done' });
    expect(probe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the op's own error is its error, not a cap", async () => {
    const run = watch(
      raceWithCap(settleAfter(50, new Error('PageError:invalid: no'), true), never, CAP)
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(run.settled).toBe(true);
    expect(run.error).toBeInstanceOf(Error);
    expect(run.error).not.toBeInstanceOf(OpCapError);
  });

  it('a slow op on a page that answers is never killed by the cap', async () => {
    const probe = vi.fn(async () => 1);
    const onSlow = vi.fn();
    const run = watch(raceWithCap(settleAfter(3_500, 'late'), probe, { ...CAP, onSlow }));
    await vi.advanceTimersByTimeAsync(3_499);
    expect(run.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toMatchObject({ settled: true, value: 'late' });
    expect(probe).toHaveBeenCalledTimes(3); // asked at 1, 2 and 3 s
    expect(onSlow.mock.calls.map(c => c[0])).toEqual([1_000, 2_000, 3_000]);
  });

  it('a page that stops answering is given up at cap + probe, as unresponsive', async () => {
    const run = watch(raceWithCap(never(), never, CAP));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(run.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.error).toBeInstanceOf(OpCapError);
    expect(run.error).toMatchObject({ reason: 'unresponsive', elapsedMs: 1_500 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a probe that fails (the page is gone) is no answer', async () => {
    const run = watch(raceWithCap(never(), async () => Promise.reject(new Error('closed')), CAP));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.error).toMatchObject({ reason: 'unresponsive', elapsedMs: 1_000 });
  });

  it('an op that finishes while the page is being asked is its answer', async () => {
    const run = watch(raceWithCap(settleAfter(1_200, 'just in time'), never, CAP));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(run).toMatchObject({ settled: true, value: 'just in time' });
  });

  it('the ceiling ends the wait even on a page that answers', async () => {
    const run = watch(
      raceWithCap(never(), async () => 1, { capMs: 1_000, probeMs: 500, hardMs: 3_500 })
    );
    await vi.advanceTimersByTimeAsync(3_499);
    expect(run.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.error).toBeInstanceOf(OpCapError);
    expect(run.error).toMatchObject({ reason: 'ceiling', elapsedMs: 3_500 });
  });

  it('an op that fails after the wait was given up leaves no unhandled rejection', async () => {
    const late = settleAfter(5_000, new Error('the page closed under it'), true);
    const run = watch(raceWithCap(late, never, CAP));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(run.error).toBeInstanceOf(OpCapError);
    // vitest fails the run on an unhandled rejection; advancing past the late failure is the check
    await vi.advanceTimersByTimeAsync(5_000);
  });
});
