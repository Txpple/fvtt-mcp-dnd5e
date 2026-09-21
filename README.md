# fvtt-mcp-dnd5e

A Dungeon Master's assistant for **D&D 5e** on [Foundry VTT](https://foundryvtt.com), driven by
[Claude Code](https://claude.com/claude-code). It is a [Model Context Protocol](https://modelcontextprotocol.io)
server that reads and edits a **live** Foundry world — actors, items, journals, scenes and
everything on them, compendia, roll tables, cards, playlists, chat — plus a set of **skills**
that know how to build D&D content properly: a stat block becomes a complete NPC with its loot, a
map image becomes a lit and walled scene, a pasted adventure becomes journals, tables and
handouts, a Discord recording becomes the session recap.

It works with the world wherever it runs — a hosting provider, this machine, any URL — and
builds from the **2024 premium books** you own (*Monster Manual*, *Player's Handbook*,
*Dungeon Master's Guide* as Foundry modules), never from the SRD. The current line targets
**dnd5e 6.0.3+ on Foundry 14.368+**.

## Start in 60 seconds

```bash
git clone https://github.com/Txpple/fvtt-mcp-dnd5e && cd fvtt-mcp-dnd5e
npm install && npx playwright install chromium && npm run build
cp .env.example .env        # set FOUNDRY_URL, and FOUNDRY_USER / _PASSWORD for the user it joins as
cp .mcp.json.example .mcp.json   # absolute paths; one registration per Foundry instance
node scripts/install-skills.mjs ~/my-campaign   # optional: link the skills into another project
```

Then, in Foundry, create the user the server joins as (Users → Create User, role Gamemaster or
Assistant GM; default name `MCP-Claude`), start Claude Code, and say **"start the world"** — the
`start-session` skill calls `get-world-info`, which wakes the instance if it sleeps, launches the
world if it can (`FOUNDRY_ADMIN_KEY`), joins, and reports what it found: the world, the host, the
bridge user's role, which premium books are present. From there, ask for content.

Claude Code loads the skills from `.claude/skills` of the directory it runs in, so running it
from this repo needs nothing; `install-skills.mjs` links them into any other project (or `~` for
user scope).

## What you can do

Say it in plain words; the matching skill takes over and calls the tools.

| Skill | Does |
| --- | --- |
| `start-session` | boot the world and report its state (read-only) |
| `stat-block-builder` | a complete NPC from a pasted or described stat block — stats, actions, spells, effects, inventory, loot, art, folder |
| `pc-builder` | a complete player character — class, species, background, scores, level-1 choices, spells, gear, art, owner |
| `physical-item-builder` | weapons, armor, wondrous items, potions, loot, containers — the real PHB / DMG item first, modified or custom last |
| `scene-builder` | a map image into a ready-to-play scene: sized to the image, walls + lights, mood, playlist, journal |
| `journal-builder` | quests, handouts, lore, boxed text, GM notes, session recaps — with the links between them |
| `table-builder` · `cards-builder` · `playlist-builder` | roll tables, card decks, music and ambience playlists |
| `soundscape-builder` | atmospheric sound for a scene (needs the companion module — below) |
| `tom-cartos-import` | a scene-pack module (Tom Cartos and the like) into your world: every scene with its walls, lights, teleporters, legend |
| `token-cutout` | a cut-out token image onto an actor, facing checked |
| `chat-and-narration` | narration, NPC dialogue, whispers, roll requests, item cards; export or prune the log |
| `session-scribe` | a Craig (Discord) recording → speaker-labeled transcript aligned with the chat log → recap, combat report, GM notes |
| `session-audit` · `plot-drift-check` · `bestiary-builder` | audit next session's encounters and pacing; diff the world against the plot document; file what the party fought |

The skills compose into whole adventures: hand over only a map and the assistant reads it and
builds the scene and everything in it; hand over a finished module and it recreates every stat
block, item and handout faithfully. The campaign-facing skills (`session-scribe`, the audits,
the bestiary) keep your campaign's facts and house style in a **campaign repo** of your own —
`campaign.json` + `STYLE.md`, laid out as [`.claude/skills/_shared/campaign-repo.md`](.claude/skills/_shared/campaign-repo.md)
describes — so nothing about one table lives in this repo.

## Requirements

- **Node.js 22+** (developed on 24; `.nvmrc`), and Chromium for Playwright
  (`npx playwright install chromium`) — the server drives a headless browser.
- **Foundry VTT 14.368+** with **dnd5e 6.0.3+** (the tools refuse to author against a pre-6.0
  world; 1.5.2 is the last release for dnd5e 5.3.x), and a dedicated **Foundry user** for the
  server to join as.
- **The 2024 premium books as Foundry modules** — `dnd-monster-manual`, `dnd-players-handbook`,
  `dnd-dungeon-masters-guide` are **required for authoring** (the skills copy from them); *Heroes
  of Faerûn* and *Ravenloft: The Horrors Within* are optional extensions. `get-world-info` reports
  each as `present` / `missing`; the non-authoring tools work with none.

## Where Foundry runs — hosts

The server reaches the world through Foundry's own client, so it works on every host. Where the
world runs is a **host preset** chosen per registration with `FOUNDRY_HOST`
([`docs/hosts.md`](docs/hosts.md)):

| `FOUNDRY_HOST` | Means |
| --- | --- |
| `generic` (default) | any Foundry at `FOUNDRY_URL`; `FOUNDRY_WAKE_URL` if it sleeps, `FOUNDRY_DATA_DIR` / `FOUNDRY_WEBDAV_*` for a direct file plane |
| `molten` | [Molten Hosting](https://moltenhosting.com): the wake URL from the panel, the WebDAV plane derived from the URL |
| `local` | an install on this machine — no wake, its `Data/` directory as the file plane ([`docs/local-sandbox.md`](docs/local-sandbox.md)) |

One `.env` serves every registration ([`.env.example`](.env.example) explains every variable); a
registration's `env` block sets what differs. `FOUNDRY_TOOLSETS` lets a registration advertise a
subset of the tools (`chat,combat` is 12 tools instead of 81).

## The tools

**81 tools.** Everything a world holds, one family tool each with an `action`
(`manage-actors`, `manage-scenes`, `manage-placeables` with a `kind` for walls / lights / tokens /
regions / sounds / tiles / drawings / notes, `manage-items`, `manage-journals`, `manage-rolltables`,
`manage-cards`, `manage-playlists`, `manage-folders`, `manage-macros`) plus the D&D-specific ones:

- **Authoring** — `author-npc`, `create-actor-from-compendium`, `create-pc` / `level-up-pc` /
  `create-pc-from-prefab` / `inspect-pc-advancement`, `add-feature`, `add-item`,
  `update-actor-item`, `remove-from-actor`, `add-free-cast`, `manage-effect` (the dnd5e 6.x
  effect model: conditions, rules-type changes, expiry), `manage-activity` (attacks, saves,
  templates, teleport, transform), `apply-condition`, `set-actor-art`, `create-quest-journal` /
  `update-quest-journal` / `link-quest-to-npc`, `content-audit`.
- **Reading** — `get-world-info`, `get-current-scene`, `search-compendium` (creatures / spells /
  items with facets), `get-compendium-entry`, `list-compendium-packs`, `read-pack` (a scene-pack
  module on disk), `search-journals`, `search-actor-contents`, `screenshot-scene`,
  `get-scene-dimensions`.
- **The table** — `send-chat-message`, `request-roll`, `post-item-card`, `list-chat-messages`,
  `export-chat-log`, `delete-chat-messages`, `roll-on-table`, `configure-combat-tracker`, `activate-scene`,
  `pull-users-to-scene`, `configure-dnd5e-settings` (the 6.0 automation switches),
  `manage-calendar` (the in-world date; advancing it triggers dawn / dusk / bastion turns).
- **Files** — `upload-asset`, `upload-asset-tree`, `list-assets`, `asset-info`, `download-asset`,
  `copy-asset`, `move-asset`, `delete-asset`, `create-asset-folder`, `asset-url`,
  `find-asset-references`, `relink-asset`, `add-journal-image`. They work on every host through
  Foundry's own file picker; a direct plane (`FOUNDRY_DATA_DIR` or WebDAV) is faster and the only
  way delete / move work.
- **People and organization** — `list-users`, `update-user`, `set-user-avatar`,
  `set-actor-ownership`, `list-actor-ownership`, `create-group` / `manage-group-members` /
  `get-group` / `set-primary-party`, `move-documents`, `bulk-delete`, `duplicate-actor`,
  `set-journal-page-visibility`, `disconnect-bridge`.

Every list answers one line per record; every `get` is JSON; a miss is an error that names what
was looked for; an unknown argument is refused by name. The full dispatch table is
[`src/registry.ts`](src/registry.ts).

### Tools that need a companion module

Three tools write or read a flag that a module of the same family acts on, and **warn instead of
claiming success** when it is not installed ([`docs/contracts.md`](docs/contracts.md)):

| Tool | Module | What it adds |
| --- | --- | --- |
| `configure-soundscape` | [`fvtt-mod-soundscape`](https://github.com/Txpple/fvtt-mod-soundscape) | per-scene sound sets — randomized one-shots with silence between, crossfaded ambient beds; neither AmbientSound placeables nor Playlists can express them |
| `get-combat-stats` | [`fvtt-mod-battleflow`](https://github.com/Txpple/fvtt-mod-battleflow) | a per-combat ledger from the module's stat stamps: damage, healing, buff margins, spend economy, the moments |
| `set-landing-scene` | [`fvtt-mod-openserver`](https://github.com/Txpple/fvtt-mod-openserver) | where each user comes up at login — core Foundry has no such thing |

## How it works

Foundry has no server-side plugin API and a managed host does not expose one either; the one
supported way in, on every host, is Foundry's own authenticated client. So the server drives a
**headless Chromium** (Playwright): it wakes the instance if the host sleeps, joins the world as
the dedicated user, waits for `game.ready`, and injects a page-side library that exposes the
world's own client APIs. Claude Code talks to the server over stdio; each tool call becomes a call
inside that live page.

```
Claude Code ──stdio──▶ MCP server (dist/index.js, on your machine)
                          │  Playwright → headless Chromium (src/foundry.ts)
                          │  + the host preset (src/hosts: generic | molten | local)
                          ▼
                 the world's own client APIs, in the page (window.__fvtt)
                          ▼
                 Foundry VTT world — wherever it runs
```

The client connects **lazily**: `tools/list` answers without touching Foundry, and the first real
tool call is what wakes and joins. World documents always go through that page (the only safe
way to write a live world); the file tools go through the host's file plane and refuse a running
world's database. Everything that depends on *where* the world runs lives behind one seam,
`src/hosts/**` — the rest of the server never knows.

**As a library:** the sister repos (the companion modules' `tools/` harnesses) drive a live world
through the same bridge with `import { connectFoundry } from 'fvtt-mcp-dnd5e/client'` —
[`docs/contracts.md`](docs/contracts.md) declares that surface. The package is not published;
clone and build is the install.

## Repository layout

```
src/
  index.ts       MCP server entry (stdio)
  registry.ts    tool name → handler; the advertised list is derived from it
  foundry.ts     the Playwright seam: launch → wake → join → inject → call()
  hosts/         where Foundry runs: the presets, the file planes, the one env selector
  tools/         the MCP tools (zod schemas; the JSON Schema is generated)
  page/          the page-side library, bundled into dist/page.bundle.js and injected
  client.ts      the library surface the sister repos import
.claude/skills/  the skills — tracked, part of the deliverable
scripts/         the live proof (verify-*.mjs), the sandbox toolkit, the measurements
tests/           the gated live integration suites (unit tests sit beside the code)
docs/            hosts, contracts, the sandbox, the release gate; done work under history/
```

## Development

`npm run build` (tsc, then esbuild bundles the page library), `npm test` (offline; it prints the
context budgets — `tools/list` bytes, tool-name bytes, skill-description bytes — and fails when
one climbs past its ratchet), `npm run check` / `typecheck` / `knip`, `npm run measure`. The
live gates run against a sandbox: `FOUNDRY_HOST=local node scripts/verify-<family>.mjs` and
`FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`. The house rules — the gates, one
world-driver at a time, what a Foundry upgrade requires — are [`CONTRIBUTING.md`](CONTRIBUTING.md);
the release gate is [`docs/RELEASE.md`](docs/RELEASE.md); the design the code answers to is
[`design.md`](design.md); what changed per release is [`CHANGELOG.md`](CHANGELOG.md).

**Out of scope, by design:** other game systems; a live in-session assistant that watches play
and interjects; AI map-image generation (it reads a map you provide); scripting a hosting
provider's management panel; D&D Beyond import (a DDB export strips the effect automation the
premium items carry, so a PC is built natively from the books instead).

## Security

- **Outbound only.** The server and the headless browser run on your machine and make only
  outbound connections; the browser authenticates to Foundry exactly as a user would.
- **Secrets stay in `.env`** (gitignored): never commit `FOUNDRY_PASSWORD`, `FOUNDRY_ADMIN_KEY`,
  a wake URL or a WebDAV password. Errors name a missing variable, never its value; the wake URL
  is redacted from every log line.
- **Agent inputs are untrusted** (chat, transcripts, web pages). Writes go through Foundry's own
  client APIs; destructive file operations are reference-aware, refuse a live world's database,
  and delete only on an exact match.
- Anything under Foundry's `Data/` is served to the world's users without further auth — don't
  upload anything sensitive.

## Support · Acknowledgments · License

Issues: [GitHub Issues](https://github.com/Txpple/fvtt-mcp-dnd5e/issues). Used as a reference:
[adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley.
MIT — see [LICENSE](LICENSE).
