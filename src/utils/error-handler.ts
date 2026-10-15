import { BridgeError, type BridgeErrorCode } from '../bridge-error.js';
import { FilePlaneError } from '../hosts/types.js';
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
//     never reached a joinable world) = the page's own words, then `[code]` and one hint — no
//     hint when the bridge's words already name the fix (`explained`, a ConnectProblem);
//   • a ToolError (a tool's own refusal or miss, Node side: the file plane, a local file) = its
//     words, then `[code]` and the code's hint, the same as a page's;
//   • a FilePlaneError = its words, coded by its HTTP-style status (`filePlaneCode`), else raw;
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
  invalid: 'The arguments were refused — fix or add the field it names and retry.',
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

/**
 * A tool's own refusal or miss, with a code: the page's PageError contract (src/page/errors.ts) on
 * the Node side, for a tool that answers before or without the page — a Data path that does not
 * exist, an existing file without overwrite, a world-DB path, a local file it cannot read. A miss
 * or a refusal is an error (design.md §3), never a success-shaped "Refused: …" string; the mapper
 * answers these words, then `[code]` and the code's hint.
 */
export class ToolError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/**
 * The code a file-plane failure's HTTP-style status stands for (src/hosts/types.ts): 404 a path
 * that is not there, 400 / 409 / 412 a path or a conflict the call can fix, 401 / 403 refused by
 * the server, 415 / 501 a format or an operation the plane does not have. Anything else (an
 * unreachable plane, a 500) has no code: its words are the answer.
 */
export function filePlaneCode(status: number): BridgeErrorCode | undefined {
  if (status === 404) return 'not-found';
  if (status === 400 || status === 409 || status === 412) return 'invalid';
  if (status === 401 || status === 403) return 'permission';
  if (status === 415 || status === 501) return 'unsupported';
  return undefined;
}

/** The words, then `[code]` and the code's one hint (and the actor-creation tip on a miss there). */
function coded(words: string, code: BridgeErrorCode, toolName: string): string {
  let message = `${words} [${code}] ${HINTS[code]}`;
  if (code === 'not-found' && ACTOR_CREATION_TOOLS.has(toolName)) {
    message += ' Tip: use search-compendium first to see available creatures.';
  }
  return message;
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
      // A connect failure that already names its fix (ConnectProblem) is the whole answer: the
      // generic hint after it only buried the one line that mattered (issue #3, item 7).
      if (error.explained) return `${error.detail} [${error.code}]`;
      return coded(error.detail, error.code, toolName);
    }
    if (error instanceof ToolError) {
      this.logger.warn('Call refused by the tool', {
        toolName,
        code: error.code,
        detail: error.message,
      });
      return coded(error.message, error.code, toolName);
    }
    if (error instanceof FilePlaneError) {
      const code = filePlaneCode(error.status);
      this.logger.warn('File plane refused the call', {
        toolName,
        status: error.status,
        detail: error.message,
      });
      return code ? coded(error.message, code, toolName) : error.message;
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
