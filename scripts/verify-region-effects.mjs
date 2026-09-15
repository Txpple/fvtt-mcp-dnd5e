// Live verification for the dnd5e 6.0 AREA behaviors (2.1.0, plan rows 5–6):
//   * add-region-behavior `dnd5e.applyActiveEffect` with effects resolved BY NAME from the stock
//     dnd5e.effects pack (the design.md §2.3 amendment), by world-item name ("Item#Effect"), and by
//     uuid — then the mechanic itself: a token that ENTERS the region gets a copy of the effect
//     (origin = the behavior), and LOSES it on exit;
//   * `dnd5e.difficultTerrain` with terrainTypes / magical / ignored dispositions;
//   * the refusals: an unknown effect name, an effect that lives on an actor, a convenience on the
//     wrong behavior type;
//   * manage-activity `template` + `behaviors[]` — an authored Web (save + 20-ft cube + Restrained +
//     web difficult terrain) persists through the TypeDataField clean step, is applicable, and its
//     createBehaviorData produces the region behavior the template will carry; edit REPLACES the list.
//
// Drives a real headless Foundry session through the foundry.call seam (bypassing the MCP process, so
// it exercises the freshly-built dist/page.bundle.js WITHOUT a Claude Code restart). Everything it
// creates is tagged ZZ-FX and deleted in `finally` (a scene, an actor, two world items).
//
// Build first: npm run build. Run: FOUNDRY_PROFILE=local node scripts/verify-region-effects.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  if (line.trimStart().startsWith('#')) continue;
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

const TAG = 'ZZ-FX';
let passes = 0;
let fails = 0;
function assert(cond, msg, extra) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL  ${msg}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}
async function expectThrow(label, fn, re) {
  try {
    await fn();
    fails++;
    console.log(`  FAIL  ${label} — expected a throw, none thrown`);
  } catch (e) {
    const m = e?.message || String(e);
    if (re.test(m)) {
      passes++;
      console.log(`  PASS  ${label} — threw ${JSON.stringify(m.slice(0, 100))}`);
    } else {
      fails++;
      console.log(`  FAIL  ${label} — threw but message didn't match ${re}: ${m.slice(0, 160)}`);
    }
  }
}

const f = new Foundry(bridgeConfig(env));
let sceneId = null;
let actorId = null;
const worldItemIds = [];

