# scripts/ — the live proof, the sandbox toolkit, the measurements

Every script here reads the family `.env` through `dist/env.js` (`loadEnv`) and targets the host
`FOUNDRY_HOST` selects, exactly as the server does (`src/hosts/env.ts`): `FOUNDRY_HOST=local` is
the sandbox, `molten` the owner's prod box, unset = `generic` (whatever `FOUNDRY_URL` names — a
placeholder is refused before any connect). Build first (`npm run build`): the scripts import the
built bridge, never the MCP process, so they exercise a fresh `dist/` without a Claude Code
restart. One world-driver at a time; temp documents are tagged `ZZ-*` and cleaned in `finally`.

## The release set (12) — `docs/RELEASE.md`

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
| `verify-scene-tools` | `create-scene` (sidecar by `placeablesPath`), `update-scene`, the view tools |
| `verify-cast-activity` | `add-free-cast` and the cast activity |
| `verify-region-tooling` | the regions kind of `manage-placeables`: create / add-behavior / update |

## The other tool verifies (≈ 45)

`verify-<family>.mjs` — one script per tool family or per fix that needed a live proof
(`verify-cards-tooling`, `verify-journal-tooling`, `verify-token-reskin`, …). Same conventions;
run the ones that touch what you changed. Three of them are infrastructure proofs rather than
tool proofs:

- `verify-wake` — **DESTRUCTIVE**: takes the world down and proves the cold bring-up (wake →
  `/setup` launch → `/join`); it refuses to run without an explicit `FOUNDRY_HOST`.
- `verify-asset-plane` — the file plane on the selected host: the direct plane (WebDAV / the
  local `Data/`) and the bridge plane (Foundry's own FilePicker through the page).
- `verify-toolsets` — the `FOUNDRY_TOOLSETS` registration filter (offline).
- `prove-bridge` — the smallest possible live round trip (connect, one `foundry.call`, dispose).
- `verify-error-contract` — the error contract end to end (read-only): a page-side `PageError`
  code crosses `page.evaluate` in the Error's name, comes back as a `BridgeError`, the mapper
  appends one hint per code, a dead URL is `connection`.

## The sandbox toolkit (owner-ops; `docs/local-sandbox.md`)

| script | does |
| --- | --- |
| `local-foundry` | run the LOCAL install as a headless server: `start` / `stop` / `restart` / `status` (the `local` host's launcher; `FOUNDRY_DATA_DIR`, `FOUNDRY_ADMIN_KEY`; the world id from `FOUNDRY_WORLD_ID` or the one world under `Data/worlds`) |
| `pull-prod-to-local` | re-image the sandbox from the prod box (a byte copy, prod → local, the only direction content flows) |
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
  `clean-stale-ownership`), `fvtt-mod-soundscape/tools/` (`verify-soundscape`),
  `fvtt-mod-soundscape-sfx/tools/` (`upload-soundscape-library`, `remap-soundscape-scene-paths`).
- The spikes that de-risked a design (`spike-*.mjs`) are archived under `docs/history/spikes/`
  — reading material, not runnable against today's `dist/`.
- `reload-clients` (battleflow owns the used copy), `register-partystash` (generalized into
  `register-module`), and the one-offs `party-stats`, `read-user-avatars`, `reveal-scene-fog`,
  `repair-orphaned-container-refs` are gone; git history has them.
