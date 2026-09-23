# Hosts — where Foundry runs, and how the server reaches it

The server drives a Foundry world through Foundry's own client (a headless Chromium joins as a
user). Where that world runs — a hosting provider, this machine, any URL — is a **host**: a preset
over a few facts, chosen per MCP registration with `FOUNDRY_HOST`, and the only place in the code
that knows one host from another is `src/hosts/**` ([design.md §2.6](../design.md)). A new user
sees one variable set, `FOUNDRY_*`.

## The three presets

| `FOUNDRY_HOST` | Means | Wake | Direct file plane |
| --- | --- | --- | --- |
| `generic` (default) | any Foundry at a URL | `FOUNDRY_WAKE_URL` if set | `FOUNDRY_DATA_DIR` or `FOUNDRY_WEBDAV_*` if set |
| `molten` | [Molten Hosting](https://moltenhosting.com) | the panel's "Server Startup / Magic URL" (`FOUNDRY_WAKE_URL`) | WebDAV, its URL and user derived from `FOUNDRY_URL`; only `FOUNDRY_WEBDAV_PASSWORD` is needed. Never a filesystem plane |
| `local` | a Foundry install on this machine ([local-sandbox.md](local-sandbox.md)) | none — a local process does not sleep; if it is down the error names the launcher | `FOUNDRY_DATA_DIR` (the install's `Data/`). Never WebDAV. `FOUNDRY_URL` defaults to `http://localhost:30000` |

`get-world-info` reports the host it is on: `host: { kind, label, files }` — `files` is the plane
the asset tools are using (`local filesystem`, `WebDAV`, or `bridge (FilePicker)`).

## The facts (the variables)

Every host reads the same names; a preset only changes the defaults and which ones apply.

- **`FOUNDRY_URL`** — required; the placeholder in `.env.example` is refused at startup.
- **`FOUNDRY_USER`** / **`FOUNDRY_PASSWORD`** — the dedicated user the bridge joins as (create it in
  Foundry: Users → Create User, role Gamemaster or Assistant GM; default name `MCP-Claude`). A
  lower role is warned about at connect and every write fails.
- **`FOUNDRY_ADMIN_KEY`** — the admin access key. With it the bridge launches the world itself when
  the instance is up but no world is active; without it you launch the world by hand.
- **`FOUNDRY_WORLD_ID`** — only when `/setup` lists more than one world; unset = the one world there
  is launched (discovered on `/setup`).
- **`FOUNDRY_WAKE_URL`** — a GET that wakes a sleeping instance; redacted from every log line and
  error. A host without one is expected to be up.
- **A direct file plane** (optional) — `FOUNDRY_DATA_DIR` (the install's `Data/`, when it is on
  this machine) or `FOUNDRY_WEBDAV_URL` / `_USER` / `_PASSWORD` (a WebDAV endpoint over `Data/`).
- **`FOUNDRY_TOOLSETS`** — per registration, a comma list of the toolsets to advertise (below).

The 2.x names (`MOLTEN_*`, `LOCAL_*`, `FOUNDRY_PROFILE`) are still read as aliases under their own
host and logged once at startup; `.env.example` lists the mapping. An alias wins over the
canonical name under its host, which is what lets one 2.x-layout `.env` keep serving two
registrations.

## One registration per instance

A registration's `env` block beats the shared `.env`, so one `.env` serves every registration and
each registration sets only what differs — which instance (`FOUNDRY_URL`) and how it is reached
(`FOUNDRY_HOST`). Which instance a tool call touches is fixed by which server it goes to; there is
no runtime "switch instance" state. The documented pair is in [`.mcp.json.example`](../.mcp.json.example):
`foundry` (your world) and `foundry-sandbox` (`FOUNDRY_HOST=local`). The skills name tools bare;
when more than one Foundry is registered they use the one you named.

## The two planes

- **Plane A — the live bridge.** World documents (actors, items, journals, scenes, compendia,
  tables, cards, ownership) go through the headless client while the server is awake — the only
  safe way to read or write live world data. The client connects **lazily**: `tools/list` answers
  without touching Foundry; the first real tool call wakes the instance (if it sleeps), launches
  the world (if it can) and joins.
- **Plane B — the file plane.** The asset file tools (`upload-asset`, `list-assets`, …) work on
  every host through Foundry's own FilePicker via the bridge (browse / upload / mkdir; media and
  text formats). A **direct** plane — the `Data/` directory or WebDAV — is the fast path for bulk
  work, takes any file type, and is the only way `delete-asset` / `move-asset` work. A tool that
  needs what the current plane cannot do refuses by name and says which variable would enable it.

**Safety rule:** a running world's database (`Data/worlds/<world>/data/`) is never written over
the file plane — that corrupts it. The write tools refuse world-DB paths; bulk DB edits are an
offline flow (stop → back up → `fvtt unpack` → edit → `fvtt pack` → start, with
[foundryvtt-cli](https://github.com/foundryvtt/foundryvtt-cli)). A hosting provider's management
panel is never scripted; only the wake GET, WebDAV and the Foundry server itself are automated.

## Toolsets — advertise less

The full surface is 81 tools, ~56k tokens of `tools/list`. A client that loads MCP schemas
eagerly pays that per registration before the first word (Claude Code defers them and lists only
names). A registration that only does part of the job can say so:

```json
"env": { "FOUNDRY_HOST": "molten", "FOUNDRY_TOOLSETS": "chat,combat" }
```

| Toolset | What it holds |
| --- | --- |
| `session` | `get-world-info`, `get-current-scene`, `disconnect-bridge`, `list-users` — **always on** |
| `settings` | `update-user`, `set-user-avatar`, the dnd5e automation switches, the calendar |
| `actors` | NPCs and PCs: sheets, effects, activities, inventory, groups, art, ownership |
| `items` · `compendium` · `journals` · `tables` · `cards` · `audio` | the document families |
| `scenes` | scenes, who-sees-what routing, every placeable kind |
| `chat` · `combat` | the chat log; combat tracker + analytics |
| `assets` | the Plane-B file tools + reference integrity |
| `organization` | folders, moves, bulk delete, macros |

Unset = everything (the bundled skills need the whole surface). A call to a tool outside the
enabled set is refused **by name** — which toolset it is in and how to enable it — never as
"unknown tool"; a misspelt toolset stops the server at startup with the valid names. The table is
[`src/toolsets.ts`](../src/toolsets.ts).

## Bringing a world up to the 3.0 line

The 3.0 tools refuse to author against a pre-6.0 dnd5e world, and dnd5e 6.x declares
`minimum: 14.367` for Foundry — so a world still on the 2.x-era stack (Foundry 14.364, dnd5e
5.3.x) is upgraded in **this order**, and the order is not optional:

1. **Foundry first, to ≥ 14.367** (14.368 is what this line is verified on). On a hosting
   provider that is the panel's Foundry version; on a local install it is the app. Two things
   changed on the way that the server already handles — the `/join` user field became a free-text
   input at 14.367 (the bridge joins either shape) and every POST must look same-origin from
   14.368 (the launcher sends `Origin`) — so a 14.36x server and a 14.368 server are both
   reachable; only the dnd5e install below needs the newer one.
2. **Then dnd5e, to 6.x** (6.0.5 verified — take the latest 6.0.x: 6.0.0–6.0.3 delete every
   actor effect that has no expiry on a short or long rest): update the system from Foundry's
   Setup screen, then launch the world and let dnd5e run its migration to completion before
   anything else joins — the migration rewrites every actor and item once, and a bridge that
   joins mid-migration reads half-converted documents.
3. **Then this server:** `get-world-info` reports `system.version` and `foundry.version`; the
   writing tools gate on the dnd5e version they detect at the first call (a refusal names the
   version it saw), so nothing is configured on this side. Existing world content is untouched
   by the upgrade (the migration is dnd5e's, not ours); content the tools author afterwards is
   6.x-shaped (activities, the 2024 traits) and does not read back on a 5.3 world.

Back out is a world backup taken **before step 1** — a dnd5e migration is one-way. On a mirrored
setup ([local-sandbox.md](local-sandbox.md)) upgrade the sandbox app first (it must be ≥ the
source's build to receive a pull), rehearse steps 1–2 on the mirror, then do the hosted world.
The line before this one, 1.5.2, is the last release that speaks dnd5e 5.3.x.

## When it cannot connect

The error names the variable or the step, and the host adds its own hint:

- `local` — "Is the local Foundry running? Start it with `node scripts/local-foundry.mjs start`."
- a host with a wake URL — "Check `FOUNDRY_URL` / `FOUNDRY_WAKE_URL`, and that the instance
  actually woke." A cold managed box can take 30–60 s; retry once before concluding anything.
- any other — "Check `FOUNDRY_URL` and that the world is launched on that server." Without
  `FOUNDRY_ADMIN_KEY` the bridge cannot launch a world; launch it from `/setup`.
- a join that fails naming users — `FOUNDRY_USER` does not exist on that world (Foundry's `/join`
  form exposes nothing, so the bridge fails fast with the real names).

The same selector serves the scripts and the integration suite (`FOUNDRY_HOST=local node
scripts/verify-*.mjs`, `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`) and the library
surface the sister repos import (`connectFoundry({ host })` from `fvtt-mcp-dnd5e/client` —
[contracts.md](contracts.md)).
