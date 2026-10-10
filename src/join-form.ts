// The /join form as the bridge reads it. Its own module, free of Playwright, so the unit suite can
// hold every selector here against saved copies of the page (test/fixtures/join/<version>.html).
// A Foundry release that reshapes the form fails `npm test` instead of hanging the bridge live.

/** The user list. ≤14.365 names it "userid", 14.369 "userId": hence the case-insensitive match. */
export const JOIN_USER_SELECT = 'select[name="userid" i]';

/** The free-text user field 14.367 rendered in place of the list (with suggestions, not a list). */
export const JOIN_USER_INPUT = 'input[name="username"]';

/**
 * Either shape of the user field. The bridge must join both: prod and the sandbox can straddle a
 * core patch release.
 */
export const JOIN_USER_FIELD = `${JOIN_USER_SELECT}, ${JOIN_USER_INPUT}`;

export const JOIN_PASSWORD = 'input[name="password"]';

export const JOIN_SUBMIT = 'button[name="join"], button[type="submit"]';

/** What the bridge reads off a drawn /join page before it picks a user. */
export interface JoinFormFacts {
  /** The user list, in order; `null` for the free-text field (14.367), which lists nobody. */
  users: string[] | null;
  /** The world's title (the /join page's document title). */
  worldTitle: string;
}

/**
 * Read the user list and the world title off a /join page. It runs inside the live page through
 * `page.evaluate(readJoinForm, JOIN_USER_SELECT)`, so it must stay self-contained (no imports, no
 * helpers): Playwright ships its source text. The unit suite passes a fixture's document as `root`.
 */
export function readJoinForm(selector: string, root: Document = document): JoinFormFacts {
  const select = root.querySelector<HTMLSelectElement>(selector);
  const users = select
    ? [...select.options].map(o => o.textContent?.trim() ?? '').filter(name => name !== '')
    : null;
  return { users, worldTitle: root.title.trim() };
}

/**
 * The refusal for a bridge user the world does not have, or `null` when the user is listed (or
 * the form lists nobody, so only the server's join answer can tell).
 */
export function missingUserProblem(user: string, form: JoinFormFacts): string | null {
  if (!form.users || form.users.includes(user)) return null;
  return (
    `user '${user}' not found in world '${form.worldTitle || '(untitled)'}'; ` +
    `users: ${form.users.join(', ') || '(none)'} — set FOUNDRY_USER to an existing ` +
    `Gamemaster/Assistant GM user or create '${user}' in the world`
  );
}
