/**
 * The cap on one page op (issue #16). A page op is one `page.evaluate`, and nothing bounded it: a
 * script stuck in `while (true) {}` (run-script's own timeout cannot preempt synchronous code) hung
 * its tool call, the idle logout never fired under the call in flight, and the bridge held its seat
 * until someone ran disconnect-bridge. `raceWithCap` waits for the op up to `capMs`, then asks the
 * page whether it still answers (`probe`, given `probeMs`). A page that answers is slow, not stuck:
 * the op keeps its time and the page is asked again every `capMs`, up to `hardMs` in all. A page
 * that does not answer, or the ceiling, ends the wait with an `OpCapError`; what to do with the page
 * is the caller's (src/foundry.ts closes it). Node-side and pure: no Playwright here.
 */

export type OpCapReason = 'unresponsive' | 'ceiling';

/** The wait on a page op was given up; `reason` says why. The op's own outcome is unknown. */
export class OpCapError extends Error {
  readonly elapsedMs: number;
  readonly reason: OpCapReason;

  constructor(
    message: string,
    elapsedMs: number,
    reason: OpCapReason,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'OpCapError';
    this.elapsedMs = elapsedMs;
    this.reason = reason;
  }
}

export interface OpCapOptions {
  /** How long the op runs before the page is asked whether it still answers (and between asks). */
  capMs: number;
  /** How long the page has to answer that probe. */
  probeMs: number;
  /** The ceiling: no op is waited on longer than this in all, answering page or not. */
  hardMs: number;
  /** Called each time the page answers a probe while the op is still running. */
  onSlow?: (elapsedMs: number) => void;
}

const TIMEOUT = Symbol('timeout');
const ANSWERED = Symbol('answered');
const SILENT = Symbol('silent');

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** `promise`, or TIMEOUT after `ms`; the timer never outlives the race. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>(resolve => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function settle<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

const seconds = (ms: number) => Math.round(ms / 1000);

/**
 * `work`'s value (or its error), unless the wait is given up first: the page stopped answering
 * (`unresponsive`, at `capMs` + up to `probeMs` after the last answer) or `hardMs` passed
 * (`ceiling`). Given up, `work` is left to settle on its own, its rejection already handled.
 */
export async function raceWithCap<T>(
  work: Promise<T>,
  probe: () => Promise<unknown>,
  opts: OpCapOptions
): Promise<T> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  // Handled from the start: giving up on the op never leaves an unhandled rejection behind.
  const outcome: Promise<Outcome<T>> = work.then(
    value => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error })
  );
  for (;;) {
    const left = opts.hardMs - elapsed();
    if (left <= 0) {
      throw new OpCapError(
        `the op ran into the ${seconds(opts.hardMs)} s ceiling`,
        elapsed(),
        'ceiling'
      );
    }
    const done = await within(outcome, Math.min(opts.capMs, left));
    if (done !== TIMEOUT) return settle(done);
    if (elapsed() >= opts.hardMs) continue; // the ceiling, thrown above
    // Ask the page; the op may still finish while it is asked, and then that is the answer.
    const asked = Promise.resolve()
      .then(probe)
      .then<typeof ANSWERED, typeof SILENT>(
        () => ANSWERED,
        () => SILENT
      );
    const answer = await within(Promise.race([outcome, asked]), opts.probeMs);
    if (answer === ANSWERED) {
      opts.onSlow?.(elapsed());
      continue;
    }
    if (answer !== TIMEOUT && answer !== SILENT) return settle(answer);
    throw new OpCapError(
      `the op did not finish within ${seconds(elapsed())} s and the page did not answer`,
      elapsed(),
      'unresponsive'
    );
  }
}
