---
name: token-cutout
description: >-
  Put a token image into the world correctly after its background has been cut to alpha. Use when
  the user wants a cut-out token assigned to an actor, or asks to "remove the background" / "make
  it transparent" for a token: the PIXEL WORK is NOT here any more — it is the artificer server's
  `cutout-image` tool (fvtt-mcp-artificer, 2026-09-19), which also runs automatically for every
  `kind: "token"` render. This skill keeps only the Foundry-side judgment: uploading, assigning
  with set-actor-art, resetting inherited prototype settings, and checking facing before
  auto-rotate.
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
3. **Reset the inherited prototype config — `set-actor-art` only swaps the texture.** A module or
   compendium actor keeps the rest of its prototype token exactly as imported, so fresh art lands on
   someone else's settings. The 2024 `dnd-monster-manual` actors ship a **dynamic ring on** and
   **`texture.scaleX`/`scaleY` at 2** (their art is a small subject on a big plate; a 512-square
   cutout is already trimmed and centred, so 2 overflows the token's footprint and the ring draws a
   dark disc under it) — and **`lockRotation: true`**, so the token won't turn to face its movement
   like every other token at the table. After every art swap, `update-actor` with **`tokenScale: 1`,
   `tokenRing: false`, `tokenAutoRotate: true`** (house rules — `_shared/authoring-policy.md` rule 10).
4. **Prototype vs placed.** Setting the prototype only affects **newly dropped** tokens. A copy already
   sitting on a scene won't change — `list-tokens` the scene and patch each with `update-token`
   (`scale`, `ring`, `lockRotation: false`), or have the user delete + re-drop it.
5. **Check which way the art faces before you enable auto-rotate.** Foundry treats the **top** of the
   image as the token's front at rotation 0, so art drawn head-down (or side-on) will move backwards
   once auto-rotate is live. Look at the cutout and say so — the fix is rotating the source PNG, which
   is the user's call, not a silent edit.

## What this skill does NOT do

Cut, retouch, redraw, upscale, or recolor. Pixels are the artificer's job.
