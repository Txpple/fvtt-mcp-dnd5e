---
name: scene-builder
description: >-
  Turn a map image into a ready-to-play Foundry scene (sized to the image, sidecar walls + lights,
  mood, an attached playlist / journal). Use when the user wants to "build a scene", "make a scene
  from this map", "set up this battlemap", "turn this image into a scene", "create a scene", "import
  a map", or asks to set scene mood/lighting/weather/fog (e.g. "make it night", "add snow", "make
  this a dark cave", "attach this playlist/journal to the scene").
---

# Scene builder

A judgment layer over the scene tools — it maps "here's a map, make it playable" into the right
`create-scene` / `update-scene` calls with sensible dnd5e defaults and a couple of confirmable mood
choices. It adds NO new mechanics; the tools hold all correctness (v14 field paths, fog/grid enum
mapping, weather validation against the live `CONFIG.weatherEffects`, playlist/journal name→id
resolution, and **auto-detecting scene dimensions from the image**).

Tools used: `create-scene`, `update-scene`, `list-scenes`, `list-assets`, `upload-asset`,
`manage-playlists { action: "list" }`, `manage-journals { action: "list" }` / `search-journals`. To **build** a new playlist or journal to
attach, hand off to the **`playlist-builder`** / **`journal-builder`** skill — scene-builder wires the
link onto the scene; those skills author the content.

**Regions & teleporters (on an existing scene).** To connect two maps — stairs, a cave mouth, a
portal — use **`manage-placeables`** `{ kind: "regions", action: "create-teleporter" }`: give a center point (canvas px, via `get-scene-dimensions` for
the padding math) on each scene and it drops a grid-snapped trigger at each end and cross-links them
two-way (or `twoWay:false` for one-directional). **Transitions ask before moving (DM-approved house
pattern):** the default `confirm:true` sets core v14's `choice` flag so the player gets a
"Teleport / Do Not Teleport" popup instead of being yanked between maps — pass `confirm:false` ONLY
for traps/plot teleports that should fire silently. The same default applies when wiring a
`teleportToken` via **`action: "add-behavior"`** (`system.choice` defaults to true; set it false
explicitly to opt out). Name the pads (`fromName`/`toName`) — never ship default "Region" labels.
NOTE: the regions list cannot read `choice` back and no tool edits a behavior after creation — a
wrong teleporter is fixed by `action: "delete"` + rebuild. For arbitrary regions/behaviors use
`action: "create"` (raw v14 shapes + behaviors), and `"list"` / `"update"` (rename, recolor, or
the `rect` reshape/resize) / `"delete"` to tune them — all `manage-placeables` with
`kind: "regions"`. (`action: "remap-teleporters"` is import-only — it relinks a scene-pack's own
teleporters after a Tom Cartos import; those keep whatever `choice` the pack authored. The create
actions are for authoring new ones.)

**Areas that DO something (dnd5e 6.0).** A region can carry the system's own behaviors — the map
itself applies the rules, no macro:
- **`dnd5e.applyActiveEffect`** — every token that ENTERS gets a copy of the named effects, and loses
  them on EXIT. Create the region (a rectangle / ellipse / polygon over the pool, the cloud, the
  altar), then **`action: "add-behavior"`** with `effects: ["Poisoned"]` — names come from
  the stock `dnd5e.effects` pack (every condition — Poisoned, Prone, Restrained, Blinded,
  Frightened, Invisible…; every damage Resistance / Immunity / Vulnerability; skill and ability
  Advantage / Disadvantage; Climb / Swim / Burrow Speed), or from an effect you authored on a world
  item with `manage-effect` (by name, or `"Item name#Effect name"`), or a premium spell's effect
  (`"<Item uuid>#<effect>"`). Filter with `dispositions` (`["hostile"]` = enemies only, e.g.
  consecrated ground that burns the undead: add `creatureTypes: ["undead"]`), `sizes`. Recipes:
  a poison pool → `effects: ["Poisoned"]`; brambles → `effects: ["Restrained"]`; a fog bank →
  `effects: ["Blinded"]`; a shrine → `effects: ["Frightened Immunity"]` for `dispositions:
  ["friendly"]`; lava has no "damage per turn" effect — that is `executeMacro` or a Battle Flow
  emanation, not this behavior.
