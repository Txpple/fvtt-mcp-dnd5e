// maplib/extract.mjs — pull every scene out of installed (or unzipped) Foundry scene-pack modules
// into a creator library on disk: one folder per scene holding the full Foundry scene document,
// the placeables sidecar, a compact meta.json for scanning and a small preview; one assets/ tree
// per pack with every image and sound the module ships; the pack's other documents (journals,
// prefabs) as JSON. The library is self-contained (no Foundry, no module needed to read it) and
// import.mjs puts a scene back into any live world through the bridge. See README.md beside this.
//
//   node scripts/maplib/extract.mjs --library <dir> --creator "<author regex>" [--modules-dir <Data/modules>]
//   node scripts/maplib/extract.mjs --library <dir> --module <unzipped module folder> [--module ...]
//   options: --only <module-id> (repeatable)  --force (re-extract a pack already in the library)
//            --no-preview  --preview-px 1024
//
// Reads the LevelDB packs with @foundryvtt/foundryvtt-cli (a dependency of this repo); the pack
// must not be open by a running Foundry (the Setup screen is fine, a launched world is not).
import { extractPack } from '@foundryvtt/foundryvtt-cli';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const all = name => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const flag = name => argv.includes(name);

const library = opt('--library');
if (!library) {
  console.error('--library <dir> is required');
  process.exit(2);
}
const creatorRe = opt('--creator') ? new RegExp(opt('--creator'), 'i') : null;
const modulesDir = opt(
  '--modules-dir',
  process.env.FOUNDRY_DATA_DIR ? path.join(process.env.FOUNDRY_DATA_DIR, 'modules') : null
);
const explicit = all('--module');
const only = new Set(all('--only'));
const force = flag('--force');
const previewPx = Number(opt('--preview-px', 1024));
const wantPreview = !flag('--no-preview');

const ASSET_RE = /\.(webp|png|jpg|jpeg|gif|svg|avif|ogg|mp3|wav|webm|mp4|m4a|flac)$/i;
const SKIP_DIRS = new Set([
  'packs',
  'scripts',
  'templates',
  'languages',
  'lang',
  'styles',
  'node_modules',
  '.git',
]);

// sharp is optional: this repo or the imagegen sibling may carry it; without it previews are skipped.
let sharp = null;
if (wantPreview) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const root of [
    path.resolve(here, '../..'),
    path.resolve(here, '../../../fvtt-mcp-imagegen'),
  ]) {
    const pkg = path.join(root, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    try {
      sharp = createRequire(pkg)('sharp');
      break;
    } catch {}
  }
  if (!sharp)
    console.warn(
      'previews skipped: sharp not found (npm i in fvtt-mcp-imagegen, or pass --no-preview)'
    );
}

