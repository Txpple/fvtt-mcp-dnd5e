# 2.2 — a Foundry MCP first, hosts as options · plan & tracker

> Checkbox-driven tracker, aligned to [`design.md`](../design.md) (§2.6, §9). 2.2 changes **no tool
> behaviour**: it moves what is host-specific behind one seam, lets a registration advertise a subset
> of the surface, and renames the project to what it is. Owner decisions 2026-09-20: new name
> **`fvtt-mcp-dnd5e`**; CRUD consolidation is **out of scope — parked for 3.0** (see the end).

## Why (the measurements behind it)

The server had become "the Molten MCP" by name and by shape, while the codebase was already
host-agnostic in fact: the bridge is Foundry's own client driven by Playwright against a URL, and
only four things ever knew about Molten — the Magic-URL wake in `foundry.ts`, the WebDAV file tools
in `tools/molten/**`, `export-chat-log` reusing that WebDAV client, and the `FOUNDRY_PROFILE` branch
in `config.ts` (which turned the file plane *off* by pointing it at a placeholder URL).

Context cost, measured 2026-09-20 by building the registry offline (`tools/list` as advertised):

| | |
| --- | --- |
| tools per server | **151** |
| full `tools/list` payload | 284k chars ≈ **~79k tokens** |
| — input schemas | 206k chars (73%) |
| — descriptions | 68k chars |
| heaviest | `manage-activity` 16k · `update-actor` 15k · `add-feature` 13k · `add-item` 9k · `create-scene` 9k chars |
| CRUD-family tools (`list/create/update/delete-X`) | **70 of 151**, in 17 families |

Both registrations (`foundry-molten5e`, `foundry-local5e`) are the same binary and advertise the
identical 151 tools — the host does **not** change the context cost. What does: (a) registering
both at user scope, so an eager client (Claude Desktop, claude.ai) loads ~158k tokens of schema
before the first word; (b) in Claude Code — which defers MCP schemas and only lists names — the 302
names in every system prompt plus the tool *results* (capped at 20k chars ≈ 5.5k tokens each).

## Framing (binding)

- **A Foundry MCP first.** The product is "drive a live Foundry VTT world through Claude". Where
  that world runs — Molten Hosting, a local install, a URL — is a **host**, chosen per registration.
  Nothing outside `src/hosts/**` may name a host.
- **`local` means "on this machine"**, not "not Molten". A self-hosted VPS or a Forge world is
  neither; that is `generic` today and its own host later. The axis is open-ended.
- **Skills decide, tools do — unchanged.** No tool contract changes in 2.2. Tool *names* stay
  exactly as they are (skills, sibling repos and the house modules call them by name), and the
  Molten-flavoured words in descriptions ("over WebDAV", "MOLTEN_WEBDAV_PASSWORD") become
  host-neutral ("through the host's file plane") with the host naming its own variable.
- **Registration names are the operator's.** `foundry-molten5e` / `foundry-local5e` are local
  names in `~/.claude.json`; the house modules (`fvtt-mod-fxstudio` …) reference them, so the
  rename does not touch them. The template (`.mcp.json.example`) shows the neutral form.

## Work items

| # | Item | What changes | Size |
| --- | --- | --- | --- |
| 1 | **design.md + this tracker** | mission line, a new binding principle (§2.6 host-agnostic core), §4 rows for 2.2 and the 3.0 marker, §9 snapshot | 30 min |
| 2 | **Host seam** — `src/hosts/**` | `Host` (`kind`, `label`, `wake?`, `redact`, `unreachableHint`, `files`, `publicUrl`) and `FilePlane` (`list stat exists read write mkdir ensureParents remove move copy`); `molten` (Magic-URL wake + `WebDavClient` as the plane), `local` (no wake; `node:fs` plane over `LOCAL_FOUNDRY_DATA`), `generic` (URL only, no plane). `foundry.ts` loses `magicUrl` and takes `host`; the admin-key `/setup` launch stays in the bridge — it is Foundry's own page, every host has it | 2–3 h |
| 3 | **One env selector** — `src/hosts/env.ts` | `resolveHostConfig(env)`: `FOUNDRY_HOST=molten\|local\|generic` (`FOUNDRY_PROFILE=local` still honoured); the same `LOCAL_* → MOLTEN_*` fallbacks as before, in ONE place. `config.ts`, `scripts/lib/bridge-config.mjs` and `tests/integration/setup.ts` all call it; the ten scripts that hand-rolled a `magicUrl` config go through `bridgeConfig()` | 1 h |
| 4 | **Asset tools over the plane** — `tools/molten/**` → `tools/assets/**` | `AssetFileTools` takes the `Host`; every handler talks to `host.files` and `host.publicUrl`; `export-chat-log` / `send-chat-message` image embedding likewise. The world-DB write refusal and path canonicalisation move to `hosts/paths.ts` (they are Foundry facts, not WebDAV facts). **New capability that falls out:** the asset tools work on the sandbox | 1.5 h |
| 5 | **`get-world-info` reports the host** | `host: { kind, label, files: 'webdav' \| 'local' \| 'none' }` so a session can tell which instance and which plane it is on | 20 min |
| 6 | **Toolsets** — `FOUNDRY_TOOLSETS` | every tool carries a toolset tag in the registry (`world actors items compendium scenes journals tables cards audio chat combat assets organization`); a comma list in the registration's env advertises only those. Unset = all (skills need the full surface). A call to a tool outside the enabled set is refused by name, not "unknown tool" | 1 h |
| 7 | **Rename** → `fvtt-mcp-dnd5e` | `package.json`, README, `.mcp.json.example`, `design.md`, CLAUDE.md, the GitHub repo (`gh repo rename`) + remote. The working directory is renamed by the owner (open handles: the running MCP processes and this session hold it) — the registrations in `~/.claude.json` and the memory dir follow the path | 45 min |

