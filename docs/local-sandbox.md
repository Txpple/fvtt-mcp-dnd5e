# Local sandbox — a Foundry install on this machine

A second Foundry on your own machine, registered as `FOUNDRY_HOST=local`
([hosts.md](hosts.md)), is where tool and module development happens: test loops don't pay a
hosted box's wake and latency, and nothing touches the world you play in until you mean it. It
is used as much as the played world — the companion modules are developed against it — so it
carries the full tool surface, not a demoted subset.

There are two ways to have one:

- **Your own local install with its own world** — install Foundry, make a world (or import one
  from a backup), point the server at it. Nothing else is needed; this page's first half is that.
- **A mirror of a hosted world** — a byte copy of the world you play in, refreshed on demand. That
  is the ops section at the end; it needs the hosted instance's file plane.

## First-time setup

1. Install Foundry VTT on this machine — the same generation as the world you will copy or play
   (v14, at or above the build the README pins), sign the license, set an admin password.
2. Launch it once so the data directory exists (`%LOCALAPPDATA%\FoundryVTT\{Config,Data}` on
   Windows; `~/.local/share/FoundryVTT` on Linux; `~/Library/Application Support/FoundryVTT` on
   macOS), then quit.
3. In the repo `.env` (see `.env.example`): `FOUNDRY_DATA_DIR=<that Data dir>` — the `local`
   host's direct file plane — and `FOUNDRY_ADMIN_KEY=<the admin password>` (world launch and
   world stop are admin-gated). `FOUNDRY_URL` defaults to `http://localhost:30000`; set
   `FOUNDRY_APP` only if the app is not at the platform's default install path.
4. Create or import a world, and in it the user the bridge joins as (`FOUNDRY_USER`, default
   `MCP-Claude`, role Gamemaster or Assistant GM). A world imported from a backup already carries
   its users and their passwords.
5. Register the server as `foundry-sandbox` with `"env": { "FOUNDRY_HOST": "local" }`
   ([`.mcp.json.example`](../.mcp.json.example)). `get-world-info` on it should answer
   `host: { kind: "local", files: "local filesystem" }`.

## Running it headless (no desktop window)

`scripts/local-foundry.mjs` runs the same server the desktop app wraps — the install's
`resources/app/main.js` under plain Node — with no Electron window (the app pays for a Chromium
instance nobody looks at; the bridge talks HTTP/WebSocket, and a human who wants eyes on the
world opens a browser tab). Same data directory, same port, same worlds; the desktop app still
works whenever the headless server isn't running (they can't run together — the data-directory
lock).

```bash
node scripts/local-foundry.mjs start      # boot server + launch the world (idempotent)
node scripts/local-foundry.mjs stop       # deactivate the world (the DB flush), end the process
node scripts/local-foundry.mjs status
node scripts/local-foundry.mjs restart
```

`start --no-world` boots to Setup only; `stop` refuses while users are connected
(`disconnect-bridge` first) and `--force` overrides. Server console output appends to
`<dataPath>/Logs/headless-console.log`; the pid rides `Logs/headless.pid`. The launcher passes
`--adminPassword` at boot so Foundry rewrites `Config/admin.txt` itself: the installed hash can
never drift from `.env`. With several worlds under `Data/worlds`, set `FOUNDRY_WORLD_ID`.

The v14 admin API it rides (the script header has the detail): admin posts carry
`adminPassword` in the JSON body — no `/auth` login, no session cookie — and since 14.368 every
POST must also carry a same-origin `Origin` header. `launchWorld` is a `/setup` action that only
exists while NO world is active; stopping a world is `POST /setup {action: "worldShutdown"}`
(the one `/setup` action that exists while a world IS active; the old `/join {action:
"shutdown"}` route answers `{}` and does nothing since 14.368); there is no process-exit route,
so `stop` deactivates the world (`db.disconnect` + `world.save`) and then ends the Setup-idle
process.

