# user-facing dimension — notes (2026-09-20)

Read-only review. Measurement scripts: `scratch/user-facing-measure.mjs` (README / scripts / skills
counts), `scratch/user-facing-script-headers.mjs` → `scratch/user-facing-script-headers.txt` (the
header comment of all 99 scripts). Nothing live was touched.

## 1. Clone-and-run walk-through (README.md + .env.example, as a stranger)

Path a stranger follows: README → Requirements (line 231) → Build (241) → Wire into Claude Code
(259) → Configuration (319). What they hit, in order:

1. **230 lines before the first install sentence.** Lines 27–141 are the 2.0 / 2.1 / 2.2 release
   narratives (115 lines, 26% of a 450-line README). `## Requirements` is line 231.
   (`scratch/user-facing-measure.mjs`.)
2. **Requirements still say "hosted on Molten"** (README:238) and Security says "to Foundry on
   Molten" (README:406) — one paragraph after 2.2 declared hosts optional. "molten" appears 35× in
   README, 29× in .env.example.
3. **The default host is the owner's host.** `FOUNDRY_HOST` unset → `molten`
   (`src/hosts/env.ts:44`, `hostKindFromEnv`), serverUrl → `https://your-server.moltenhosting.com`
   (`env.ts:112`). `.mcp.json.example` sets no `FOUNDRY_HOST`. A stranger who registers before
   filling `.env` gets: `probeJoinState` → navigation error → `'booting'` (`src/foundry.ts:252-255`)
   → loop until `wakeTimeoutMs` default **600 000 ms** (`foundry.ts:197`) → "never became joinable
   within 600s … Check MOLTEN_SERVER_URL / MOLTEN_MAGIC_URL". Ten minutes to the first error, and
   nothing at startup says the placeholder is still in place. There is no "is this still
   `your-server`?" guard anywhere in src (`git grep your-server src` → only the default and tool
   examples).
4. **Three registration names in three files.** README:268/273 recommends `foundry-prod` /
   `foundry-sandbox`; `.mcp.json.example:4` ships `foundry-molten5e`; `docs/local-sandbox.md:143-146`
   documents `foundry-molten5e` / `foundry-local5e`; `.claude/skills/start-session/SKILL.md:40,58`
   calls `mcp__foundry-molten5e__get-world-info` literally. A stranger who follows the README's
   example names gets a skill that names a tool they don't have.
5. **The skills have no install step.** README says "Paired with its bundled skills" (line 11) and
   never mentions `.claude/skills/` (0 hits). Project skills load only when Claude Code runs from
   this repo's directory; a stranger who registers the server in `~/.claude.json` and works from
   their own campaign folder gets 151 tools and zero skills — and the skills are "the sell"
   (HANDOFF §C). Nothing says "copy `.claude/skills/*` into your project or `~/.claude/skills`".
6. **The bridge user story is one clause.** README:238 "a dedicated passwordless Foundry user";
   README:162 "joins as a dedicated GM user". There is no step "in Foundry → Users, create a user
   named `MCP-Claude` with role Gamemaster and no password". Nothing at connect time checks the
   role; only two page functions do (`src/page/dnd5e/calendar.ts:165`, `settings.ts:101`), so a
   Player-role bridge user fails on writes with Foundry's own permission errors.
7. **Two default user names.** src defaults to `MCP-Claude` (`env.ts:96,104,113`); 7 scripts default
   to `'DM Assistant'` (`scripts/reload-clients.mjs:33`, `verify-actor-export.mjs:40,47`,
   `verify-receipt-settings.mjs:49`, `verify-soundscape-tooling.mjs:48,55`,
   `.claude/skills/bestiary-builder/bestiary-entry.mjs:77`); the owner's `.env` has
   `FOUNDRY_USER=DM Assistant`. The shipped **tool description** of `disconnect-bridge` says "Log
   the DM Assistant bridge user out" (`src/tools/bridge.ts:39`, comment at :9; `src/registry.ts:150`;
   also `src/tools/registry.test.ts:80`, `src/tools/scene.test.ts:182,187`). Every client sees the
   owner's user name in `tools/list`.
