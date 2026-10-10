// maplib/mapimage.mjs — the picture of a scene whose map is not one background image: maps painted
// as tiles (FA's Tomb of Horrors, MAD's Mythic Greece seas), modular kits assembled from rotated
// pieces (MAD Modular Dungeons), layered maps (MAD Pick'n'Mix volcano: lava, chains, ground).
// Shared by extract.mjs and refresh-maps.mjs. Library paths only (assets/...), never Foundry's.
import fs from 'node:fs';
import path from 'node:path';

const VIDEO_RE = /\.(webm|mp4|m4v|mov|ogv)$/i;
// A creator's UI furniture, not paint: "click to read the journal" badges, elevation markers.
const UI_RE =
  /(^|\/)(journal|ui|icons?)\/|reader\.(png|webp)$|elevationicon|blanksquare|transparent\./i;

/**
 * The tiles Foundry draws at ground level: visible images (not video, not UI badges) at an
 * elevation at or below 0 (or, when every tile is raised, at the lowest elevation present),
 * painted bottom-up by elevation then sort. Overhead layers (roofs, canopies, the 999 overlays)
 * are left out.
 */
export function groundTiles(doc) {
  const tiles = (doc.tiles ?? []).filter(
    t =>
      t.texture?.src?.startsWith('assets/') &&
      !t.hidden &&
      (t.alpha ?? 1) > 0 &&
      !VIDEO_RE.test(t.texture.src) &&
      !UI_RE.test(t.texture.src)
  );
  if (!tiles.length) return [];
  const floor = Math.min(...tiles.map(t => t.elevation ?? 0));
  const ceiling = Math.max(0, floor);
  return tiles
    .filter(t => (t.elevation ?? 0) <= ceiling)
    .sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0) || (a.sort ?? 0) - (b.sort ?? 0));
}

/** True when the scene has no background image anywhere (levels, legacy background, img). */
export function hasNoBackground(doc) {
  const levels = Array.isArray(doc.levels) ? doc.levels : [];
  return (
    !levels.some(l => l.background?.src) && !doc.background?.src && typeof doc.img !== 'string'
  );
}

/**
 * Paint the tiles into one image over their bounding box, each rotated about its centre as Foundry
 * does, at the resolution of the least-detailed tile (none upscaled) and at most 12,000 px on a
 * side (memory on a 16 GB machine; WebP's limit is 16,383). Returns what was painted, or null.
 */
export async function stitchTiles(sharp, tiles, packDir, dest) {
  try {
    const inputs = [];
    for (const t of tiles) {
      const file = path.join(packDir, t.texture.src);
      if (!fs.existsSync(file)) continue;
      const buf = fs.readFileSync(file);
      const m = await sharp(buf, { limitInputPixels: false }).metadata();
      inputs.push({ t, buf, ratio: Math.min(m.width / t.width, m.height / t.height) });
    }
    if (inputs.length < 2) return null;
    // Bounding box of each tile after rotation about its centre.
    const box = t => {
      const a = ((t.rotation ?? 0) * Math.PI) / 180;
      const w = Math.abs(t.width * Math.cos(a)) + Math.abs(t.height * Math.sin(a));
      const h = Math.abs(t.width * Math.sin(a)) + Math.abs(t.height * Math.cos(a));
      const cx = t.x + t.width / 2;
      const cy = t.y + t.height / 2;
      return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, cx, cy };
    };
    const boxes = inputs.map(i => box(i.t));
    const minX = Math.min(...boxes.map(b => b.x0));
    const minY = Math.min(...boxes.map(b => b.y0));
    const w = Math.max(...boxes.map(b => b.x1)) - minX;
    const h = Math.max(...boxes.map(b => b.y1)) - minY;
    const scale = Math.min(
      Math.max(0.25, Math.min(1, ...inputs.map(i => i.ratio)) || 1),
      12000 / Math.max(w, h)
    );
    const W = Math.max(1, Math.round(w * scale));
    const H = Math.max(1, Math.round(h * scale));
    const layers = [];
    for (const [k, { t, buf }] of inputs.entries()) {
      let img = sharp(buf, { limitInputPixels: false }).resize(
        Math.max(1, Math.round(t.width * scale)),
        Math.max(1, Math.round(t.height * scale)),
        { fit: 'fill' }
      );
      if (t.texture?.scaleX < 0) img = img.flop();
      if (t.texture?.scaleY < 0) img = img.flip();
      if (t.rotation) img = img.rotate(t.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
      if ((t.alpha ?? 1) < 1) img = img.ensureAlpha(t.alpha);
      const piece = await img.png().toBuffer({ resolveWithObject: true });
      const b = boxes[k];
      let left = Math.round((b.cx - minX) * scale - piece.info.width / 2);
      let top = Math.round((b.cy - minY) * scale - piece.info.height / 2);
      // Keep every piece inside the canvas (rounding can push an edge by a pixel).
      let input = piece.data;
      if (left < 0 || top < 0 || left + piece.info.width > W || top + piece.info.height > H) {
        const cx0 = Math.max(0, -left);
        const cy0 = Math.max(0, -top);
        const cw = Math.min(piece.info.width - cx0, W - Math.max(0, left));
        const ch = Math.min(piece.info.height - cy0, H - Math.max(0, top));
        if (cw <= 0 || ch <= 0) continue;
        input = await sharp(piece.data)
          .extract({ left: cx0, top: cy0, width: cw, height: ch })
          .toBuffer();
        left = Math.max(0, left);
        top = Math.max(0, top);
      }
      layers.push({ input, left, top });
    }
    const out = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      limitInputPixels: false,
    })
      .composite(layers)
      .webp({ quality: 90 })
      .toBuffer();
    fs.writeFileSync(dest, out);
    return {
      tiles: inputs.length,
      sources: [...new Set(inputs.map(i => i.t.texture.src))],
      sceneRect: { x: minX, y: minY, width: w, height: h },
      scale,
    };
  } catch (e) {
    console.warn(`  could not stitch the map tiles: ${e.message}`);
    return null;
  }
}