Foundry holds an exclusive **lock on the whole data directory** — any second Foundry process
against the same `dataPath` dies with "cannot start in this directory which is already locked by
another process". That is also why CLI flags like `--adminPassword` can't be applied while the
app is up. (A *killed* process leaves `Config/options.json.lock` behind; Foundry treats it as
stale after ~10 s, and the launcher's `start` waits that window out automatically.)

## What the local host does differently (deliberate)

- **The direct file plane is the install's `Data/` directory** (`FOUNDRY_DATA_DIR` — the same
  directory the launcher serves) over `node:fs` — so the asset file tools (`upload-asset`,
  `list-assets`, …) work on the sandbox with exactly the WebDAV contract, including the live
  world-DB refusal. Without it they still work through Foundry's own FilePicker (the bridge
  plane — no delete / move). A local-host process never dials WebDAV.
- **No wake plumbing** — a local box doesn't sleep; if it isn't running the bridge fails fast
  naming `scripts/local-foundry.mjs start`.
- **World launch needs the admin key** — with `FOUNDRY_ADMIN_KEY` set the bridge auto-launches a
  cold instance exactly like a hosted one; without it you click Play yourself.
  Counter-intuitively, an admin-*less* Foundry v14 is *less* automatable, not more: it accepts a
  `launchWorld` POST but refuses remote shutdown / return-to-setup with 403 `InvalidAdminKey`, so
  there is no way back to Setup without the desktop UI.

  To set one on an install that has none, let Foundry hash it rather than writing
  `Config/admin.txt` by hand — start it once with `--adminPassword=<pw>` and it writes the file
  itself. That needs the data-directory lock, so the app must be stopped. If it is running and
  you don't want to interrupt it, generate the file from a throwaway data dir
  (`--dataPath=<tmp> --port=30099 --adminPassword=<pw>`) and copy its `Config/admin.txt` across:
  the hash is portable between installs whose `options.json` has `passwordSalt: null` (Foundry
  falls back to a build constant), and it takes effect at the next restart. Put the same
  plaintext in `FOUNDRY_ADMIN_KEY`. To undo: delete `Config/admin.txt`.

## Testing a companion module against it

The house-module repos (`fvtt-mod-*`, beside this one) are exercised against the sandbox without
risking the played world:

```bash
node scripts/deploy-house-module.mjs fvtt-mod-battleflow --local
```

`--local` writes the module's served files straight into the sandbox's `Data/modules/` (same
byte read-back proof as the hosted path). The loop is: edit the module → `--local` → reload the
local world → drive assertions through the sandbox registration's tools or a
`scripts/verify-*.mjs` run pointed at it → only when it's green, deploy for real. A brand-new
module still needs registering — Foundry scans the package registry at process boot, so a module
that has never been installed needs `scripts/register-module.mjs` (or a process restart), not
just a file drop. The scripts are described in [`../scripts/README.md`](../scripts/README.md).

---

## Ops: mirroring a hosted world into the sandbox

When the sandbox is a copy of the world you play in, content flows **one way** and code flows
the other:

| What | Direction | How |
| --- | --- | --- |
| **Content** — world DB (actors, items, journals, scenes…), assets, installed modules & systems | **hosted → local, only** | `scripts/pull-prod-to-local.mjs` |
| **Code** — house modules | **local → hosted, only** | `scripts/deploy-house-module.mjs` (+ `register-module.mjs` for a new module) |
| **MCP server** (`src/**`) | never deployed anywhere | runs on this machine; point it at whichever instance |

