// maplib/audit.mjs — find the scenes in a library whose map picture is probably not the whole map
// (the Tomb of Horrors case: a map painted as several tiles, where map.webp showed one of them).
// Read-only; reports, never changes the library.
//
//   node scripts/maplib/audit.mjs --library "<Desktop>\Maps_FA" [--json audit.json]
//
// Flags per scene:
//   shape     the map image's aspect ratio is off the scene's by more than 4% (cut off, or a tile)
//   tiny      the map file is under 20 KB (a placeholder or transparent level, not a painting)
//   tile      no background: the map is a single tile covering under 80% of the scene
//   stitched  the map was stitched from several tiles (worth a look; normally right)
//   nomap     no map file; nopreview  no preview.jpg (video maps without ffmpeg)
//   video     an animated map
import fs from 'node:fs';
import path from 'node:path';

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
const catalog = JSON.parse(fs.readFileSync(path.join(library, 'catalog.json'), 'utf8'));
const findings = [];
for (const m of catalog) {
  const dir = path.join(library, m.pack.id, m.scene.folder);
  const flags = [];
  const mapFile = m.files?.map ? path.join(dir, m.files.map) : null;
  if (!mapFile || !fs.existsSync(mapFile)) flags.push('nomap');
  else if (fs.statSync(mapFile).size < 20_000 && !m.map.video) flags.push('tiny');
  if (!m.files?.preview) flags.push('nopreview');
  if (m.map.video) flags.push('video');
  if (m.map.stitched) flags.push('stitched');
  const px = m.map.imagePixels;
  // The map should cover the scene (width x height, padding excluded); compare shapes.
  if (px?.width && px?.height && m.map.width && m.map.height && !m.map.stitched) {
    const want = m.map.width / m.map.height;
    const got = px.width / px.height;
    if (Math.abs(got / want - 1) > 0.04) flags.push('shape');
  }
  if (!m.map.levels?.some(l => l.background) && !m.map.stitched && m.map.background) {
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
    const t = (scene.tiles ?? []).find(x => x.texture?.src === m.map.background);
    if (t && (t.width * t.height) / (scene.width * scene.height) < 0.8) flags.push('tile');
  }
  if (flags.length)
    findings.push({
      scene: `${m.pack.id}/${m.scene.folder}`,
      name: m.scene.name,
      flags,
      map: px ? `${px.width}x${px.height}` : null,
      sceneSize: `${m.map.width}x${m.map.height}`,
    });
}
const count = f => findings.filter(x => x.flags.includes(f)).length;
console.log(
  `${catalog.length} scenes; flagged ${findings.length}: ` +
    ['shape', 'tile', 'tiny', 'nomap', 'stitched', 'nopreview', 'video']
      .map(f => `${f} ${count(f)}`)
      .join(', ')
);
for (const f of findings.filter(x => !(x.flags.length === 1 && x.flags[0] === 'video')))
  console.log(
    `  ${f.flags.join(',').padEnd(18)} ${f.scene}  map ${f.map ?? '-'} scene ${f.sceneSize}`
  );
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(findings, null, 2));
