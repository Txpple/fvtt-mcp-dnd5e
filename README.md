# fvtt-mcp-dnd5e

A **D&D 5e** Dungeon Master's assistant for [Foundry VTT](https://foundryvtt.com) — a [Model
Context Protocol](https://modelcontextprotocol.io) server driven by **Claude Code**. It lets an AI
GM assistant read and edit a **live** Foundry world (actors, items, journals, scenes, compendia,
roll tables, cards…) and manage its static files. It is a Foundry MCP first: the world can run on
**[Molten Hosting](https://moltenhosting.com)**, on **this machine**, or at **any URL** — where it
runs is a *host*, an option chosen per registration (`FOUNDRY_HOST`), never the product
([design.md §2.6](design.md)). *(Formerly `fvtt-mcp-molten5e`.)*

Paired with its bundled **skills**, it goes well beyond CRUD: it can author a **complete, table-ready
adventure end to end** — scene, monsters, NPCs, a pregen PC or party, treasure, linked journals, and
roll tables — scaled to however much the DM provides. Hand it **only a map image** and Claude reads the
map and builds the whole module; hand it **your own finished module** and it faithfully recreates every
stat block, item, and handout in the VTT.

**An importer worth calling out:**

- **Adventure map packs → your world.** Import a battlemap *module* (a distributed Foundry scene-pack
  with its own compendiums) faithfully: every scene with its walls, lights, day/night mood, and
  navigation thumbnails, plus the journal of map keys — with all assets re-pointed into your world, and
  cross-version (older and newer Foundry formats) handled. **[Tom Cartos](https://www.tomcartos.com)**
  packs are the first supported format; more to come.

---

## 2.0 — built for the D&D 5e system 6.x

**Version 2.0 targets the D&D 5e system 6.x on Foundry VTT 14** (developed and verified against
dnd5e **6.0.1** / Foundry **14.368** on the local sandbox; the production world stays on dnd5e 5.3.3 /
Foundry 14.364 until the 2.x line has been tested there — a 2.x tool refuses to author against a
pre-6.0 world, since it writes native 6.0 keys that a 5.3.3 schema prunes). dnd5e 6.0 is, by the system team's own account, the biggest
release in the system's history: a ground-up pass that leans on everything new in Foundry v14. The
Levels feature now drives falling and fall damage; ActiveEffect v2 underpins conditional effects,
rules-based effects that apply at roll time, region-attached effects, and smarter expiry; chat cards
were rebuilt on typed message data; armor class became a list of qualifying calculations the sheet
picks the best of; and the calendar now drives dawn/dusk recovery and bastion turns. (See the
[dnd5e 6.0 release notes](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.0) for the
full picture.)

A good deal of the **persisted data model moved with it**, so 2.0 is the version of this MCP that
speaks 6.x natively — armor class, conditions (including leveled exhaustion), Active Effect changes
and durations, movement, item rarities, and typed chat messages are all read and written in the 6.0
shapes, and the compendium readers cope with premium book packs that are still built for 5.x. The
audit behind it, tool by tool, is in
[`docs/dnd5e-6.0-compat-review.md`](docs/dnd5e-6.0-compat-review.md).

What changed at the tool surface:

- **`update-actor` → `ac`** now speaks the 6.0 model: `override` (a fixed stat-block AC), `natural`
  (natural armor), `calcs` (the base calculations the actor qualifies for) and `formulas` (custom
  formulas). The 5.x `calc` / `flat` / `formula` fields are still accepted and translated, but
  deprecated.
- **`manage-effect`** writes changes to `system.changes` and takes a v14 `duration`
  (`{ value, units, expiry }`; the old `rounds` / `turns` / `seconds` keys are translated).
- **`apply-condition`** sets exhaustion levels 1–6 (0 removes) through the system's own lever; the
  5.x flag no longer exists.
- **`get-combat-stats`**, **`list-chat-messages`** and **`export-chat-log`** read 6.0's typed chat
  messages; card bodies that the system renders on the fly are rendered into the export.
- **`post-item-card`** reports honestly when a module hook vetoes a use (e.g. a require-target rule).

**1.x** remains the line for dnd5e 5.3.x on Foundry 14.

## 2.1 — tools for what 6.0 introduced

2.0 made the existing tools speak 6.x; **2.1 adds tools for the features dnd5e 6.0 introduced**, so an
authored monster trait, magic item or map area can express what a 2024 book entry can. Every shape is
validated against the 6.0.1 source and proven live (`scripts/verify-effects-6.mjs`,
`scripts/verify-region-effects.mjs`); the plan and status are in
[`docs/plan-2.1-dnd5e-6-features.md`](docs/plan-2.1-dnd5e-6-features.md).

- **`manage-effect`** — **conditions** (the system's Filter JSON, on the whole effect or on one
  change: "+2 AC while Bloodied", "only ranged or thrown weapons"), **rules-type changes** that modify
  a roll at roll time (`dnd5e.advantage` / `dnd5e.bonus` / `dnd5e.minimum` / `dnd5e.maximum` on
  `attack` / `check` / `d20` / `save`, bonus on `damage` / `healing` — "+1d4 on History checks",
  "disadvantage on Strength-based d20 tests", "ranged attacks never roll below 10"; key × type ×
  value validated, and a core-type change on a roll category is refused as a write to nowhere),
  per-change `replacement` (origin / target), `magical`, and the full **expiry** vocabulary
  (`turnEnd` … + `shortRest` / `longRest` + `sourceStart` / `sourceEnd` / `targetStart` /
  `targetEnd`). Read-back (`get-actor`, `manage-effect list`) shows each effect's type, conditions
  and every rule as a sentence; `content-audit` flags a dead rules change.
- **`manage-activity`** — a **`duration`** override with expiry the applied effects inherit, an area
  **`template`** + `affects`, and **`behaviors`** the template carries (`applyActiveEffect`,
  `difficultTerrain`): an authored Web is a save + a 20-ft cube + `["Restrained"]` + web terrain.
- **`add-region-behavior`** — `dnd5e.applyActiveEffect` / `dnd5e.difficultTerrain` with
  `effects` resolved **by name** (a poison pool is `effects: ["Poisoned"]`), `dispositions`,
  `sizes`, `creatureTypes`, `terrainTypes`, `magical`. Effect names resolve from the system's stock
  `dnd5e.effects` pack (the one `dnd5e.*` pack that is a permitted source — it holds mechanics,
  not book content; design.md §2.3), from a world item's effect (`"Item#Effect"`), or a uuid — never
  an actor's effect (the behavior copies it on entry and removes it on exit).
- **`add-item`** / **`update-actor-item`** — `rarity` accepts a list for a "Rarity Varies" item and
  is written natively to `system.rarities`.

2.1.1 rounds out the surface:

- **`manage-activity`** — `type: "teleport"` (`teleportDistance`, self-targeted by default) and
  `type: "transform"` in all three 6.0 modes: by CR (`profiles` with cr / size / type / movement
  filters + a `transformPreset`), direct link (`profiles[].actor` by Monster Manual name or uuid),
  and Select Form (`forms` — the item's own effects are the forms: a lycanthrope's Humanoid / Hybrid
  / Beast shapes, Disguise Self).
- **`add-region-behavior`** — `dnd5e.rotateArea` gets a typed `rotate` (stop angles + the tiles /
  walls / lights / regions / sounds that turn with the platform, validated to exist on the scene);
  `manage-activity` transform gets `transformSettings` (keep / merge / effects / minimumAC /
  tempFormula / spellLists) on top of the presets — the last 6.0 shapes that were pass-through.
- **`configure-dnd5e-settings`** *(new)* — read or set the 6.0 automation switches through an
  allow-list: falling, token-size and vision sync, exhaustion, initiative grouping, auto-Downed,
  encounter placement, the player damage / effects trays, bastions, and the calendar (enabled,
  daily recovery mode, which calendar). Every change echoes previous → new; the ones that need a
  client reload are named. `get-world-info` carries the same block as `automation`.
- **`manage-calendar`** *(new)* — the in-world date and time on Foundry v14's `game.time` with the
  dnd5e calendar layer: read it in display terms, advance it (rounds / minutes / hours / days —
  what triggers dawn / dusk / day recovery and bastion turns), or set a date by month name or number
  and a time of day.
- The PC leveling engine applies 6.0's **ModifyItem** advancement (an enchantment placed on an
  identified item) as a forced step, like ItemGrant.

## 2.2 — a Foundry MCP first, hosts as options

No tool behaviour changed in 2.2; what changed is what the project *is*. It was named for one host
(`fvtt-mcp-molten5e`) while the code had long been host-agnostic in fact — so the host left the
name and became a **[seam](design.md)** (§2.6, [`docs/plan-2.2-hosts.md`](docs/plan-2.2-hosts.md)):

- **`FOUNDRY_HOST`** = `molten` (Magic-URL wake, WebDAV file plane) · `local` (an install on this
  machine — no wake, and the asset file tools work straight on its `Data/` directory, which the
  sandbox never had before) · `generic` (a URL, nothing else). One `.env`, one registration per
  instance; `FOUNDRY_PROFILE=local` still works as an alias. `get-world-info` reports the host.
- **`FOUNDRY_TOOLSETS`** — a registration advertises a subset of the 151 tools (13 named toolsets;
  `world` always on); an out-of-set call is refused by name. `chat,combat` is 16 tools at ~6k tokens
  instead of ~79k.
- **`fvtt-mcp-dnd5e`** — the name says what it is (D&D 5e, by design), not where it runs.

Parked for **3.0**: folding the 17 `list/create/update/delete-X` families (70 of 151 tools) into
`kind` + `op` tools — the biggest context lever left, and a change to every skill, so its own line.

---

> 📐 **Design north star — [`design.md`](design.md).** The mission, scope, the *skills decide, tools
> do* contract, and the NPC authoring doctrine all live there; it's the document every skill, tool,
> and refactor traces back to. **🚧 Still under construction** — actively evolving alongside the
> project, so expect it (and the tool surface) to change.

## Why this shape

Foundry has no server-side plugin API, and managed hosts (like Molten) don't expose a control API
either — you can't run a process next to the game server. The only supported way in, on *every*
host, is Foundry's own authenticated client.

So the MCP server drives a **headless Chromium** client (via [Playwright](https://playwright.dev)):
it lets the host wake a sleeping instance (Molten's **Magic URL**), joins the world as a dedicated
Foundry user, waits for `game.ready`, and injects a page-side library that exposes the world's own
client APIs. Claude Code talks to the MCP server over stdio; the server turns each tool call into a
call inside that live page. Everything that depends on **where** the world runs — the wake step,
the file channel into `Data/`, the env vars — lives behind one seam, `src/hosts/**`; the rest of
the server never knows.

```
Claude Code  ──stdio──>  MCP server  (dist/index.js, on your PC)
                              │  Playwright → headless Chromium (src/foundry.ts)
                              │  + the host (src/hosts: molten | local | generic)
                              ▼
                    Headless Foundry client
                    (host wakes the instance if it sleeps; joins as a dedicated GM user)
                              │  the world's own client APIs (window.__fvtt)
                              ▼
                    Foundry VTT world (Molten, this machine, or any URL)
```

The headless client connects **lazily**: `tools/list` answers without touching Foundry, and the
first actual tool call is what wakes the instance and joins the world. The whole tool tree depends
on one seam — `foundry.call(name, args)` — and only `src/foundry.ts` ever imports Playwright.

### Two-plane model

- **Plane A — the live bridge.** World documents (actors, items, journals, scenes, compendia, roll
  tables, cards, ownership). Goes through the headless Foundry client while the server is awake — the
  **only** safe way to read/write live world data.
- **Plane B — the host's file plane.** Talks to the file channel of wherever Foundry runs, directly
  (no bridge): on Molten that is WebDAV, on a local install it is the `Data/` directory itself.
  Uploads/serves static assets and maps `Data/`-relative paths to public URLs. Which host a
  registration targets is `FOUNDRY_HOST` (`molten` / `local` / `generic` — [design.md §2.6](design.md)).

**Safety rule baked in:** a running world's database (LevelDB stores under `Data/worlds/<world>/data/`)
must **never** be written over the file channel — that corrupts it. Plane-B file ops are restricted
to static assets and refuse world-DB paths; bulk DB edits are an offline-only flow (stop → Create
Backup → `fvtt unpack` → edit → `fvtt pack` → start, via
[foundryvtt-cli](https://github.com/foundryvtt/foundryvtt-cli)). The Molten **management panel is
never scripted** (their ToU forbids it); only the Magic-URL wake, WebDAV, and the Foundry server are
automated.

## Scope

**In scope:** actors — both **NPCs** and full leveled **PCs** — items, journals, scenes (the scene **document** _and_ its **placeables** —
walls, lights, tokens, regions/teleporters, ambient sounds, tiles, drawings, map notes), playlists,
roll tables, cards, macros, combat-tracker config, compendium manipulation — especially **pulling**
content out ("make an actor from the MM owlbear") — and asset upload. With the bundled skills these
compose into **end-to-end adventures** — from **reading a provided map image** to drive a scene and
everything in it, to **importing a distributed battlemap module** (e.g. Tom Cartos scene-packs)
faithfully into your world. Authoring prefers the **2024** dnd5e data model, sourced from
**PHB / DMG / MM**; if the requested content isn't in those packs the tool says so rather than
inventing it.

**Out of scope (for now):** non-5e game systems; **live session assistance** — monitoring a running
game and interjecting during play (live chat, running the monsters' combat turns) is the next phase
(see [`design.md`](design.md) §8), not built yet; AI **map-image** generation (Claude reads a
*provided* map, it does not draw one); scripting the Molten management panel. (Scene placeables —
walls, lights, tokens, regions — _are_ authored and edited as scene contents; what's out of scope is
driving them live on the canvas during a running session.)

**Removed deliberately: D&D Beyond import.** DDB character exports strip the embedded effect
automation the premium compendium items carry, so an imported PC looks right and silently fails at
the table. Ask for the character instead and it's built **natively from the premium books**, using
the DDB sheet only as a reading reference.

---

## Repository layout

```
src/
  index.ts          MCP server entry (stdio) — serves the registry's tools over JSON-RPC
  registry.ts       single source of truth: tool name → handler (advertised list derived from it)
  foundry.ts        THE Playwright seam: launch headless Chromium → wake → join → inject → call()
  hosts/            WHERE Foundry runs — molten (Magic-URL wake, WebDAV plane) / local (Data/ dir) / generic
  config.ts         env/config loader (reads .env from the repo root; FOUNDRY_HOST picks the host)
  tools/            MCP tool classes — Plane A world tools + assets/ (Plane B file tools over the host's plane)
  page/             page-side domain library, bundled into dist/page.bundle.js and injected
scripts/            dev/maintenance scripts (verify-*.mjs live acceptance, spike-headless)
tests/              gated live integration suites (offline unit tests live beside the code in src/**)
```

## Requirements

- **Node.js 22+** (developed/tested on Node 24; see `.nvmrc`; CI runs 22 + 24). On Windows, if Node
  isn't on `PATH`, use the full path to `node.exe` (see wiring below).
- A **Chromium for Playwright** — `npx playwright install chromium` (Playwright is a devDependency;
  the headless bridge drives this browser).
- **Foundry VTT 14.368+** with the **D&D 5e system 6.0.1+** (2.x is the dnd5e **6.x** line and
  refuses to author against an older system; v1.5.2 is the last release that runs on dnd5e 5.3.x), hosted on **Molten**, plus a dedicated **passwordless Foundry user**
  for the MCP to join as.

## Build

```bash
npm install
npx playwright install chromium   # one-time: the headless browser the bridge drives
npm run build                     # tsc → dist/, then esbuild bundles the in-page library
```

`npm run build` runs `tsc && node esbuild.page.mjs`: TypeScript compiles `src/**` to `dist/`, then
esbuild bundles the page-side library (`src/page/**`) into `dist/page.bundle.js` for injection.
Tests: `npm test` (offline unit suite on vitest). Live integration suites are gated — see
[`vitest.integration.config.ts`](vitest.integration.config.ts) and `npm run test:integration`.

> **Dev watch:** `npm run dev` rebuilds the page bundle once, then runs `tsc --watch` for `src/**`.
> Because the page library is a **separate** esbuild artifact, editing anything under `src/page/**`
> while developing needs `npm run dev:page` (esbuild `--watch`) alongside it — otherwise the running
> server keeps injecting the stale `dist/page.bundle.js`.

## Wire into Claude Code

Register the built MCP server in your Claude Code config. Copy
[`.mcp.json.example`](.mcp.json.example) to a `.mcp.json` Claude Code reads (project-scoped, or your
`~/.claude.json` `mcpServers`) and set **absolute** paths:

```json
{
  "mcpServers": {
    "foundry-prod": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/fvtt-mcp-dnd5e/dist/index.js"],
      "env": { "FOUNDRY_HOST": "molten" }
    },
    "foundry-sandbox": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/fvtt-mcp-dnd5e/dist/index.js"],
      "env": { "FOUNDRY_HOST": "local" }
    }
  }
}
```

- **One registration per Foundry instance.** `FOUNDRY_HOST` in the registration's `env` says where
  that instance runs — `molten` (the default), `local` (an install on this machine), or `generic`
  (a bare URL) — and one `.env` serves all of them ([design.md §2.6](design.md)). Which instance a
  call touches is fixed by which server it goes to.
- Use an **absolute** path to the root `dist/index.js` (Claude Code may launch the server from any
  directory).
- On Windows, point `command` at the full `node.exe` path if Node isn't on `PATH`.
- The server loads its `.env` from the repo root regardless of working directory.
- The headless client connects lazily — the first tool call wakes the instance (on a host that
  sleeps) and joins the world, so the initial call after a cold box can take a while.

### Toolsets — advertise less

The full surface is 151 tools, and `tools/list` for it is ~79k tokens. A client that loads MCP
schemas eagerly pays that on every registration before the first word (Claude Code defers them and
only lists names, so it pays far less). A registration that only ever does part of the job can say
so with `FOUNDRY_TOOLSETS` (comma-separated) and advertise just those:

```json
"env": { "FOUNDRY_HOST": "molten", "FOUNDRY_TOOLSETS": "chat,combat" }
```

| Toolset | What it holds |
| --- | --- |
| `world` | `get-world-info`, `get-current-scene`, `disconnect-bridge`, users, dnd5e settings, calendar — **always on** |
| `actors` | NPCs and PCs: sheets, effects, activities, inventory, groups, art, ownership |
| `items` · `compendium` · `journals` · `tables` · `cards` · `audio` | the document families |
| `scenes` | scenes, who-sees-what routing, every placeable kind |
| `chat` · `combat` | the chat log; combat tracker + analytics |
| `assets` | the Plane-B file tools + reference integrity |
| `organization` | folders, moves, bulk delete, macros |

Unset = everything (the bundled skills need the whole surface). `chat,combat` advertises 16 tools
at ~6k tokens. A call to a tool outside the enabled set is refused **by name** — which toolset it
is in and how to enable it — never as "unknown tool"; a misspelt toolset stops the server at
startup with the valid names. The table is [`src/toolsets.ts`](src/toolsets.ts).

## Configuration

Copy [`.env.example`](.env.example) to `.env` (gitignored) and fill in your instance. The host
(`FOUNDRY_HOST`) picks which variables apply:

- **`molten`** — `MOLTEN_SERVER_URL`, `MOLTEN_WORLD_ID`, `MOLTEN_WEBDAV_URL`,
  `MOLTEN_FILEBROWSER_URL`, `FOUNDRY_USER` (the dedicated user to join as; defaults to
  `MCP-Claude`) / `FOUNDRY_PASSWORD`. The committed defaults are neutral `your-server`/`your-world`
  placeholders. **Wake (optional but recommended):** `MOLTEN_MAGIC_URL` — Molten's "Server
  Startup / Magic URL" (`…?s=token`), GET to wake a sleeping box before joining. **Secrets (never
  commit — env only):** `MOLTEN_WEBDAV_PASSWORD` (the asset file tools), `MOLTEN_ADMIN_KEY`. Read
  them from your Molten panel → Server Details.
- **`local`** — `LOCAL_SERVER_URL` (default `http://localhost:30000`), `LOCAL_ADMIN_KEY`,
  `LOCAL_FOUNDRY_DATA` (the install's `Data/` directory — the asset file tools' plane); the world id
  and join user fall back to the `MOLTEN_*` / `FOUNDRY_*` values (a sandbox is a copy of prod).
- **`generic`** — `FOUNDRY_URL`, `FOUNDRY_USER` / `FOUNDRY_PASSWORD`, optionally `FOUNDRY_ADMIN_KEY` +
  `FOUNDRY_WORLD_ID` for a remote world launch. No wake, no file plane.

Each tool reports which variable to set if something it needs is missing.

## Tools

**151 tools total: 141 over the headless bridge (Plane A) + 10 asset file tools over the host's file plane (Plane B).**

Plane A (bridge) covers world introspection and editing — actors, items, compendium search,
journals & quests, scenes **and their placeables** (walls, lights, tokens, regions/teleporters,
ambient sounds, tiles, drawings, notes), **who-sees-what routing** (the one active scene, pulling
connected users to a side scene, and per-user landing scenes for where players come up at login —
core Foundry has no such thing, so `set-landing-scene` writes a flag the companion
[`fvtt-mod-openserver`](https://github.com/Txpple/fvtt-mod-openserver) module acts on, and warns
when that module is absent rather than claiming success),
roll tables, cards, playlists, **per-scene atmospheric sound sets** (`configure-soundscape`, for the
companion [`fvtt-mod-soundscape`](https://github.com/Txpple/fvtt-mod-soundscape) module — randomized
one-shots with silence between them, or crossfaded ambient beds, which neither AmbientSound
placeables nor Playlists can express), ownership,
folders/organization, macros, combat-tracker config, the dnd5e 6.0 **automation switches** and
**in-world calendar** (`configure-dnd5e-settings`, `manage-calendar`), and 5e-specific helpers (NPC creation,
**PC building & leveling**, feature/spell granting, structured inventory/loot
authoring), **full-fidelity actor JSON export** (`export-actor`), and **per-combat session
analytics** (`get-combat-stats`, folded from the companion
[`fvtt-mod-battleflow`](https://github.com/Txpple/fvtt-mod-battleflow) module's stat stamps),
**plus the asset-composition + reference-integrity tools**. Plane B (the host's file plane —
WebDAV on Molten, the `Data/` directory on a local install) is the asset file library.

**Plane B — asset file tools:**

| Tool                  | What it does                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| `list-assets`         | List a directory under `Data/` (folders + files, with size/type/public URL)      |
| `asset-info`          | Existence + size/type/mtime/public URL for one path under `Data/`                |
| `download-asset`      | Download a file from under `Data/` to a local path                               |
| `upload-asset`        | Upload a local file under `Data/` (auto-creates parents; refuses world-DB paths) |
| `upload-asset-tree`   | Recursively upload a local directory tree under `Data/` (preserves layout)        |
| `create-asset-folder` | Create a folder (and missing parents) under `Data/` (idempotent)                 |
| `delete-asset`        | Delete a file (reference-aware; refuses if still used unless `force`)            |
| `move-asset`          | Move/rename a file (refuses or relinks references; `relink`/`force`)             |
| `copy-asset`          | Copy a file under `Data/`                                                        |
| `asset-url`           | Map a `Data/`-relative path to its public HTTPS URL (pure, no network)           |

**Plane A — asset composition + reference integrity (bridge):**

| Tool                    | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `find-asset-references` | Find every scene/actor/journal/playlist/… that references an asset path      |
| `relink-asset`          | Rewrite all references from one asset path to another (`dryRun` supported)   |
| `create-playlist`       | Create a Playlist from sound paths (the flagship "upload → playlist" wiring) |
| `create-scene`          | Create a Scene from a background image path                                  |
| `update-scene`          | Update a scene's fields, including swapping its background image             |
| `set-actor-art`         | Set an actor's portrait (+ prototype token) from an image path               |
| `add-journal-image`     | Append an image page to a journal entry                                      |

The remaining Plane A tools cover world CRUD (`create-actor-from-compendium`/`author-npc`, `add-feature` (features / compendium
features / spells), `import-item` (copy a real PHB/DMG item — art + stats — onto an actor or the
sidebar), `add-item` (author structured weapons/armor/consumables/loot/containers), `create-item`,
`create-journal`/`create-quest-journal`, `create-rolltable`, `create-cards`, …), listing/search
(`list-actors`, `search-compendium`, `list-journals`, …), and organization (`create-folder`,
`move-documents`, `bulk-delete`). See the `handlers` map in [`src/registry.ts`](src/registry.ts) for the full dispatch table.

> Plane B file ops run over the host's file plane (Molten: WebDAV, needs `MOLTEN_WEBDAV_PASSWORD`,
> works whenever the VM is awake; local: `LOCAL_FOUNDRY_DATA`).
> Plane A tools run over the headless bridge (need the world joined). Write tools refuse live
> world-DB paths; destructive file ops consult `find-asset-references` first.

## Security

- **Outbound-only, nothing public.** The server and the headless browser run on your machine and make
  only outbound connections (to Foundry on Molten, and to Anthropic); nothing listens for inbound
  traffic, and the headless client authenticates to Foundry exactly as a normal user would.
- **Secrets stay in `.env`** (gitignored), with tight file perms — never commit `MOLTEN_WEBDAV_PASSWORD`,
  `MOLTEN_ADMIN_KEY`, or your Claude token. Errors name the missing variable, never its value.
- **Treat all agent inputs as untrusted** (chat, transcripts, web) — prompt-injection can ride in.
  Plane-A writes are inherently safe because they go through Foundry's own client APIs; Plane-B
  destructive file ops are reference-aware, refuse live world-DB paths (canonicalized, `..`-rejecting),
  and deletes resolve strictly (exact id/name, no fuzzy match).
- **Anything under `Data/` is served publicly over HTTPS with no auth** — don't upload anything
  sensitive.

## Contributing

The project is one package: a Node-side MCP server (`src/`) that drives a headless Foundry page
through the `foundry.call(name, args)` seam, plus a page-side library (`src/page/**`, bundled into
`dist/page.bundle.js` and injected as `window.__fvtt`). Adding a tool touches both halves:

1. **MCP tool class** (`src/tools/<category>.ts`) — declare the input contract **once** as a hoisted
   zod schema; `getToolDefinitions()` returns `{ name, description, inputSchema: toInputSchema(schema) }`
   (the advertised JSON Schema is **generated** from that zod via `src/utils/schema.ts` — never
   hand-written), plus a `handleX(args)` that `schema.parse`es and calls `foundry.call('<op>', data)`.
2. **Register it** (`src/registry.ts`) — instantiate the class, add its `getToolDefinitions()` to the
   collected definitions, and add a `'<tool-name>': args => tool.handleX(args)` entry to the `handlers`
   map. The advertised tool list is **derived** from `handlers`, so a handler with no matching
   definition fails loudly at startup (`src/tools/registry.test.ts` guards the surface).
3. **Page-side op** (`src/page/<domain>.ts`) — implement `<op>(args)` and register it in
   `src/page/index.ts`. This runs **inside** the live Foundry page (the actual `Document.create` /
   `update` / `delete`): import only browser + Foundry globals here, never Node/Playwright.
4. **Build + verify** — `npm run build`, then `npm test`, `npm run typecheck`, `npm run knip`, and
   biome (`npm run check`). For live changes, `npm run test:integration` against a real world.

---

## Support

Issues: [GitHub Issues](https://github.com/Txpple/fvtt-mcp-dnd5e/issues)

## Acknowledgments

Used as a reference:
[adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley.  

## License

MIT License — see [LICENSE](LICENSE) for details.
