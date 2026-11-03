// Crystal Ball's Seer beside a Foundry: its user (role Player, logged in on its own socket for as
// long as the Seer runs) is among the users `/api/status` counts, so a guard that waits for an
// empty table would wait for ever on a box that runs the Seer. The Seer answers `healthz` with
// `{ foundry: { connected, counted, world, ballUser } }`; a guard asks it and discounts that one
// user only while `counted` is true, Foundry's own word (asked by the Seer) that it counts the ball
// present in the world in question. A socket can be open yet uncounted (one that outlived a world's
// close was, before Crystal Ball 1.0.11), and discounting it then hid one real user; a Seer that
// does not say discounts nothing. Shared by scripts/local-foundry.mjs (the stop and restart guard)
// and scripts/pull-prod-to-local.mjs (the prod-side snapshot guard).
//
// Where healthz is: FOUNDRY_SEER_URL from the .env when set (the Seer's base, e.g. the public
// origin's `/crystalball` route for a box whose Seer binds 127.0.0.1 and is reached only through
// its tunnel), else Foundry's own origin under `/crystalball` (a proxy or tunnel route) and then
// the companion port, 30001 of Foundry's host (a sandbox; the module's window looks there too, on
// a plain-http page). No Seer answering discounts nothing: the count stands as Foundry gave it.

/** The Seer's default port beside a Foundry with no proxy, as the module's window has it. */
export const COMPANION_PORT = 30001;

/**
 * The `healthz` URLs to try, in order.
 * @param {string} serverUrl  Foundry's base URL
 * @param {string | undefined} seerUrl  FOUNDRY_SEER_URL, the Seer's base, when set
 * @returns {string[]}
 */
export function seerHealthUrls(serverUrl, seerUrl) {
  const urls = [];
  const base = seerUrl?.trim().replace(/\/+$/, '');
  if (base) urls.push(`${base}/healthz`);
  try {
    const u = new URL(serverUrl);
    urls.push(`${u.origin}/crystalball/healthz`);
    if (u.port !== String(COMPANION_PORT))
      urls.push(`${u.protocol}//${u.hostname}:${COMPANION_PORT}/crystalball/healthz`);
  } catch {
    // no Foundry URL to derive from: the configured one alone
  }
  return [...new Set(urls)];
}

/**
 * The Seer's word on its user: `{ connected, counted, world, ballUser, at }` from the first
 * `healthz` that answers (`counted` true or false as the Seer says, null when it does not), or
 * null when none does (no Seer there, or none reachable from here).
 * @param {string} serverUrl
 * @param {string | undefined} seerUrl
 * @param {{ timeoutMs?: number, fetchFn?: typeof fetch }} [opts]
 */
export async function seerUser(serverUrl, seerUrl, { timeoutMs = 3000, fetchFn = fetch } = {}) {
  for (const at of seerHealthUrls(serverUrl, seerUrl)) {
    try {
      const res = await fetchFn(at, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const body = await res.json();
      if (!body || typeof body !== 'object' || !body.foundry || typeof body.foundry !== 'object')
        continue;
      return {
        connected: body.foundry.connected === true,
        counted: typeof body.foundry.counted === 'boolean' ? body.foundry.counted : null,
        world: typeof body.foundry.world === 'string' ? body.foundry.world : null,
        ballUser: typeof body.foundry.ballUser === 'string' ? body.foundry.ballUser : null,
        at,
      };
    } catch {
      // not answering: the next candidate
    }
  }
  return null;
}

/**
 * The connected users a guard should wait for: Foundry's count less the Seer's user when the Seer
 * says Foundry counts it in this world (a world it names that differs is another Foundry's Seer).
 * `note` reads as the guard's line: what was counted and what was discounted.
 * @param {{ users?: number, world?: string | null } | null | undefined} status  `/api/status`
 * @param {{ connected: boolean, counted?: boolean | null, world: string | null,
 *   ballUser: string | null } | null} seer
 * @returns {{ users: number, counted: number, discounted: number, note: string }}
 */
export function discountSeer(status, seer) {
  const counted = Number.isFinite(status?.users) ? Math.max(0, status.users) : 0;
  const sameWorld = !seer?.world || !status?.world || seer.world === status.world;
  const ours = seer?.connected && sameWorld;
  const discounted = ours && seer.counted === true ? Math.min(1, counted) : 0;
  const users = counted - discounted;
  const who = seer?.ballUser ? `"${seer.ballUser}"` : "the Seer's user";
  const why = !seer
    ? ''
    : !ours
      ? " (Crystal Ball's Seer answers but is not connected here)"
      : seer.counted === false
        ? ` (Crystal Ball's Seer is connected, but Foundry does not count ${who}: nothing discounted)`
        : seer.counted !== true
          ? " (Crystal Ball's Seer does not say whether Foundry counts its user: nothing discounted)"
          : '';
  const note = discounted
    ? `${counted} connected, one of them ${who} (Crystal Ball's Seer, discounted): ${users} to wait for`
    : `${counted} connected${why}`;
  return { users, counted, discounted, note };
}