8. **LOCAL.md is gitignored** (`.gitignore:3`) and CLAUDE.md is too (`.gitignore:2`). CLAUDE.md
   references `LOCAL.md` as where "the real per-instance values" live. A stranger gets neither: no
   house rules (offline gate, live-proof discipline, the compatibility-event procedure) and no
   template for the per-instance sheet. `.env.example` is the only template and it is Molten-first.
9. **`.env.example` is mangled at :93-94** — `LOCAL_FOUNDRY_APP` comment reads
   "resourcesappmain.js … C:Program FilesFoundry Virtual Tabletopesourcesappmain.js" (backslash
   escapes eaten; `cat -A` confirms). The one line that tells a local user the default app path is
   unreadable.
10. **`scripts/local-foundry.mjs`** requires `.env` to exist (`readFileSync(join(__dirname,'..','.env'))`
    at :46 — throws ENOENT before any message), requires `LOCAL_FOUNDRY_DATA` (:63) and
    `LOCAL_ADMIN_KEY` (world launch/stop), and defaults the app path to
    `C:\Program Files\Foundry Virtual Tabletop\resources\app\main.js` (:69-70) — Windows-only,
    overridable via `LOCAL_FOUNDRY_APP`. It does not assume the owner's license, but the comment
    header and docs/local-sandbox.md assume the "sandbox imaged from prod (Molten)" model — a
    stranger with only a local Foundry has no prod to pull from, and the doc's "First-time machine
    setup" step 4 is `pull-prod-to-local.mjs`.
11. **The admin key** is documented per host (`MOLTEN_ADMIN_KEY` / `LOCAL_ADMIN_KEY` /
    `FOUNDRY_ADMIN_KEY`), optional; without it the bridge says "Launch the world (Setup → Launch
    World), or set X + Y" (`foundry.ts:224-227`). Good. `.env.example:52-53` documents it as the
    Foundry "Default Administrator Password" — fine.
12. **Premium books.** design.md §2.3 "assumed always installed". `src/utils/compendium-sources.ts`
    is the one definition (5 prefixes incl. Heroes of Faerûn and Ravenloft — design.md §2.3 still
    says MM/PHB/DMG only). There is **no presence check**: `get-world-info` (`src/page/world.ts:55-83`)
    reports system/version/users/automation, never which premium packs exist. A user without the
    PHB gets, per call, "No valid compendium packs available — check the compendiumPacks parameter.
    Valid pack ID is the premium PHB" (`src/page/dnd5e/spells.ts:321-323`,
    `compendium-features.ts:87`); searches return empty or third-party packs silently
    (`packPriority` tier 1 allows any non-SRD pack). No startup or `get-world-info` line says
    "MM/PHB/DMG: present/missing".
13. **Owner's box name leaks in comments**: `eoh-test` in `src/foundry.ts:63`,
    `src/hosts/webdav.ts:20`, plus tests (`webdav.test.ts`, `assets/index.test.ts`). LOCAL.md says
    these were "scrubbed out of the public repo" — not fully.
14. **Playwright is a devDependency** (`package.json`) but `src/foundry.ts:18` imports it at
    runtime. `npm ci --omit=dev` yields a server that cannot start. README's "Playwright is a
    devDependency" (line 234) documents the bug as a feature.
15. **`tests/integration/setup.ts:46`** gates the live suite on `MOLTEN_SERVER_URL` — a
    `local`/`generic` user can never run `RUN_LIVE=1 npm run test:integration` (it warns
    "no MOLTEN_SERVER_URL — live suites will skip"). docs/RELEASE.md step 2 says "needs a live
    Molten box".

## 2. Scripts (99 .mjs + scripts/lib/bridge-config.mjs) — classification

