# Changelog

What changed for a user of the tools and skills, release by release. The measured numbers
(`npm test` budgets, `npm run measure`) ride each entry from 3.0 on. Dates are tag dates.

## Unreleased — 3.0 (the dnd5e MCP: cheaper in context, official 6.x, hosts as endpoints)

Tracked in [`docs/plan-3.0-consolidation.md`](docs/plan-3.0-consolidation.md); measured in
[`docs/architecture-review-2026-09.md`](docs/architecture-review-2026-09.md). The last feature
line — after it the project is in maintenance (compatibility events, bug fixes, premium books).

- **Context.** `tools/list` 283,948 → 201,562 chars; the two-registration name list 11,147 →
  6,153 chars (151 tools → 81); skill descriptions 15,382 → 7,986 chars; the 24-call result
  baseline 154,534 → 101,203 chars with 0 capped and 0 errors. Every tool's prose is contract-only
  (a leaf ≤ 120 chars, a description ≤ 400) and `npm test` ratchets the budgets.
- **The families.** The 17 `list/create/update/delete-X` families are one tool each, selected by
  `action` (and `kind` for `manage-placeables`): `manage-actors` (with `get-entity` / `export`),
  `manage-scenes`, `manage-placeables`, `manage-items`, `manage-journals`, `manage-rolltables`,
  `manage-cards`, `manage-playlists`, `manage-folders`, `manage-macros`; `search-compendium` takes a
  `type`. Every skill re-pointed in the same commit as its family.
- **Results.** One line per record with a header on every list; JSON with a `fields` selector on
  every `get`; a miss is `isError`; the raw Foundry message on every mapped error; a record-level
  cap with a `truncation` stamp; the placeable tools default to the active scene; one search-hit
  shape with a true `totalFound`; unknown arguments refused by name. `search-compendium`'s first
  call 7.8–13.2 s → 175 ms (the index warms at connect).
- **Official dnd5e 6.x.** Pinned to 6.0.3 on Foundry 14.368; the tools refuse a pre-6.0 world.
- **Config.** One variable set on every host, `FOUNDRY_*` (`_URL / _USER / _PASSWORD / _ADMIN_KEY /
  _WORLD_ID / _HOST / _WAKE_URL / _TOOLSETS`, plus `_DATA_DIR` / `_WEBDAV_*` for a direct file
  plane); the default host is `generic`; the 2.x `MOLTEN_*` / `LOCAL_*` names are aliases logged
  once; a placeholder URL is refused at startup; the world id is discovered on `/setup`. The asset
  file tools work on every host through Foundry's own FilePicker (a direct plane is the fast path
  and the only way delete / move work). `get-world-info` reports the host, the bridge user's role
  and which premium books are present.
- **The library.** `fvtt-mcp-dnd5e/client` (`connectFoundry`, `Foundry`, the host seam,
  `loadEnv`) is the declared surface the sister repos import; the scripts are classified (the
  sandbox toolkit stays, module harnesses moved to their repos, spikes archived).
- **Errors.** A coded `PageError` → `BridgeError` contract (`not-found` / `ambiguous` / `invalid`
  / `permission` / `unsupported` / `rolled-back` / `connection`) with one hint per code; the seam
  typed end to end (`foundry.call<N>`).
- **Skills.** Every skill on the trigger-phrase description rule; the campaign-facing skills read a
  campaign repo (`_shared/campaign-repo.md`: `campaign.json` + `STYLE.md`) instead of carrying one
  DM's names and rulings; `start-session` is host-neutral; `tom-cartos-import` imports a pack
  faithfully by default (maps-only and the born-explored stamp are options).
- **Docs.** README rewritten as a plain-English project page; `CONTRIBUTING.md` (the house rules,
  tracked); `docs/hosts.md`, `docs/contracts.md`; the done trackers under `docs/history/`.

## 2.2.0 — 2026-09-20 — a Foundry MCP first, hosts as options

No tool behaviour changed; what changed is what the project is. Renamed `fvtt-mcp-molten5e` →
`fvtt-mcp-dnd5e`: the host left the name and became a seam (`src/hosts/**`, design.md §2.6).

