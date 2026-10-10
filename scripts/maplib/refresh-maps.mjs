// maplib/refresh-maps.mjs — rebuild the map picture (map.webp, preview.jpg, meta.json) of library
// scenes that have no single background image, by painting their ground tiles (mapimage.mjs). Works
// on the library alone: the creator's modules need not be installed any more. Rewrites the
// catalogue afterwards. Scenes with a background image are left as they are.
//
//   node scripts/maplib/refresh-maps.mjs --library "<Desktop>\Maps_MC" [--only <pack id>] [--dry-run]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groundTiles, hasNoBackground, stitchTiles } from './mapimage.mjs';

const argv = process.argv.slice(2);
const opt = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const library = opt('--library');
if (!library || !fs.existsSync(path.join(library, 'catalog.json'))) {
  console.error('--library <dir with catalog.json> is required');
  process.exit(2);
}
const only = opt('--only');
const dryRun = argv.includes('--dry-run');

let sharp = null;
const here = path.dirname(fileURLToPath(import.meta.url));
for (const root of [
  path.resolve(here, '../..'),
  path.resolve(here, '../../../fvtt-mcp-imagegen'),
]) {
  try {
    sharp = createRequire(path.join(root, 'package.json'))('sharp');
    break;
  } catch {}
}
if (!sharp) {
  console.error('sharp not found (npm i in fvtt-mcp-imagegen)');
  process.exit(1);
}

let done = 0;
let skipped = 0;
for (const pack of fs.readdirSync(library, { withFileTypes: true })) {
  if (!pack.isDirectory() || (only && pack.name !== only)) continue;
  const packDir = path.join(library, pack.name);
  const pj = path.join(packDir, 'pack.json');
  if (!fs.existsSync(pj)) continue;
  for (const folder of JSON.parse(fs.readFileSync(pj, 'utf8')).sceneFolders ?? []) {
    const dir = path.join(packDir, folder);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
    if (!hasNoBackground(doc)) continue;
    const tiles = groundTiles(doc);
    if (tiles.length < 2) {
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`would stitch ${tiles.length} tiles: ${pack.name}/${folder}`);
      done++;
      continue;
    }
    const tmp = path.join(dir, 'map.stitching.webp');
    const info = await stitchTiles(sharp, tiles, packDir, tmp);
    if (!info) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    // The earlier single-tile copy goes; the stitched picture is the map.
    if (meta.files?.map && meta.files.map !== 'map.webp')
      fs.rmSync(path.join(dir, meta.files.map), { force: true });
    fs.renameSync(tmp, path.join(dir, 'map.webp'));
    const m = await sharp(fs.readFileSync(path.join(dir, 'map.webp'))).metadata();
    meta.files = { ...(meta.files ?? {}), map: 'map.webp', preview: 'preview.jpg' };
    meta.map = {
      ...meta.map,
      stitched: info,
      imagePixels: { width: m.width, height: m.height },
      video: false,
    };
    const preview = await sharp(fs.readFileSync(path.join(dir, 'map.webp')), {
      limitInputPixels: false,
    })
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#000000' })
      .jpeg({ quality: 78 })
      .toBuffer();
    fs.writeFileSync(path.join(dir, 'preview.jpg'), preview);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`stitched ${info.tiles} tiles: ${pack.name}/${folder} -> ${m.width}x${m.height}`);
    done++;
  }
}
console.log(
  `${dryRun ? 'would stitch' : 'stitched'} ${done}; ${skipped} scenes without a background have fewer than 2 ground tiles`
);

if (!dryRun && done) {
  // The catalogue from every scene's meta.json, as extract.mjs writes it.
  const catalog = [];
  for (const pack of fs.readdirSync(library, { withFileTypes: true })) {
    const pj = path.join(library, pack.name, 'pack.json');
    if (!pack.isDirectory() || !fs.existsSync(pj)) continue;
    for (const s of JSON.parse(fs.readFileSync(pj, 'utf8')).sceneFolders ?? []) {
      const mp = path.join(library, pack.name, s, 'meta.json');
      if (fs.existsSync(mp)) catalog.push(JSON.parse(fs.readFileSync(mp, 'utf8')));
    }
  }
  catalog.sort(
    (a, b) => a.pack.id.localeCompare(b.pack.id) || a.scene.folder.localeCompare(b.scene.folder)
  );
  fs.writeFileSync(path.join(library, 'catalog.json'), JSON.stringify(catalog, null, 2));
  console.log(`catalogue: ${catalog.length} scenes`);
}
