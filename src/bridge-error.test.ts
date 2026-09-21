/**
 * The Node side of the error contract: what Playwright hands us for an in-page throw, taken
 * apart into code / detail / stack, and the BridgeError the seam throws.
 */

import { describe, expect, it } from 'vitest';
import { BridgeError, asCallError, asConnectError, parsePageThrow } from './bridge-error.js';

describe('parsePageThrow — the header Chromium reports is the code channel', () => {
  it('reads a PageError code back from the name and drops the in-page stack', () => {
    const parsed = parsePageThrow(
      'page.evaluate: PageError:not-found: Actor "Gren" not found\n    at eval (eval at evaluate (:1:1), <anonymous>:3:9)\n    at UtilityScript.evaluate'
    );
    expect(parsed).toEqual({
      code: 'not-found',
      detail: 'Actor "Gren" not found',
      pageStack:
        'at eval (eval at evaluate (:1:1), <anonymous>:3:9)\n    at UtilityScript.evaluate',
    });
  });

  it('drops a plain `Error:` header (it adds nothing)', () => {
    expect(parsePageThrow('page.evaluate: Error: Journal entry not found')).toEqual({
      code: undefined,
      detail: 'Journal entry not found',
      pageStack: undefined,
    });
  });

  it("keeps any other name (Foundry's own TypeError is informative)", () => {
    expect(
      parsePageThrow(
        "page.evaluate: TypeError: Cannot read properties of undefined (reading 'pages')"
      ).detail
    ).toBe("TypeError: Cannot read properties of undefined (reading 'pages')");
  });

  it('treats an unknown code as uncoded and a missing prefix as plain text', () => {
    expect(parsePageThrow('page.evaluate: PageError:bogus: x').code).toBeUndefined();
    expect(parsePageThrow('plain text')).toEqual({
      code: undefined,
      detail: 'plain text',
      pageStack: undefined,
    });
  });
});

describe('asCallError / asConnectError', () => {
  it('keeps the 2.x message shape the sibling harnesses print, without the plumbing', () => {
    const err = asCallError(
      'getCharacterInfo',
      new Error('page.evaluate: PageError:not-found: Actor "Gren" not found\n    at x (y)')
    );
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.message).toBe('foundry.call(\'getCharacterInfo\') failed: Actor "Gren" not found');
    expect(err.code).toBe('not-found');
    expect(err.fn).toBe('getCharacterInfo');
    expect(err.detail).toBe('Actor "Gren" not found');
    expect(err.pageStack).toBe('at x (y)');
  });

  it("codes Playwright's own mid-call failures as connection", () => {
    const closed = Object.assign(
      new Error('page.evaluate: Target page, context or browser has been closed'),
      {
        name: 'TargetClosedError',
      }
    );
    expect(asCallError('listActors', closed).code).toBe('connection');
    const timeout = Object.assign(new Error('page.evaluate: Timeout 30000ms exceeded.'), {
      name: 'TimeoutError',
    });
    expect(asCallError('listActors', timeout).code).toBe('connection');
  });

  it('is idempotent and handles non-Error throwables', () => {
    const once = asCallError('x', new Error('page.evaluate: PageError:invalid: nope'));
    expect(asCallError('x', once)).toBe(once);
    expect(asCallError('x', 'thrown string').detail).toBe('thrown string');
    const conn = asConnectError(new Error('net::ERR_CONNECTION_REFUSED at http://x/join'));
    expect(conn.code).toBe('connection');
    expect(conn.fn).toBeUndefined();
    expect(conn.message).toBe('net::ERR_CONNECTION_REFUSED at http://x/join');
    expect(asConnectError(conn)).toBe(conn);
  });
});