- **`dnd5e.difficultTerrain`** — `terrainTypes: ["web" | "plants" | "ice" | "mud" | "sand" |
  "snow" | "rocks" | "slope" | "liquid"]` (a creature that ignores that kind — a spider in webs — walks
  freely), `magical: true` for a spell's terrain, `dispositions` = who IGNORES it. Movement cost
  doubles while the token plans a path through it.
- **`dnd5e.rotateArea`** — a turning platform / puzzle room: `rotate: {positions: [0, 90, 180,
  270], tiles: [...], walls: [...], lights: [...]}` (ids from `manage-placeables` `action: "list"`
  with `kind: "tiles"` / `"walls"` / `"lights"`, validated to exist) turns the listed placeables together around the region's first
  shape, stopping at the angles; `direction` (`short` / `cw` / `ccw`), `timeMs`. The DM triggers a
  turn from the region config (or a macro calling `behavior.system.rotate()`) — walking in does not
  turn it. Draw the region centred on the pivot.
- Effects the behavior applies live in a compendium or on a world item — never on an actor; the
  tool refuses an actor's effect (it would be duplicated on entry and deleted on exit). Wrong
  behavior = delete the region + rebuild (no behavior editing).

## Step 0 — Get a map (don't proceed without one)

A scene without a background is rarely what the user wants. If no image was given:
- Offer to **upload a local file** (`upload-asset` → returns a Data-relative path), or
- **Pick an already-uploaded map** (`list-assets` on the maps folder, e.g. `worlds/<world>/assets/maps`).

Ask for the path/file if you don't have one. The background must be a Data-relative path (what
`upload-asset` returns and `list-assets` shows).

## Step 0.5 — Look for an accompanying sidecar JSON (walls + lighting)

Battlemaps often ship a **sidecar JSON next to the image** (`cavern.jpg` → `cavern.json`, or the one
`.json` in the folder): a Foundry scene export — Dungeon Alchemist's "legacy" export and most map
packs — with `walls` / `lights` arrays plus scene scalars (`width`, `height`, `grid`, `padding`,
`gridDistance`, `gridUnits`, `darkness`…). Whenever a local map file is given, check its folder first.

- **Hand the FILE to the tool: `create-scene` with `placeablesPath: "<absolute path>"`.** It reads
  the arrays server-side, whole, and normalizes legacy and v14 shapes itself. Never copy the arrays
  into the call by hand — a hand remap is how walls lose `sight` (every limited/none wall goes
  solid) and lights lose their `config` (torchlight blows out at ≈2× luminosity, no flicker). If the
  tool warns "*N wall(s) declared light/move/sound but no sight*", the file itself is broken — say so.
- Never use Foundry's native right-click "Import Data" for this shape: v14 dropped the legacy
  migration and silently zeroes the walls and lights. `create-scene` does the conversion.
- A **Universal VTT** file (`.uvtt` / `.dd2vtt` / `.df2vtt`, or a JSON with `pixels_per_grid` /
  `line_of_sight` / `portals`) is a different, grid-unit schema `create-scene` does not convert —
  tell the user it isn't supported rather than feed it in. A map MODULE's `packs/*.db` scenes are
  `tom-cartos-import`'s job (`read-pack` writes the placeables file). No sidecar? Skip this step.

## Step 1 — Dimensions: auto, EXCEPT when a sidecar provides them

**Normally do NOT compute or ask for width/height** — `create-scene` auto-detects the image's pixel
size when you omit `width`/`height`. **But when a sidecar goes in via `placeablesPath`, pass the
sidecar's own `width`, `height`, `gridSize` (its `grid`), `padding`, `gridDistance`, and `gridUnits`
explicitly** — the tool takes only the placeable arrays from the file. Read just those top-level
scalars (a one-line script printing them), not the arrays. The wall/light coordinates were authored
against that exact canvas, so reproducing it 1:1 keeps them aligned. (The tool reports the size it used.)

## Step 2 — Battlemap or illustration? (one up-front question)

Ask this once, because it flips two settings:
- **Battlemap** (a place the party fights/explores on a grid): keep the dnd5e defaults — token vision
  on, fog individual, square grid 100px = 5 ft.
