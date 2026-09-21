// The Node side of the error contract (the page side is src/page/errors.ts).
//
// Every failure of `foundry.call` — and a connect that never reached a joinable world — is a
// BridgeError. It carries the page's own words (`detail`), the handler that failed (`fn`) and a
// CODE: the page's PageError code when the handler refused the call, `'connection'` when the
// bridge itself failed, undefined for an uncoded throw (Foundry's own TypeError, a plain
// `new Error` in a handler). The central error mapper (src/utils/error-handler.ts) turns the code
// into guidance and never classifies by substring; an uncoded error reaches the model as its raw
// words. Sibling harnesses get the same class from `fvtt-mcp-dnd5e/client`.

import { type PageErrorCode, pageErrorCode } from './page/errors.js';

export type BridgeErrorCode = PageErrorCode | 'connection';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode | undefined;
  /** The page handler that failed (`getCharacterInfo`); undefined for a connect failure. */
  readonly fn: string | undefined;
  /** The page's or the bridge's own words — the message without the seam's plumbing. */
  readonly detail: string;
  /** The in-page stack Chromium reported, for logs; never part of the message. */
  readonly pageStack: string | undefined;

  constructor(opts: {
    code?: BridgeErrorCode | undefined;
    fn?: string | undefined;
    detail: string;
    pageStack?: string | undefined;
    cause?: unknown;
  }) {
    // The message keeps the 2.x shape the sibling harnesses print (`foundry.call(<fn>) failed: …`),
    // minus the `page.evaluate: Error:` prefix and the folded in-page stack they used to carry.
    super(opts.fn ? `foundry.call('${opts.fn}') failed: ${opts.detail}` : opts.detail, {
      cause: opts.cause,
    });
    this.name = 'BridgeError';
    this.code = opts.code;
    this.fn = opts.fn;
    this.detail = opts.detail;
    this.pageStack = opts.pageStack;
  }
}

/**
 * What Playwright hands Node for an in-page throw, taken apart. Chromium reports the thrown
 * error as its V8 description — `${name}: ${message}` and then the in-page stack frames — and
 * Playwright prefixes the API name: `page.evaluate: PageError:not-found: Actor "Gren" not found
 * \n    at eval (…)`. The name is the only channel a page-side code survives in (a custom
 * property does not cross the seam), so it is read back from the header here. A plain `Error:`
 * header adds nothing and is dropped; any other name (`TypeError`) is informative and stays in
 * the detail.
 */
export function parsePageThrow(raw: string): {
  code: PageErrorCode | undefined;
  detail: string;
  pageStack: string | undefined;
} {
  let text = raw.replace(/^page\.evaluate: /, '');
  const stackAt = text.search(/\r?\n\s+at /);
  const pageStack = stackAt >= 0 ? text.slice(stackAt).trim() : undefined;
  if (stackAt >= 0) text = text.slice(0, stackAt);
  text = text.trim();
  const coded = /^(PageError:[a-z-]+): /.exec(text);
  if (coded) {
    return { code: pageErrorCode(coded[1] ?? ''), detail: text.slice(coded[0].length), pageStack };
  }
  return { code: undefined, detail: text.replace(/^Error: /, ''), pageStack };
}

/** Wrap whatever a `foundry.call` threw as a BridgeError for handler `fn` (idempotent). */
export function asCallError(fn: string, err: unknown): BridgeError {
  if (err instanceof BridgeError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const { code, detail, pageStack } = parsePageThrow(raw);
  // Playwright's own failures mid-call — the page or browser closed under the call, a timeout —
  // are the session's, not the handler's.
  const playwright = err instanceof Error ? err.name : '';
  const sessionLost = playwright === 'TargetClosedError' || playwright === 'TimeoutError';
  return new BridgeError({
    code: sessionLost ? 'connection' : code,
    fn,
    detail,
    pageStack,
    cause: err,
  });
}

/** Wrap whatever the connect path threw as a `connection` BridgeError (idempotent). */
export function asConnectError(err: unknown): BridgeError {
  if (err instanceof BridgeError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new BridgeError({ code: 'connection', detail, cause: err });
}
