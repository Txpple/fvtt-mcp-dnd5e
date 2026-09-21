// Live verification for the placeable CRUD kernel — Tile CRUD, Light CRUD, the token / note list
// reads, and (G) the consolidated tool the four skill-cheap kinds ride: manage-placeables
// (kind × action; src/tools/_union.ts, M8) through the registry's dispatch.
//
// Drives a real headless Foundry session (fresh dist/, no CC restart) and exercises the page fns
// createSceneTiles / listSceneTiles / updateSceneTiles / deleteSceneTiles through f.call against a
// throwaway scene, asserting the shared kernel + Tile descriptor end to end:
//   • create places tiles (nested texture + occlusion Set-as-array), returns ids, isolates a bad item.
//   • list reads them back with the salient fields (size = width/height, image zoom = texture.scaleX).
//   • update RESIZES (width/height) + MOVES (x/y) + zooms the image (texture.scaleX) via dot-paths.
//   • delete removes by id and reports a missing id, never fatal.
//   • TL↔anchor conversion (v14 stores a tile's x/y as its texture-anchor point, default 0.5 =
//     CENTER; live-probed 14.364): tools speak TOP-LEFT, the doc holds TL + size/2, list round-trips
//     the TL back, a resize without x/y keeps the corner fixed, and the RENDERED bounds match.
// Fixture scene is deleted in `finally`.
//
//   • (G) manage-placeables: every kind × action of tiles / lights / walls / drawings through
//     buildToolRegistry().dispatch — the union selects the member, the list answers one line per
//     record under a header naming the columns, an unknown kind / action / key is refused by name.
//
// Build first: npm run build.  Run: FOUNDRY_HOST=local node scripts/verify-placeables-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();

