# scripts/ — the live proof, the sandbox toolkit, the measurements

Every script here reads the family `.env` through `dist/env.js` (`loadEnv`) and targets the host
`FOUNDRY_HOST` selects, exactly as the server does (`src/hosts/env.ts`): `FOUNDRY_HOST=local` is
the sandbox, `molten` a Molten-hosted box, unset = `generic` (whatever `FOUNDRY_URL` names — a
placeholder is refused before any connect). Build first (`npm run build`): the scripts import the
built bridge, never the MCP process, so they exercise a fresh `dist/` without a Claude Code
restart. One world-driver at a time; temp documents are tagged `ZZ-*` and cleaned in `finally`.

## The release set (14) — `docs/RELEASE.md`

`FOUNDRY_HOST=local node scripts/<name>.mjs`, sequentially; counts go into the commit message.

| script | proves |
| --- | --- |
| `verify-effects-6` | the dnd5e 6.x ActiveEffect surface (conditions, rules changes that fire in real rolls, expiry) |
| `verify-region-effects` | Region behaviors and the effects they apply |
| `verify-activities-6` | `manage-activity` on the 6.x activity model |
| `verify-settings-calendar` | `configure-dnd5e-settings` + `manage-calendar` (worldTime restored) |
| `verify-item-tooling` | the item CRUD family |
| `verify-actor-tooling` | the actor CRUD family + projections |
| `verify-pc-build` | `create-pc` / `level-up-pc` / advancement (zero unresolved `@scale`) |
| `verify-teleporter-scene-fields` | the teleporter create / remap (`manage-placeables`, kind regions) and the scene fields they read |
| `verify-placeables-tooling` | the 32 placeable tools on the active scene |
| `verify-scene-tools` | `manage-scenes` `create` (sidecar by `placeablesPath`) / `update`, the view tools |
| `verify-cast-activity` | `add-free-cast` and the cast activity |
| `verify-region-tooling` | the regions kind of `manage-placeables`: create / add-behavior / update |
| `verify-receipts` | the receipt every write answers with (issue #6), through the registry as the server answers: an actor, a light and a journal page, each created, updated and deleted and undone by its receipt id; the redo, once; a run-script run; two writes in flight, each undo only its own; the store's refusal of a wrong id; a partial undo, which leaves its receipt undoable; an undo with nothing to put back (the value restored by hand), which still marks its receipt undone; a run abandoned at its timeout with its creates in flight, which land in its own receipt; two run-script calls issued together, run one after the other with no op-cap time lost to the wait (about 35 s); the cost of the page's choke point, timed in the page |
| `verify-toolsets` | the `FOUNDRY_TOOLSETS` registration filter over the real stdio server, no world needed: a selection, a misspelt name, and `readonly` (only the reads advertised, a write refused by name before the bridge connects, `readonly` beside a toolset refused at startup) |

## The other tool verifies (49)

`verify-<family>.mjs` — one script per tool family or per fix that needed a live proof
(`verify-cards-tooling`, `verify-journal-tooling`, `verify-token-reskin`, …). Same conventions;
run the ones that touch what you changed. Some of them are infrastructure proofs rather than
tool proofs:

- `verify-wake` — **DESTRUCTIVE**: takes the world down and proves the cold bring-up (wake →
  `/setup` launch → `/join`); it refuses to run without an explicit `FOUNDRY_HOST`.
- `verify-asset-plane` — the file plane on the selected host: the direct plane (WebDAV / the
  local `Data/`) and the bridge plane (Foundry's own FilePicker through the page).
- `verify-holders` — the seat records: two bridges on one seat (one in a forked child; the second
  to join warns that the seat is held twice, and what that means for receipts), and
  `disconnect-bridge { all }` from one ends the other's browser by its recorded pid and
  executable, leaves a decoy record whose pid runs another program alone, keeps a record that
  names no browser (still named afterwards), and the evicted bridge re-joins on its next call; an
  eviction made while connected leaves the bridge's own browser alone when another record names
  its pid. Touches no world document.
- `verify-bridge-status` — `get-world-info`'s `bridge` block through the registry's own dispatch:
  the renderer, the canvas, the three Open Roll 5e modules, the seat's `since`, the server version
  and `toolsets`; a second registry built `readonly` warns that the joined user can write. Touches
  no world document.
- `prove-bridge` — the smallest possible live round trip (connect, one `foundry.call`, dispose).
- `smoke-bridge` (`npm run smoke:bridge`) — the upgrade review's live check: joins as the bridge
  user, prints one PASS/FAIL line with the host kind, its Foundry and dnd5e versions, Chromium's
  renderer and the Open Roll 5e modules (no URL, no world name, so it can go in a public issue).
  Read-only.
- `doctor` (`npm run doctor`) — the setup check, one line per item, exit 1 on any ✗: Node, the
  build, Playwright's Chromium, the `.env`, the Foundry app (local), Foundry, the admin key (only
  with no world running), the world, a login as `FOUNDRY_USER` with its role, the bridge's
  renderer and modules (a ! when it renders in software or a module is not active). Read-only; it
  never launches a world (the admin key is withheld from its login) and does not wake a sleeping
  box.
- `init` (`npm run init`; `-- --help` for the flags) — the setup in one command: it says first
  that the Foundry user must exist (it cannot create one), asks for the connection (or takes it as
  flags; `--yes` asks nothing), writes the `.env` (an existing one copied to `.bak` and changed in
  place) and the registration (this clone's `.mcp.json`, another project's, or `~/.claude.json`,
  copied to `.bak-<time>` first; never a secret), runs the doctor on them, and prints the entry as
  an `mcpServers` block for any other MCP client. `scripts/lib/preflight.mjs` holds the Node and
  build checks it shares with the doctor.
- `verify-error-contract` — the error contract end to end (read-only): a page-side `PageError`
  code crosses `page.evaluate` in the Error's name, comes back as a `BridgeError`, the mapper
  appends one hint per code, a dead URL is `connection`.

## The sandbox toolkit (`docs/local-sandbox.md`, `docs/hosts.md`)

| script | does |
| --- | --- |
| `local-foundry` | run the LOCAL install as a headless server: `start` / `stop` / `restart` / `status` (the `local` host's launcher; `FOUNDRY_DATA_DIR`, `FOUNDRY_ADMIN_KEY`; the world id from `FOUNDRY_WORLD_ID` or the one world under `Data/worlds`) |
| `pull-prod-to-local` | re-image the sandbox from a hosted world (a byte copy, hosted → local, the only direction content flows; it wakes the source first, even under `--dry-run`) |
| `deploy-house-module` | copy a built house module into a host's `Data/modules` through its file plane and byte-verify it (`--local` for the sandbox, `--check` to compare only) |
| `register-module` | install a module on the running server through Foundry's own `/setup` package installer (the box scans `Data/modules` at process start only) |
| `configure-modules` | enable / disable world modules (`core.moduleConfiguration`) through the bridge |
| `uninstall-modules` | the mirror of `register-module` |

## Measurements — `scripts/measure/`

`npm run measure` prints the context budgets `src/measure.test.ts` ratchets: `schema-decompose`
(tools/list bytes by leaf / description / structure), `schema-toolsets` (per toolset),
`names-cost` (the tool-name list every Claude Code prompt carries), `skills-matrix` (skill ↔
tool references, the M8 checklist), `seam-typing` (the checker's count of `any` / `unknown`
args and returns across the page handlers — 0 / 0 since M6; the `SeamGuard` type in
`src/page/index.ts` is the ratchet). `FOUNDRY_HOST=local node scripts/measure/tool-results.mjs`
is the live 24-call baseline of result sizes.

## What is not here any more (3.0)

- The house modules' own harnesses live in their repos on the declared client contract
  (`import { Foundry, foundryConfig, loadEnv } from 'fvtt-mcp-dnd5e/client'`): `fvtt-mod-lootshelf/tools/`
  (`verify-lootshelf`, `verify-receipt-settings`), `fvtt-mod-partystash/tools/` (`verify-partystash`,
  `verify-partystash-coin`, `shot-partystash-coin`, `audit-partystash-coin-cleanup`,
  `clean-stale-ownership`), `fvtt-mod-areasounds/tools/` (`verify-areasounds`),
  `fvtt-mod-areasounds-sfx/tools/` (`upload-areasounds-library`, `remap-areasounds-scene-paths`).
- The spikes that de-risked a design (`spike-*.mjs`) are archived under `docs/history/spikes/`
  — reading material, not runnable against today's `dist/`.
- `reload-clients` (By the Books owns the used copy), `register-partystash` (generalized into
  `register-module`), and the one-offs `party-stats`, `read-user-avatars`, `reveal-scene-fog`,
  `repair-orphaned-container-refs` are gone; git history has them.
