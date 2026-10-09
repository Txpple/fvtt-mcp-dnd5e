// maplib/import.mjs — put a library scene (a folder extract.mjs wrote) into the live world, whole:
// the map and every asset it references are uploaded through the host's file plane, the paths in
// the scene document are rewritten to where they landed, and the document is created in one
// Scene.create with its walls, lights, sounds, tiles, regions, notes, drawings and levels intact.
// The map image may have been replaced in the library (an imagegen edit): the import takes what
// is in the folder, and warns when its pixel size no longer matches meta.json.
//
//   FOUNDRY_HOST=local node scripts/maplib/import.mjs <scene folder> [options]
//   options: --dest <Data-relative root>   default worlds/<world>/assets/maplib/<pack id>
//            --folder "<Scene folder>"      default the creator's name; "" for none
//            --name "<scene name>"          default the pack's scene name
//            --overwrite                    re-upload assets that already exist on the host
//            --force                        create even when this scene was imported before
//            --activate                     activate the scene after creating it
//            --dry-run                      report what would be uploaded and created, change nothing
//
// Build first (npm run build): this imports the built bridge like every script here.
import fs from 'node:fs';
import path from 'node:path';
import { connectFoundry } from '../../dist/client.js';
import { filePlaneFor } from '../../dist/hosts/index.js';

const argv = process.argv.slice(2);
const sceneDir = argv.find(
  a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.match(/^--(dest|folder|name)$/)
);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = name => argv.includes(name);
if (!sceneDir || !fs.existsSync(path.join(sceneDir, 'scene.json'))) {
  console.error('usage: import.mjs <scene folder containing scene.json + meta.json> [options]');
  process.exit(2);
}
const meta = JSON.parse(fs.readFileSync(path.join(sceneDir, 'meta.json'), 'utf8'));
const doc = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene.json'), 'utf8'));
const packDir = path.resolve(sceneDir, '..');
const dryRun = flag('--dry-run');
const overwrite = flag('--overwrite');
const force = flag('--force');

const CONTENT_TYPES = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
};
function deepStrings(o, fn) {
  if (typeof o === 'string') return fn(o);
  if (Array.isArray(o)) return o.map(v => deepStrings(v, fn));
  if (o && typeof o === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o)) r[k] = deepStrings(v, fn);
    return r;
  }
  return o;
}