- **Illustration / overland / region / world map** (a picture, not a tactical surface): set
  `tokenVision: false` and `globalLight: true` (and consider `fogMode: "disabled"`); the grid is
  cosmetic.

If it's obvious from context, state your assumption instead of asking.

## Step 3 — Look at the map, suggest mood (big brush, confirm — never silent)

**Read the image file** (it renders to you) and offer at most **2–3** mood suggestions as confirmable
choices, not silent defaults. Keep it to broad strokes:

| What you see | Suggest |
|---|---|
| Snow / ice / tundra | `weather: "snow"` (heavy → `"blizzard"`) |
| Swamp / bog / misty / dark forest | `weather: "fog"`, `darkness: 0.3–0.5` |
| Dungeon / cave / crypt / windowless interior | `globalLight: false`, `darkness: 0.75–1` |
| Bright outdoor day / lit town | `globalLight: true` (or `darkness: 0`) |
| Night exterior / moonlit | `darkness: 0.6–0.8`, `globalLight: false` |
| Rain / storm sky | `weather: "rain"` (heavy → `"rainStorm"`) |

Don't stack five effects. Pick the one or two that define the scene and confirm. Weather keys are
validated live by the tool — if you guess wrong, its error lists the valid keys; case doesn't matter.

## Step 4 — Offer attachments

- **Playlist** — `manage-playlists { action: "list" }`, offer to set `playlist: "<name or id>"`. It auto-plays **on scene
  activation** (not on view), so pair it with an offer to activate. To build a NEW playlist to attach,
  hand off to the **`playlist-builder`** skill, then set `playlist` to it here.
- **Journal** — `manage-journals { action: "list" }` / `search-journals`, offer to set `journal: "<name or id>"` (e.g. the
  read-aloud / GM notes for this location).

Both are plain scene-document links; pass the name and the tool resolves it (and errors on an
ambiguous duplicate name — pass the id then).

## Step 5 — Create and report

Make a single `create-scene` call with the assembled params, then report the scene id/name, the
detected dimensions, and what mood/links you set. Offer to **activate** it if the user wants it live
now (or pass `activate: true` when they've already said so).

Typical call (defaults already cover grid 5ft / vision on / fog individual / daylight, so only pass
what's special):

```
create-scene {
  name: "Frostspire Pass",
  backgroundPath: "worlds/<world>/assets/maps/frostspire.webp",
  weather: "snow",            // from the map
  darkness: 0.3,              // dusk
  playlist: "Winter Winds",  // if attaching
  activate: false
}
```

With a sidecar (walls + lighting from `map.json`), hand the file over and pass its canvas fields so
the coordinates line up — report back the wall/light counts the tool placed:

```
create-scene {
  name: "Eerie Temple",
  backgroundPath: "worlds/<world>/assets/maps/eerie-temple.jpg",
  width: 13050, height: 6450,         // from the sidecar
  gridSize: 150,                       // sidecar `grid`
  gridDistance: 5, gridUnits: "ft",
  padding: 0, gridColor: "#000000", gridAlpha: 0.2,
  globalLight: true, darkness: 0.3,    // sidecar lighting
  placeablesPath: "D:/maps/eerie-temple/map.json",  // walls + lights read whole, server-side
  activate: false
}
```

To adjust an existing scene later, use `update-scene` with the same fields (and `""` to clear a
`playlist`/`journal` link). `update-scene` is document-only — it does **not** add walls/lights, so
import those at `create-scene` time.

## Boundaries

- Never proceed without a background image; offer upload or pick-from-assets instead.
- Don't hand-compute dimensions — let `create-scene` auto-detect them, **except** when importing a
  sidecar: then pass the sidecar's own width/height/grid/padding so wall/light pixels stay aligned.
- Always check for a sidecar JSON next to a local map; import it by `placeablesPath`, never by
  copying its arrays. Decline Universal VTT (`.uvtt`/`.dd2vtt`) sidecars cleanly — not yet supported.
- Mood is suggested and confirmed, never silently applied. Keep it to big strokes (1–2 effects).
- The tool places walls/lights only at create time, only from a supplied sidecar — this skill never
  hand-authors or moves placeables. If a tool returns a refusal or reason (e.g. unknown weather,
  ambiguous link name, skipped walls), surface it rather than working around it.
