// Live verification — Playlists: the page functions through the foundry.call seam, then
// manage-playlists (action create / list / update / delete — the M8 union, src/tools/playlist.ts)
// through buildToolRegistry().dispatch, so the playlist-builder skill rests on a verified base.
//
// Drives a real headless Foundry session (exercises the built dist/page.bundle.js). Against the
// live sandbox world it proves:
//   * createPlaylist builds a Playlist with one PlaylistSound per path, writing the v14 sound `path`
//     field (FilePathField) — if `path` had been renamed, the returned sound would carry no path;
//   * the playback `mode` maps (shuffle) and repeat/volume apply;
//   * updatePlaylist renames + re-modes;
//   * the playlist is listed, its mode BY NAME;
//   * through dispatch: the four per-op tools are gone; create / update / delete answer one-line
//     confirmations; list is the §3 line shape (header + one row per playlist) and reads the
//     update back; an unknown action / key is refused by name; a miss is an error.
// FilePathField validates extension/format, not file existence, so plausible .ogg paths are accepted.
// Everything created is cleaned up.
//
// Build first: npm run build. Run: node scripts/verify-playlist-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();

const TAG = 'ZZ-PLAYLIST-IT';
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

let playlistId;
let unionId;
try {
  console.log('[verify-playlist] connecting to sandbox…');
  await f.connect();
  console.log('[verify-playlist] connected — exercising Playlist tooling\n');
  const worldId = await f.worldId(); // the live world's id — the paths need not exist
  // --- create-playlist: a soundscape (shuffle, looping) ---
  console.log('# createPlaylist: layered ambience');
  const created = await f.call('createPlaylist', {
    name: `${TAG} Storm Ambience`,
    soundPaths: [
      `worlds/${worldId}/assets/audio/rain.ogg`,
      `worlds/${worldId}/assets/audio/thunder.ogg`,
    ],
    mode: 'shuffle',
    repeat: true,
    defaultVolume: 0.4,
  });
  playlistId = created?.playlistId;
  assert(Boolean(playlistId), `playlist created (${created?.playlistName})`);
  assert(created?.soundCount === 2, `2 tracks added (${created?.soundCount})`);
  assert(created?.mode === 'shuffle', `mode is shuffle (${created?.mode})`);
  assert(
    Array.isArray(created?.sounds) &&
      created.sounds.length === 2 &&
      created.sounds.every(s => typeof s.path === 'string' && s.path.endsWith('.ogg')),
    'each track carries the v14 `path` field (file path round-trips)'
  );

  // --- update-playlist: rename + re-mode ---
  console.log('\n# updatePlaylist: rename + re-mode');
  const updated = await f.call('updatePlaylist', {
    identifier: playlistId,
    name: `${TAG} Storm Ambience (v2)`,
    mode: 'sequential',
  });
  assert(updated?.updated === true, 'update reported success');

  // --- list-playlists: it shows up ---
  console.log('\n# listPlaylists');
  const list = await f.call('listPlaylists', {});
  const mine = (Array.isArray(list) ? list : []).find(p => p.id === playlistId);
  assert(Boolean(mine), 'created playlist appears in the list');
  assert(mine?.name === `${TAG} Storm Ambience (v2)`, 'list reflects the rename');
  assert(mine?.soundCount === 2, 'list reflects the track count');
  assert(mine?.mode === 'sequential', `list reports the mode by name (${mine?.mode})`);

  // --- manage-playlists through the registry (the M8 union: action create / list / update / delete)
  console.log('\n# manage-playlists (action) through dispatch');
  const { dispatch, tools } = buildToolRegistry({
    foundry: f,
    logger: new Logger({ level: 'error' }),
    host: cfg.host,
  });
  const names = new Set(tools.map(t => t.name));
  assert(
    names.has('manage-playlists') &&
      ['create-playlist', 'list-playlists', 'update-playlist', 'delete-playlist'].every(
        n => !names.has(n)
      ),
    'manage-playlists is advertised, the four per-op tools are gone'
  );
  const mp = args => dispatch('manage-playlists', args);
  const cr = String(
    await mp({
      action: 'create',
      name: `${TAG} Union`,
      soundPaths: [`worlds/${worldId}/assets/audio/wind.ogg`],
      mode: 'soundboard',
      repeat: true,
    })
  );
  unionId = /\((\w+)\)/.exec(cr)?.[1];
  assert(
    !!unionId &&
      cr.startsWith(`Created playlist "${TAG} Union" (${unionId}): mode soundboard, 1 track(s)`),
    `create: the one-line confirmation (${cr.split('\n')[0]})`
  );
  const l1 = String(await mp({ action: 'list' })).split('\n');
  assert(
    /^\d+ playlist\(s\): id name mode tracks playing$/.test(l1[0] ?? ''),
    `list: the header + the columns (${l1[0]})`
  );
  const row = l1.find(x => x.startsWith(`${unionId} `)) ?? '';
  assert(
    row === `${unionId} "${TAG} Union" soundboard 1 false`,
    `list row: id, quoted name, mode by name, tracks, playing (${row})`
  );
  const up = String(
    await mp({
      action: 'update',
      identifier: unionId,
      name: `${TAG} Union 2`,
      mode: 'shuffle',
      fade: 250,
    })
  );
  assert(up === `Updated playlist "${TAG} Union 2" (${unionId})`, `update: one line (${up})`);
  const row2 =
    String(await mp({ action: 'list' }))
      .split('\n')
      .find(x => x.startsWith(`${unionId} `)) ?? '';
  assert(
    row2 === `${unionId} "${TAG} Union 2" shuffle 1 false`,
    `list reads the update back: the rename and the mode (${row2})`
  );
  for (const [args, want] of [
    [
      { action: 'play', identifier: 'x' },
      'action must be one of "create", "list", "update", "delete"',
    ],
    [{ action: 'delete', ids: ['x'] }, 'unknown argument "ids" — it takes: action, identifiers'],
    [
      { action: 'update', identifier: 'ZZ-no-such-playlist', name: 'x' },
      'Playlist not found: "ZZ-no-such-playlist". Nothing changed.',
    ],
  ]) {
    let msg = '';
    try {
      await mp(args);
    } catch (e) {
      msg = e?.message ?? String(e);
    }
    assert(msg.includes(want), `refused by name / a miss is an error: ${want.slice(0, 60)}`);
  }
  const del = String(await mp({ action: 'delete', identifiers: [unionId, 'ZZ-NOPE-PL'] }));
  assert(
    del === `Deleted 1 playlist(s): "${TAG} Union 2" (${unionId}) (1 not found: ZZ-NOPE-PL)`,
    `delete: the one-line confirmation with the not-found tail (${del})`
  );
  unionId = undefined;
} catch (e) {
  fails++;
  console.log(`\n[verify-playlist] FATAL: ${e?.message || String(e)}`);
} finally {
  const strays = [playlistId, unionId].filter(Boolean);
  if (strays.length) {
    try {
      await f.call('deletePlaylists', { identifiers: strays });
      console.log('\n[verify-playlist] cleaned up playlist(s)');
    } catch {
      /* best-effort */
    }
  }
  await f.dispose?.();
}

console.log(`\n==== playlist-tooling verification: ${passes} passed, ${fails} failed ====`);
process.exit(fails > 0 ? 1 : 0);
