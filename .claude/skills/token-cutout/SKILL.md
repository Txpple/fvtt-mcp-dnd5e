---
name: token-cutout
description: >-
  Put a cut-out token image into the world — upload, set-actor-art, the facing check. Use when the
  user wants a cut-out token assigned to an actor, or asks to "remove the background" / "make it
  transparent" for a token; the pixel work is the artificer server's cutout-image tool (automatic
  for every kind: "token" render), not this skill.
---

# Token cutout (Foundry install half)

**The cutout itself moved to `fvtt-mcp-artificer` on 2026-09-19.** Call `cutout-image` there
(chroma key for flat plates, rembg AI matte fallback, 512 square, magenta preview). Tokens
generated or edited with `generate-image` / `edit-image` in `kind: "token"` arrive already cut.
There is no script in this folder any more; `token_cutout.py` lives at
`fvtt-mcp-artificer/scripts/token_cutout.py` and the tool is its only caller.

Read the `*_preview.png` the tool reports before trusting the edge: a colour halo means a fringe
survived (ask for `erode: 1` or `method: "rembg"`); eaten hair or a thin blade means over-cut
(prefer rembg). Coverage near 0% or 100% means the key was misread; pass `color`.

## Put it in Foundry

1. `upload-asset` the PNG to `worlds/<world>/assets/tokens/<name>.png` (get `<world>` from
   `get-world-info`).
2. Assign it. **`set-actor-art` sets the portrait AND the prototype token in one call** — `imagePath`
   is the portrait and doubles as the token texture unless `tokenImagePath` overrides it. So by default
   **both** get set; say so plainly before you run it. Find the actor with `list-actors` / `get-actor`.
   - **Token-only, keeping the existing portrait, IS possible** — read the current portrait back and
     pass it straight through. `export-actor` to a scratch path dumps the full document (`img`,
     `prototypeToken`, `folder`, ownership), so: `imagePath` = the `img` you just read,
     `tokenImagePath` = the new cutout. The portrait write becomes a no-op and only the token changes.
     (`export-actor` is also how you tell two same-named actors apart — `folder` gives it away.)
   - **Portrait-only** is the plain `applyToToken: false`.
3. **The inherited prototype config is normalized for you.** A 2024 `dnd-monster-manual` copy ships
   a dynamic ring on and `texture.scaleX`/`scaleY` at 2 (a small subject on a big plate — wrong for a
   trimmed, centred cut-out); `set-actor-art` resets both with the new texture and says so in its
   reply. Auto-rotate is NOT part of that — pass `autoRotate: true` yourself, after step 5.
4. **Prototype vs placed.** Setting the prototype only affects **newly dropped** tokens; the reply
   lists the copies already on a scene that still carry the old art or settings — patch each with
   `manage-placeables { kind: "tokens", action: "update", ids, scale, ring, lockRotation: false }`, or
   have the user delete + re-drop it.
5. **Check which way the art faces before you enable auto-rotate.** Foundry treats the **top** of the
   image as the token's front at rotation 0, so art drawn head-down (or side-on) will move backwards
   once auto-rotate is live. Look at the cutout and say so — the fix is rotating the source PNG, which
   is the user's call, not a silent edit.

## What this skill does NOT do

Cut, retouch, redraw, upscale, or recolor. Pixels are the artificer's job.
