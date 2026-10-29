// Live verify for issue #22: a scene placeable function given a key it does not take throws, never
// lists (or writes) the active scene as the requested one; an actor call missing its key names it.
//   FOUNDRY_HOST=local node scripts/verify-unknown-keys.mjs
// The bug's own shape first: run-script's `fvtt.listSceneTokens({ sceneId })` on a scene that is not
// the active one (it answered with the active scene's tokens). Then each kernel op (list, create,
// update, delete), updateSceneTokens, addRegionBehavior and the actor reads/writes through the page,
// and that the active scene gained nothing. The fixture is one ZZ-* scene, never activated, with one
// tile, deleted in finally. Needs a built dist/ (the registry and the page bundle come from there).
import { connectFoundry } from '../dist/client.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
};
/** The message a call fails with, or null when it answered. */
const failure = async fn => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const { f, host, hostConfig, dispose } = await connectFoundry({
  identity: 'bridge',
  tag: 'verify-unknown-keys',
  watchdogMs: 180_000,
});
const logger = new Logger({
  level: 'error',
  format: 'simple',
  enableConsole: false,
  enableFile: false,
});
const { dispatch } = buildToolRegistry({
  foundry: f,
  logger,
  host,
  serverUrl: hostConfig.serverUrl,
});

const NAME = 'ZZ-unknown-keys';
let sceneId;
try {
  const before = await f.evaluate(() => {
    const a = game.scenes.active;
    return a ? { id: a.id, name: a.name, tiles: a.tiles.size, tokens: a.tokens.size } : null;
  });
  check('the world has an active scene to fall back to', !!before, before?.name ?? 'none');

  sceneId = await f.evaluate(
    async name => (await Scene.create({ name, width: 1000, height: 1000, navigation: false })).id,
    NAME
  );
  await f.call('createSceneTiles', {
    sceneIdentifier: sceneId,
    items: [{ src: 'icons/svg/door-closed.svg', x: 100, y: 100, width: 100, height: 100 }],
  });

  // --- the bug as found: run-script, listSceneTokens({ sceneId }) ---
  const run = async src =>
    String(await dispatch('run-script', { script: src }).catch(e => e.message));
  const wrong = await run(
    `return await fvtt.listSceneTokens({ sceneId: ${JSON.stringify(sceneId)} });`
  );
  check(
    'run-script listSceneTokens({ sceneId }) is refused, naming sceneIdentifier',
    /listSceneTokens: unknown key 'sceneId' — use sceneIdentifier/.test(wrong) &&
      !wrong.includes(before?.name ?? '\u0000'),
    wrong.split('\n').find(l => /unknown key|sceneName/.test(l)) ?? wrong.slice(0, 160)
  );
  const right = await run(
    `return await fvtt.listSceneTokens({ sceneIdentifier: ${JSON.stringify(sceneId)} });`
  );
  check(
    'run-script listSceneTokens({ sceneIdentifier }) lists the requested scene',
    right.includes(`"sceneId": "${sceneId}"`) &&
      right.includes(`"sceneName": "${NAME}"`) &&
      right.includes('"count": 0')
  );

  // --- every list, through the page ---
  for (const kind of [
    'Tokens',
    'Tiles',
    'Lights',
    'Walls',
    'Notes',
    'Regions',
    'Sounds',
    'Drawings',
  ]) {
    const fn = `listScene${kind}`;
    const msg = await failure(() => f.call(fn, { sceneId }));
    check(
      `${fn}({ sceneId }) throws`,
      /unknown key 'sceneId' — use sceneIdentifier/.test(msg ?? ''),
      msg ?? 'answered'
    );
  }
  const tiles = await f.call('listSceneTiles', { sceneIdentifier: sceneId });
  check(
    'listSceneTiles({ sceneIdentifier }) still finds the fixture tile',
    tiles?.sceneId === sceneId && tiles?.count === 1
  );
  const walls = await f.call('listSceneWalls', { sceneIdentifier: sceneId, doorsOnly: true });
  check('listSceneWalls takes doorsOnly', walls?.found === true && walls?.count === 0);
  const active = await f.call('listSceneTiles', {});
  check(
    'no key still lists the active scene',
    active?.sceneId === before?.id && active?.sceneActive === true
  );

  // --- the writes refuse before writing ---
  const writes = [
    [
      'createSceneTiles',
      { sceneId, items: [{ src: 'icons/svg/hazard.svg', x: 0, y: 0, width: 100, height: 100 }] },
    ],
    ['placeSceneTokens', { sceneId, items: [{ actorIdentifier: 'nobody', x: 0, y: 0 }] }],
    ['updateSceneTiles', { sceneId, patches: [{ id: 'x', x: 5 }] }],
    ['deleteSceneTiles', { sceneId, ids: ['x'] }],
    ['updateSceneTokens', { sceneId, tokenIds: ['x'], hidden: true }],
    ['addRegionBehavior', { sceneId, regionIdentifier: 'x', type: 'teleportToken' }],
  ];
  for (const [fn, args] of writes) {
    const msg = await failure(() => f.call(fn, args));
    check(
      `${fn}({ sceneId, … }) throws`,
      msg?.includes(`${fn}: unknown key 'sceneId'`) ?? false,
      msg ?? 'answered'
    );
  }
  const after = await f.evaluate(id => {
    const a = game.scenes.get(id);
    return { tiles: a.tiles.size, tokens: a.tokens.size };
  }, before.id);
  check(
    'the active scene gained nothing',
    after.tiles === before.tiles && after.tokens === before.tokens,
    `tiles ${before.tiles}→${after.tiles}, tokens ${before.tokens}→${after.tokens}`
  );

  // --- the actor calls name the key they wanted and the ones they got ---
  for (const [fn, args, want] of [
    [
      'exportActorData',
      { actorId: 'x' },
      "exportActorData: identifier is required (got 'actorId')",
    ],
    [
      'updateActor',
      { identifier: 'x' },
      "updateActor: actorIdentifier is required (got 'identifier')",
    ],
  ]) {
    const msg = await failure(() => f.call(fn, args));
    check(`${fn} names the missing key`, msg?.includes(want) ?? false, msg ?? 'answered');
  }
} finally {
  if (sceneId)
    await f
      .evaluate(async id => game.scenes.get(id)?.delete(), sceneId)
      .catch(e => console.log(`cleanup: ${e.message}`));
  await dispose();
}
const passed = checks.filter(c => c.ok).length;
console.log(`\n[verify-unknown-keys] ${passed}/${checks.length}`);
process.exit(passed === checks.length ? 0 : 1);
