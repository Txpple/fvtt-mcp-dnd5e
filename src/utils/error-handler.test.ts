/**
 * Unit tests for ErrorHandler — the ONE mapper every tool failure routes through (the central
 * dispatch wrapper in index.ts). Since 3.0 M6 it classifies by the error's CODE (a BridgeError's
 * `code`, put there by the page's PageError name or by the bridge's connect path) and never by a
 * substring of the message: the original words are always the message, a code earns one hint.
 */

import { describe, expect, it } from 'vitest';
import { BridgeError, asCallError } from '../bridge-error.js';
import { PAGE_ERROR_NAME_PREFIX, type PageErrorCode } from '../page/errors.js';
import { ErrorHandler, HINTS } from './error-handler.js';

// Minimal logger stub — ErrorHandler only needs child()/warn/error.
const noopLogger: any = {
  child: () => noopLogger,
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const eh = new ErrorHandler(noopLogger);

/** What Node receives when page handler `fn` throws a PageError with `code` and `text`. */
function pageThrow(fn: string, code: PageErrorCode, text: string): BridgeError {
  const raw = `page.evaluate: ${PAGE_ERROR_NAME_PREFIX}${code}: ${text}\n    at eval (eval at evaluate (:1:1), <anonymous>:3:9)\n    at UtilityScript.evaluate`;
  return asCallError(fn, new Error(raw));
}

describe('ErrorHandler.toUserMessage — the original words survive, the code adds one hint', () => {
  // The 12 realistic page/tool errors the 2026-09 review ran through the 2.x mapper
  // (docs/review-2026-09/scripts/arch-seams-error-mangle.mjs): 11 of 12 lost their text to a
  // substring heuristic. Each now arrives with the code its handler attaches.
  const cases: Array<[string, string, PageErrorCode, string]> = [
    [
      'manage-placeables',
      'createSceneTiles',
      'invalid',
      'Scene "Crypt" has no grid; set gridType first',
    ],
    ['update-scene', 'updateScene', 'invalid', 'background.src must be a Data-relative path'],
    [
      'get-actor',
      'getCharacterInfo',
      'not-found',
      'Actor "Gren" not found (did you mean "Grendel"?)',
    ],
    ['update-actor', 'updateActor', 'invalid', 'invalid field path system.attributes.hp.vale'],
    [
      'set-actor-ownership',
      'setActorOwnership',
      'invalid',
      'unknown permission level "OBSERVR" — use OWNER/OBSERVER/LIMITED/NONE',
    ],
    [
      'manage-effect',
      'manageEffect',
      'invalid',
      'effect "Bless" is missing a change for system.bonuses.abilities.save',
    ],
    [
      'search-compendium-spells',
      'searchCompendium',
      'not-found',
      'pack dnd-players-handbook.spells not found — is the PHB installed?',
    ],
    [
      'upload-asset',
      'uploadFile',
      'invalid',
      'WebDAV PUT timeout after 30000ms for assets/maps/big.webp',
    ],
    [
      'asset-url',
      'statFile',
      'invalid',
      'FOUNDRY_WEBDAV_URL is unset; the file browser link cannot be built',
    ],
    [
      'create-actor-from-compendium',
      'createActorFromCompendium',
      'not-found',
      'entry owlbear not found in dnd-monster-manual.actors',
    ],
    [
      'list-journals',
      'listJournals',
      'invalid',
      "Cannot read properties of undefined (reading 'pages')",
    ],
    [
      'create-pc',
      'createPcActor',
      'rolled-back',
      'advancement transaction aborted at level 3: no HP choice',
    ],
  ];
  it.each(cases)('%s keeps its text and gets its own hint', (tool, fn, code, text) => {
    const msg = eh.toUserMessage(pageThrow(fn, code, text), tool);
    expect(msg.startsWith(text)).toBe(true);
    expect(msg).toContain(`[${code}] ${HINTS[code]}`);
    // no in-page stack, no bridge plumbing in what the model reads
    expect(msg).not.toMatch(/page\.evaluate|foundry\.call|\n\s+at /);
  });

  it('never classifies by a word in the message: "permission" in an invalid error stays invalid', () => {
    const msg = eh.toUserMessage(
      pageThrow('setActorOwnership', 'invalid', 'unknown permission level "OBSERVR"'),
      'set-actor-ownership'
    );
    expect(msg).toContain('[invalid]');
    expect(msg).not.toContain(HINTS.permission);
  });

  it('adds the search-compendium tip on a not-found across the actor-creation family only', () => {
    for (const tool of ['create-actor-from-compendium', 'author-npc']) {
      const msg = eh.toUserMessage(pageThrow('createActorFromCompendium', 'not-found', 'x'), tool);
      expect(msg).toContain('use search-compendium first to see available creatures');
    }
    const other = eh.toUserMessage(pageThrow('updateActor', 'not-found', 'x'), 'update-actor');
    expect(other).not.toContain('use search-compendium first');
  });

  it('gives a connection error the wake / launch guidance', () => {
    const err = new BridgeError({
      code: 'connection',
      detail: 'net::ERR_CONNECTION_REFUSED at http://x/join',
    });
    const msg = eh.toUserMessage(err, 'list-actors');
    expect(msg).toBe(
      `net::ERR_CONNECTION_REFUSED at http://x/join [connection] ${HINTS.connection}`
    );
  });
});

describe('ErrorHandler.toUserMessage — an uncoded error is its raw words, nothing added', () => {
  it("an uncoded page throw (Foundry's own TypeError) is the page's words, name kept", () => {
    const err = asCallError(
      'listJournals',
      new Error(
        "page.evaluate: TypeError: Cannot read properties of undefined (reading 'pages')\n    at listJournals (<anonymous>:12:3)"
      )
    );
    expect(eh.toUserMessage(err, 'list-journals')).toBe(
      "TypeError: Cannot read properties of undefined (reading 'pages')"
    );
  });

  it('an uncoded page throw with a trigger word gets NO guidance (the 2.x mangling)', () => {
    const err = asCallError(
      'getCharacterInfo',
      new Error('page.evaluate: Error: Actor "Gren" not found')
    );
    expect(eh.toUserMessage(err, 'get-actor')).toBe('Actor "Gren" not found');
  });

  it('passes ZodError messages through verbatim', () => {
    const zodish = Object.assign(new Error('Invalid input: expected string, received number'), {
      name: 'ZodError',
    });
    expect(eh.toUserMessage(zodish, 'create-actor-from-compendium')).toBe(
      'Invalid input: expected string, received number'
    );
  });

  it('falls back to the raw message for any other throwable', () => {
    expect(eh.toUserMessage(new Error('kaboom widget malfunction'), 'roll-on-table')).toBe(
      'kaboom widget malfunction'
    );
    expect(eh.toUserMessage('a string was thrown', 'x')).toBe('a string was thrown');
  });
});
