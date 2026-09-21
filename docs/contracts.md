# Contracts — what other repos depend on here

Two surfaces of this package are declared contracts, and a handful of Foundry **flags** are wire
formats shared with companion modules. A change to any of them is a change to another repo:
re-point the consumer in the same commit, or version the change. The package version
(`package.json`, tags `vX.Y.Z`, [`CHANGELOG.md`](../CHANGELOG.md)) is the pin.

## 1. The tool surface (skills and sibling instructions call tools by name)

The 81 tool names, their `action` / `kind` / `type` discriminators and their argument leaves are
what `.claude/skills/**` and any sibling's skills or `CLAUDE.md` write down. The registry
(`src/registry.ts`) is the source of truth; `npm test` fails on a handler without a definition.

- **A rename or re-shape re-points every consumer in the same commit.** In this repo:
  `node scripts/measure/skills-matrix.mjs` must report **0 unresolved** names (it also treats a
  union's discriminator values as names a skill may write beside the tool). Beyond this repo the
  checklist is a grep — `grep -rn "<old-tool-name>" .claude/skills scripts tests ../fvtt-mod-*/tools
  ../fvtt-mcp-artificer <campaign repo>` — because sibling skills name tools too (the artificer's
  illustration-builder names 11; a campaign repo's notes may name 20).
- **Tool names are bare.** A skill never writes `mcp__<registration>__<tool>`; the registration
  name is the user's ([hosts.md](hosts.md)).
- **Result shapes** are design.md §3: a list is one line per record under a `<N> <noun>(s)`
  header, a `get` is JSON, a mutation is one line, a miss is `isError`. A sibling that parses a
  result parses that.

## 2. The library surface (`fvtt-mcp-dnd5e/client`)

The house modules' `tools/` harnesses and the artificer drive a live world through the same
headless bridge, never through the MCP process. The package's `exports` declare it; the sibling
depends with `"fvtt-mcp-dnd5e": "file:../fvtt-mcp-dnd5e"` (the family is cloned side by side) and
imports:

| Import | Gives |
| --- | --- |
| `fvtt-mcp-dnd5e/client` | `connectFoundry({ host, env, identity, tag, watchdogMs })` → `{ f, dispose }`; `Foundry` (`evaluate` / `call` / `screenshot` / `dispose`, alias `disconnect`); `BridgeError` (+ `BridgeErrorCode`, `PageErrorCode`); `foundryConfig`, `resolveIdentity`, `quietLogger`, `targetLabel`; `Logger`; `FilePlaneError`; and re-exports of the two below |
| `fvtt-mcp-dnd5e/env` | `loadEnv` (dotenv.parse of the family `.env`), `envPath` (`FVTT_MCP_ENV` or `<repo>/.env`), `repoRoot` |
| `fvtt-mcp-dnd5e/hosts` | `resolveHostConfig` (the one env selector: `FOUNDRY_HOST` → preset), `createHost`, `filePlaneFor`, `bridgeConfigOf`, the `Host` / `FilePlane` / `HostKind` types |

`identity` is `bridge` (the MCP's own user — `FOUNDRY_USER`), `suite` (`FOUNDRY_SUITE_USER` /
`_PASSWORD` — a distinct GM-capable account, so a bridge left connected shows as a second user
instead of an invisible collision), `player` (`FOUNDRY_PLAYER_USER` / `_PASSWORD`, no admin key)
or `{ user, password }`. `foundry.call(name, args)` is typed from the page's own signatures
(`PageArgs<N>` / `PageResult<N>`), so a sibling written in TypeScript gets the page contract at
compile time. The package is not published; "clone and build" is the install, and a sibling's
`npm install` links the local checkout.

## 3. Flags — wire formats shared with the companion modules

A tool never imports a module and a module never imports this package; they meet on a document
flag. Each row names the writer, the reader and where the shape is documented.

| Flag | Document | Written by | Read by | Shape lives in |
| --- | --- | --- | --- | --- |
| `flags["fvtt-mod-battleflow"]` — the stat stamps (`combat`, `sourceUuid`, `reverted`, the roll / damage / heal families) | ChatMessage | [`fvtt-mod-battleflow`](https://github.com/Txpple/fvtt-mod-battleflow) | `get-combat-stats` (read-only scan, `src/page/combat-stats.ts`) | battleflow `ARCHITECTURE.md` §4 "The data plane — stat stamps"; the read essentials are the file header here |
| `flags["fvtt-mod-soundscape"].sets` — the scene's sound sets | Scene | `configure-soundscape` (`src/page/soundscape.ts` owns the set schema, the clamps, the KEEP+WARN file check) | [`fvtt-mod-soundscape`](https://github.com/Txpple/fvtt-mod-soundscape) at scene load | the module's design doc; the tool warns when the module is absent or disabled |
| `flags["fvtt-mod-openserver"].landingScene` — a scene id | User | `set-landing-scene` (`src/page/scenes.ts`) | [`fvtt-mod-openserver`](https://github.com/Txpple/fvtt-mod-openserver) at login; `list-users` reports it | this repo (the tool is the writer); the tool warns when the module is absent or disabled |
| `flags["fvtt-mod-autoexplore"].enabled` — render the scene born-explored | Scene | `manage-scenes` `create` / `update` `flags` (the `tom-cartos-import` skill's born-explored option; any scene by hand) | `fvtt-mod-autoexplore` at canvas draw | the module |
| `flags["tom-cartos-import"]` — `sourceModule`, `sourceId` provenance | Scene, Region, JournalEntry | `manage-scenes` `create` + `manage-placeables` `{ kind: "regions" }` (`src/page/scenes.ts`) | `manage-placeables` `remap-teleporters` (old → new id maps), `manage-scenes` `list` with `flagScope` (dedup) | this repo — `TOM_CARTOS_FLAG_SCOPE` |

Tools that need a companion module say so in their description and **warn instead of claiming
success** when the module is missing: `get-combat-stats` (battleflow), `configure-soundscape`
(soundscape), `set-landing-scene` (openserver). Everything else is core Foundry + dnd5e.

## 4. The campaign repo

The campaign-facing skills read one DM's campaign facts and taste from a repo they do not own:
`campaign.json` + `STYLE.md`, laid out as
[`.claude/skills/_shared/campaign-repo.md`](../.claude/skills/_shared/campaign-repo.md) describes.
That file is the contract; a key added there is a key a campaign repo may set.

## 5. The `.env`

One file, read by the server, every script, the integration suite and the siblings through
`loadEnv`; `FVTT_MCP_ENV=<path>` points them all elsewhere. Every key any of them reads is
declared in [`.env.example`](../.env.example) — a new key is added there in the same commit.