Counts from `scratch/user-facing-measure.mjs`: 63 `verify-*`, 17 `spike-*`, 19 other.
knip.json: `project: src/**/*.ts`, `entry: src/page/index.ts` — **scripts/ is outside knip
entirely** (not ignored; never analysed). Nothing detects a dead script.

### Product — keep (60)
- **Release verify set (12, CLAUDE.md / HANDOFF)**: verify-effects-6, verify-region-effects,
  verify-activities-6, verify-settings-calendar, verify-item-tooling, verify-actor-tooling,
  verify-pc-build, verify-teleporter-scene-fields, verify-placeables-tooling, verify-scene-tools,
  verify-cast-activity, verify-region-tooling.
  - **verify-region-tooling.mjs:26** hard-codes
    `worlds/the-broken-heart-of-greenrest/assets/tom-cartos/tomcartos-troll-bridge/maps/…webp` as
    the scene background — a release-gate script bound to the owner's world.
- **Infra (3 + lib)**: local-foundry (sandbox launcher), measure-tool-results, prove-bridge;
  plus verify-toolsets (offline), verify-wake, verify-asset-plane, verify-reads, verify-read-tools.
- **Other tool verifies (45)**: generic acceptance for product tools. Campaign strings inside:
  verify-token-display.mjs:19 (actor id `w4bENQ7PaWf8upSo`, "Greenrest > Extras"),
  verify-scene-sidecar.mjs:3-19 ("Eerie Temple" from the owner's Desktop), verify-folder-sort.mjs:68
  (comment), verify-actor-export / verify-soundscape-tooling (`'DM Assistant'` default).
  verify-soundscape-tooling exercises the product tool `configure-soundscape`, which only does
  anything with the sibling module installed — keep, but it belongs to the "house-module tools"
  group in docs.
- Recommendation: keep all 60 in `scripts/verify/` (+ `scripts/lib/`), fix the 4 campaign-bound
  ones to build their own fixtures (ZZ-* scene/actor), and add `scripts/README.md` naming the
  release set. Move the "release set" list from the gitignored CLAUDE.md into that README.

### House-module verifies / harness — move to the sibling repo (10)
verify-landing-scene (openserver), verify-lootshelf (lootshelf, "Greenrest merchants"),
verify-partystash, verify-partystash-coin, shot-partystash-coin, audit-partystash-coin-cleanup,
clean-stale-ownership (partystash test cleanup; referenced from `src/page/ownership.ts` comment),
register-partystash (superseded by register-module), verify-receipt-settings (lootshelf +
partystash), verify-soundscape (module engine, not the tool). None are referenced by README,
docs/RELEASE.md or a skill. They construct `new Foundry(...)` from `dist/foundry.js` — exactly the
undeclared library surface finding 6 of the brief describes; moving them makes the `exports`
field a hard requirement.

### Owner-ops — move to a sibling `fvtt-ops` / the module repos (12)
deploy-house-module, register-module, configure-modules, uninstall-modules (module lifecycle on
the owner's boxes), upload-soundscape-library + remap-soundscape-scene-paths (the private
`fvtt-mod-soundscape-sfx` library; soundscape-builder SKILL.md:342 names remap), pull-prod-to-local
(Molten→local mirror, 517 lines; .env.example:60 and docs/local-sandbox.md build on it),
reload-clients, party-stats (get-combat-stats dev harness for battleflow), read-user-avatars,
reveal-scene-fog ("owner-directed 2026-07-08, Greenrest/Ostenwold maps"),
repair-orphaned-container-refs ("Greenrest merchants" one-off).
Sibling references today (all by the OLD directory name — the rename broke them):
`fvtt-mod-fxstudio/CLAUDE.md:85,90`, `fvtt-mod-fxstudio/tools/sandbox-module.mjs:5,7`,
`fvtt-mod-fxstudio/tools/README.md:88`, `fvtt-mod-fxstudio/NEXT-SESSION.md:277,314-315`,
`fvtt-mod-miscpatches/CLAUDE.md:18,20`, `fvtt-mod-soundscape-sfx/README.md:5,55-56`,
`fvtt-mod-battleflow/tools/target.mjs:5`, `fvtt-mod-battleflow/PLAN.md:1715` — every one says
`../fvtt-mcp-molten5e/scripts/…`. Two options: (a) keep `local-foundry.mjs` + `deploy-house-module.mjs`
+ `register-module.mjs` + `configure-modules.mjs` here as the documented "developer sandbox
toolkit" (they are generic Foundry admin-API drivers, not campaign-bound) and move the rest;
(b) move all 12 to one `fvtt-ops` repo the modules point at. (a) is the smaller change and keeps
the fxstudio/miscpatches loop working after a path fix.

### Spikes — delete or archive (17)
Referenced from tracked non-script files: spike-headless (package.json `"spike"` script),
spike-pc-build / spike-pc-level / spike-pc-v3 (comments in `src/page/dnd5e/advancement.ts`),
spike-compendium-lookup (docs/compendium-lookup-plan.md), spike-cards-schema /
spike-playlist-schema / spike-rolltable-schema (docs/alignment-plan.md), spike-screenshot
(docs/tom-cartos-import-plan.md). Unreferenced (8): spike-advancement, spike-advancement-choices,
spike-native-scene-import, spike-placeables-schema, and the 4 partystash DOM spikes
(spike-dialogv2-render, spike-group-currency-dom, spike-group-currency-dom2,
spike-group-render-hooks). All 17 are historical ground-truth probes (v14.364 / dnd5e 5.3.3 era).
Recommendation: delete the 4 partystash spikes with the partystash harness (sibling), archive the
rest under `docs/history/spikes/` or delete and let git history hold them; drop the `spike`
npm script; rewrite the three `advancement.ts` comments to cite the commit, not the file.

### One-offs (counted above)
reveal-scene-fog, repair-orphaned-container-refs, read-user-avatars, audit-partystash-coin-cleanup,
clean-stale-ownership → delete (their fix landed or belongs to the module).

Totals: keep 60 · sibling 22 (10 house-module + 12 owner-ops; or 18 if the 4 sandbox admin
scripts stay) · delete/archive 17 spikes.

## 3. Skills that assume the owner's setup

Measured (`scratch/user-facing-measure.mjs`): 17 skills, 229 445 chars of SKILL.md.

| skill | campaign-specific | owner-machine | house-module | verdict |
|---|---|---|---|---|
| **session-scribe** (20.9k chars, 57 owner/campaign hits) | Craig (Discord) is the pipeline's input; `fvtt-campaign-greenrest` named as "active" (:61); "Greenrest Tonic" (:210); the four-document rule, third-person rule, "dreams get bullets" (:186-190), Session Diary journal, party-snapshots — all "(owner directive YYYY-MM-DD)"; reference implementations are paths in the campaign repo (:218-221) | `setup.ps1` (winget, `~\.session-scribe\venv`, CUDA), "DESKTOP-NY ✅", Edge headless at `C:\Program Files (x86)\Microsoft\Edge\…` (:109), PowerShell only | Battle Flow named as a mechanics example | **Move out** to the campaign repo (or a `session-scribe` sibling skill repo). What stays here is generic: `export-chat-log` + `get-combat-stats` + `export-actor` as "the plumbing a recap pipeline uses". If kept: split into a generic skill + a `house-style.md` the owner keeps outside the repo. |
| **session-audit** (15.1k, 5 hits) | reads `plot/`, `sessions/*/recap.md`, `party-snapshots/*.md` from "the campaign repo" (:38, :116-118); "Morgash / Gren" examples; "owner rule 2026-08-14" (:170) | "Ultracode state arrives in a system reminder" (:27) — a Claude-Code-specific mode | none | **Configuration**: make "campaign repo layout" a named convention (`campaign-repo.md` in `_shared`) with the plot/sessions/party-snapshots paths as inputs the user states; the encounter-math script is clean and generic (0 hits) — keep. |
| **plot-drift-check** (6.8k, 1 hit) | "a campaign pointer memory names it" (:18) | none | none | **Keep** with the same campaign-repo convention; one sentence to change. |
| **bestiary-builder** (6.4k, 1 hit) | "campaign repo's sessions/<date>/recap.md" (:33); Bestiary / Adventure Log names are house convention but configurable via flags | `bestiary-entry.mjs` hand-parses `.env`, hard-codes `MOLTEN_SERVER_URL` / `MOLTEN_MAGIC_URL` / `MOLTEN_ADMIN_KEY` / `MOLTEN_WORLD_ID` and `'DM Assistant'` (:67-83), and passes `magicUrl:` — a key `FoundryConfig` no longer has (`src/foundry.ts:60-101` takes `host`), so since 2.2 the wake step is silently dropped and the script cannot target `local`/`generic` at all | none | **Fix (tool side)**: route through `scripts/lib/bridge-config.mjs` (`bridgeConfig(env)`), or better, land the two missing capabilities (read a compendium journal page; entry-level journal ownership) as tools and delete the script — the skill itself says "there is no MCP tool for this". |
| **start-session** (5.2k, 10 molten hits, 2 registration-name hits) | none | Molten-only narrative ("Bring the Molten-hosted world up", EC2, Magic URL, `MOLTEN_*` names :17-29, :66-70); literal `mcp__foundry-molten5e__get-world-info` (:40, :58); "LIVE GAME … owner directive" (:80) | none | **Rewrite**: host-neutral ("call `get-world-info`; the host wakes/launches as configured"); name env vars per host via the bridge's own error text; drop the registration prefix. |
| **tom-cartos-import** (21.8k, 2 hits) | "OWNER DEFAULT — MAPS ONLY … Ostenwold → Greenrest … his chapter folders" (:35-44) as the default behaviour; `fvtt-mod-autoexplore` flag stamped on every town map | "Molten's hosting blocks flipping a module's enable-flag" (:24) as the strategy rationale; "Molten cold-start is ~25 s" (:65) | autoexplore (owner module, not in README) | **Example**: turn the owner default into a documented option ("maps-only mode") with the pack-faithful import as the default; make the autoexplore stamp conditional on the module being present; host-neutral rationale (any host may forbid module enable). |
| **soundscape-builder** (23.1k, 38 house-module hits) | none | "author soundscapes against prod, use the sandbox for shape" (:307-318) — the owner's two-box model and the private `soundscape-sfx` library (~400 templates) that "is never mirrored" | entirely: `fvtt-mod-soundscape` + `fvtt-mod-soundscape-sfx` | **Move out** with `configure-soundscape` into the module repo as that module's skill (the module is a "companion" in README; a stranger without it gets nothing from 23k chars of skill), or keep only if README ships an install path for the module + a public library. |

Also outside the seven: `journal-builder/SKILL.md:18,48,87,140-142` and `src/tools/journal.ts:282,437`
reference "§8 landing zone" (Phase-2 language, see §4); `_shared/authoring-policy.md:34` "a future
phase"; `cards-builder/SKILL.md:11` "a later phase"; `chat-and-narration/SKILL.md:78`
`C:/Users/<you>/…` (fine, placeholder).

## 4. Phase-2 scrub inventory — exact lines

`git grep -n -i -E "phase[ -]?2|wait-for-events|event bridge|session-assist|live assist|NUC|companion module|half 2|half 1|two halves"`
plus `§8|next phase|future phase|later phase|live session assist`.

**True DM-assist Phase-2 references (scrub):**
- design.md: 18 ("two halves"), 21-22 (half 2 row), 25-26 ("leave the door open for half 2"),
  28 ("Where half 1 stands"), 151-155 (§4 rows: Event bridge ⛔, Chat ◻️, Export ◻️, Audio→text ✅,
  Summaries ✅), 161-162 (legend ⛔ / ◻️ only exist for these rows), 164-166 ("We do not start a
  Phase-2 capability…"), 168-173 ("Phase 1 is now feature-complete … first Phase-2 increment …
  remaining Phase-2 frontier"), 190-191 (§5 Journals "landing zone for Phase-2"), 302-363 (all of
  §8 and §8.1: event bridge, `wait-for-events`, `session-assist`, companion module, build order),
  and §9 has no Phase-2 mention (clean). 18 hits total, as the brief counted.
- README.md:202-204 ("live session assistance … is the next phase (see design.md §8), not built
  yet").
- docs/alignment-plan.md:20 ("verbs are Phase-2"), :41 (cards deal/draw = Phase-2), :123
  ("§8 landing zone"), :205 (progress line).
- docs/architecture-review.md:50, :76, :100, :202 (historical — archive rather than edit).
- docs/plan-2.1-dnd5e-6-features.md:118 ("Phase 2 stays shelved unless asked").
- docs/scene-placeables-architecture.md:49, :98, :116, :328, :349, :447, :548-551, :574
  (MeasuredTemplate "deferred to Phase-2 combat / §8 session assistance"; "future Phase-2 session
  skill"). :505 is that doc's own "Phase 2 — Tile CRUD" (homonym).
- docs/compendium-lookup-plan.md:54 is that doc's own "Phase 2 — Node tool facades" (homonym).
- .claude/skills/journal-builder/SKILL.md:18, :48, :87, :140-142 ("§8 landing zone"; "design.md §8:
  later, automated session output…"); src/tools/journal.ts:282, :437 ("the §8 session-log path"
  in a tool description and a doc comment); _shared/authoring-policy.md:34 ("a future phase");
  cards-builder/SKILL.md:11 ("later phase").
- Memory: `~/.claude/projects/…/memory/three-point-oh-is-terminal.md:17-18,37` (records the
  removal — keep; it is the instruction), MEMORY.md:4 (same).
- HANDOFF.md and CLAUDE.md: **no Phase-2 hits**. HANDOFF §C/§D describe the README rewrite and
  the 3.0 plan and should say "no roadmap beyond 3.0"; CLAUDE.md is gitignored (see §5).

**Homonyms (a local plan/step numbering, not DM-assist; rename to "Step 2" only to stop the
grep tripping):** scripts/verify-wake.mjs:3, :91-92 ("Phase 2: cold bring-up");
scripts/verify-actor-tooling.mjs:346 ("PHASE 2 — update-actor-item");
scripts/verify-write-tools.mjs:1 and verify-dnd5e-writes.mjs:1 ("Phase-2 WRITE acceptance" — the
2026-06 rewrite's wave numbering); scripts/verify-journal-tooling.mjs:1 ("Phase-2 journal
de-leak" — alignment-plan's Phase 2, which is titled "§8 landing zone", so half-linked);
src/page/dnd5e/cast-spells.ts:218 ("Phase 2: converge to one named copy" — an algorithm step).

**Replacement text shape for design.md** (3.0 terminal, no phase 2):

§1 Mission — replace lines 18-26 with a single statement, no halves:
> `fvtt-mcp-dnd5e` builds and maintains the *content* of a D&D 5e campaign in a live Foundry
> world — scenes, NPCs and PCs, items, journals, tables, cards, playlists — and records what
> happened at the table afterwards (chat export, combat analytics, session recaps written into the
> journal). It is a Foundry MCP first (§2.6). It does not run the game: there is no live
> in-session assistant in this project, by decision (2026-09-20); one may exist as a separate app
> that depends on this MCP.
Keep "Where things stand today" (28-38) as is, retitled.

§4 Scope & roadmap — replace the table with two columns of *areas* (no Phase column, no ⛔/◻️
legend): Content creation (the 1.x/2.x rows as today), **Session record** (chat tools,
`export-chat-log`, `get-combat-stats`, `session-scribe` — plain features, ✅), Platform (hosts,
toolsets, rename ✅; CRUD consolidation + response/schema diet 🔨 3.0). Legend: ✅ done · 🔨 3.0.
Replace lines 164-173 with: "**3.0 is the last feature line.** After it the project is in
maintenance: Foundry / dnd5e compatibility events (CLAUDE procedure), bug fixes, and premium books
brought into scope via `src/utils/compendium-sources.ts`. There is no roadmap beyond 3.0."
§5 :190-191 → "This is also where session recaps are filed (`session-scribe`)."
§8 → delete; renumber §9 → §8, §10 → §9. §8.1's *ground truth* paragraph (the bridge is a
logged-in client and already receives the feed) is worth one sentence in the implementation
snapshot as a fact, not a plan.

## 5. The documentation set — current vs historical, and the 3.0 set

| file | lines | status | 3.0 recommendation |
|---|---|---|---|
| README.md | 450 | current but accreted; 26% release narrative; 35 "molten" | rewrite per HANDOFF §C; narratives → CHANGELOG.md (none exists; tags v2.1.1…v2.2.0) |
| design.md | 406 | binding; Phase-2 text in §1/§4/§5/§8 | keep; scrub per §4 above; §2.3 list the 5 prefixes actually in `compendium-sources.ts` |
| HANDOFF.md | 214 | transient (says "retire when the 3.0 plan exists") | retire into `docs/plan-3.0-*.md`; not for strangers |
| CLAUDE.md | 43 | **gitignored** — a stranger never sees the offline gate, the live-proof rules, the compatibility procedure | track it (or move its content to CONTRIBUTING.md and keep CLAUDE.md as a 3-line pointer); the release verify list belongs in `scripts/README.md` |
| LOCAL.md | 39 | gitignored, owner values | keep private; ship `LOCAL.md.example`? No — `.env.example` is the template; delete the CLAUDE.md reference |
| docs/RELEASE.md | 44 | current; "needs a live Molten box" | keep; host-neutral wording; note the `MOLTEN_SERVER_URL` gate bug |
| docs/local-sandbox.md | 198 | current for the owner; assumes prod→local mirror; `foundry-molten5e/-local5e` names; "local is v14.365" (:120) stale | split: "Running a local Foundry headless" (generic, keep) vs "Mirroring a Molten prod" (owner-ops, move with pull-prod-to-local) |
| docs/plan-2.2-hosts.md | 125 | current tracker (2.2 shipped) | docs/history/ after 3.0 plan lands |
| docs/plan-2.1-dnd5e-6-features.md | 218 | current tracker; pins say 6.0.1; :118 Phase-2 | pin 6.0.3; scrub; then docs/history/ |
| docs/dnd5e-6.0-compat-review.md | 300 | dated audit (2026-09-15) | docs/history/ |
| docs/scene-placeables-architecture.md | 582 | in-flight build doc from 2026-07; references gitignored `scratch-placeables-schema.json`; 8 Phase-2 hits | docs/history/ after extracting the placeable descriptor rules into a short `docs/placeables.md` |
| docs/tom-cartos-import-plan.md | 405 | design complete 2026-06-28 | docs/history/ |
| docs/compendium-lookup-plan.md | 124 | tracker, done | docs/history/ |
| docs/alignment-plan.md | 214 | tracker, done | docs/history/ |
| docs/architecture-review.md | 255 | self-declared "SUPERSEDED SNAPSHOT (2026-06-24)" | docs/history/ |

The 3.0 set a stranger needs (7 files): README (what/60-second start/skills/tool table by
toolset/architecture/config by host/security), CHANGELOG, design.md (scrubbed), CONTRIBUTING (the
gate + live-proof + compatibility procedure — today's CLAUDE.md), docs/hosts.md (per-host setup
incl. "run a local Foundry headless"), docs/RELEASE.md, scripts/README.md (the verify set).
Everything else → docs/history/ (10 files) with a one-line index.

What the current README says that a stranger cannot use: the three release narratives (:27-141);
"hosted on Molten" (:238); the `foundry-prod` example names that no skill uses; `.mcp.json.example`
without `FOUNDRY_HOST`; the Tools section that references companion modules (`fvtt-mod-openserver`,
`fvtt-mod-soundscape`, `fvtt-mod-battleflow`) as if installed; the toolset table without the
count per toolset; no skills install step; no "create the bridge user" step; the security line
"to Foundry on Molten"; the Contributing section's `npm run test:integration` "against a real
world" that only runs with `MOLTEN_SERVER_URL`.

## 6. Packaging

- `package.json`: `name` ok, `version` 2.2.0, `"private": true`, **no `bin`**, **no `exports`**,
  **no `files`**, `main: dist/index.js`, `types: dist/index.d.ts`. `src/index.ts:1` has the
  shebang. Keywords still carry `molten-hosting`.
- **`playwright` is a devDependency and a runtime import** (`src/foundry.ts:18`). `vitest` is
  imported by `src/tools/test-helpers.ts:12` which tsc compiles to `dist/tools/test-helpers.js`
  (not excluded by `**/*.test.*`); nothing at runtime imports it, but it ships in dist.
- `@foundryvtt/foundryvtt-cli` is a runtime dependency (read-pack child process) — fine.
- `dist/` is not committed (0 tracked) — correct; the build is `tsc && node esbuild.page.mjs`
  (two artifacts; README explains). A sibling that imports `dist/foundry.js` by absolute path
  needs the consumer to have built this repo.
- `.env` is resolved as `../.env` from `dist/config.js` (`src/config.ts:15`) — works for a clone,
  breaks for an npm-installed package (`node_modules/fvtt-mcp-dnd5e/.env`). No env-var override
  for the path.
- Node: `engines >=22`, `.nvmrc` 24, CI tests 22 + 24 (ubuntu only — no Windows job although the
  owner and the sandbox launcher are Windows-first).
- Playwright browser: README documents `npx playwright install chromium`; on Linux CI/servers the
  `--with-deps` form is needed and undocumented. Nothing runs the install automatically.
- `.gitignore`: `/scratch-*.json` (a 1.2 MB `scratch-placeables-schema.json` sits at the root and
  docs/scene-placeables-architecture.md cites it as a source), `/scratch/`, `CLAUDE.md`,
  `LOCAL.md`, `.mcp.json`, `scripts/*.png`, `__pycache__/`. Hygiene is fine; the CLAUDE.md ignore
  is the questionable one for a user-facing repo.
- LICENSE: MIT, dual copyright (Adam Dooley 2025 / Txpple 2026) — consistent with the
  Acknowledgments.
- What an `npx` story needs: `"bin": {"fvtt-mcp-dnd5e": "dist/index.js"}`, `"files": ["dist",
  "images", ".claude/skills"]` (or a `skills/` dir at the package root), `"exports"` for `.`,
  `./foundry`, `./hosts` (the sibling surface), `playwright` → `dependencies`, a `prepare`
  script, an `FVTT_MCP_ENV` (or `--env <path>`) override for the `.env` location, drop
  `private: true`, and a `postinstall` note (not script) for `playwright install chromium`.
  Until then the honest README claim is "clone and build".

## Could not verify
- Whether the GitHub repos linked in README (`Txpple/fvtt-mod-openserver`, `-soundscape`,
  `-battleflow`) are public (no network).
- Whether Claude Code loads `.claude/skills` from a registered MCP server's directory when the
  session runs elsewhere (assumed not: project skills are per working directory).
- What the actual 10-minute failure looks like end-to-end with a placeholder URL (read from
  `foundry.ts` timing constants only; no live run).
- Whether the `pack.getIndex` search paths return third-party packs silently when no premium
  pack is installed (read from `packPriority`; not exercised).