## Decisions

- **Wake rides the page.** `Host.wake(ctx)` gets `{ goto(url) }` from the bridge and the Molten
  host navigates the real browser to the Magic URL, exactly as before (proven live on every cold
  start since 2026-06). No Playwright type crosses into `hosts/`.
- **`/setup` launch is not host code.** Authenticating to `/setup` with the admin key and posting
  `launchWorld` is Foundry's own admin flow; `LOCAL_ADMIN_KEY` / `MOLTEN_ADMIN_KEY` both feed it.
- **The local plane is real, not a stub.** `LOCAL_FOUNDRY_DATA` already exists in `.env` for the
  sandbox launcher; the same directory is the file plane. The world-DB refusal applies exactly as on
  WebDAV — a running Foundry holds the LevelDB open and a filesystem write corrupts it just the
  same.
- **Public URLs are a Foundry fact.** Every host serves `Data/` at the server root
  (`<serverUrl>/<data-relative path>`), so `publicUrl` is one implementation with the host's URL.
- **Backward compatibility, deliberately:** `FOUNDRY_PROFILE=local` keeps working (an alias for
  `FOUNDRY_HOST=local`); every `MOLTEN_*` / `LOCAL_*` variable keeps its meaning; every tool name is
  unchanged; the `send-chat-message` `embed: "webdav"` value stays accepted as an alias of `upload`.

## Verification

Offline gate before and after each commit (`npm run check && npm run typecheck && npm test && npm
run build && npm run knip`). Live, on the sandbox (`FOUNDRY_HOST=local`):

- `scripts/verify-wake.mjs` semantics on a local host: no wake, straight to `/join`.
- `get-world-info` over a real MCP session reports `host.kind: local`.
- The asset tools against `LOCAL_FOUNDRY_DATA`: `create-asset-folder` → `upload-asset` →
  `asset-info` → `list-assets` → `copy-asset` → `move-asset` → `delete-asset` on a `ZZ-*` path,
  world-DB path refused, cleaned in `finally` (`scripts/verify-asset-plane.mjs`).
- `FOUNDRY_TOOLSETS=world` advertises only that set; a call outside it is refused by name.
- `FOUNDRY_PROFILE=local RUN_LIVE=1 npm run test:integration`.

## Milestones

- [ ] **2.2.0 — hosts, toolsets, rename** (#1–#7).

### Progress

- 2026-09-20 — measurements taken; owner decisions recorded (name, 3.0 scope); tracker opened.
- 2026-09-20 — **#2 #3 #4 #5 built.** `src/hosts/**` (types, paths, webdav, local-files, molten,
  local, generic, env, index); `foundry.ts` takes a `host` and no longer knows a Magic URL;
  `tools/molten/**` → `tools/assets/**` over the plane; `export-chat-log` / image embedding
  likewise; `get-world-info` carries `host`; one selector for the server, `bridge-config.mjs`
  and the integration harness (the ten hand-rolled scripts attach `hostFor(env)`). Offline gate
  green (1724 unit tests, +49 new for the hosts). **Live on the sandbox:**
  `FOUNDRY_HOST=local node scripts/verify-asset-plane.mjs` 28/28 (the full asset cycle on the
  local plane, the world-DB / traversal / overwrite refusals, bridge connect through the host,
  `get-world-info.host = { kind: local, files: local filesystem }`, reference-checked delete);
  `FOUNDRY_PROFILE=local node scripts/verify-reads.mjs` 25/25 (the alias);
  `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` 85 passed / 1 pre-existing skip — the
  chat suite's remote-export test now runs on the sandbox through the local plane instead of
  skipping.

## Parked for 3.0 — CRUD consolidation (owner, 2026-09-20: out of scope for 2.2)

70 of the 151 tools are `list/create/update/delete-X` across 17 families (the eight placeable
kinds — walls, lights, tiles, sounds, drawings, regions, notes, tokens — plus items, tables,
journals, actors, folders, scenes, playlists, cards, macros). A `placeables` tool with `kind` + `op`
(and the same for the document families) would fold ~40 tools into a handful and cut the advertised
surface by roughly a third. It is the single biggest context lever left after toolsets — and it
changes every skill that names those tools, so it is a **3.0** change, planned in its own doc with
the skills updated in the same line. Not to be started inside 2.x.