// ---------- discover modules ----------
function readManifest(dir) {
  const p = path.join(dir, 'module.json');
  if (!fs.existsSync(p)) return null;
  try {
    return { dir, manifest: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return null;
  }
}
function authorsOf(m) {
  return (m.authors ?? [])
    .map(a => (typeof a === 'string' ? a : (a?.name ?? '')))
    .concat(m.author ?? '')
    .filter(Boolean);
}
let modules = explicit.map(readManifest).filter(Boolean);
if (!explicit.length) {
  if (!modulesDir || !creatorRe) {
    console.error('need --module <dir>, or --creator with --modules-dir (or FOUNDRY_DATA_DIR)');
    process.exit(2);
  }
  for (const name of fs.readdirSync(modulesDir)) {
    const m = readManifest(path.join(modulesDir, name));
    if (!m) continue;
    const hay = [...authorsOf(m.manifest), m.manifest.title ?? '', m.manifest.id ?? ''].join(' | ');
    if (creatorRe.test(hay)) modules.push(m);
  }
}
if (only.size) modules = modules.filter(m => only.has(m.manifest.id));
modules = modules.filter(m =>
  (m.manifest.packs ?? []).some(p => p.type === 'Scene' || p.type === 'Adventure')
);
modules.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
if (!modules.length) {
  console.error('no scene-pack modules matched');
  process.exit(1);
}
console.log(`library: ${library}\nmodules: ${modules.length}`);

// ---------- helpers ----------
const slug = s =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'scene';
const decode = s => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
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
function stripKeys(o) {
  if (Array.isArray(o)) return o.map(stripKeys);
  if (o && typeof o === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (k !== '_key') r[k] = stripKeys(v);
    return r;
  }
  return o;
}
const copyOnce = new Map();
function copyAsset(fromAbs, toAbs) {
  if (copyOnce.has(toAbs)) return copyOnce.get(toAbs);
  let ok = false;
  if (fs.existsSync(fromAbs)) {
    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.copyFileSync(fromAbs, toAbs);
    ok = true;
  }
  copyOnce.set(toAbs, ok);
  return ok;
}
const VARIANT_WORDS =
  /\s[-–]\s*(Night|Clean|Simple|Day|Dusk|Dawn|Winter|Summer|Autumn|Spring|Snow|Rain|Ruined|Flooded|Lit|Unlit|Gridless|Grid|No Grid)\s*$/i;
function sceneVariant(name) {
  const m = name.match(/\(([^)]+)\)\s*$/) ?? name.match(VARIANT_WORDS);
  return m ? m[1].trim() : null;
}
function baseName(name) {
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(VARIANT_WORDS, '')
    .replace(/^\s*\d+[a-z]?[.\-:)\s]+/i, '')
    .trim();
}
/** The scene's number: leading ("06. Desert Spa"), else the first number token in the name, else 00. */
function sceneNo(name) {
  const m = name.match(/^\s*(\d+[a-z]?)\b/i) ?? name.match(/\b(\d{1,3}[a-z]?)\b/i);
  return m ? m[1].padStart(2, '0') : '00';
}
/** Folder name: `NN-<base>` when the number leads, else the slug of the whole base (it keeps its number). */
function folderName(name, variant) {
  const leading = /^\s*\d+[a-z]?\b/i.test(name);
  const stem = leading
    ? `${sceneNo(name)}-${slug(baseName(name))}`
    : slug(baseName(name)) || '00-scene';
  return `${leading || /\d/.test(stem) ? '' : '00-'}${stem}${variant ? `-${slug(variant)}` : ''}`;
}
// The image bytes go to sharp as a Buffer: libvips on Windows cannot open a path over the old
// MAX_PATH, and a deep library folder plus a creator's long file names gets there.
async function makePreview(src, dest, px) {
  if (!sharp) return false;
  try {
    const out = await sharp(fs.readFileSync(src), { limitInputPixels: false })
      .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    fs.writeFileSync(dest, out);
    return true;
  } catch (e) {
    console.warn(`  preview failed: ${e.message}`);
    return false;
  }
}
async function imageSize(src) {
  if (!sharp) return null;
  try {
    const m = await sharp(fs.readFileSync(src), { limitInputPixels: false }).metadata();
    return { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

// ---------- extract ----------
fs.mkdirSync(library, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maplib-'));
const catalog = [];
const libraryName = path.basename(library);
const extractedAt = new Date().toISOString();

for (const { dir: moduleDir, manifest } of modules) {
  const id = manifest.id ?? manifest.name;
  const packDir = path.join(library, id);
  const packJsonPath = path.join(packDir, 'pack.json');
  if (fs.existsSync(packJsonPath) && !force) {
    const prev = JSON.parse(fs.readFileSync(packJsonPath, 'utf8'));
    if (prev.version === manifest.version) {
      console.log(
        `= ${id} v${manifest.version} already in the library (${prev.scenes} scenes) — skip (--force to redo)`
      );
      for (const s of prev.sceneFolders ?? []) {
        const mp = path.join(packDir, s, 'meta.json');
        if (fs.existsSync(mp)) catalog.push(JSON.parse(fs.readFileSync(mp, 'utf8')));
      }
      continue;
    }
  }
  console.log(`+ ${id} v${manifest.version} — ${manifest.title}`);
  const modPrefix = `modules/${id}/`;
  const scenes = []; // {doc, folderPath:[names], pack, adventure?}
  const journalNames = [];
  const otherDocs = []; // every non-scene document, kept as JSON under docs/<pack>/
  for (const pack of manifest.packs ?? []) {
    const src = path.join(moduleDir, pack.path ?? `packs/${pack.name}`);
    if (!fs.existsSync(src)) {
      console.warn(`  pack missing on disk: ${pack.path}`);
      continue;
    }
    const out = path.join(tmpRoot, id, pack.name);
    try {
      await extractPack(src, out, { log: false, yaml: false, folders: true, clean: true });
    } catch (e) {
      console.warn(`  cannot read pack ${pack.name}: ${e.message}`);
      continue;
    }
    const walk = (d, chain) => {
      let folderName = null;
      const fj = path.join(d, '_Folder.json');
      if (fs.existsSync(fj)) {
        try {
          folderName = JSON.parse(fs.readFileSync(fj, 'utf8')).name;
        } catch {}
      }
      const here = folderName ? [...chain, folderName] : chain;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p, here);
        else if (ent.name.endsWith('.json') && ent.name !== '_Folder.json') {
          let doc;
          try {
            doc = JSON.parse(fs.readFileSync(p, 'utf8'));
          } catch {
            continue;
          }
          if (pack.type === 'Scene' && doc.walls)
            scenes.push({ doc, folderPath: here, pack: pack.name });
          else if (pack.type === 'Adventure') {
            for (const s of doc.scenes ?? [])
              scenes.push({
                doc: s,
                folderPath: [...here, doc.name],
                pack: pack.name,
                adventure: doc.name,
              });
            for (const j of doc.journal ?? []) journalNames.push(j.name);
            const { scenes: _scenes, ...rest } = doc;
            otherDocs.push({ doc: rest, pack: pack.name, type: 'Adventure' });
          } else {
            if (pack.type === 'JournalEntry') journalNames.push(doc.name);
            otherDocs.push({ doc, pack: pack.name, type: pack.type });
          }
        }
      }
    };
    walk(out, []);
  }
  if (!scenes.length) {
    console.log('  no scenes');
    continue;
  }

  // Stable, readable scene folder names; collisions get the source id.
  const used = new Map();
  const planned = scenes.map(s => {
    const no = sceneNo(s.doc.name);
    const variant = sceneVariant(s.doc.name);
    let folder = folderName(s.doc.name, variant);
    if (s.adventure && scenes.some(o => o !== s && o.doc.name === s.doc.name))
      folder += `-${slug(s.adventure)}`;
    used.set(folder, (used.get(folder) ?? 0) + 1);
    return { ...s, no, variant, folder };
  });
  for (const p of planned) if (used.get(p.folder) > 1) p.folder += `-${p.doc._id}`;

  if (force && fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  const packAssets = new Set();
  const missingAssets = new Set();
  const sceneFolders = [];

  for (const s of planned) {
    const sceneDir = path.join(packDir, s.folder);
    fs.mkdirSync(sceneDir, { recursive: true });
    const raw = stripKeys(s.doc);
    const sceneAssets = new Set();
    const external = new Set();
    // Rewrite module-relative asset paths to library-relative (assets/<rel>, percent-decoded).
    const doc = deepStrings(raw, str => {
      const dec = decode(str);
      if (dec.startsWith(modPrefix)) {
        const rel = dec.slice(modPrefix.length);
        sceneAssets.add(rel);
        return `assets/${rel}`;
      }
      if (/^(modules|worlds|systems)\//.test(dec) && ASSET_RE.test(dec)) external.add(dec);
      return str;
    });
    // Thumbnails pointing into a world or another module are regenerated by Foundry on import.
    if (typeof doc.thumb === 'string' && !doc.thumb.startsWith('assets/')) doc.thumb = null;
    for (const rel of sceneAssets) {
      const ok = copyAsset(path.join(moduleDir, rel), path.join(packDir, 'assets', rel));
      if (ok) packAssets.add(rel);
      else missingAssets.add(rel);
    }
    // The background: v14 keeps it on the initial level, older packs at the top level.
    const levels = Array.isArray(doc.levels) ? doc.levels : [];
    const level = levels.find(l => l._id === doc.initialLevel) ?? levels[0] ?? null;
    // Some multi-level scenes open on a level with no background (the map sits on another level
    // or on a full-size tile), so fall through to the first level with one, then the largest tile.
    const biggestTile = [...(doc.tiles ?? [])]
      .filter(t => t.texture?.src)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const bgRel =
      level?.background?.src ??
      levels.find(l => l.background?.src)?.background?.src ??
      doc.background?.src ??
      (typeof doc.img === 'string' ? doc.img : null) ??
      biggestTile?.texture?.src ??
      null;
    const bgAbs = bgRel?.startsWith('assets/') ? path.join(packDir, bgRel) : null;
    const grid =
      typeof doc.grid === 'object'
        ? doc.grid
        : {
            size: doc.grid ?? 100,
            type: doc.gridType ?? 1,
            distance: doc.gridDistance ?? 5,
            units: doc.gridUnits ?? 'ft',
          };
    const walls = doc.walls ?? [];
    const meta = {
      library: libraryName,
      creator: authorsOf(manifest)[0] ?? null,
      pack: { id, title: manifest.title, version: manifest.version },
      scene: {
        name: doc.name,
        sourceId: doc._id,
        folder: s.folder,
        packFolder: s.folderPath.join(' / ') || null,
        adventure: s.adventure ?? null,
        base: baseName(doc.name),
        variant: s.variant,
        number: s.no,
        navName: doc.navName || null,
      },
      map: {
        background: bgRel,
        width: doc.width,
        height: doc.height,
        padding: doc.padding,
        gridSize: grid.size,
        gridType: grid.type,
        gridDistance: grid.distance,
        gridUnits: grid.units,
        columns: grid.size ? Math.round(doc.width / grid.size) : null,
        rows: grid.size ? Math.round(doc.height / grid.size) : null,
        levels: levels.map(l => ({
          id: l._id,
          name: l.name,
          background: l.background?.src ?? null,
          foreground: l.foreground?.src ?? null,
          elevation: l.elevation,
        })),
        foreground: doc.foreground?.src ?? level?.foreground?.src ?? null,
      },
      counts: {
        walls: walls.length,
        doors: walls.filter(w => w.door > 0).length,
        lights: (doc.lights ?? []).length,
        sounds: (doc.sounds ?? []).length,
        tiles: (doc.tiles ?? []).length,
        regions: (doc.regions ?? []).length,
        notes: (doc.notes ?? []).length,
        drawings: (doc.drawings ?? []).length,
        tokens: (doc.tokens ?? []).length,
        levels: levels.length,
      },
      mood: {
        darkness: doc.environment?.darknessLevel ?? doc.darkness ?? null,
        globalLight: doc.environment?.globalLight?.enabled ?? doc.globalLight ?? null,
        tokenVision: doc.tokenVision ?? null,
        weather: doc.weather || null,
      },
      flagsPresent: Object.keys(doc.flags ?? {}),
      assets: [...sceneAssets].sort(),
      externalAssets: [...external].sort(),
      sourceCore: doc._stats?.coreVersion ?? null,
      files: { scene: 'scene.json', placeables: 'placeables.json', preview: null },
      extractedAt,
    };
    if (bgAbs && fs.existsSync(bgAbs)) {
      // A full-quality copy of the map beside the document (the shared assets/ tree stays the
      // source the import uploads); other levels' backgrounds get their own copy too.
      const mapFile = `map${path.extname(bgAbs).toLowerCase()}`;
      fs.copyFileSync(bgAbs, path.join(sceneDir, mapFile));
      meta.files.map = mapFile;
      for (const l of levels) {
        const src = l.background?.src;
        if (!src || src === bgRel || !src.startsWith('assets/')) continue;
        const from = path.join(packDir, src);
        if (!fs.existsSync(from)) continue;
        const file = `map-${slug(l.name ?? l._id)}${path.extname(from).toLowerCase()}`;
        fs.copyFileSync(from, path.join(sceneDir, file));
        (meta.files.levelMaps ??= {})[l._id] = file;
      }
      const sz = await imageSize(bgAbs);
      if (sz) meta.map.imagePixels = sz;
      if (wantPreview && (await makePreview(bgAbs, path.join(sceneDir, 'preview.jpg'), previewPx)))
        meta.files.preview = 'preview.jpg';
    }
    fs.writeFileSync(path.join(sceneDir, 'scene.json'), JSON.stringify(doc, null, 2));
    const placeables = {};
    for (const k of [
      'walls',
      'lights',
      'regions',
      'sounds',
      'tiles',
      'notes',
      'drawings',
      'templates',
    ])
      if (doc[k]?.length) placeables[k] = doc[k];
    fs.writeFileSync(path.join(sceneDir, 'placeables.json'), JSON.stringify(placeables, null, 2));
    fs.writeFileSync(path.join(sceneDir, 'meta.json'), JSON.stringify(meta, null, 2));
    catalog.push(meta);
    sceneFolders.push(s.folder);
    const c = meta.counts;
    console.log(
      `  ${s.folder}: ${c.walls} walls, ${c.lights} lights, ${c.sounds} sounds, ${c.tiles} tiles` +
        `${c.regions ? `, ${c.regions} regions` : ''}${c.levels > 1 ? `, ${c.levels} levels` : ''}`
    );
  }

  // Every image / audio file the module ships, referenced or not (phase variants, journal art and
  // prefab tiles live outside the scene documents); the unreferenced ones are listed as extras.
  const extras = [];
  const walkAssets = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walkAssets(path.join(d, ent.name), r);
      } else if (ASSET_RE.test(ent.name) && !packAssets.has(r)) {
        if (copyAsset(path.join(moduleDir, r), path.join(packDir, 'assets', r))) extras.push(r);
      }
    }
  };
  walkAssets(moduleDir, '');
  extras.sort();

  // The pack's other documents (journals, Mass Edit prefabs, playlists, macros ...), paths rewritten.
  const docIndex = [];
  for (const { doc, pack, type } of otherDocs) {
    const rewritten = deepStrings(stripKeys(doc), str => {
      const dec = decode(str);
      return dec.startsWith(modPrefix) ? `assets/${dec.slice(modPrefix.length)}` : str;
    });
    const dir = path.join(packDir, 'docs', slug(pack));
    fs.mkdirSync(dir, { recursive: true });
    const file = `${slug(doc.name ?? type)}-${doc._id ?? docIndex.length}.json`;
    fs.writeFileSync(path.join(dir, file), JSON.stringify(rewritten, null, 2));
    docIndex.push({ type, pack, name: doc.name ?? null, file: `docs/${slug(pack)}/${file}` });
  }

  for (const f of ['README.md', 'readme.md', 'LICENSE', 'LICENSE.md', 'CHANGELOG.md'])
    if (fs.existsSync(path.join(moduleDir, f)))
      fs.copyFileSync(path.join(moduleDir, f), path.join(packDir, `module-${f}`));
  fs.writeFileSync(
    packJsonPath,
    JSON.stringify(
      {
        id,
        title: manifest.title,
        version: manifest.version,
        description: manifest.description ?? '',
        authors: authorsOf(manifest),
        url: manifest.url ?? null,
        compatibility: manifest.compatibility ?? null,
        relationships: manifest.relationships ?? null,
        packs: (manifest.packs ?? []).map(p => ({ name: p.name, label: p.label, type: p.type })),
        journals: [...new Set(journalNames)],
        scenes: sceneFolders.length,
        sceneFolders,
        assets: packAssets.size + extras.length,
        sceneAssets: packAssets.size,
        extras,
        docs: docIndex,
        missingAssets: [...missingAssets],
        source: moduleDir,
        extractedAt,
      },
      null,
      2
    )
  );
  if (missingAssets.size)
    console.warn(
      `  ${missingAssets.size} referenced files not found in the module: ${[...missingAssets].slice(0, 5).join(', ')}${missingAssets.size > 5 ? ' …' : ''}`
    );
}
fs.rmSync(tmpRoot, { recursive: true, force: true });

// ---------- catalogue ----------
catalog.sort(
  (a, b) => a.pack.id.localeCompare(b.pack.id) || a.scene.folder.localeCompare(b.scene.folder)
);
fs.writeFileSync(path.join(library, 'catalog.json'), JSON.stringify(catalog, null, 2));
const cell = s => String(s ?? '').replace(/\|/g, '\\|');
const md = [
  `# ${libraryName} — scene catalogue`,
  '',
  `${catalog.length} scenes from ${new Set(catalog.map(c => c.pack.id)).size} packs. Regenerated by scripts/maplib/extract.mjs (fvtt-mcp-dnd5e) on ${extractedAt.slice(0, 10)}.`,
  '',
  '| Pack | Scene | Variant | Squares | Grid px | Walls | Doors | Lights | Sounds | Tiles | Regions | Levels | Dark | Folder |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...catalog.map(
    c =>
      `| ${c.pack.id} | ${cell(c.scene.name)} | ${cell(c.scene.variant)} | ${c.map.columns ?? '?'}x${c.map.rows ?? '?'} | ${c.map.gridSize} | ${c.counts.walls} | ${c.counts.doors} | ${c.counts.lights} | ${c.counts.sounds} | ${c.counts.tiles} | ${c.counts.regions} | ${c.counts.levels} | ${c.mood.darkness ?? ''} | ${c.pack.id}/${c.scene.folder} |`
  ),
  '',
].join('\n');
fs.writeFileSync(path.join(library, 'catalog.md'), md);
console.log(
  `\ncatalogue: ${catalog.length} scenes -> ${path.join(library, 'catalog.json')} / catalog.md`
);
