import { BridgeError, type BridgeErrorCode } from '../bridge-error.js';
import { Logger } from '../logger.js';

// THE TOOL ERROR-HANDLING CONTRACT (one contract, applied uniformly across every tool module):
//
//   • A handler NEVER maps its own errors. It either returns a result, or throws.
//   • It throws `FormattedToolError` for a message it curates itself — validation/precondition
//     guidance and domain "not found" messages. The central dispatch wrapper (index.ts) passes
//     these through VERBATIM.
//   • Every OTHER throw (a ZodError from `.parse()`, a BridgeError from the seam, an unexpected
//     error) bubbles to that same wrapper, which maps it via `toUserMessage` below.
//
// What `toUserMessage` adds is decided by the error's CODE, never by a word in its message:
//   • a BridgeError with a code (the page threw a PageError — src/page/errors.ts — or the bridge
//     never reached a joinable world) = the page's own words, then `[code]` and one hint;
//   • a BridgeError without a code (Foundry's own TypeError, a plain `new Error` in a handler),
//     a ZodError, any other throw = its raw message, nothing added.
// The 2.x mapper classified by substring and replaced the message with canned text — 11 of 12
// realistic page errors lost their words (review 2026-09, F5). The message is the fact; the hint
// is a suffix.

// The actor-creation tool family — a not-found on any of these earns the "search-compendium first"
// tip. Covers the two split tools (create-actor-from-compendium / author-npc).
const ACTOR_CREATION_TOOLS = new Set(['create-actor-from-compendium', 'author-npc']);

/** One hint per code: what to do next, in one sentence. */
export const HINTS: Readonly<Record<BridgeErrorCode, string>> = {
  'not-found':
    'Nothing matched that identifier — list or search first, then retry with the id or exact name.',
  ambiguous: 'The name matched several documents — retry with the id.',
  invalid: 'The page rejected the arguments — fix the field it names and retry.',
  permission:
    'Foundry refused it for the bridge user — it needs the Gamemaster or Assistant GM role ' +
    '(get-world-info shows bridgeUser) or ownership of the document.',
  unsupported:
    'This world cannot do it — check the game system, module or Foundry version the message names.',
  'rolled-back': 'Nothing was written — the whole change was undone; fix the cause and retry.',
  connection:
    'The bridge could not reach a joinable world — check FOUNDRY_URL, that the world is launched ' +
    '(Setup → Launch World; a host with a wake URL is woken automatically, and a cold box can take ' +
    'a minute — retry once it is up) and that FOUNDRY_USER can join.',
};

/**
 * A tool-authored, user-facing error message. A handler throws this for guidance it curates itself
 * (validation/precondition failures, domain "not found" messages). The central dispatch wrapper
 * (index.ts) passes these through verbatim. Every OTHER error a handler throws bubbles to that
 * wrapper and is mapped by ErrorHandler.toUserMessage; tools never map their own errors.
 */
export class FormattedToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormattedToolError';
  }
}

export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ErrorHandler' });
  }

  /**
   * Map + log an arbitrary tool error into a user-facing message — the form used by the central
   * dispatch wrapper for every error a tool doesn't curate itself. The original words are always
   * the message; a coded error gets its code and one hint appended. No markdown/emoji — index.ts
   * prefixes "Error: " when returning it, and the consumer is a model, not a terminal.
   */
  toUserMessage(error: unknown, toolName: string): string {
    if (error instanceof BridgeError) {
      this.log(error, toolName);
      if (!error.code) return error.detail;
      let message = `${error.detail} [${error.code}] ${HINTS[error.code]}`;
      if (error.code === 'not-found' && ACTOR_CREATION_TOOLS.has(toolName)) {
        message += ' Tip: use search-compendium first to see available creatures.';
      }
      return message;
    }
    const raw = error instanceof Error ? error.message : String(error);
    this.logger.error('Tool error', { toolName, message: raw, error });
    return raw;
  }

  /** A refused call is the caller's problem (warn); a lost session or an undone write is ours. */
  private log(error: BridgeError, toolName: string): void {
    const data = {
      toolName,
      fn: error.fn,
      code: error.code,
      detail: error.detail,
      ...(error.pageStack ? { pageStack: error.pageStack } : {}),
    };
    if (error.code === 'connection' || error.code === 'rolled-back' || !error.code) {
      this.logger.error('Bridge error', data);
    } else {
      this.logger.warn('Call refused by the page', data);
    }
  }
}
