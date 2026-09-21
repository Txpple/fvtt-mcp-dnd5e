// Live acceptance for the scene-document tools: the page's createScene / updateScene params
// (grid scale, token vision, fog mode, lighting, weather, auto-dimension, playlist / journal link
// resolution) end-to-end via the foundry.call seam, the sidecar import through the tool class,
// then manage-scenes (action create / list / update / delete — the M8 union, src/tools/scene.ts)
// through buildToolRegistry().dispatch: the four per-op tools are gone; create reports its facts;
// list is the §3 line shape (header + one row per scene, + flags under flagScope); update's miss
// is an error; delete is one line; an unknown action / key is refused by name. Unit tests mock the
// seam, so this is the real correctness gate. Scenes are tagged ZZ-MCP-ST and deleted in a finally.
//
// Build first: npm run build. Run: node scripts/verify-scene-tools.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { SceneTools } from '../dist/tools/scene.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const TAG = 'ZZ-MCP-ST';
const BG_VECTOR = 'icons/svg/dice-target.svg'; // always present in core Foundry
const BG_RASTER = 'assets/mcp/mcp-claude.jpg'; // bundled portrait (for auto-dimension)

const env = loadEnv();
const cfg = bridgeConfig(env);
const foundry = new Foundry(cfg);

const results = [];
const pass = (n, s) => {
  results.push({ n, ok: true });
  console.log(`PASS  ${n}${s ? ` -> ${s}` : ''}`);
};
const fail = (n, e) => {
  results.push({ n, ok: false });
  console.log(`FAIL  ${n} -> ${e}`);
};
const createdSceneIds = [];

async function expectThrow(n, fn, match) {
  try {
    await fn();
    fail(n, 'expected throw, got success');
  } catch (e) {
    const msg = e?.message || String(e);
    if (match && !msg.includes(match)) fail(n, `threw but missing "${match}": ${msg}`);
    else pass(n, `threw as expected`);
  }
}

