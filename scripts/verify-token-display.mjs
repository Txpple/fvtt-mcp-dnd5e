// Live acceptance for update-actor's prototype-token DISPLAY fields (tokenDisplayName /
// tokenDisplayBars): drive the tool's bridge path on a real actor and read the prototype back.
//   FOUNDRY_HOST=local node scripts/verify-token-display.mjs [actorId]
// Default: a throwaway ZZ-* NPC, created here and deleted in `finally`. Build first if dist is stale.
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();
const TAG = 'ZZ-TOKEN-DISPLAY-IT';
let ACTOR = process.argv[2] || '';
let ownFixture = false;

const f = new Foundry(bridgeConfig(env));

const read = id =>
  f.evaluate(
    ({ id }) => {
      const a = game.actors.get(id);
      return a
        ? { displayName: a.prototypeToken.displayName, displayBars: a.prototypeToken.displayBars }
        : { error: 'actor not found' };
    },
    { id }
  );

let fails = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

try {
  console.log('[verify-token-display] connecting…');
  await f.connect();
  if (!ACTOR) {
    const made = await f.evaluate(
      async name => (await Actor.create({ name, type: 'npc' })).id,
      TAG
    );
    ACTOR = made;
    ownFixture = true;
  }
  console.log(`[verify-token-display] connected; test actor ${ACTOR}\n`);

  // 1) set a visible mode via the tool path → expect the mapped numbers on the prototype.
  const r1 = await f.call('updateActor', {
    actorIdentifier: ACTOR,
    tokenDisplayName: 'hover',
    tokenDisplayBars: 'owner',
  });
  const a1 = await read(ACTOR);
  check(
    'applied lists both fields',
    ['tokenDisplayName', 'tokenDisplayBars'].every(x => r1.applied?.includes(x)),
    JSON.stringify(r1.applied)
  );
  check('hover → displayName 30', a1.displayName === 30, `got ${a1.displayName}`);
  check('owner → displayBars 40', a1.displayBars === 40, `got ${a1.displayBars}`);

  // 2) restore to the window-dressing default (none) → expect 0 / 0.
  await f.call('updateActor', {
    actorIdentifier: ACTOR,
    tokenDisplayName: 'none',
    tokenDisplayBars: 'none',
  });
  const a2 = await read(ACTOR);
  check('none → displayName 0', a2.displayName === 0, `got ${a2.displayName}`);
  check('none → displayBars 0', a2.displayBars === 0, `got ${a2.displayBars}`);

  // 3) page-layer defense: an invalid mode warns and is skipped, while a valid companion field
  //    still applies (zod already blocks bad enums in the real tool; this covers a raw f.call).
  const r3 = await f.call('updateActor', {
    actorIdentifier: ACTOR,
    tokenDisplayName: 'sometimes',
    tokenDisplayBars: 'none',
  });
  const a3 = await read(ACTOR);
  check(
    'invalid mode warns',
    (r3.warnings ?? []).some(w => /tokenDisplayName/.test(w)),
    JSON.stringify(r3.warnings)
  );
  check(
    'invalid skipped, valid companion applied',
    !(r3.applied ?? []).includes('tokenDisplayName') &&
      (r3.applied ?? []).includes('tokenDisplayBars') &&
      a3.displayName === 0
  );

  console.log(`\n==== verify-token-display: ${fails ? `${fails} FAIL(s)` : 'PASS'} ====`);
  process.exitCode = fails ? 1 : 0;
} finally {
  if (ownFixture && ACTOR) {
    await f.call('deleteActor', { identifiers: [ACTOR] }).catch(() => {});
  }
  await f.dispose().catch(() => {});
}