try {
  console.log('[verify-region-effects] connecting…');
  await f.connect();
  console.log('[verify-region-effects] connected — dnd5e 6.0 area behaviors\n');

  // --- Lab: a tiny scene, a bare NPC with a token outside the region, a world item with an effect ---
  const lab = await f.evaluate(async tag => {
    const scene = await globalThis.Scene.create({
      name: `${tag} Region Lab`,
      width: 1000,
      height: 1000,
      grid: { type: 1, size: 100 },
      padding: 0,
    });
    const actor = await globalThis.Actor.create({ name: `${tag} Walker`, type: 'npc' });
    const [token] = await scene.createEmbeddedDocuments('Token', [
      { name: actor.name, actorId: actor.id, actorLink: true, x: 100, y: 100, disposition: -1 },
    ]);
    const [item] = await globalThis.Item.create(
      [
        {
          name: `${tag} Effects`,
          type: 'feat',
          effects: [
            {
              name: `${tag} Slick`,
              img: 'icons/svg/aura.svg',
              system: {
                changes: [{ key: 'system.attributes.ac.bonus', value: '-1', type: 'add' }],
              },
            },
          ],
        },
      ],
      {}
    );
    return {
      sceneId: scene.id,
      actorId: actor.id,
      tokenId: token.id,
      itemId: item.id,
      effectUuid: item.effects.contents[0].uuid,
    };
  }, TAG);
  sceneId = lab.sceneId;
  actorId = lab.actorId;
  worldItemIds.push(lab.itemId);
  assert(
    !!sceneId && !!actorId && !!lab.tokenId,
    `lab created: scene ${sceneId}, actor ${actorId}, token ${lab.tokenId}, world item ${lab.itemId}`
  );

  // --- Region: a 3x3-cell pool in the middle of the scene ---
  const regions = await f.call('createSceneRegions', {
    sceneIdentifier: sceneId,
    items: [
      {
        name: `${TAG} Poison Pool`,
        shapes: [{ type: 'rectangle', x: 500, y: 500, width: 300, height: 300 }],
      },
    ],
  });
  const regionId = regions?.created?.[0]?.id ?? regions?.items?.[0]?.id ?? regions?.[0]?.id;
  assert(!!regionId, `region "${TAG} Poison Pool" created (${regionId})`, regions);

  // ======================================================================
  // 1. applyActiveEffect by NAME from the stock pack (+ dispositions), then the mechanic
  // ======================================================================
  const added = await f.call('addRegionBehavior', {
    sceneIdentifier: sceneId,
    regionIdentifier: regionId,
    type: 'dnd5e.applyActiveEffect',
    effects: ['Poisoned'],
    dispositions: ['hostile', 'neutral'],
  });
  assert(
    added?.behavior?.type === 'dnd5e.applyActiveEffect',
    'add-region-behavior: dnd5e.applyActiveEffect created',
    added
  );
  const poisonedUuid = added?.effects?.[0]?.uuid;
  assert(
    added?.effects?.[0]?.source === 'dnd5e.effects' &&
      /^Compendium\.dnd5e\.effects\.ActiveEffect\./.test(poisonedUuid ?? ''),
    `"Poisoned" resolved from the stock pack → ${poisonedUuid}`,
    added?.effects
  );
  const behaviorId = added?.behavior?.id;
  const bSrc = await f.evaluate(
    ({ sceneId, regionId, behaviorId }) => {
      const b = globalThis.game.scenes.get(sceneId).regions.get(regionId).behaviors.get(behaviorId);
      const src = b.toObject();
      return { effects: src.system.effects, dispositions: src.system.dispositions, uuid: b.uuid };
    },
    { sceneId, regionId, behaviorId }
  );
  assert(
    Array.isArray(bSrc.effects) && bSrc.effects[0] === poisonedUuid,
    'behavior source: system.effects carries the uuid',
    bSrc.effects
  );
  assert(
    JSON.stringify(bSrc.dispositions) === JSON.stringify([-1, 0]),
    'behavior source: dispositions → [-1, 0]',
    bSrc.dispositions
  );

  const moveTo = (x, y) =>
    f.evaluate(
      async ({ sceneId, tokenId, x, y }) => {
        const token = globalThis.game.scenes.get(sceneId).tokens.get(tokenId);
        await token.update({ x, y });
        // region events resolve after the update round-trips; give the client a beat
        await new Promise(r => setTimeout(r, 400));
        const actor = token.actor;
        return actor.effects.map(e => ({
          name: e.name,
          origin: e.origin,
          statuses: Array.from(e.statuses),
        }));
      },
      { sceneId, tokenId: lab.tokenId, x, y }
    );

  const inside = await moveTo(600, 600);
  const applied = inside.find(e => e.name === 'Poisoned');
  assert(
    !!applied,
    'token ENTERS the region → a "Poisoned" effect is created on the actor',
    inside
  );
  assert(
    applied?.origin === bSrc.uuid,
    "the applied effect's origin is the behavior uuid (the removal key)",
    applied
  );
  assert(
    applied?.statuses?.includes('poisoned'),
    'the applied effect carries the poisoned status',
    applied
  );

  const outside = await moveTo(100, 100);
  assert(
    !outside.find(e => e.name === 'Poisoned'),
    'token LEAVES the region → the effect is removed',
    outside
  );

  // ======================================================================
  // 2. world-item effect by "Item#Effect" name and by bare name; uuid form; difficult terrain
  // ======================================================================
  const byItem = await f.call('addRegionBehavior', {
    sceneIdentifier: sceneId,
    regionIdentifier: regionId,
    type: 'dnd5e.applyActiveEffect',
    name: `${TAG} Slick Floor`,
    effects: [`${TAG} Effects#${TAG} Slick`, `${TAG} Slick`, lab.effectUuid],
    disabled: true,
  });
  const srcs = (byItem?.effects ?? []).map(e => `${e.source}:${e.uuid === lab.effectUuid}`);
  assert(
    srcs.length === 3 && srcs.every(s => s === 'world-item:true'),
    'a world-item effect resolves by "Item#Effect", by bare name (world fallback) and by uuid',
    byItem?.effects
  );

  const terrain = await f.call('addRegionBehavior', {
    sceneIdentifier: sceneId,
    regionIdentifier: regionId,
    type: 'dnd5e.difficultTerrain',
    terrainTypes: ['web', 'plants'],
    magical: true,
    dispositions: ['friendly'],
  });
  const tSrc = await f.evaluate(
    ({ sceneId, regionId, behaviorId }) => {
      const b = globalThis.game.scenes.get(sceneId).regions.get(regionId).behaviors.get(behaviorId);
      return b.toObject().system;
    },
    { sceneId, regionId, behaviorId: terrain?.behavior?.id }
  );
  assert(
    JSON.stringify(tSrc?.types) === JSON.stringify(['web', 'plants']) &&
      tSrc?.magical === true &&
      JSON.stringify(tSrc?.ignoredDispositions) === JSON.stringify([1]),
    'dnd5e.difficultTerrain: types / magical / ignoredDispositions persisted',
    tSrc
  );

  // ======================================================================
  // 2b. rotateArea: a tile listed on a turning platform rotates 90° when the platform turns
  // ======================================================================
  const tileId = await f.evaluate(async sceneId => {
    const scene = globalThis.game.scenes.get(sceneId);
    const [tile] = await scene.createEmbeddedDocuments('Tile', [
      {
        x: 600,
        y: 600,
        width: 100,
        height: 100,
        rotation: 0,
        texture: { src: 'icons/svg/aura.svg' },
      },
    ]);
    return tile.id;
  }, sceneId);
  const turntable = await f.call('createSceneRegions', {
    sceneIdentifier: sceneId,
    items: [
      {
        name: `${TAG} Turntable`,
        shapes: [{ type: 'rectangle', x: 500, y: 500, width: 300, height: 300 }],
      },
    ],
  });
  const turntableId = turntable?.items?.[0]?.id;
  const rot = await f.call('addRegionBehavior', {
    sceneIdentifier: sceneId,
    regionIdentifier: turntableId,
    type: 'dnd5e.rotateArea',
    rotate: { positions: [0, 90], tiles: [tileId], timeMs: 600, direction: 'cw' },
  });
  assert(
    rot?.behavior?.type === 'dnd5e.rotateArea',
    'add-region-behavior: dnd5e.rotateArea created',
    rot
  );
  const rotSrc = await f.evaluate(
    ({ sceneId, regionId, behaviorId }) => {
      const b = globalThis.game.scenes.get(sceneId).regions.get(regionId).behaviors.get(behaviorId);
      return b.toObject().system;
    },
    { sceneId, regionId: turntableId, behaviorId: rot?.behavior?.id }
  );
  assert(
    JSON.stringify(rotSrc?.positions) === JSON.stringify([{ angle: 0 }, { angle: 90 }]) &&
      rotSrc?.tiles?.ids?.[0] === tileId &&
      rotSrc?.directionMode === 'cw' &&
      rotSrc?.time?.value === 600,
    'rotateArea source: positions / tile id / direction / time persisted',
    rotSrc
  );
  const turned = await f.evaluate(
    async ({ sceneId, regionId, behaviorId, tileId }) => {
      const scene = globalThis.game.scenes.get(sceneId);
      const b = scene.regions.get(regionId).behaviors.get(behaviorId);
      await b.system.rotate();
      await new Promise(r => setTimeout(r, 300));
      return { rotation: scene.tiles.get(tileId)?.rotation, status: b.system.status?.angle };
    },
    { sceneId, regionId: turntableId, behaviorId: rot?.behavior?.id, tileId }
  );
  assert(
    turned.rotation === 90 && turned.status === 90,
    'rotate(): the platform turned to the 90° stop and the tile turned with it',
    turned
  );
  await expectThrow(
    'refuses a tile id that is not on the scene',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: turntableId,
        type: 'dnd5e.rotateArea',
        rotate: { tiles: ['nopenopenopenope'] },
      }),
    /is not a tile on scene/
  );

  // ======================================================================
  // 3. Refusals at the seam
  // ======================================================================
  await expectThrow(
    'refuses an unknown effect name',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: regionId,
        type: 'dnd5e.applyActiveEffect',
        effects: ['Definitely Not An Effect Zzz'],
      }),
    /not found in the stock dnd5e\.effects pack/
  );
  const actorEffectUuid = await f.evaluate(async id => {
    const a = globalThis.game.actors.get(id);
    const [e] = await a.createEmbeddedDocuments('ActiveEffect', [
      { name: 'ZZ-FX On Actor', img: 'icons/svg/aura.svg' },
    ]);
    return e.uuid;
  }, actorId);
  await expectThrow(
    'refuses an effect that lives on an actor',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: regionId,
        type: 'dnd5e.applyActiveEffect',
        effects: [actorEffectUuid],
      }),
    /lives on an actor/
  );
  await expectThrow(
    'refuses applyActiveEffect without any effect',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: regionId,
        type: 'dnd5e.applyActiveEffect',
        sizes: ['med'],
      }),
    /needs at least one effect/
  );
  await expectThrow(
    'refuses terrainTypes on applyActiveEffect',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: regionId,
        type: 'dnd5e.applyActiveEffect',
        effects: ['Poisoned'],
        terrainTypes: ['web'],
      }),
    /only apply to dnd5e\.difficultTerrain/
  );
  await expectThrow(
    'refuses an SRD content-pack item as an effect source',
    () =>
      f.call('addRegionBehavior', {
        sceneIdentifier: sceneId,
        regionIdentifier: regionId,
        type: 'dnd5e.applyActiveEffect',
        effects: ['Compendium.dnd5e.spells24.Item.aaaaaaaaaaaaaaaa#Web'],
      }),
    /SRD|does not resolve/
  );

  // ======================================================================
  // 4. Activity behaviors: an authored Web on a world feat
  // ======================================================================
  const webItemId = await f.evaluate(async tag => {
    const [it] = await globalThis.Item.create([{ name: `${tag} Web`, type: 'feat' }]);
    return it.id;
  }, TAG);
  worldItemIds.push(webItemId);
  const web = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: webItemId,
    activity: {
      type: 'save',
      name: 'Web',
      saveAbility: 'dex',
      saveDC: 13,
      template: { type: 'cube', size: 20 },
      affects: { type: 'creature' },
      behaviors: [
        { type: 'applyActiveEffect', name: 'Webbed', effects: ['Restrained'] },
        { type: 'difficultTerrain', terrainTypes: ['web'] },
      ],
    },
  });
  assert(
    web?.success && web.activityId,
    `manage-activity add: Web save activity (${web?.activityId})`,
    web
  );
  assert(
    web?.effects?.[0]?.source === 'dnd5e.effects' && web.effects[0].name === 'Restrained',
    '"Restrained" resolved from the stock pack',
    web?.effects
  );
  const webSrc = await f.evaluate(
    ({ itemId, activityId }) => {
      const item = globalThis.game.items.get(itemId);
      const src = item.toObject().system.activities[activityId];
      const act = item.system.activities.get(activityId);
      const applicable = act.applicableBehaviors?.map(b => b.type) ?? null;
      const data = act.behaviors[0]?.config?.createBehaviorData?.(act) ?? null;
      return {
        template: src.target.template,
        override: src.target.override,
        affects: src.target.affects,
        behaviors: src.behaviors,
        applicable,
        behaviorData: data
          ? {
              type: data.type,
              effects: Array.from(data.system?.effects ?? []),
              dispositions: Array.from(data.system?.dispositions ?? []),
            }
          : null,
      };
    },
    { itemId: webItemId, activityId: web.activityId }
  );
  assert(
    webSrc.template?.type === 'cube' && webSrc.template?.size === '20' && webSrc.override === true,
    'template persisted (cube 20 ft, target.override)',
    webSrc.template
  );
  assert(
    webSrc.behaviors?.length === 2 &&
      webSrc.behaviors[0].type === 'applyActiveEffect' &&
      Array.isArray(webSrc.behaviors[0].config?.effects) &&
      webSrc.behaviors[0].config.effects.length === 1 &&
      webSrc.behaviors[1].type === 'difficultTerrain' &&
      JSON.stringify(webSrc.behaviors[1].config?.types) === JSON.stringify(['web']),
    'behaviors persisted WITH their config (type + config written together survive the clean step)',
    webSrc.behaviors
  );
  assert(
    JSON.stringify(webSrc.applicable) === JSON.stringify(['applyActiveEffect', 'difficultTerrain']),
    'both behaviors are applicable at the item level',
    webSrc.applicable
  );
  assert(
    webSrc.behaviorData?.type === 'dnd5e.applyActiveEffect' &&
      webSrc.behaviorData.effects.length === 1,
    'createBehaviorData yields the dnd5e.applyActiveEffect region behavior the template will carry',
    webSrc.behaviorData
  );
  const listed = await f.call('manageActivity', { action: 'list', itemIdentifier: webItemId });
  const row = (listed?.activities ?? []).find(a => a.id === web.activityId);
  assert(
    row?.template?.type === 'cube' &&
      row?.behaviors?.length === 2 &&
      row.behaviors[0].effects?.length === 1,
    'list: template + behaviors surfaced',
    row
  );

  const edited = await f.call('manageActivity', {
    action: 'edit',
    itemIdentifier: webItemId,
    activityId: web.activityId,
    activity: { behaviors: [{ type: 'difficultTerrain', terrainTypes: ['plants'] }] },
  });
  const afterEdit = await f.evaluate(
    ({ itemId, activityId }) => {
      return globalThis.game.items.get(itemId).toObject().system.activities[activityId].behaviors;
    },
    { itemId: webItemId, activityId: web.activityId }
  );
  assert(
    edited?.success &&
      afterEdit?.length === 1 &&
      afterEdit[0].type === 'difficultTerrain' &&
      afterEdit[0].config?.types?.[0] === 'plants',
    'edit: behaviors REPLACED (one difficultTerrain, plants)',
    afterEdit
  );

  await expectThrow(
    'refuses behaviors on an activity without a template',
    () =>
      f.call('manageActivity', {
        action: 'add',
        itemIdentifier: webItemId,
        activity: { type: 'utility', name: 'No Area', behaviors: [{ type: 'difficultTerrain' }] },
      }),
    /ride on an AREA TEMPLATE/
  );
} catch (e) {
  fails++;
  console.log(`  FAIL  unexpected error: ${e?.stack || e}`);
} finally {
  try {
    await f.evaluate(
      async ({ sceneId, actorId, worldItemIds }) => {
        if (sceneId) await globalThis.game.scenes.get(sceneId)?.delete();
        if (actorId) await globalThis.game.actors.get(actorId)?.delete();
        for (const id of worldItemIds) await globalThis.game.items.get(id)?.delete();
      },
      { sceneId, actorId, worldItemIds }
    );
    console.log(
      `\ncleanup -> deleted scene ${sceneId}, actor ${actorId}, ${worldItemIds.length} world item(s)`
    );
  } catch (e) {
    console.log(`cleanup failed: ${e?.message || e}`);
  }
  await f.disconnect?.();
  console.log(`\n${passes}/${passes + fails} passed`);
  process.exit(fails > 0 ? 1 : 0);
}