const TAG = 'ZZ-TILE-IT';
let passes = 0;
let fails = 0;
function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL  ${msg}`);
  }
}

const cfg = bridgeConfig(env);
const f = new Foundry(cfg);

let sceneId;
let journalId;

try {
  console.log('[verify-tiles] connecting…');
  await f.connect();
  console.log('[verify-tiles] connected\n');

  sceneId = await f.evaluate(async tag => {
    const s = await Scene.create({
      name: `${tag} Scene`,
      width: 2000,
      height: 2000,
      navigation: false,
    });
    return s.id;
  }, TAG);

  // --- A: create — 2 good tiles + 1 bad (missing width) → isolated ---
  console.log('# A: createSceneTiles (nested texture/occlusion; per-item error isolation)');
  const created = await f.call('createSceneTiles', {
    sceneIdentifier: sceneId,
    items: [
      {
        src: 'icons/svg/direction.svg',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        rotation: 45,
        occlusionMode: 1,
      },
      { src: 'icons/svg/hazard.svg', x: 400, y: 100, width: 300, height: 300, scaleX: 1.25 },
      // Clean probe (no rotation/zoom) — its RENDERED bounds are checked against the TL in B.
      { src: 'icons/svg/door-closed.svg', x: 700, y: 100, width: 200, height: 100 },
      { src: 'icons/svg/bad.svg', x: 0, y: 0 /* missing width/height */ },
    ],
  });
  assert(created?.created === 3, `A — created 3 tiles (got ${created?.created})`);
  assert(
    Array.isArray(created?.errors) && created.errors.some(e => /height|width/.test(e)),
    'A — the bad tile was isolated + reported, not fatal'
  );
  const ids = (created?.items ?? []).map(t => t.id);
  assert(ids.length === 3, 'A — returned 3 created ids');
  // Confirm the occlusion Set + nested texture persisted live.
  const liveOcc = await f.evaluate(
    ({ sId, tId }) => {
      const t = game.scenes.get(sId).tiles.get(tId);
      return {
        modes: t.occlusion?.modes ? [...t.occlusion.modes] : null,
        rot: t.rotation,
        src: t.texture?.src,
      };
    },
    { sId: sceneId, tId: ids[0] }
  );
  assert(
    liveOcc.modes?.[0] === 1,
    `A — occlusion.modes persisted as a Set [1] (got ${JSON.stringify(liveOcc.modes)})`
  );
  assert(liveOcc.rot === 45, 'A — rotation persisted');
  // TL→anchor conversion: tool x/y (100,100) for a 200×200 tile lands as doc anchor point (200,200).
  const liveXY = await f.evaluate(
    ({ sId, tId }) => {
      const t = game.scenes.get(sId).tiles.get(tId);
      return { x: t.x, y: t.y, ax: t.texture?.anchorX, ay: t.texture?.anchorY };
    },
    { sId: sceneId, tId: ids[0] }
  );
  assert(
    liveXY.x === 200 && liveXY.y === 200,
    `A — doc x/y is the CENTER anchor point, TL + size/2 (got ${liveXY.x},${liveXY.y})`
  );
  assert(
    liveXY.ax === 0.5 && liveXY.ay === 0.5,
    `A — v14 texture anchor defaulted to 0.5/0.5 (got ${liveXY.ax},${liveXY.ay})`
  );

  // --- B: list — read back ids + salient fields ---
  console.log('\n# B: listSceneTiles');
  const listed = await f.call('listSceneTiles', { sceneIdentifier: sceneId });
  assert(
    listed?.found === true && listed?.count === 3,
    `B — lists 3 tiles (count ${listed?.count})`
  );
  const t0 = (listed?.items ?? []).find(t => t.id === ids[0]);
  assert(t0?.width === 200 && t0?.height === 200, 'B — reports size = width/height');
  assert(
    t0?.x === 100 && t0?.y === 100,
    `B — round-trips the tool TOP-LEFT (anchor→TL conversion; got ${t0?.x},${t0?.y})`
  );
  assert(
    listed.items.find(t => t.id === ids[1])?.scaleX === 1.25,
    'B — reports image zoom = texture.scaleX'
  );
  // Rendered truth: view the fixture scene and check the CLEAN tile's bounds sit at the reported
  // TL (ids[0] is rotated → its bounds are a rotated AABB, useless for this check).
  await f.call('prepareSceneShot', { sceneIdentifier: sceneId, fit: true });
  const bounds = await f.evaluate(
    ({ tId }) => {
      const t = globalThis.canvas?.tiles?.get?.(tId);
      return t ? { x: t.bounds?.x, y: t.bounds?.y, w: t.bounds?.width } : null;
    },
    { tId: ids[2] }
  );
  assert(
    bounds?.x === 700 && bounds?.y === 100 && bounds?.w === 200,
    `B — RENDERED bounds TL matches the reported x/y (got ${JSON.stringify(bounds)})`
  );

  // --- C: update — resize (w/h) + move (x/y) + image zoom (texture.scaleX) + one bad id ---
  console.log('\n# C: updateSceneTiles (resize + move + image zoom; unresolved id reported)');
  const updated = await f.call('updateSceneTiles', {
    sceneIdentifier: sceneId,
    patches: [
      { id: ids[0], width: 512, height: 512, x: 150, scaleX: 2 },
      { id: 'doesNotExist00', x: 5 },
    ],
  });
  assert(
    updated?.matched === 1 && updated?.updated === 1,
    `C — matched & updated 1 (matched ${updated?.matched})`
  );
  assert(
    updated?.notFoundIds?.includes('doesNotExist00'),
    'C — the bogus id is reported, not fatal'
  );
  const after = await f.evaluate(
    ({ sId, tId }) => {
      const t = game.scenes.get(sId).tiles.get(tId);
      return { w: t.width, h: t.height, x: t.x, y: t.y, scaleX: t.texture?.scaleX };
    },
    { sId: sceneId, tId: ids[0] }
  );
  assert(
    after.w === 512 && after.h === 512,
    `C — RESIZED via width/height (${after.w}x${after.h})`
  );
  // Tool said TL x=150 at the new 512 width → doc anchor x = 150 + 256; no y given, so the TL y
  // (100) stays FIXED through the resize → doc anchor y = 100 + 256.
  assert(after.x === 406, `C — MOVED via x: doc anchor = new TL + width/2 (got ${after.x})`);
  assert(after.y === 356, `C — resize kept the TL y corner fixed (doc y ${after.y})`);
  assert(after.scaleX === 2, 'C — image zoom via texture.scaleX (distinct from resize)');
  const relisted = await f.call('listSceneTiles', { sceneIdentifier: sceneId });
  const rt0 = (relisted?.items ?? []).find(t => t.id === ids[0]);
  assert(
    rt0?.x === 150 && rt0?.y === 100,
    `C — list round-trips the post-update TOP-LEFT (got ${rt0?.x},${rt0?.y})`
  );

  // --- D: delete — by id, missing id reported ---
  console.log('\n# D: deleteSceneTiles');
  const deleted = await f.call('deleteSceneTiles', {
    sceneIdentifier: sceneId,
    ids: [ids[0], ids[1], ids[2], 'ghostTile00'],
  });
  assert(deleted?.deleted === 3, `D — deleted 3 (got ${deleted?.deleted})`);
  assert(deleted?.notFoundIds?.includes('ghostTile00'), 'D — missing id reported');
  const remaining = await f.call('listSceneTiles', { sceneIdentifier: sceneId });
  assert(remaining?.count === 0, `D — 0 tiles remain (got ${remaining?.count})`);

  // --- E: AmbientLight CRUD (config nesting; torch flicker; darkness range) ---
  console.log('\n# E: light CRUD (config nesting + animation + darkness range)');
  const litE = await f.call('createSceneLights', {
    sceneIdentifier: sceneId,
    items: [
      {
        x: 500,
        y: 500,
        dim: 40,
        bright: 20,
        color: '#fcd674',
        animationType: 'torch',
        animationSpeed: 5,
        animationIntensity: 5,
        darknessMin: 0.1,
      },
      { x: 900, y: 500 /* no config — a default point light */ },
    ],
  });
  assert(litE?.created === 2, `E — created 2 lights (got ${litE?.created})`);
  const lightIds = (litE?.items ?? []).map(l => l.id);
  const liveLight = await f.evaluate(
    ({ sId, lId }) => {
      const l = game.scenes.get(sId).lights.get(lId);
      return {
        dim: l.config?.dim,
        color: l.config?.color?.css ?? l.config?.color ?? null, // v14 Color → CSS hex for the wire
        anim: l.config?.animation?.type,
        dMin: l.config?.darkness?.min,
      };
    },
    { sId: sceneId, lId: lightIds[0] }
  );
  assert(
    liveLight.dim === 40 && liveLight.color === '#fcd674',
    `E — emission nested under config (dim ${liveLight.dim})`
  );
  assert(
    liveLight.anim === 'torch' && liveLight.dMin === 0.1,
    'E — animation + darkness range persisted in config'
  );

  const listedLights = await f.call('listSceneLights', { sceneIdentifier: sceneId });
  assert(listedLights?.count === 2, `E — lists 2 lights (count ${listedLights?.count})`);

  const updL = await f.call('updateSceneLights', {
    sceneIdentifier: sceneId,
    patches: [{ id: lightIds[0], dim: 60, animationType: 'flame' }],
  });
  assert(updL?.updated === 1, 'E — updated 1 light');
  const afterL = await f.evaluate(
    ({ sId, lId }) => {
      const l = game.scenes.get(sId).lights.get(lId);
      return {
        dim: l.config?.dim,
        bright: l.config?.bright,
        anim: l.config?.animation?.type,
        color: l.config?.color?.css ?? l.config?.color ?? null, // v14 Color → CSS hex for the wire
      };
    },
    { sId: sceneId, lId: lightIds[0] }
  );
  assert(
    afterL.dim === 60 && afterL.anim === 'flame',
    'E — config.dim + config.animation.type patched'
  );
  assert(
    afterL.bright === 20 && afterL.color === '#fcd674',
    'E — partial patch PRESERVED the un-touched config fields'
  );

  const delL = await f.call('deleteSceneLights', { sceneIdentifier: sceneId, ids: lightIds });
  assert(delL?.deleted === 2, `E — deleted 2 lights (got ${delL?.deleted})`);

  // --- F: read-only list-tokens / list-notes (need existing placeables) ---
  console.log('\n# F: list-tokens / list-notes (read-only inspect layer)');
  const fx = await f.evaluate(
    async ({ sId }) => {
      const j = await JournalEntry.create({ name: 'ZZ Probe Journal' });
      const scene = game.scenes.get(sId);
      const [tk] = await scene.createEmbeddedDocuments('Token', [
        {
          name: 'Probe Token',
          x: 100,
          y: 100,
          width: 1,
          height: 1,
          disposition: -1,
          texture: { src: 'icons/svg/mystery-man.svg', scaleX: 1.5 },
        },
      ]);
      const [nt] = await scene.createEmbeddedDocuments('Note', [
        { entryId: j.id, x: 200, y: 200, text: 'Probe Note' },
      ]);
      return { journalId: j.id, tokenId: tk.id, noteId: nt.id };
    },
    { sId: sceneId }
  );
  journalId = fx.journalId;

  const tokens = await f.call('listSceneTokens', { sceneIdentifier: sceneId });
  const tk = (tokens?.items ?? []).find(t => t.id === fx.tokenId);
  assert(tokens?.found === true && tk, 'F — list-tokens finds the placed token');
  assert(
    tk?.disposition === 'hostile' && tk?.scale === 1.5,
    `F — token disposition mapped to name + art scale (${tk?.disposition}, ${tk?.scale})`
  );

  const notes = await f.call('listSceneNotes', { sceneIdentifier: sceneId });
  const nt = (notes?.items ?? []).find(n => n.id === fx.noteId);
  assert(notes?.found === true && nt, 'F — list-notes finds the pin');
  assert(
    nt?.entryId === fx.journalId && nt?.text === 'Probe Note',
    'F — note reports the linked journal + label'
  );

  // --- G: manage-placeables through the registry (the M8 union: kind × action) ---
  console.log('\n# G: manage-placeables (kind × action) through dispatch');
  const { dispatch, tools } = buildToolRegistry({
    foundry: f,
    logger: new Logger({ level: 'error' }),
    host: cfg.host,
  });
  const names = new Set(tools.map(t => t.name));
  assert(names.has('manage-placeables'), 'G — manage-placeables is advertised');
  assert(
    ['tiles', 'lights', 'walls', 'drawings', 'sounds'].every(k =>
      ['create', 'list', 'update', 'delete'].every(a => !names.has(`${a}-${k}`))
    ) &&
      ['create-scene-notes', 'list-notes', 'update-note', 'delete-note'].every(n => !names.has(n)),
    'G — the 24 per-op tools are gone'
  );
  const mp = (kind, action, args = {}) =>
    dispatch('manage-placeables', { kind, action, sceneIdentifier: sceneId, ...args });
  const gIds = {};
  // create: one of each kind
  const gCreate = {
    tiles: { items: [{ src: 'icons/svg/hazard.svg', x: 100, y: 100, width: 200, height: 200 }] },
    lights: { items: [{ x: 600, y: 600, dim: 30, bright: 15, color: '#ff9900' }] },
    walls: { items: [{ x0: 0, y0: 0, x1: 300, y1: 0, door: 1, ds: 2 }] },
    drawings: {
      items: [
        { x: 700, y: 700, shapeType: 'rectangle', width: 120, height: 80, text: 'Trap Room' },
      ],
    },
    // a 404 path keeps the path with a warning — no upload needed for the round trip
    sounds: { items: [{ path: 'sounds/ZZ-no-such-file.ogg', x: 300, y: 300, radius: 20 }] },
    notes: { items: [{ journal: fx.journalId, x: 400, y: 400, label: '7 — Vault' }] },
  };
  for (const [kind, args] of Object.entries(gCreate)) {
    const out = await mp(kind, 'create', args);
    const id = /• (\w+)/.exec(String(out))?.[1];
    gIds[kind] = id;
    assert(
      typeof out === 'string' && out.startsWith(`Created 1 ${kind.slice(0, -1)}(s) on`) && id,
      `G — create ${kind}: one-line confirmation + the id (${String(out).split('\n')[0]})`
    );
  }
  // list: one line per record under the column header; the id we made is a row
  const gColumns = {
    tiles: 'id x y width height rotation elevation sort hidden locked src scaleX scaleY',
    lights: 'id x y rotation hidden walls vision dim bright color angle animation',
    walls: 'id c move sight light sound dir door ds',
    drawings: 'id x y shapeType width height rotation elevation sort text fillType strokeColor',
    sounds: 'id x y radius path volume repeat walls easing hidden',
    notes: 'id x y text entryId pageId iconSize global',
  };
  for (const [kind, columns] of Object.entries(gColumns)) {
    const out = await mp(kind, 'list');
    const [head, ...rows] = String(out).split('\n');
    assert(
      head.startsWith(
        `${rows.length} ${kind.slice(0, -1)}(s) on "${TAG} Scene" (${sceneId}): ${columns}`
      ),
      `G — list ${kind}: header names the scene and the column order (${head.slice(0, 70)}…)`
    );
    const row = rows.find(r => r.startsWith(`${gIds[kind]} `));
    assert(row, `G — list ${kind}: the created id is a row (${row})`);
  }
  const wallsRow = String(await mp('walls', 'list', { doorsOnly: true })).split('\n');
  assert(
    wallsRow.length === 2 && /^\w+ 0,0,300,0 20 20 20 20 0 1 2/.test(wallsRow[1]),
    `G — list walls doorsOnly: the one door, its segment one cell, door 1 ds 2 (${wallsRow[1]})`
  );
  const drawingRow = String(await mp('drawings', 'list')).split('\n')[1];
  assert(
    drawingRow.includes(' "Trap Room" '),
    `G — list drawings: a label with a space is quoted (${drawingRow})`
  );
  // update: one patch per kind
  const gUpdate = {
    tiles: { patches: [{ id: gIds.tiles, width: 250 }] },
    lights: { patches: [{ id: gIds.lights, dim: 45 }] },
    walls: { patches: [{ id: gIds.walls, ds: 0 }] },
    drawings: { patches: [{ id: gIds.drawings, text: '' }] },
    sounds: { patches: [{ id: gIds.sounds, radius: 35 }] },
    notes: { patches: [{ id: gIds.notes, label: '7 — Antechamber' }] },
  };
  for (const [kind, args] of Object.entries(gUpdate)) {
    const out = await mp(kind, 'update', args);
    assert(
      String(out).startsWith(`Updated 1 of 1 matched ${kind.slice(0, -1)}(s)`),
      `G — update ${kind}: ${String(out).split('\n')[0]}`
    );
  }
  const tileAfter = String(await mp('tiles', 'list')).split('\n')[1];
  assert(/^\w+ 100 100 250 200 /.test(tileAfter), `G — the tile update landed (${tileAfter})`);
  // refusals by name
  for (const [args, want] of [
    [
      { kind: 'roofs', action: 'list' },
      'kind must be one of "tiles", "lights", "walls", "drawings", "sounds", "notes" (got "roofs")',
    ],
    [
      { kind: 'walls', action: 'roll' },
      'action must be one of "create", "list", "update", "delete" for kind "walls" (got "roll")',
    ],
    [
      { kind: 'tiles', action: 'delete', tileIds: ['x'] },
      'unknown argument "tileIds" — it takes: kind, action, sceneIdentifier, ids',
    ],
    [
      { kind: 'tiles', action: 'list', sceneIdentifier: 'ZZ-no-such-scene' },
      'Scene not found: "ZZ-no-such-scene". No tiles listed.',
    ],
  ]) {
    let msg = '';
    try {
      await dispatch('manage-placeables', args);
    } catch (e) {
      msg = e?.message ?? String(e);
    }
    assert(msg.includes(want), `G — refused by name: ${want.slice(0, 60)}`);
  }
  // delete: each id, plus a ghost reported not fatal
  for (const kind of Object.keys(gIds)) {
    const out = await mp(kind, 'delete', { ids: [gIds[kind], 'ZZghost0000000'] });
    assert(
      String(out).startsWith(`Deleted 1 ${kind.slice(0, -1)}(s)`) &&
        String(out).includes('1 id(s) not found: ZZghost0000000'),
      `G — delete ${kind}: ${String(out).split('\n')[0]}`
    );
  }
  assert(
    String(await mp('tiles', 'list')) === `0 tile(s) on "${TAG} Scene" (${sceneId}).`,
    'G — an empty list is the header alone'
  );
} catch (e) {
  fails++;
  console.log(`\n[verify-tiles] FATAL: ${e?.stack || e?.message || String(e)}`);
} finally {
  if (sceneId || journalId) {
    try {
      await f.evaluate(
        async ({ sId, jId }) => {
          if (sId) await game.scenes.get(sId)?.delete();
          if (jId) await game.journal.get(jId)?.delete();
        },
        { sId: sceneId, jId: journalId }
      );
      console.log('\n[verify-tiles] cleaned up fixture scene + journal');
    } catch (e) {
      console.log(`\n[verify-tiles] cleanup note: ${e?.message || e}`);
    }
  }
  await f.dispose?.();
}

console.log(`\n==== placeables verification: ${passes} passed, ${fails} failed ====`);
process.exit(fails > 0 ? 1 : 0);
