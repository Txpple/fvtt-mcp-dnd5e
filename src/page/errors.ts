// The page-side error contract — runs INSIDE the headless Foundry page (bundled with the rest of
// src/page/**), and its pure parts are imported by src/foundry.ts on the Node side too. No
// Foundry globals here.
//
// A page handler that refuses a call throws a PageError carrying a CODE. The code travels in the
// Error's `name`: Playwright reports an in-page throw to Node as the error's V8 description —
// `${name}: ${message}` followed by the in-page stack — and rebuilds a plain Error around that
// text, so the name (the first token of the message) is the only field that survives the seam;
// a custom property (`err.code`) does not (measured, review 2026-09 F5). src/foundry.ts parses
// the header back into a BridgeError, and the central error mapper (src/utils/error-handler.ts)
// turns the CODE — never a substring of the message — into guidance. An uncoded throw (Foundry's
// own, or a plain `new Error`) reaches the model as its raw words with no guidance attached.

export type PageErrorCode =
  | 'not-found'
  | 'ambiguous'
  | 'invalid'
  | 'permission'
  | 'unsupported'
  | 'rolled-back';

/** `name` of a coded page error: the prefix plus the code (`PageError:not-found`). */
export const PAGE_ERROR_NAME_PREFIX = 'PageError:';

const CODES: ReadonlySet<string> = new Set<PageErrorCode>([
  'not-found',
  'ambiguous',
  'invalid',
  'permission',
  'unsupported',
  'rolled-back',
]);

export class PageError extends Error {
  readonly code: PageErrorCode;
  constructor(code: PageErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = `${PAGE_ERROR_NAME_PREFIX}${code}`;
  }
}

/** An identifier (actor, scene, item, pack, page, user…) that did not resolve. */
export const notFound = (message: string): PageError => new PageError('not-found', message);
/** An identifier that resolves to MORE than one document (a name shared by several). */
export const ambiguous = (message: string): PageError => new PageError('ambiguous', message);
/** An argument the page rejects: a missing field, a bad shape, a value outside its vocabulary. */
export const invalid = (message: string): PageError => new PageError('invalid', message);
/** A permission refusal — the bridge user's role or the document's ownership. */
export const forbidden = (message: string): PageError => new PageError('permission', message);
/** The world / game system / module cannot do this. */
export const unsupported = (message: string): PageError => new PageError('unsupported', message);
/** A multi-step write that was undone as a whole. */
export const rolledBack = (message: string): PageError => new PageError('rolled-back', message);

/** The code an error name encodes, or undefined for any other name (`Error`, `TypeError`, …). */
export function pageErrorCode(name: string): PageErrorCode | undefined {
  if (!name.startsWith(PAGE_ERROR_NAME_PREFIX)) return undefined;
  const code = name.slice(PAGE_ERROR_NAME_PREFIX.length);
  return CODES.has(code) ? (code as PageErrorCode) : undefined;
}
