/**
 * Unit tests for ErrorHandler — the keyword-based classifier EVERY tool failure routes through, in
 * exactly one place (the central dispatch wrapper in index.ts). Tools no longer map their own
 * errors; they throw FormattedToolError for curated messages and let everything else bubble here.
 * Pure and order-dependent, so tested directly.
 */

import { describe, it, expect } from 'vitest';
import { ErrorHandler, rawPageMessage } from './error-handler.js';

// Minimal logger stub — ErrorHandler only needs child()/warn/error.
const noopLogger: any = {
  child: () => noopLogger,
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const eh = new ErrorHandler(noopLogger);

describe('ErrorHandler.toUserMessage — enriches bridge/permission/validation failures', () => {
  it('maps connection/cold-box errors to actionable wake guidance', () => {
    const msg = eh.toUserMessage(new Error('net::ERR_CONNECTION_REFUSED'), 'list-actors');
    expect(msg).toContain('Connection to the Foundry world failed');
    expect(msg).toMatch(/wake/i);
  });

  it('maps permission errors', () => {
    const msg = eh.toUserMessage(new Error('User lacks permission for this'), 'create-item');
    expect(msg).toContain('Permission denied for this operation');
  });

  it('adds the search-compendium tip on validation errors across the actor-creation family', () => {
    // The tip fires for both split tools. (The base message differs by branch:
    // 'create-actor-from-compendium' contains the substring "compendium", so the classifier picks
    // the more-specific "Creature not found" wording — fine.)
    for (const tool of ['create-actor-from-compendium', 'author-npc']) {
      const msg = eh.toUserMessage(new Error('actor not found'), tool);
      expect(msg).toContain('use search-compendium first to see available creatures');
    }
    // ...but not for an unrelated tool.
    const other = eh.toUserMessage(new Error('actor not found'), 'update-actor');
    expect(other).not.toContain('use search-compendium first');
  });
});

describe('ErrorHandler.toUserMessage — never degrades already-specific messages', () => {
  it('passes ZodError messages through verbatim (not flattened to the validation template)', () => {
    const zodish = Object.assign(new Error('Invalid input: expected string, received number'), {
      name: 'ZodError',
    });
    expect(eh.toUserMessage(zodish, 'create-actor-from-compendium')).toBe(
      'Invalid input: expected string, received number'
    );
  });

  it('falls back to the raw message for unclassifiable errors (not "An unexpected error occurred")', () => {
    const msg = eh.toUserMessage(new Error('kaboom widget malfunction'), 'roll-on-table');
    expect(msg).toBe('kaboom widget malfunction');
  });

  it('handles non-Error throwables', () => {
    expect(eh.toUserMessage('a string was thrown', 'x')).toBe('a string was thrown');
  });
});

describe('ErrorHandler.toUserMessage — the original words survive every classification', () => {
  // The 12 realistic page/tool errors the 2026-09 review ran through the mapper
  // (docs/review-2026-09/scripts/arch-seams-error-mangle.mjs): 11 of 12 lost their text.
  const cases: Array<[string, string]> = [
    ['create-tiles', 'Scene "Crypt" has no grid; set gridType first'],
    ['update-scene', 'background.src must be a Data-relative path'],
    ['get-actor', 'Actor "Gren" not found (did you mean "Grendel"?)'],
    ['update-actor', 'invalid field path system.attributes.hp.vale'],
    ['set-actor-ownership', 'unknown permission level "OBSERVR" — use OWNER/OBSERVER/LIMITED/NONE'],
    ['manage-effect', 'effect "Bless" is missing a change for system.bonuses.abilities.save'],
    [
      'search-compendium-spells',
      'pack dnd-players-handbook.spells not found — is the PHB installed?',
    ],
    ['upload-asset', 'WebDAV PUT timeout after 30000ms for assets/maps/big.webp'],
    ['asset-url', 'FOUNDRY_WEBDAV_URL is unset; the file browser link cannot be built'],
    ['create-actor-from-compendium', 'entry owlbear not found in dnd-monster-manual.actors'],
    ['list-journals', "Cannot read properties of undefined (reading 'pages')"],
    ['create-pc', 'advancement transaction aborted at level 3: no HP choice'],
  ];
  it.each(cases)('%s keeps its text', (tool, text) => {
    const wrapped = new Error(`foundry.call('x') failed: ${text}`);
    expect(eh.toUserMessage(wrapped, tool)).toContain(text);
  });

  it('strips the bridge wrapper, the page.evaluate prefix and the folded in-page stack', () => {
    expect(
      rawPageMessage(
        'foundry.call(\'getActor\') failed: page.evaluate: Error: Actor "Gren" not found\n    at eval (eval at evaluate (:1:1), <anonymous>:3:9)\n    at UtilityScript.evaluate'
      )
    ).toBe('Actor "Gren" not found');
    expect(rawPageMessage('plain text')).toBe('plain text');
  });

  it('appends the page text after the guidance, once', () => {
    const msg = eh.toUserMessage(new Error('Actor "Gren" not found'), 'update-actor');
    expect(msg).toMatch(/Invalid request or missing data.*Foundry said: Actor "Gren" not found$/);
    expect(msg.match(/Foundry said:/g)).toHaveLength(1);
  });
});

describe('ErrorHandler.mapFoundryError — classification order', () => {
  it('classifies a creature lookup in a compendium context as a creature-not-found validation', () => {
    const mapped = eh.mapFoundryError(new Error('not found'), 'search-compendium creature');
    expect(mapped.type).toBe('validation');
    expect(mapped.message).toBe('Creature not found in compendiums');
  });

  it('prefers permission over the generic system fallback', () => {
    expect(eh.mapFoundryError(new Error('access denied'), 'x').type).toBe('permission');
  });

  it('falls back to a non-recoverable system error for unknown messages', () => {
    const mapped = eh.mapFoundryError(new Error('???'), 'x');
    expect(mapped.type).toBe('system');
    expect(mapped.recoverable).toBe(false);
  });
});