- `FOUNDRY_HOST` = `generic` (any Foundry at a URL) · `molten` (Molten Hosting: the WebDAV plane
  derived from the URL) · `local` (an install on this machine — no wake, the `Data/` directory as
  the file plane). One `.env`, one registration per instance; `FOUNDRY_PROFILE=local` kept as an
  alias. `get-world-info` reports the host.
- `FOUNDRY_TOOLSETS` — a registration advertises a subset of the surface (14 named toolsets,
  `session` always on); an out-of-set call is refused by name.

## 2.1.4 — 2026-09-19 — Foundry 14.368 compatibility

- Every POST to Foundry now carries the same-origin `Origin` header 14.368 requires (the launcher
  and the wake path had started getting 400).
- Teleport Token destinations are stored as relative uuids since 14.368; the teleporter read-back
  and `remap-teleporters` follow.
- `darknessLock` on the scene document.

## 2.1.3 — 2026-09-15 — the 2.1 review fixes

Second-call, edit and combination bugs from the 2.1 review; a dnd5e 6.0 version guard (the tools
refuse to author against a 5.x world); `appliesEffects` on activity read-back.

## 2.1.2 — 2026-09-15

2.1.1 plus a clean listing of a duration-less expiry.

## 2.1.1 — 2026-09-15 — the rest of the dnd5e 6.0 surface

- `manage-activity` — `type: "teleport"` and `type: "transform"` in all three 6.0 modes (by CR
  with profiles, direct link, Select Form), plus `transformSettings`.
- `add-region-behavior` — `dnd5e.rotateArea` with a typed `rotate`.
- `configure-dnd5e-settings` *(new)* — read or set the 6.0 automation switches through an
  allow-list; every change echoes previous → new.
- `manage-calendar` *(new)* — the in-world date and time on `game.time` with the dnd5e calendar:
  read, advance (what triggers dawn / dusk / day recovery and bastion turns), or set.
- The PC leveling engine applies 6.0's ModifyItem advancement as a forced step.

## 2.1.0 — 2026-09-15 — tools for what dnd5e 6.0 introduced

2.0 made the existing tools speak 6.x; 2.1 adds tools for the features 6.0 introduced, so an
authored monster trait, magic item or map area can express what a 2024 book entry can
(`docs/history/plan-2.1-dnd5e-6-features.md`).

- `manage-effect` — conditions (the system's Filter JSON, on the effect or on one change),
  rules-type changes applied at roll time (`dnd5e.advantage` / `bonus` / `minimum` / `maximum`
  on attack / check / d20 / save; bonus on damage / healing), per-change `replacement`, `magical`,
  the full expiry vocabulary. Read-back shows every rule as a sentence; `content-audit` flags a
  dead rules change.
- `manage-activity` — a `duration` override, an area `template` + `affects`, and `behaviors` the
  template carries (`applyActiveEffect`, `difficultTerrain`).
- `add-region-behavior` — `dnd5e.applyActiveEffect` / `dnd5e.difficultTerrain` with effects
  resolved by name, `dispositions`, `sizes`, `creatureTypes`, `terrainTypes`, `magical`.
- `add-item` / `update-actor-item` — `rarity` accepts a list, written natively to
  `system.rarities`.

## 2.0.0 — 2026-09-15 — the dnd5e 6.x line

Targets the D&D 5e system 6.x on Foundry VTT 14 (`docs/history/dnd5e-6.0-compat-review.md`). The
persisted data model moved with 6.0, so 2.0 reads and writes the 6.0 shapes:

- `update-actor` → `ac` speaks the 6.0 model (`override`, `natural`, `calcs`, `formulas`; the 5.x
  `calc` / `flat` / `formula` translated, deprecated).
- `manage-effect` writes `system.changes` and takes a v14 `duration` (`{ value, units, expiry }`).
- `apply-condition` sets exhaustion levels 1–6 through the system's own lever.
- `get-combat-stats`, `list-chat-messages`, `export-chat-log` read 6.0's typed chat messages.
- `post-item-card` reports honestly when a module hook vetoes a use.

## 1.5.2 — 2026-09-15

The last release for dnd5e 5.3.x on Foundry 14.