Content authored in the sandbox is **throwaway by definition** — the next refresh overwrites it.
If something built locally turns out to be keeper content, run the same tool calls against the
hosted world (or use Foundry's own export / import); never hand-copy world DB files upward. The
hosted world's DB stays pure; there is no local → hosted sync.

### Refreshing

```bash
node scripts/pull-prod-to-local.mjs        # --dry-run to see the plan
```

The script reads the hosted instance through the `molten` host's WebDAV plane (or a `generic`
host's `FOUNDRY_WEBDAV_*`), and:

1. **Wakes the hosted instance** if asleep (its wake URL) — WebDAV needs it live. *This is its
   first step even under `--dry-run`.*
2. **Guards both LevelDBs**: refuses while the hosted world has users connected (a mid-write
   snapshot would tear), and refuses while the *local* Foundry has the world active (same risk,
   receiving side). Hosted idle-but-active (0 users) and local-on-setup-screen are both fine.
3. **Mirrors** `worlds/<id>` + `systems` + `modules` + `assets` into `FOUNDRY_DATA_DIR`:
   incremental (size + mtime — a no-change refresh downloads nothing), and **deletes local files
   that no longer exist on the source**. The delete half is load-bearing for the world: a stale
   `.ldb` / `MANIFEST` mixed into a fresh LevelDB set corrupts it.
4. The remote side is strictly **read-only** (GET / PROPFIND) — a refresh cannot harm the source.
5. **Verifies the world DB is openable** — every LevelDB collection must have exactly one
   `MANIFEST-*` and a `CURRENT` naming a manifest that exists.

Flags: `--dry-run`, `--force` (override both activity guards), `--no-delete` (copy without
mirroring), `--to <dataRoot>` (override `FOUNDRY_DATA_DIR`), explicit targets
(`node scripts/pull-prod-to-local.mjs modules/<name>`). After a refresh: **restart** the local
Foundry if it was running (Foundry scans the package registry at process boot — freshly pulled
modules / systems won't register into a running process), re-deploy any module under test
(`--local` again — the mirror overwrote it), then launch the world.

### Refreshing while Foundry is running

The local Foundry must be **fully stopped**, not just returned to Setup. A running process keeps
LevelDB handles open on the very files being replaced, and can write its stale in-memory state
back over the fresh copy after the pull finishes. The script's local guard catches an *active
world*, but stopping the process is the actual requirement:

1. `curl -s http://localhost:30000/api/status` — is a world active, and how many users?
2. If the MCP bridge is one of them, `disconnect-bridge` first so no Playwright session is
   dangling (`list-users` shows who is really connected — check no human is mid-session).
3. Stop the server **gracefully**. Headless: `node scripts/local-foundry.mjs stop`. Desktop app:
   close it with `CloseMainWindow()` on the process, never `Stop-Process` — it shuts the world
   down and releases the LevelDB cleanly; a hard kill risks the local DB and the file locks may
   outlive the process.
4. Confirm the port is free, then run the refresh.
5. Relaunch Foundry and launch the world — headless, that's `node scripts/local-foundry.mjs
   start` again.

### What is deliberately not pulled

- **`Config/`** — license, admin password, `options.json` (port, dataPath) are per-machine. The
  local install keeps its own.
- **`Logs/`, `Backups/`** — the hosted instance's own machinery.

World **users ride the world DB**, so the same join identities (the GM, the bridge user, the
players) exist in the sandbox with the same passwords.

### Version rule

The local Foundry **app** must be the same generation as the source at ≥ its build. The script
prints the pulled world's `coreVersion` / `systemVersion` after every refresh. The dnd5e system
itself is mirrored, so it always matches the world — only the app binary is a manual install.
A hosting provider's own modules (a sleep-watch, a panel bridge) ride along in `modules/`; they
are harmless locally.

When the hosted world is still on the pre-3.0 stack (Foundry 14.364 / dnd5e 5.3.x), the sandbox
is where the upgrade is rehearsed: its app is already ≥ 14.367, so a pulled 5.3 world can be
taken to dnd5e 6.x here first, and the hosted world follows the same order — Foundry, then dnd5e
([hosts.md](hosts.md#bringing-a-world-up-to-the-30-line)). Until it does, every refresh mirrors
the 5.3 system back down with the world, and the pulled world has to be taken to 6.x again (the
system update + the migration; the app is already new enough) before the 3.0 tools will author
on it — a refresh of a 5.3 source is never "ready to play" on this line by itself.