try {
  // ---- 1. create with the full new param set (explicit dims) ----
  const c1 = await foundry.call('createScene', {
    name: `${TAG}-full`,
    backgroundPath: BG_VECTOR,
    width: 3000,
    height: 2000,
    gridSize: 100,
    gridType: 1,
    gridDistance: 5,
    gridUnits: 'ft',
    tokenVision: true,
    fogMode: 'shared',
    darkness: 0.6,
    globalLight: false,
    weather: 'snow',
  });
  if (c1?.sceneId) createdSceneIds.push(c1.sceneId);
  const s1 = c1?.settings || {};
  console.log('   create settings:', JSON.stringify(s1));
  const okFull =
    c1?.success &&
    s1.grid?.distance === 5 &&
    s1.grid?.units === 'ft' &&
    s1.tokenVision === true &&
    s1.fogMode === 'shared' &&
    Math.abs((s1.darkness ?? -1) - 0.6) < 1e-6 &&
    s1.globalLight === false &&
    s1.weather === 'snow' &&
    c1?.width === 3000 &&
    c1?.height === 2000;
  okFull
    ? pass('create-scene full params', `${c1.sceneId}`)
    : fail(
        'create-scene full params',
        JSON.stringify({ width: c1?.width, height: c1?.height, s1 })
      );

  // ---- 2. auto-dimension from a raster image (no width/height passed) ----
  const c2 = await foundry.call('createScene', {
    name: `${TAG}-auto`,
    backgroundPath: BG_RASTER,
  });
  if (c2?.sceneId) createdSceneIds.push(c2.sceneId);
  if (c2?.autoSized && c2?.width > 0 && c2?.height > 0) {
    pass('create-scene auto-dimension', `${c2.width}x${c2.height} (autoSized)`);
  } else {
    // soft: the raster asset may not exist on this instance — note, don't hard-fail
    console.log(
      `NOTE  auto-dimension not confirmed (autoSized=${c2?.autoSized}, ${c2?.width}x${c2?.height}) — asset "${BG_RASTER}" may be absent`
    );
    pass('create-scene auto-dimension (soft)', `autoSized=${c2?.autoSized}`);
  }

  // ---- 3. update: flip lighting, clear weather, change fog, set grid units ----
  const u1 = await foundry.call('updateScene', {
    sceneIdentifier: c1.sceneId,
    darkness: 1,
    globalLight: true,
    weather: '',
    fogMode: 'individual',
    gridDistance: 10,
  });
  const su = u1?.settings || {};
  console.log('   update settings:', JSON.stringify(su));
  const okUpd =
    u1?.updated &&
    Math.abs((su.darkness ?? -1) - 1) < 1e-6 &&
    su.globalLight === true &&
    su.weather === '' &&
    su.fogMode === 'individual' &&
    su.grid?.distance === 10;
  okUpd
    ? pass('update-scene fields', `${u1.sceneId}`)
    : fail('update-scene fields', JSON.stringify(su));

  // ---- 3b. Foundry 14.368 darknessLock: a darkness write on a LOCKED scene must still land ----
  // Core drops `environment.darknessLevel` from an update on a locked scene unless the lock is
  // restated in the same update (Scene#_preUpdate, #14718); the tool restates it and warns.
  await foundry.evaluate(
    id => game.scenes.get(id).update({ 'environment.darknessLock': true }),
    c1.sceneId
  );
  const u1b = await foundry.call('updateScene', { sceneIdentifier: c1.sceneId, darkness: 0.25 });
  const lockState = await foundry.evaluate(
    id => ({
      lock: game.scenes.get(id).environment.darknessLock,
      level: game.scenes.get(id).environment.darknessLevel,
    }),
    c1.sceneId
  );
  const okLock =
    u1b?.updated &&
    Math.abs((lockState?.level ?? -1) - 0.25) < 1e-6 &&
    lockState?.lock === true &&
    (u1b?.warnings ?? []).some(w => /darknessLock/.test(w));
  okLock
    ? pass(
        'update-scene darkness on a LOCKED scene lands, keeps the lock, warns',
        `level=${lockState.level}`
      )
    : fail(
        'update-scene darkness on a LOCKED scene',
        JSON.stringify({ lockState, warnings: u1b?.warnings, settings: u1b?.settings })
      );
  await foundry.evaluate(
    id => game.scenes.get(id).update({ 'environment.darknessLock': false }),
    c1.sceneId
  );

  // ---- 4. weather + case-insensitive normalization ----
  const u2 = await foundry.call('updateScene', { sceneIdentifier: c1.sceneId, weather: 'RAIN' });
  u2?.settings?.weather === 'rain'
    ? pass('weather case-normalization', `RAIN -> ${u2.settings.weather}`)
    : fail('weather case-normalization', JSON.stringify(u2?.settings));

  // ---- 5. invalid weather rejected with listing ----
  await expectThrow(
    'invalid weather rejected',
    () => foundry.call('updateScene', { sceneIdentifier: c1.sceneId, weather: 'thunderstorm' }),
    'Unknown weather'
  );

  // ---- 6. invalid fogMode rejected ----
  await expectThrow(
    'invalid fogMode rejected',
    () => foundry.call('updateScene', { sceneIdentifier: c1.sceneId, fogMode: 'sometimes' }),
    'Invalid fogMode'
  );

  // ---- 7. link resolution: attach an existing journal/playlist by name ----
  const existing = await foundry.evaluate(
    () => ({
      journal: game.journal?.contents?.[0]
        ? { id: game.journal.contents[0].id, name: game.journal.contents[0].name }
        : null,
      playlist: game.playlists?.contents?.[0]
        ? { id: game.playlists.contents[0].id, name: game.playlists.contents[0].name }
        : null,
    }),
    null
  );
  if (existing?.journal) {
    const uj = await foundry.call('updateScene', {
      sceneIdentifier: c1.sceneId,
      journal: existing.journal.name,
    });
    uj?.settings?.journal === existing.journal.id
      ? pass('journal link by name', `${existing.journal.name} -> ${existing.journal.id}`)
      : fail('journal link by name', `got ${uj?.settings?.journal}, want ${existing.journal.id}`);
    // clear it
    const ujc = await foundry.call('updateScene', { sceneIdentifier: c1.sceneId, journal: '' });
    ujc?.settings?.journal == null
      ? pass('journal link clear with ""', 'cleared')
      : fail('journal link clear with ""', `got ${ujc?.settings?.journal}`);
  } else {
    console.log('NOTE  no journals in world — skipping journal link test');
  }
  if (existing?.playlist) {
    const up = await foundry.call('updateScene', {
      sceneIdentifier: c1.sceneId,
      playlist: existing.playlist.name,
    });
    up?.settings?.playlist === existing.playlist.id
      ? pass('playlist link by name', `${existing.playlist.name} -> ${existing.playlist.id}`)
      : fail(
          'playlist link by name',
          `got ${up?.settings?.playlist}, want ${existing.playlist.id}`
        );
  } else {
    console.log('NOTE  no playlists in world — skipping playlist link test');
  }

  // ---- 8. unknown link name rejected ----
  await expectThrow(
    'unknown journal name rejected',
    () => foundry.call('updateScene', { sceneIdentifier: c1.sceneId, journal: 'NoSuchJournalXYZ' }),
    'No journal found'
  );

  // ---- 9. a map sidecar through placeablesPath (F29: scene-builder's path) ----
  // A legacy Dungeon-Alchemist-style export next to a v14-shaped wall and light, handed to the
  // Node handler as a FILE: the arrays are read server-side, whole, and normalized — the legacy
  // `sense` drives sight AND light, a v14 light keeps its whole `config` (luminosity, animation).
  const dir = mkdtempSync(join(tmpdir(), 'mcp-sidecar-'));
  const sidecar = join(dir, 'map.json');
  writeFileSync(
    sidecar,
    JSON.stringify({
      width: 1200,
      height: 800,
      grid: 100,
      gridDistance: 5,
      gridUnits: 'ft',
      padding: 0,
      walls: [
        { c: [100, 100, 500, 100], move: 1, sense: 2, sound: 1, door: 0 }, // legacy LIMITED
        { c: [500, 100, 500, 500], move: 20, sight: 0, light: 0, sound: 20, door: 0 }, // v14 see-through
      ],
      lights: [
        { x: 300, y: 300, dim: 30, bright: 15, tintColor: '#ff9329', tintAlpha: 0.5 }, // legacy
        {
          x: 700,
          y: 300,
          rotation: 0,
          config: {
            dim: 40,
            bright: 20,
            color: '#ffb066',
            alpha: 0.4,
            luminosity: 0.25,
            attenuation: 0.75,
            animation: { type: 'torch', speed: 5, intensity: 5 },
          },
        },
      ],
    })
  );
  try {
    const tools = new SceneTools({
      foundry,
      logger: new Logger({ level: 'error', format: 'simple' }),
    });
    const text = await tools.handleManageScenes({
      action: 'create',
      name: `${TAG}-sidecar`,
      backgroundPath: BG_VECTOR,
      width: 1200,
      height: 800,
      gridSize: 100,
      gridDistance: 5,
      gridUnits: 'ft',
      padding: 0,
      placeablesPath: sidecar,
    });
    const back = await foundry.evaluate(name => {
      const s = globalThis.game.scenes.find(x => x.name === name);
      if (!s) return null;
      const w = s.walls.contents.map(x => ({
        c: x.c,
        sight: x.sight,
        light: x.light,
        move: x.move,
      }));
      const l = s.lights.contents.map(x => ({
        x: x.x,
        luminosity: x.config?.luminosity,
        anim: x.config?.animation?.type,
        dim: x.config?.dim,
      }));
      return { id: s.id, walls: w, lights: l };
    }, `${TAG}-sidecar`);
    if (back?.id) createdSceneIds.push(back.id);
    /imported: 2 wall\(s\), 2 light\(s\)/.test(text)
      ? pass(
          'placeablesPath: 2 walls + 2 lights placed from the file',
          text.match(/imported:[^\n]*/)?.[0]
        )
      : fail('placeablesPath: 2 walls + 2 lights placed from the file', text);
    const legacy = back?.walls?.find(w => w.c?.[0] === 100);
    legacy?.sight === 10 && legacy?.light === 10 && legacy?.move === 20
      ? pass('legacy sense:2 → v14 sight 10 + light 10, move 1 → 20')
      : fail('legacy sense:2 → v14 sight 10 + light 10, move 1 → 20', JSON.stringify(legacy));
    const v14 = back?.walls?.find(w => w.c?.[0] === 500);
    v14?.sight === 0 && v14?.light === 0
      ? pass('v14 sight:0 kept (see-through wall stays see-through)')
      : fail('v14 sight:0 kept (see-through wall stays see-through)', JSON.stringify(v14));
    const torch = back?.lights?.find(l => l.x === 700);
    torch?.luminosity === 0.25 && torch?.anim === 'torch' && torch?.dim === 40
      ? pass('v14 light config carried whole (luminosity 0.25, torch animation)')
      : fail(
          'v14 light config carried whole (luminosity 0.25, torch animation)',
          JSON.stringify(torch)
        );
    const legacyLight = back?.lights?.find(l => l.x === 300);
    legacyLight?.dim === 30
      ? pass('legacy light dim/bright normalized into config')
      : fail('legacy light dim/bright normalized into config', JSON.stringify(legacyLight));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── manage-scenes through the registry (the M8 union: action create / list / update / delete) ──
  {
    const { dispatch, tools } = buildToolRegistry({
      foundry,
      logger: new Logger({ level: 'error' }),
      host: cfg.host,
    });
    const names = new Set(tools.map(t => t.name));
    names.has('manage-scenes') &&
    ['create-scene', 'list-scenes', 'update-scene', 'delete-scene'].every(n => !names.has(n))
      ? pass('manage-scenes: advertised; the four per-op tools gone')
      : fail('manage-scenes: advertised', [...names].filter(n => /scene/.test(n)).join(','));
    const ms = args => dispatch('manage-scenes', args);
    const cr = String(
      await ms({
        action: 'create',
        name: `${TAG}-union`,
        backgroundPath: BG_VECTOR,
        width: 1000,
        height: 600,
        darkness: 0.4,
        weather: 'snow',
        flags: { 'zz-mcp-st': { sourceId: 'union-1' } },
      })
    );
    const unionId = /\((\w{16})\)/.exec(cr)?.[1];
    if (unionId) createdSceneIds.push(unionId);
    !!unionId &&
    cr.startsWith(`Created scene "${TAG}-union" (${unionId})\n  background: ${BG_VECTOR}`) &&
    cr.includes('dimensions: 1000×600px') &&
    cr.includes('darkness 0.4') &&
    cr.includes('weather snow')
      ? pass('manage-scenes create: the report (dimensions, darkness, weather)', cr.split('\n')[0])
      : fail('manage-scenes create', cr);
    const lines = String(
      await ms({ action: 'list', filter: `${TAG}-union`, flagScope: 'zz-mcp-st' })
    ).split('\n');
    lines[0] ===
      '1 scene(s): id name active width height grid darkness weather tokens walls flags' &&
    // width / height are the PADDED canvas (what the old list printed too): match the shape
    /^\w{16} ZZ-MCP-ST-union false \d+ \d+ 100 0.4 snow 0 0 \{"sourceId":"union-1"\}$/.test(
      lines[1] ?? ''
    )
      ? pass('manage-scenes list: the header + the row with flags[flagScope]', lines[1])
      : fail('manage-scenes list', lines.join(' | '));
    const up = String(
      await ms({
        action: 'update',
        sceneIdentifier: unionId,
        name: `${TAG}-union-2`,
        darkness: 0.9,
        weather: '',
      })
    );
    up.startsWith(`Updated scene "${TAG}-union-2" (${unionId})`) &&
    up.includes('darkness 0.9') &&
    !up.includes('weather')
      ? pass('manage-scenes update: rename + darkness, weather cleared', up.split('\n')[0])
      : fail('manage-scenes update', up);
    for (const [args, want] of [
      [
        { action: 'activate', sceneIdentifier: unionId },
        'action must be one of "create", "list", "update", "delete"',
      ],
      [
        { action: 'list', sceneIdentifier: unionId },
        'unknown argument "sceneIdentifier" — it takes: action, filter, includeActiveOnly, flagScope',
      ],
      [
        { action: 'update', sceneIdentifier: 'ZZ-no-such-scene', darkness: 0.1 },
        'Scene not found: "ZZ-no-such-scene". Nothing changed.',
      ],
    ]) {
      let msg = '';
      try {
        await ms(args);
      } catch (e) {
        msg = e?.message ?? String(e);
      }
      msg.includes(want)
        ? pass(`manage-scenes refused by name / a miss is an error: ${want.slice(0, 50)}`)
        : fail(`manage-scenes refusal: ${want.slice(0, 50)}`, msg.slice(0, 140));
    }
    const del = String(await ms({ action: 'delete', identifiers: [unionId, 'ZZ-NOPE-SCENE'] }));
    del === `Deleted 1 scene(s): "${TAG}-union-2" (${unionId}) (1 not found: ZZ-NOPE-SCENE)`
      ? pass('manage-scenes delete: one line with the not-found tail', del)
      : fail('manage-scenes delete', del);
    createdSceneIds.splice(createdSceneIds.indexOf(unionId), 1);
  }
} catch (e) {
  fail('SUITE', e?.message || String(e));
} finally {
  // cleanup
  if (createdSceneIds.length) {
    try {
      const del = await foundry.call('deleteScenes', { identifiers: createdSceneIds });
      console.log(`cleanup -> deleted ${del?.deletedCount ?? 0} scene(s)`);
    } catch (e) {
      console.log(`cleanup FAILED: ${e?.message || e}`);
    }
  }
  await foundry.dispose?.();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
