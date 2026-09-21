/**
 * The page side of the error contract: the code rides in the Error's `name`, and V8 puts the name
 * at the head of the error's description (`stack`) — which is what Chromium reports to Playwright
 * and Playwright to Node. Node's V8 is the same engine, so the header assumption is checked here.
 */

import { describe, expect, it } from 'vitest';
import {
  PAGE_ERROR_NAME_PREFIX,
  PageError,
  ambiguous,
  forbidden,
  invalid,
  notFound,
  pageErrorCode,
  rolledBack,
  unsupported,
} from './errors.js';

describe('PageError — the code in the name', () => {
  it('encodes the code in the name and keeps the message clean', () => {
    const err = notFound('Actor "Gren" not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('not-found');
    expect(err.name).toBe(`${PAGE_ERROR_NAME_PREFIX}not-found`);
    expect(err.message).toBe('Actor "Gren" not found');
  });

  it('puts `name: message` at the head of the V8 description (the channel that crosses the seam)', () => {
    const err = invalid('sceneIdentifier is required');
    expect(err.stack?.split('\n')[0]).toBe('PageError:invalid: sceneIdentifier is required');
    expect(String(err)).toBe('PageError:invalid: sceneIdentifier is required');
  });

  it('has one helper per code', () => {
    expect(ambiguous('x').code).toBe('ambiguous');
    expect(forbidden('x').code).toBe('permission');
    expect(unsupported('x').code).toBe('unsupported');
    expect(rolledBack('x').code).toBe('rolled-back');
    expect(new PageError('invalid', 'x').code).toBe('invalid');
  });
});

describe('pageErrorCode — reading the name back', () => {
  it('parses every code and nothing else', () => {
    for (const code of [
      'not-found',
      'ambiguous',
      'invalid',
      'permission',
      'unsupported',
      'rolled-back',
    ] as const) {
      expect(pageErrorCode(`${PAGE_ERROR_NAME_PREFIX}${code}`)).toBe(code);
    }
    expect(pageErrorCode('Error')).toBeUndefined();
    expect(pageErrorCode('TypeError')).toBeUndefined();
    expect(pageErrorCode(`${PAGE_ERROR_NAME_PREFIX}bogus`)).toBeUndefined();
    expect(pageErrorCode('NotFoundError')).toBeUndefined();
  });
});
