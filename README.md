# fvtt-mcp-dnd5e

An [MCP](https://modelcontextprotocol.io) server and a set of [Claude Code](https://claude.com/claude-code)
skills that build **D&D 5e** content in a live [Foundry VTT](https://foundryvtt.com) world. A pasted
stat block becomes a complete NPC with its loot; a map image becomes a walled, lit scene; an
adventure becomes journals, tables and handouts; a Discord recording becomes the session recap.
Everything is built from the **2024 premium books** you own, never the SRD.

Targets **dnd5e 6.0.5+ on Foundry 14.368+**, on any host — a hosting provider, this machine, a URL.

## Setup

```bash
git clone https://github.com/Txpple/fvtt-mcp-dnd5e && cd fvtt-mcp-dnd5e
npm install && npx playwright install chromium && npm run build
cp .env.example .env              # FOUNDRY_URL, FOUNDRY_USER / FOUNDRY_PASSWORD
cp .mcp.json.example .mcp.json    # absolute paths; one registration per Foundry instance
node scripts/install-skills.mjs ~/my-campaign   # optional: link the skills into another project
```

In Foundry, create the user the server joins as (Gamemaster or Assistant GM; default name
`MCP-Claude`). Start Claude Code and say **"start the world"**: the server wakes the instance if
it sleeps, launches the world if `FOUNDRY_ADMIN_KEY` is set, joins, and reports the world, the
host, its role and which premium books it found. Then ask for content.

**Requirements:** Node.js 22+ · Foundry 14.368+ with dnd5e 6.0.5+ (6.0.0–6.0.3 delete every
effect without an expiry on a rest; the tools refuse a pre-6.0 world; an older world is upgraded
Foundry-first, then dnd5e —
[`docs/hosts.md`](docs/hosts.md#bringing-a-world-up-to-the-30-line)) · the *Monster Manual*,
*Player's Handbook* and *Dungeon Master's Guide* modules for authoring (*Heroes of Faerûn* and
*Ravenloft: The Horrors Within* are optional).

## Skills

Say it in plain words; the matching skill calls the tools.

| Skill | Does |
| --- | --- |
| `start-session` | boot the world and report its state (read-only) |
| `stat-block-builder` | a complete NPC from a stat block — stats, actions, spells, effects, inventory, loot, art |
| `pc-builder` | a complete player character — class, species, background, choices, spells, gear, art, owner |
| `physical-item-builder` | weapons, armor, wondrous items, potions, loot — the real PHB / DMG item first |
| `scene-builder` | a map image into a ready-to-play scene: walls, lights, mood, playlist, journal |
| `journal-builder` | quests, handouts, lore, boxed text, GM notes, recaps — linked to each other |
| `table-builder` · `cards-builder` · `playlist-builder` | roll tables, card decks, music and ambience |
| `soundscape-builder` | atmospheric sound for a scene (companion module — below) |
| `tom-cartos-import` | a scene-pack module into your world: scenes, walls, lights, teleporters, legend |
| `token-cutout` | a cut-out token image onto an actor |
| `chat-and-narration` | narration, NPC dialogue, whispers, roll requests, item cards; export or prune the log |
| `session-scribe` | a Craig (Discord) recording → transcript aligned with the chat log → recap, combat report, GM notes |
| `session-audit` · `plot-drift-check` · `bestiary-builder` | audit next session's encounters; diff the world against the plot; log what the party fought |

The campaign-facing skills keep your campaign's facts and house style in a repo of your own
(`campaign.json` + `STYLE.md` — [`campaign-repo.md`](.claude/skills/_shared/campaign-repo.md));
nothing about one table lives here.

## Tools

**81 tools.** One family tool per document type, selected by `action`: `manage-actors`,
`manage-scenes`, `manage-placeables` (with a `kind`: walls, lights, tokens, regions, sounds,
tiles, drawings, notes), `manage-items`, `manage-journals`, `manage-rolltables`, `manage-cards`,
`manage-playlists`, `manage-folders`, `manage-macros`. Around them:

- **D&D authoring** — `author-npc`, `create-pc` / `level-up-pc`, `add-feature`, `add-item`,
  `manage-effect`, `manage-activity`, `apply-condition`, `set-actor-art`, the quest journals,
  `content-audit`.
- **Reading** — `get-world-info`, `search-compendium` (creatures / spells / items, with facets),
  `get-compendium-entry`, `read-pack`, `search-journals`, `screenshot-scene`.
- **At the table** — `send-chat-message`, `request-roll`, `post-item-card`, `export-chat-log`,
  `roll-on-table`, `configure-combat-tracker`, `activate-scene`, `configure-dnd5e-settings`,
  `manage-calendar`.
- **Files** — upload, list, download, copy, move, delete, relink; on every host through Foundry's
  own file picker, faster with a direct plane.
- **Users and organization** — ownership, groups and the primary party, `move-documents`,
  `bulk-delete`.

A list answers one line per record, a `get` answers JSON, a miss is an error, an unknown argument
is refused by name. The full table is [`src/registry.ts`](src/registry.ts). `FOUNDRY_TOOLSETS`
lets a registration advertise a subset (`chat,combat` is 12 tools instead of 81).

Three tools need a companion module and warn when it is absent: `configure-soundscape`
([fvtt-mod-soundscape](https://github.com/Txpple/fvtt-mod-soundscape)), `get-combat-stats`
([fvtt-mod-battleflow](https://github.com/Txpple/fvtt-mod-battleflow)), `set-landing-scene`
([fvtt-mod-openserver](https://github.com/Txpple/fvtt-mod-openserver)).

## Hosts

Where the world runs is a preset chosen per registration with `FOUNDRY_HOST`
([`docs/hosts.md`](docs/hosts.md)):

| `FOUNDRY_HOST` | Means |
| --- | --- |
| `generic` (default) | any Foundry at `FOUNDRY_URL`; `FOUNDRY_WAKE_URL` if it sleeps, `FOUNDRY_DATA_DIR` / `FOUNDRY_WEBDAV_*` for a direct file plane |
| `molten` | [Molten Hosting](https://moltenhosting.com): the panel's wake URL, WebDAV derived from the URL |
| `local` | an install on this machine — its `Data/` as the file plane ([`docs/local-sandbox.md`](docs/local-sandbox.md)) |

One `.env` serves every registration; [`.env.example`](.env.example) explains each variable.

## How it works

Foundry has no server-side plugin API, so the server drives a **headless Chromium** (Playwright):
it joins the world as the dedicated user, waits for `game.ready`, and injects a page-side library;
every tool call runs inside that live page through Foundry's own client APIs. The connection is
lazy — the first real tool call is what wakes and joins. The sister repos drive a world through
the same bridge as a library: `import { connectFoundry } from 'fvtt-mcp-dnd5e/client'`
([`docs/contracts.md`](docs/contracts.md)).

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

Outbound only — the server and the browser run on your machine and authenticate to Foundry as a
user. Secrets stay in `.env` (gitignored); errors name a missing variable, never its value. Agent
inputs are untrusted: writes go through Foundry's own APIs, destructive file operations refuse a
live world's database and delete only on an exact match. Anything under Foundry's `Data/` is
served to the world's users — don't upload anything sensitive.

## License

MIT — see [LICENSE](LICENSE).
