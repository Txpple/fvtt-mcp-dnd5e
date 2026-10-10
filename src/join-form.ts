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
