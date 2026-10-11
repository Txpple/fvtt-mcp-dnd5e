# fvtt-mcp-dnd5e

[![CI](https://github.com/Txpple/fvtt-mcp-dnd5e/actions/workflows/ci.yml/badge.svg)](https://github.com/Txpple/fvtt-mcp-dnd5e/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server and a set of [Claude Code](https://claude.com/claude-code)
skills that build **D&D 5e** content in a live [Foundry VTT](https://foundryvtt.com) world. A pasted
stat block becomes a complete NPC with its loot; a map image becomes a walled, lit scene; an
adventure becomes journals, tables and handouts; a Discord recording becomes the session recap.
Everything is built from the **2024 premium books** you own, never the SRD.

Targets **dnd5e 6.0.5+ on Foundry 14.368+**, on any host: a hosting provider, this machine, a URL.

## Setup

```bash
git clone https://github.com/Txpple/fvtt-mcp-dnd5e && cd fvtt-mcp-dnd5e
npm install && npx playwright install chromium && npm run build
cp .env.example .env              # or just the minimal local / Molten block at its top
cp .mcp.json.example .mcp.json    # absolute paths; one registration per Foundry instance
FOUNDRY_HOST=local npm run doctor # checks the setup, one line per item (the host as registered)
node scripts/install-skills.mjs ~/my-campaign   # optional: link the skills into another project
```

`npm run doctor` checks, in order: Node, the build, Playwright's Chromium, the `.env` (as the
server reads it), the Foundry app (local host), that Foundry answers, the admin key (when no world
is running), the world, and a login as `FOUNDRY_USER` with its role. Every ✗ line names its fix,
and any ✗ exits non-zero. It never launches or stops a world; the login is the same short join a
tool call makes, so it is safe against a live instance.

Registration (`.mcp.json`, or `mcpServers` in `~/.claude.json` for every project) names the
full Node path, `"command": "C:/Program Files/nodejs/node.exe"` on Windows, since the client
that starts the server may not have Node on PATH. A desktop-app install of Claude Code may not put
`claude` on PATH either, so register by editing one of those files rather than with
`claude mcp add`.

In Foundry, create the user the server joins as (Gamemaster or Assistant GM; default name
`MCP-Claude`), or set `FOUNDRY_USER` to an existing Gamemaster or Assistant GM user; a name the
world does not have is refused at the first tool call, with the users it does have. Start Claude
Code and say **"start the world"**: the server wakes the instance if it sleeps, launches the world
if `FOUNDRY_ADMIN_KEY` is set, joins, and reports the world, the host, its role and which premium
books it found. Then ask for content.

**Requirements:** Node.js 22+ · Foundry 14.368+ with dnd5e 6.0.5+ (6.0.0–6.0.3 delete every
effect without an expiry on a rest; the tools refuse a pre-6.0 world; an older world is upgraded
Foundry-first, then dnd5e:
[`docs/hosts.md`](docs/hosts.md#bringing-a-world-up-to-the-30-line)) · the *Monster Manual*,
*Player's Handbook* and *Dungeon Master's Guide* modules for authoring (*Heroes of Faerûn* and
*Ravenloft: The Horrors Within* are optional).

## Skills

Say it in plain words; the matching skill calls the tools.

| Skill | Does |
| --- | --- |
| `start-session` | boot the world and report its state (read-only) |
| `stat-block-builder` | a complete NPC from a stat block: stats, actions, spells, effects, inventory, loot, art |
| `pc-builder` | a complete player character: class, species, background, choices, spells, gear, art, owner |
| `physical-item-builder` | weapons, armor, wondrous items, potions, loot; the real PHB / DMG item first |
| `scene-builder` | a map image into a ready-to-play scene: walls, lights, mood, playlist, journal |
| `journal-builder` | quests, handouts, lore, boxed text, GM notes, recaps, linked to each other |
| `table-builder` · `cards-builder` · `playlist-builder` | roll tables, card decks, music and ambience |
| `area-sounds-builder` | atmospheric sound for a scene (companion module, below) |
| `tom-cartos-import` | a scene-pack module into your world: scenes, walls, lights, teleporters, legend |
| `token-cutout` | a cut-out token image onto an actor |
| `chat-and-narration` | narration, NPC dialogue, whispers, roll requests, item cards; export or prune the log |
| `session-audit` · `plot-drift-check` · `bestiary-builder` | audit next session's encounters; diff the world against the plot; log what the party fought |

Session summaries and analytics moved out in 4.0.0, to
[`fvtt-mcp-sessionscribe`](https://github.com/Txpple/fvtt-mcp-sessionscribe). That covers turning
a Craig (Discord) recording and the chat log into the transcript, recap, combat report and GM
notes. It files the session diary through `manage-journals` here.

The campaign-facing skills keep your campaign's facts and house style in a repo of your own
(`campaign.json` + `STYLE.md`: [`campaign-repo.md`](.claude/skills/_shared/campaign-repo.md));
nothing about one table lives here.

## Tools

**80 tools.** One family tool per document type, selected by `action`: `manage-actors`,
`manage-scenes`, `manage-placeables` (with a `kind`: walls, lights, tokens, regions, sounds,
tiles, drawings, notes), `manage-items`, `manage-journals`, `manage-rolltables`, `manage-cards`,
`manage-playlists`, `manage-folders`, `manage-macros`. Around them:

- **D&D authoring**: `author-npc`, `create-pc` / `level-up-pc`, `add-feature`, `add-item`,
  `manage-effect`, `manage-activity`, `apply-condition`, `set-actor-art`, the quest journals,
  `content-audit`.
- **Reading**: `get-world-info`, `search-compendium` (creatures / spells / items, with facets),
  `get-compendium-entry`, `read-pack`, `search-journals`, `screenshot-scene`.
- **At the table**: `send-chat-message`, `request-roll`, `post-item-card`, `export-chat-log`,
  `roll-on-table`, `configure-combat-tracker`, `activate-scene`, `configure-dnd5e-settings`,
  `manage-calendar`.
- **Files**: upload, list, download, copy, move, delete, relink; on every host through Foundry's
  own file picker, faster with a direct plane.
- **Users and organization**: ownership, groups and the primary party, `move-documents`,
  `bulk-delete`.

A list answers one line per record, a `get` answers JSON, a miss is an error, an unknown argument
is refused by name. The full table is [`src/registry.ts`](src/registry.ts). `FOUNDRY_TOOLSETS`
lets a registration advertise a subset (`chat,combat` is 11 tools instead of 80).

Two tools need a companion module and warn when it is absent: `configure-area-sounds`
([Open Roll 5e: Area Sounds](https://github.com/Txpple/fvtt-mod-areasounds)) and `set-landing-scene`
([Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver)).

## Hosts

Where the world runs is a preset chosen per registration with `FOUNDRY_HOST`
([`docs/hosts.md`](docs/hosts.md)):

| `FOUNDRY_HOST` | Means |
| --- | --- |
| `generic` (default) | any Foundry at `FOUNDRY_URL`; `FOUNDRY_WAKE_URL` if it sleeps, `FOUNDRY_DATA_DIR` / `FOUNDRY_WEBDAV_*` for a direct file plane |
| `molten` | [Molten Hosting](https://moltenhosting.com): the panel's wake URL, WebDAV derived from the URL |
| `local` | an install on this machine, its `Data/` as the file plane ([`docs/local-sandbox.md`](docs/local-sandbox.md)) |

One `.env` serves every registration; [`.env.example`](.env.example) explains each variable.

## How it works

Foundry has no server-side plugin API, so the server drives a **headless Chromium** (Playwright):
it joins the world as the dedicated user, waits for `game.ready`, and injects a page-side library;
every tool call runs inside that live page through Foundry's own client APIs. The connection is
lazy: the first real tool call is what wakes and joins. The other Open Roll 5e servers and the
modules' live suites drive a world through the same bridge as a library:
`import { connectFoundry } from 'fvtt-mcp-dnd5e/client'` ([`docs/contracts.md`](docs/contracts.md)).
While connected the bridge leaves a seat record (a file on the machine, a marker on its User
document) naming the session that holds it; `disconnect-bridge` names any other holder and ends
them with `{ "all": true }`, and a bridge idle for 20 minutes logs itself out
(`FOUNDRY_IDLE_LOGOUT_MIN`) — [`docs/hosts.md`](docs/hosts.md).

## Development

The offline gate is `npm run check && npm run typecheck && npm test && npm run build && npm run knip`
(`npm test` prints and ratchets the context budgets). Live proof runs against a sandbox:
`FOUNDRY_HOST=local node scripts/verify-<family>.mjs` and
`FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`. House rules:
[`CONTRIBUTING.md`](CONTRIBUTING.md) · release gate: [`docs/RELEASE.md`](docs/RELEASE.md) · design:
[`design.md`](design.md) · changes: [`CHANGELOG.md`](CHANGELOG.md).

**Out of scope:** other game systems; a live in-session assistant; AI map generation; D&D Beyond
import.

## Security

Outbound only: the server and the browser run on your machine and authenticate to Foundry as a
user. Secrets stay in `.env` (gitignored); errors name a missing variable, never its value. Agent
inputs are untrusted: writes go through Foundry's own APIs, destructive file operations refuse a
live world's database and delete only on an exact match. Anything under Foundry's `Data/` is
served to the world's users, so don't upload anything sensitive.

<!-- openroll5e:family -->
## Part of Open Roll 5e

fvtt-mcp-dnd5e is one of the three MCP servers in Open Roll 5e, a suite of Foundry VTT modules and Claude
Code tooling built for one D&D 5e table and shared. The other servers:

- [fvtt-mcp-imagegen](https://github.com/Txpple/fvtt-mcp-imagegen): makes the art with Google's Gemini image models: icons, tokens, props, portraits and illustrations, token redresses and restyles, battlemap and overland-map repaints, and the illustrated session records, all grounded in what the world already shows.
- [fvtt-mcp-sessionscribe](https://github.com/Txpple/fvtt-mcp-sessionscribe): turns a session's Discord recording and Foundry chat log into its record. Its end-to-end `session-scribe` skill drives the server from the Craig link to a speaker-labelled transcript, a fully illustrated player recap, combat statistics, GM notes and a party snapshot.

The modules, each of which installs and works on its own and none of which needs another:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: Battle Flow](https://github.com/Txpple/fvtt-mod-battleflow): combat automation for dnd5e 2024 rules: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, and concentration is tracked. Every rule that touches a fight in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives any user a landing scene of their own.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.
- [Open Roll 5e: Area Sounds](https://github.com/Txpple/fvtt-mod-areasounds): background sound for scenes: random one-shots with silence between them, seamless crossfaded loops, day and night gating, and quiet during combat.

Issues are welcome on every repo in the family; pull requests are not accepted, since each is one
author's design for one table, shared because it might suit yours. How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