const { f, host, dispose } = await connectFoundry({ tag: 'maplib', watchdogMs: 600_000 });
try {
  const worldId = await f.worldId();
  const dest = (opt('--dest') ?? `worlds/${worldId}/assets/maplib/${meta.pack.id}`).replace(
    /\/+$/,
    ''
  );
  const name = opt('--name') ?? doc.name;
  const folderName = opt('--folder') ?? meta.creator ?? '';
  const plane = filePlaneFor(host, f);
  console.log(
    `world: ${worldId}  file plane: ${plane.label}\nscene: "${name}" from ${meta.pack.id}/${meta.scene.folder}\nassets -> ${dest}/`
  );

  // Dedup on the provenance flag this importer stamps.
  const prior = await f.evaluate(
    ({ pack, sourceId }) =>
      game.scenes
        .filter(s => s.flags?.maplib?.pack === pack && s.flags?.maplib?.sourceId === sourceId)
        .map(s => ({ id: s.id, name: s.name })),
    { pack: meta.pack.id, sourceId: meta.scene.sourceId }
  );
  if (prior.length && !force) {
    console.log(
      `already imported: ${prior.map(p => `"${p.name}" (${p.id})`).join(', ')} — pass --force to create another copy`
    );
    process.exit(0);
  }

  // Upload every asset the scene references, from the library's assets/ tree.
  let uploaded = 0,
    skipped = 0,
    missing = 0;
  for (const rel of meta.assets) {
    const local = path.join(packDir, 'assets', rel);
    const remote = `${dest}/${rel}`;
    if (!fs.existsSync(local)) {
      console.warn(`  missing in library: assets/${rel}`);
      missing++;
      continue;
    }
    if (!overwrite && (await plane.exists(remote))) {
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`  would upload ${rel}`);
      uploaded++;
      continue;
    }
    await plane.ensureParents(remote);
    await plane.write(
      remote,
      fs.readFileSync(local),
      CONTENT_TYPES[path.extname(rel).slice(1).toLowerCase()]
    );
    uploaded++;
  }
  console.log(`assets: ${uploaded} uploaded, ${skipped} already there, ${missing} missing`);

  // Warn when the map in the library no longer matches the pixel size the scene was authored for.
  const bgRel = meta.map.background?.replace(/^assets\//, '');
  if (bgRel && meta.map.imagePixels) {
    try {
      const { createRequire } = await import('node:module');
      let sharp = null;
      for (const root of ['../../package.json', '../../../fvtt-mcp-imagegen/package.json']) {
        try {
          sharp = createRequire(new URL(root, import.meta.url))('sharp');
          break;
        } catch {}
      }
      if (!sharp) throw new Error('no sharp');
      const m = await sharp(fs.readFileSync(path.join(packDir, 'assets', bgRel))).metadata();
      if (m.width !== meta.map.imagePixels.width || m.height !== meta.map.imagePixels.height)
        console.warn(
          `  map is ${m.width}x${m.height}, the scene was authored for ${meta.map.imagePixels.width}x${meta.map.imagePixels.height}: walls and lights will not line up unless the scene is resized`
        );
    } catch {}
  }

  // The document: paths to the host, provenance stamped, pack-only flags dropped, ids left to Foundry.
  const data = deepStrings(doc, s =>
    s.startsWith('assets/') ? `${dest}/${s.slice('assets/'.length)}` : s
  );
  delete data._id;
  delete data._stats;
  delete data.folder;
  data.name = name;
  data.active = false;
  data.navigation = false;
  data.thumb = null;
  data.flags = { ...(data.flags ?? {}) };
  for (const k of ['scene-packer', 'cf', 'core']) delete data.flags[k];
  data.flags.maplib = {
    library: meta.library,
    pack: meta.pack.id,
    packVersion: meta.pack.version,
    sourceId: meta.scene.sourceId,
    sceneFolder: meta.scene.folder,
    importedAt: new Date().toISOString(),
  };
  // The same provenance the MCP's teleporter remap reads (manage-placeables, kind regions,
  // action remap-teleporters, sourceModule = the pack id): the scene's source id, and each
  // region's, so a stair between two imported scenes can be re-pointed once both exist.
  data.flags['tom-cartos-import'] = { sourceModule: meta.pack.id, sourceId: meta.scene.sourceId };
  data.regions = (data.regions ?? []).map(r => ({
    ...r,
    flags: { ...(r.flags ?? {}), 'tom-cartos-import': { sourceId: r._id } },
  }));
  const counts = {
    walls: data.walls?.length ?? 0,
    lights: data.lights?.length ?? 0,
    sounds: data.sounds?.length ?? 0,
    tiles: data.tiles?.length ?? 0,
    regions: data.regions?.length ?? 0,
    notes: data.notes?.length ?? 0,
    drawings: data.drawings?.length ?? 0,
    levels: data.levels?.length ?? 0,
  };
  if (dryRun) {
    console.log(
      `would create "${name}" with ${JSON.stringify(counts)} in folder "${folderName || '(none)'}"`
    );
    process.exit(0);
  }

  const result = await f.evaluate(
    async ({ data, folderName, legacyBackground, activate }) => {
      if (folderName) {
        let folder = game.folders.find(
          x => x.type === 'Scene' && x.name === folderName && !x.folder
        );
        folder ??= await Folder.create({ name: folderName, type: 'Scene' });
        data.folder = folder.id;
      }
      const scene = await Scene.create(data);
      // A pre-v14 document carries its map at background.src; v14 keeps it on the initial level.
      const levels = scene.toObject().levels ?? [];
      if (legacyBackground && levels.length) {
        const i = Math.max(
          0,
          levels.findIndex(l => l._id === scene.initialLevel)
        );
        if (!levels[i].background?.src) {
          levels[i].background = { ...(levels[i].background ?? {}), src: legacyBackground };
          await scene.update({ levels });
        }
      }
      let thumb = null;
      try {
        const t = await scene.createThumbnail();
        if (t?.thumb) {
          await scene.update({ thumb: t.thumb });
          thumb = 'generated';
        }
      } catch (e) {
        thumb = `not generated: ${e.message}`;
      }
      if (activate) await scene.activate();
      const o = scene.toObject();
      return {
        id: scene.id,
        name: scene.name,
        folder: scene.folder?.name ?? null,
        thumb,
        background:
          (o.levels ?? []).find(l => l._id === o.initialLevel)?.background?.src ??
          o.background?.src ??
          null,
        counts: {
          walls: o.walls.length,
          lights: o.lights.length,
          sounds: o.sounds.length,
          tiles: o.tiles.length,
          regions: o.regions.length,
          notes: o.notes.length,
          drawings: o.drawings.length,
          levels: (o.levels ?? []).length,
        },
      };
    },
    {
      data,
      folderName,
      legacyBackground: data.levels?.length ? null : (data.background?.src ?? null),
      activate: flag('--activate'),
    }
  );
  console.log(
    `created "${result.name}" (${result.id}) in folder ${result.folder ?? '(none)'}\n  background: ${result.background}\n  placed: ${JSON.stringify(result.counts)}\n  thumbnail: ${result.thumb}`
  );
  for (const k of Object.keys(counts))
    if (counts[k] !== result.counts[k])
      console.warn(`  ${k}: sent ${counts[k]}, scene has ${result.counts[k]}`);
} finally {
  await dispose();
}
