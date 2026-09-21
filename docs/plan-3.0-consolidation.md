# 3.0 — the dnd5e MCP: the token fix, official 6.x, hosts as endpoints · plan & tracker

> Checkbox-driven tracker, aligned to [`design.md`](../design.md) and built from
> [`docs/architecture-review-2026-09.md`](architecture-review-2026-09.md) (every number below is
> measured there; finding ids `F1`–`F50` refer to it). **3.0 is the last feature line.** After it the
> project is in maintenance: Foundry / dnd5e compatibility events, bug fixes, premium books brought
> into scope. There is no roadmap beyond 3.0 and no document should imply one.

## Why (the measurements behind it)

The owner runs out of tokens in Claude Code and `/explain-usage` named this MCP. The review measured
where the context goes and what the project still carries from its origin as a Molten-specific
server:

| | measured 2026-09-20 | target at 3.0 |
| --- | --- | --- |
| tool **results**, 24 ordinary reads | 154,534 chars ≈ 42.9k tokens; 2 capped mid-JSON; 5 bare placeable lists error | **≤ ~112,600**; 0 capped; 0 errors |
| tool **names** in every Claude Code prompt (two registrations) | 302 names, 11,147 chars ≈ 3.1k tokens | **≤ 7,000 chars** (family tools) |
| skill **descriptions** in every prompt | 17 × front-matter = 15,382 chars ≈ 4.3k tokens | **≤ 8,000** (six rewrites measure 11,982) |
| `tools/list` per registration (eager clients) | 151 tools, 283,948 chars ≈ 78.9k tokens; 67% English | **≤ 230,000** |
| `search-compendium` first call | 7.8–13.2 s (one pack's index build; warm 176 ms) | **< 1 s** after the session warm-up |
| files outside `src/hosts/` that name a host var | 51 (`MOLTEN_*` canonical; 24 scripts bypass the selector — one shut prod down) | **`git grep MOLTEN_ src` → `src/hosts/env.ts` only** |
| siblings importing `dist/foundry.js` by absolute path | 40 code files + 17 docs across 6 repos, all broken by the rename | **0**; every sibling imports `fvtt-mcp-dnd5e/client` |
| Phase-2 language | design.md 18 lines, README, 4 docs, 4 skills + `_shared`, 1 tool description | **0** outside `docs/history/` |

The one architectural answer the plan turns on, byte-measured (review §4): **fewer tools does not
mean fewer bytes.** A lossless `kind × op` union of 48 tools → 3 costs **+4.5%** (78,572 → 82,130
chars); a `describe`-op shape shrinks the eager list to 4.5% but defers the same prose into tool
*results* (the wrong direction for Claude Code) and adds a round trip; zod's `reused:'ref'` grows the
list **+18.75%**. What shrinks bytes is the **prose diet** (leaf `.describe()` 43%, descriptions 24% of
the list); what shrinks the Claude Code prompt is the **name list**; the CRUD consolidation is a name
diet and must land **after** the prose diet, or a deferred client loads a family's whole schema
(placeables: 64,619 chars) on first use.

## Framing (binding)

- **3.0 = (a) the token/perf fix, (b) first official dnd5e 6.x support, (c) the refactor that makes
  it *the dnd5e MCP* — `molten` / `local` / `generic` are endpoints, chosen per registration; a new
  user sees only `FOUNDRY_*`.**
- **User-facing.** Someone clones it and runs it against their own world with their own premium
  books. No campaign, machine, hosting or registration specifics in tracked files — configuration
  or examples only.
- **Sister to the `fvtt-mod-*` families.** The house modules and the artificer are first-class
  consumers of two surfaces: the MCP tools (by name, from skills and instructions) and the
  `Foundry` client (from their `tools/` harnesses). Both are declared contracts in 3.0.
- **Skills decide, tools do — unchanged.** Every finding is placed on its side of the line
  (design.md §2.1); the consolidation re-points every skill in the same commit as the family it
  renames.
- **Phase 2 is gone.** No event bridge, no `wait-for-events`, no session assistant, no NUC. What
  shipped under that name (`session-scribe`, the chat tools, `export-chat-log`, `get-combat-stats`)
  stays as plain features. *(Internal note: a live assistant, if ever, is a separate app that may
  depend on this MCP; it never lives here.)*
- **One family = one commit,** with before/after numbers in the message; the offline gate before
  and after; live proof on the sandbox, one driver at a time (CLAUDE.md).

## Milestones

| # | Milestone | Findings | Definition of done (numbers) |
| --- | --- | --- | --- |
| **M0** | **Measure & guard** ✅ 2026-09-20 — `scripts/measure/` (`schema-decompose`, `schema-toolsets`, `names-cost`, `skills-matrix`, the live `tool-results`; `npm run measure`); `src/measure.ts` + `src/measure.test.ts` print and ratchet the three offline budgets on every `npm test`; the two dead `getToolDefinitions()` deleted and the registry refuses an orphan definition at build; `prebuild` clears `dist/` | F44, F48 | done — reproduced 283,945 · 155,100 · 15,381 · 11,147 (the −3 / −1 are the Phase-2 scrub of `7aff73e`; the +566 is world drift: two loot items and the chat log grew since the capture, the other 22 calls byte-identical); `dist/tools/molten` gone |
| **M1** | **The 6.0.3 pin (official 6.x)** ✅ `c53c2de` 2026-09-20 | F40 | done — left: the #7470 elevation check and `sourceItem.*` in the manage-effect prose (fold into M2) |
| **M2** | **Results diet** ✅ 2026-09-20 (12 commits, `1a38440`…) — the raw message on every mapped error (#15); bestiary through the host seam (#18); the record-level cap with a `truncation` stamp; ownership compact by default; the 32 placeable tools default to the ACTIVE scene and a scene miss is `isError`; one search-hit shape `{id,name,type,uuid,pack,img?,facets?}` + the creature `name` facet + limit 50 + a true `totalFound`; unknown arguments refused by name (the closed top level, +4,379 on tools/list); `list-scenes` fields (darkness / weather / `flags[flagScope]`, the background path on `get-current-scene`); the list projections + `nameFilter` on actors / journals; list-macros filters; the index warm-up at connect; the result-shape rule in design.md §3 (#10); the M1 leftovers | F6 F7 F8 F9 F17 F18 F19 F20 F41 F43 (+F5/F4/F40 parts) | done — 24-call baseline (corrected args) **101,203 chars ≈ 28.1k tokens** (was 155,100; target ≤ ~112,600); **0** capped; **0** errors on bare placeable `list-*`; `totalFound` on all four search bodies; `search-compendium` first call **175 ms** 20 s after connect (warm-up 15 packs in 9.7 s; a search that is the very first call still waits for it); tools/list 288,175 (ratchet 288,200) |
| **M3** | **Skill descriptions + line fixes** ✅ 2026-09-20 (6 commits, `af5cdd4`…`f8156d9`) — all 17 descriptions on the trigger rule (the six as measured, the other 11 by the same rule); the two stale claims fixed; scene-builder hands the sidecar file to `create-scene` by `placeablesPath`; `hp` in `extractDerived` (a PC's real max HP on `get-actor`); `create-pc` `defaultArt` (the primary class's pregen portrait + token cut-out) and `spells.alwaysPrepared`, the trait-key grammar on the `chosen` leaf; `set-actor-art` `normalizePrototype` / `autoRotate` + the placed-token report | F16 F28 F29 F30 F31 F32 | done — descriptions **7,998 chars** (was 15,381; 120/120 quoted trigger phrases kept, ratchet 15,400 → 8,000); scene-builder's sidecar section **15** prose lines (was 65); **0** skill lines prescribing the post-art fix-up; tools/list 287,850 (the 6 new leaves paid for in their families' prose: 288,175 → 287,850); live: verify-pc-build 70/70, verify-scene-tools 16/16, verify-actor-tooling 38/38 |
| **M4** | **Config contract + hosts** ✅ 2026-09-20 (3 commits, `0a1e665` `ef011f1` `46f5623`) — `FOUNDRY_*` canonical (`FOUNDRY_URL / _USER / _PASSWORD / _ADMIN_KEY / _WORLD_ID / _HOST / _WAKE_URL / _TOOLSETS`; plane extras `FOUNDRY_DATA_DIR`, `FOUNDRY_WEBDAV_*`), **default host `generic`**, one `FoundryHost` with `molten` / `local` / `generic` as presets, the placeholder refused at startup, aliases only in `src/hosts/env.ts` (logged once), worldId discovery on `/setup` + `bridge.worldId()`, the bridge `FilePlane` (FilePicker through the page) on every host composed with the direct plane (`filePlaneFor`), `send-chat-message` drops `webdav`, `library:{book: present|missing}` + `bridgeUser:{name,role}` in `get-world-info`, a role warning after join, one default bridge-user name | F1 F12 F15 F36 F38 F46 | done — `git grep -l MOLTEN_ src` → `src/hosts/env.ts` + its test (was 6 files); `resolveHostConfig({})` → `generic`, the startup refusal in **236 ms** naming `FOUNDRY_URL`; **0** tools answer "unavailable" on any host (delete / move refuse by name on the bridge plane, the rest work); live on `local`: verify-wake cold bring-up **12 s** with the world discovered on `/setup`, verify-asset-plane **27/27** through the bridge plane and **29/29** direct, integration **80 passed / 6 skipped**, the C proof 6/6; tools/list 287,838 (was 287,850) |
| **M5** | **Package + sibling contract + scripts** ✅ 2026-09-20 (4 commits here, `f107a48` `e8a4521` `68dff22` `2603e27`; 9 sibling commits) — `exports` (`.` / `./client` / `./hosts` / `./env`), `bin`, `files`, `main` = dist/client.js; `src/client.ts` (`Foundry` + `disconnect()` alias, `foundryConfig`, `connectFoundry({host, env, identity: bridge|suite|player|{user,password}, tag, watchdogMs})` with the watchdog and the raced dispose, the host seam, `Logger`) and `src/env.ts` (`loadEnv` = dotenv.parse, `envPath` = `FVTT_MCP_ENV` or `<repo>/.env`, `repoRoot`); playwright → dependencies; test-only sources out of dist/; scripts classified (6 deleted, 10 moved to their module repos on the contract, 17 spikes → `docs/history/spikes/`, the 3 campaign-bound verifies on ZZ fixtures), knip reads `scripts/` (an unlisted package is a gate failure), the `.env` loop codemod (62 scripts), `hostFor` gone, local-foundry / pull-prod-to-local / deploy-house-module / register-module / uninstall-modules on the host presets (the local world discovered under Data/worlds; deploy through the host's own file plane); `.env.example` complete (FOUNDRY_SUITE_* / FOUNDRY_PLAYER_* / FOUNDRY_APP / FVTT_MCP_ENV + the aliases); `scripts/README.md`; every sibling on `fvtt-mcp-dnd5e/client` via `file:../fvtt-mcp-dnd5e` | F2 F3 F25(a) F26 F27 | done — battleflow `node tools/smoke-saves.mjs --list` passes; **0** files in any sibling name `fvtt-mcp-molten5e` as a live reference (what remains says "formerly" or names the archived `-notes` repo); **0** hand-rolled `.env` loops in `scripts/` (was 97) and **0** `MOLTEN_*` / `LOCAL_*` reads outside `src/hosts/env.ts`; integration **80 passed / 6 skipped** from a .env with NO `MOLTEN_*` key (via `FVTT_MCP_ENV`); `.env.example` declares every key the family reads (diffed against the code); scripts 98 → 65; live: prove-bridge, token-display 7/7, scene-sidecar 13/13, region-tooling 22/22, playlist 8/8, copy-primitive 23/23, actor-export 9/9, soundscape-tooling 32/32, deploy `--check --local` 80/80; siblings live: battleflow verify-settings CLEAN, fxstudio smoke-boot PASS, soundscape 11/11; tools/list 287,838 (unchanged) |
| **M6** | **Error contract + seam typing** ✅ 2026-09-20 (2 commits, `094848f` + the seam) — the page throws a coded `PageError` (`not-found` / `ambiguous` / `invalid` / `permission` / `unsupported` / `rolled-back`) whose code rides in the Error's `name` (the channel measured to survive `page.evaluate`); `BridgeError` (`code` / `fn` / `detail` / `pageStack`) on the Node side, `connection` for the connect path; the mapper appends one hint per code and the substring classifier is gone; 359 of 393 page throws coded, 25 catch-and-rewrap shells deleted. The seam: 93 untyped returns (92 `unknown`, 1 `any` — the checker's count, not the review's regex 74) and 9 `any` args typed (85 by inference once the `Promise<unknown>` annotations came off; 8 explicit shapes; 9 args as the tools' zod output by type-only import, `addSpellsToActor` page-declared because create-pc calls it with `alwaysPrepared` the tool never exposes); `foundry.call<N>(name, ...PageArgs<N>): Promise<PageResult<N>>`; 744 + 156 page-side optionals widened to `T \| undefined` (what arrives); the `SeamGuard` type in `src/page/index.ts` refuses an `any` / `unknown` result or arg at `tsc`; the 446 tool-side errors behind the flip fixed (13 dead `result.error` checks in journal.ts, 5 `call<Shape>` casts in the bridge plane, 6 `call('x', {})` on argless handlers, 31 placeable wrappers that still said `sceneIdentifier: string` after M2 made it optional, literal discriminants on the miss unions) | F5 F24 | 12/12 review cases keep their text with their own hint (unit test); **0** `any` / `unknown` results and **0** `any` args across 156 handlers (`SeamGuard`, proven to name an offender); **0** explicit `call<T>` casts left; live: verify-error-contract 15/15, integration 80 passed / 6 skipped |
| **M7** | **Schema prose diet + toolsets** ✅ 2026-09-20 (8 commits, `49f2108`…`a12bdf8`) — `world` → always-on `session` + opt-in `settings`; the prose budget (leaf ≤ 120, description ≤ 400) as a test over every tool (`proseOffenders` in `src/measure.ts`, landed with a per-family pending set that each family commit shrank and the last deleted); `src/tools/_targets.ts` (`actorTarget` fuzzy / `actorTargetStrict` for the three destructive-or-art tools, `sceneTarget` / `sceneTargetRequired`, `itemTarget`) wired into 38 leaves with a test that every `*Identifier` leaf starts with its rule's text (add-feature had advertised "exact" and resolved fuzzy; its sub-schemas no longer re-advertise `actorIdentifier`), the page's duplicate ownership resolver folded; all 151 tools rewritten family by family (actors, scenes, compendium + items, journals + tables + cards, audio + chat + combat, assets + organization) to contract-only — the §6 ladder, "PREFER" / "LAST-RESORT" / "ask first", the design.md section numbers, the house-pattern glosses, the sibling-tool tours and the Foundry-internals asides gone (the skills already carry them; one stale claim in authoring-policy.md rule 12 corrected: content-audit DOES scan item descriptions); 11 verify scripts outside the release set still on the pre-M2 array shape re-pointed to `.results` | F10 F22 F23 | done — `tools/list` **205,248** (was 287,838; ratchet 288,200 → 230,000); leaf prose 124,311 → 81,791, descriptions 66,596 → 26,538, structural unchanged; **0** tools over the budget (longest leaf 120); always-on **1,578** (was 10,814 as `world`); `chat,combat` 23,045 → 9,860; live: the release set + integration 80 passed / 6 skipped per family commit |
| **M8** | **CRUD consolidation — one family per commit** 🔧 started 2026-09-21 — the lossless `op` union (+ `kind` for placeables; the key is spelled `action`, the surface's existing discriminator — manage-effect, manage-activity, configure-soundscape, post-item-card — not a second convention), member descriptions kept, top-level `type:"object"` (`src/tools/_union.ts`); the family's list result moves to the design.md §3 line shape in the same commit (F20); the family's skill lines re-pointed (185 SKILL.md lines name a CRUD tool), its verify script re-pointed, the sibling checklist entries; `actors.ts` split rides the actor commit. Order: tiles / lights / walls / drawings (skill-cheap) → sounds → notes → tokens → regions → macros → folders → playlists → cards → tables → items → journals → scenes → actors → `search-compendium` ×4 → one with `type` → the actor projections (`get-actor` / `get-actor-entity` / `export-actor`) | F11 F20 F44 F45 F49 | per family: advertised bytes **≤ today's**; **0** unresolved tool names in `.claude/skills` (`skills-matrix`); the family's verify counts in the commit. Overall: names **151 → ≤ 90**; two-registration name chars **≤ 7,000**; `tools/list` still ≤ 230k |
| **M9** | **Owner content out, docs in** — start-session / chat-and-narration host-neutral; session-scribe / soundscape-builder / tom-cartos-import per the decisions below; `_shared/campaign-repo.md`; owner strings scrubbed; design.md (already scrubbed here) re-checked; README rewritten (the owner's "git-friendly page, plain English, describes the project"); `CHANGELOG.md`; `CONTRIBUTING.md` (today's CLAUDE.md, tracked); `docs/hosts.md`; `docs/contracts.md`; the 8 done trackers → `docs/history/` | F13 F14 F33 F34 F35 F37 F39 F47 | Phase-2 grep (`phase[ -]?2\|wait-for-events\|event bridge\|session-assist\|next phase\|§8\|NUC`) → **0** outside `docs/history/`; owner-string grep (`greenrest\|broken-heart\|DM Assistant\|eoh-test\|foundry-molten5e`) → **0** outside `.env.example` and `docs/history/`; README ≤ 250 lines with the 60-second start before line 40 and a skills install step; `.claude/skills` carry **0** server prefixes |
| **M10** | **Release 3.0** — full offline gate, the release set, integration, the measurement scripts' numbers in the release notes; tag; the prod upgrade path documented (Foundry ≥ 14.367 first, then dnd5e 6.x) | — | every M0–M9 number restated and met |

Sequence: M0 → M2 → M3 (the largest per-prompt savings, no renames) → M4 → M5 (a stranger can run
it; the siblings are whole) → M6 → M7 (name-neutral hardening; the prose diet) → M8 (the only
renaming milestone) → M9 → M10. M0–M7 done 2026-09-20.

## Decisions

Recorded from the review (§15) with the owner's answers of 2026-09-20 (#1–#9, #16, #17); the rest
are defaults the owner can overturn before the milestone that depends on them starts.

| # | Decision | Recorded |
| --- | --- | --- |
| 1 | Consolidation shape | **b2 lossless `op` union per family, after the prose diet** — measured (review §4). Not the `describe` op; not `reused:'ref'`. |
| 2 | Default host | **`generic`** (owner, 2026-09-20): the owner's `foundry-molten5e` registration sets `FOUNDRY_HOST=molten` explicitly when M4 lands; today it sets nothing. |
| 3 | Skill descriptions | apply the six measured rewrites; budget ≤ 8,000 for all 17 (default). |
| 4 | Response/schema diet timing | **inside 3.0** (owner, 2026-09-20 — no 2.3). |
| 5 | README | **rewritten at the end of 3.0** (owner, 2026-09-20): a git-friendly page in plain English describing the project; release narratives → `CHANGELOG.md`. |
| 6 | Registration names | keep `foundry-molten5e` / `foundry-local5e` privately (fxstudio + start-session reference them); `.mcp.json.example` shows neutral names. **The sandbox keeps the FULL surface everywhere** (owner, 2026-09-20): local is used as much as prod — the other house modules are developed against it from their own repos — so the review's `FOUNDRY_TOOLSETS=world` demotion of `foundry-local5e` in fxstudio / battleflow / miscpatches is **withdrawn**; the ≈ 1.5k tokens per prompt it would have saved is accepted. M4/M5 change no sibling's toolset. Content boundary (unchanged, now written down): world content flows ONE way — `pull-prod-to-local` is a byte copy prod → local and nothing flows back; moving something authored on local to prod is "run the same tool calls against prod" or Foundry's own export/import. 3.0 adds no local → prod sync (a world-management problem, not a tool problem). |
| 7 | Prod version | stays dnd5e 5.3.3 / Foundry 14.364 until the owner upgrades (owner, 2026-09-20). |
| 8 | Ops scripts (deploy / register / configure / uninstall house modules) | **keep here** as the documented "sandbox toolkit" importing `./client` + `./hosts` (owner, 2026-09-20); the module-specific harnesses (partystash, lootshelf, soundscape, receipt) move to their module repos; the soundscape upload scripts → `fvtt-mod-soundscape-sfx`. |
| 9 | Bridge file plane on `generic` | **build it** in M4 (owner, 2026-09-20; 2–3 days incl. live verify) — without it 9 tools and 7 skills are dead on generic, which contradicts "user-facing". |
| 10 | List output format | default: **one line per record** in a documented field order with a header `<N> <noun>(s) [of M]`; `get-*` = JSON with a `fields` selector; mutations = one-line confirmation; a miss is `isError`. |
| 11 | Active-scene default for placeable tools | default: **yes** — `game.scenes.active` is one world-wide document, echoed in the result; the 6 scene-document tools stay explicit. |
| 12 | Release scripts → `tests/integration` | default: (a) the gate fix now (M5); (b) promotion optional, not a 3.0 requirement. |
| 13 | CLAUDE.md | default: tracked as `CONTRIBUTING.md` in M9 with a 3-line pointer; LOCAL.md stays gitignored. |
| 14 | Premium set | default: `PREMIUM_BOOK_PREFIXES` stays the five; `dnd-arcana-unleashed` / `dnd-deadfall` added when the owner installs them; design.md §2.3 names MM/PHB/DMG as required for authoring and the rest as optional extensions. |
| 15 | Error contract | default: both — the 3-line raw-message fix in M2's first commit, the coded contract in M6. |
| 16 | session-scribe | **genericize in place** (owner, 2026-09-20) — per-campaign `STYLE.md` + `campaign.json`, a Windows-only note. |
| 17 | soundscape-builder + `configure-soundscape` | **keep here** (owner, 2026-09-20) under a README "tools that need a companion module" section (same for `get-combat-stats`, `set-landing-scene`). |
| 18 | bestiary-builder | default: land the page-targeted compendium-journal read + page sort (tool side) and delete `bestiary-entry.mjs`; the 2-line `bridgeConfig` fix first (M2). |
| 19 | tom-cartos-import defaults | default: pack-faithful import as the default; maps-only and the autoexplore stamp as asked-for options. |
| 20 | Tools no skill names (51) | decided per tool in M8's family commit: plain feature (documented) or dropped. |

## Verification

Offline gate before and after every commit (`npm run check && npm run typecheck && npm test && npm
run build && npm run knip`). Live on the sandbox (`FOUNDRY_HOST=local`, one driver at a time):

- the measurement scripts (M0) re-run at the end of every milestone and their numbers pasted into
  the commit message; the three ratchets in `src/measure.test.ts` (tools/list, names, skill
  descriptions) move only for a reason this plan names — a new selector or field is paid for in
  its own family's prose in the same commit (M2 did this seven times), and a milestone that lands
  its diet lowers its ceiling in the same commit;
- the family's verify script(s) and `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` on
  every M8 commit;
- the release set + integration + a Claude Code smoke after restart (new tool schemas need a
  restart) at M10.

## Skills checklist (M8)

Every `SKILL.md` line that names a CRUD-family tool is re-pointed in the family's commit:
scene-builder 32, tom-cartos-import 22, stat-block-builder 21, physical-item-builder 18,
plot-drift-check 15, table-builder 15 …; by family: actors 39, scenes 36, items 32, journals 27,
tables 19, regions 17, cards 14, playlists 14, tokens 9, sounds / notes / folders 4 each, tiles /
walls / lights 1 each (`docs/review-2026-09/data/skills-tool-matrix.md`). Beyond this repo: the
artificer names 11 tools (10 tracked files); battleflow 5; the campaign repo 21 — the checklist is
`grep -rn "<old-tool-name>" .claude/skills scripts tests ../fvtt-mod-*/tools ../fvtt-mcp-artificer
../fvtt-campaign-greenrest`.

## Progress

- 2026-09-20 — owner decisions recorded (3.0 terminal; Phase 2 removed; user-facing; siblings as
  consumers; no 2.3; README last; prod stays 5.3.3); the review
  (`docs/architecture-review-2026-09.md`, `c327ac6`) measured the baselines; **M1 done**
  (`c53c2de`) with the launcher / verify-wake fix (`96ed726`); this tracker opened; design.md
  scrubbed of Phase 2 and its §4 updated; HANDOFF.md retired; owner decisions #2, #8, #9, #16, #17
  answered (`d42dd93`). **M0 done** (measure & guard): `scripts/measure/` + `npm run measure`,
  `src/measure.test.ts` prints the budgets on every `npm test` and ratchets them (284,000 /
  11,200 / 15,400 today; each milestone lowers its own), the F44 orphan guard in `registry.ts`,
  the F48 `prebuild` clean; the numbers reproduced (283,945 · 155,100 · 15,381 · 11,147).
  **M2 done** (the results diet, 12 commits): the 24-call baseline 155,100 → 101,203 chars
  (−35%), no capped or erroring call left in it, the search tools on one hit shape with a true
  `totalFound`, unknown arguments refused, the placeable tools on the active scene by default,
  the compendium indexes warm at connect (first search 175 ms), the result-shape rule written
  into design.md §3. Two things the milestone surfaced: (a) the search-hit `uuid` + `img` cost
  makes `search-compendium "sword"` 11,486 (was 8,954 with four dead fields) — the one shape
  won over the per-tool minimum, and physical-item-builder reads `img` from a hit; (b) with
  dnd5e falling on, an `elevation` write marks the actor Falling on unviewed scenes too (#7470,
  the system's rule; noted on the leaf). **M3 done** (6 commits): the 17 descriptions 15,381 →
  7,998 chars (≈ 2.2k tokens per prompt, was 4.3k; every quoted trigger phrase kept; the
  mechanism / composition / ownership sentences were already each body's first paragraph), then
  the five line fixes each with its live proof — the tool owns what the skill re-derived
  (`placeablesPath`, the PC max HP, the class-pregen art + `alwaysPrepared`, the prototype
  normalization) and the skill keeps the judgment (which classes, whether the player brings art,
  whether the art faces up). Two things it surfaced: (a) pc-builder's pregen id pattern
  `phbprg<Class>0000` was wrong for most classes (the ids are zero-padded to 16) — the tool
  resolves by name; (b) the pregens ship a separate token cut-out (`assets/tokens/<class>.webp`),
  which the skill never used — `defaultArt` takes both. Decision #6 revised the same day (the
  sandbox keeps the full surface everywhere). **M4 done** (3 commits): the `FOUNDRY_*` contract
  with `generic` as the default and the three hosts collapsed into one class over
  {wakeUrl, dataDir, webdav} (a host is a preset; the wake GET and its redaction are any host's);
  the legacy names read only in `env.ts`, only under their own host, alias-over-canonical so the
  owner's one 2.x `.env` keeps serving both registrations (3 alias notes under local, 7 under
  molten, logged at startup); the placeholder refused in 236 ms where it used to sit behind the
  600 s budget; `FOUNDRY_WORLD_ID` optional — the one world on the authenticated `/setup` is
  launched (`game.worlds`, the tiles as fallback; several = a refusal naming them), and the live
  `game.world.id` replaces config for world-scoped default paths. The bridge file plane: probed
  first (14.368, role 3 — browse returns URL-encoded paths and throws on a missing dir;
  createDirectory has no parents; upload overwrites silently and answers `false` with no reason
  for a bad extension or a missing dir; no delete / move exists), then built page-side over
  `FilePicker.implementation` + same-origin HEAD / GET and composed with the direct plane in
  `filePlaneFor` — so no tool says "not configured" any more; delete / move refuse by name with
  the direct-plane variables, `copy` is a download + upload, `.html` is refused (Foundry's
  uploadable set). Then the chat enum, `library` + `bridgeUser` in `get-world-info` (the sandbox:
  MM / PHB / DMG / heroes-faerun present, ravenloft missing), the role warning. Pulled forward
  from M5: the integration gate runs on the selector. Left for M5 as planned: the 19 scripts
  that read `MOLTEN_*` by hand (`local-foundry.mjs`, `pull-prod-to-local.mjs`, `hostFor(env)`
  callers). **Owner step before restarting Claude Code:** the `foundry-molten5e` registration
  (`~/.claude.json`, `.mcp.json`) must set `"env": {"FOUNDRY_HOST": "molten"}` — today it sets
  nothing and resolves to `generic`, where `MOLTEN_SERVER_URL` is not read and startup refuses
  naming `FOUNDRY_URL` (loud, not silent); `foundry-local5e`'s `FOUNDRY_PROFILE=local` keeps
  working (one alias note). **M5 done** (4 commits here + 9 across the siblings): the package
  declares its surface — `exports` `.` / `./client` / `./hosts` / `./env`, `bin`, `files`,
  `main` = dist/client.js (never dist/index.js, which calls `main()` at import), playwright a
  dependency, the vitest-importing helpers out of dist/. `src/client.ts` is the sibling
  contract: `Foundry` (+ `disconnect()`, the alias 16 battleflow suites had been calling into
  the void), `foundryConfig(env, host?, identity?)` (the config with the Host attached),
  `connectFoundry(...)` (.env → host → identity → connect, the watchdog armed before the connect,
  dispose raced against 15 s — the harness battleflow / fxstudio / miscpatches had each written),
  the identities `bridge` / `suite` (FOUNDRY_SUITE_*, alias BF_SUITE_*) / `player`
  (FOUNDRY_PLAYER_*, alias MOLTEN_TEST_*; no admin key); `src/env.ts` is the ONE .env reader
  (dotenv.parse — byte-identical to the hand loop on the owner's 20 keys; `FVTT_MCP_ENV` moves
  the file for the whole family), which the server, the 65 scripts, the live suite and every
  sibling now share (97 copies of the six-line loop in this repo alone, three variants, gone).
  The scripts on the review's classification (decision #8): 6 deleted, 10 moved into
  lootshelf / partystash / soundscape / soundscape-sfx `tools/` on the contract (each repo got
  a package.json with the `file:` dependency), 17 spikes archived under `docs/history/spikes/`
  with advancement.ts citing their commits, the 3 campaign-bound verifies on ZZ fixtures (a
  core icon for the background, a throwaway npc, a built-in legacy sidecar), `hostFor` (the
  helper that defaulted to PROD) gone, the launcher / mirror / deploy / register / uninstall
  scripts on the host presets — local-foundry discovers the one world under Data/worlds when
  FOUNDRY_WORLD_ID is unset (the launcher is HTTP-only, so the disk stands in for /setup),
  deploy-house-module writes through the host's own file plane instead of two hand-rolled ones,
  register/uninstall discover the world on the authenticated /setup and accept the 14.367 join
  field; knip now reads `scripts/` (an unlisted package fails the gate). Siblings: battleflow
  (21 files; the prod branch's dead `magicUrl` fixed by riding the Host), fxstudio (a
  package.json declaring `classic-level` too — it had reached it through this repo's
  node_modules), miscpatches, the four module repos, the artificer and the campaign repo (docs).
  Three things it surfaced: (a) `pull-prod-to-local --dry-run` wakes the prod box as its FIRST
  step — it was run once to prove config resolution and did (nothing written; the mirror only
  reads prod); (b) two verifies had been broken since M2 (`searchCompendiumFaceted` now answers
  `{results, totalFound}`) and two since M4 (the registry needs `host`) — all four were outside
  the release set, fixed on the way; verify-icons still has one product FAIL ("explicit img is
  respected") for the icons family's own pass; (c) the moved module harnesses connect through
  the contract, and two of them then fail on the module's side — verify-lootshelf's kernel
  refuses its probe item on the current sandbox world, verify-partystash's drag-and-drop move
  assertions fail on dnd5e 6.0.3 (8/…) — pre-existing, recorded in those repos' commits for
  their next pass. The battleflow `.claude/worktrees/nostalgic-curie-8e42e7` checkout still
  carries the old path (another branch; not touched). Nothing pushed yet — 13 commits across 10
  repos are local. **M6 done** (2 commits). F5 first, the coded error contract: the page throws
  a `PageError` whose code rides in the Error's `name`, the one field measured to survive
  `page.evaluate` (live: the Node-side `.name` is `Error`; the header is
  `page.evaluate: PageError:not-found: …`); 359 of 393 page throws coded by a reviewed codemod
  (invalid 231 · not-found 95 · unsupported 21 · ambiguous 10 · permission 2), the 34 left are
  Foundry's own words (`Failed to create …`, `Actor.create returned nothing`) and the
  serialization guard; 25 catch-and-rewrap shells (10 page, 15 tool) deleted — each turned a
  coded error back into a plain one; `BridgeError` on the Node side (`code` / `fn` / `detail` /
  `pageStack`, the 2.x message shape kept for the siblings, exported from the client); the mapper
  rewritten around the code (one hint each; the substring classifier gone; an uncoded error is
  its raw words). Then F24, the seam typed end to end: the checker (not the review's regex)
  counted 93 untyped returns and 9 `any` args over 156 handlers; taking the `Promise<unknown>`
  annotations off let inference type 85 returns for free, 8 needed a written shape (six
  `game.x.contents.map(…)` lists, `addItem`, `importItemFromCompendium`); the 9 args are the
  tools' zod output by type-only import (add-feature's six per-kind schemas hoisted to module
  scope for it), except `addSpellsToActor`, which create-pc calls page-side with an
  `alwaysPrepared` the tool never exposes — declared page-side. The flip
  (`call<N>(name, ...PageArgs<N>): Promise<PageResult<N>>`, the bridge plane's `PageCaller` on
  the same types) exposed 446 tool-side errors, most of them `exactOptionalPropertyTypes`
  friction from page types that said `field?: T` for a field that arrives as `T | undefined` —
  900 optionals widened by codemod; the rest were real: 13 dead `result.error` checks in
  journal.ts (the page throws, never answers `error`), five `call<Shape>` casts in the bridge
  file plane, six `call('x', {})` on argless handlers, 31 placeable wrappers still typed
  `sceneIdentifier: string` after M2 made it optional, a `describeUser` returning
  `Record<string, unknown>`, and the miss unions (`updated: false` / `found: false`) that never
  narrowed because the discriminant wasn't literal. Two misses that were success-shaped
  (`getJournalContent` / `getJournalPageContent` answering `null`, `setActorArt` /
  `addJournalImage` answering `{updated:false, notFound}`) now throw `not-found` (design.md §3);
  the other nine miss unions keep their shape for M8's family commits. The `SeamGuard` type next
  to `PageApi` is the ratchet: an `any` / `unknown` result, an `any` arg or a second parameter
  fails `tsc` naming the handler (proven). tools/list unchanged at 287,838. Live: the release
  verifies touching the change — error-contract 15/15, journal 20/20, item 13/13, placeables
  34/34, actor 38/38, region 22/22, pc-build 70/70, scene-tools 16/16, users 27/27, group 26/26 —
  and integration 80 passed / 6 skipped. **M7 done** (8 commits). The toolset split first
  (`world` → `session` + `settings`; always-on 10,814 → 1,578), landing the prose budget as a
  ratchet with a per-family pending set so every commit kept the gate green; then F22 — the
  four shared target leaves in `src/tools/_targets.ts` and the test that a `*Identifier` leaf
  starts with its rule's text (proven to name an offender), which surfaced add-feature
  advertising "exact name or ID" over a fuzzy resolver and three copies of one field; then the
  diet, one family per commit, largest first: actors 111,142 → 76,759, scenes 83,605 → 64,727,
  compendium + items, journals + tables + cards, audio + chat + combat, assets + organization —
  tools/list 287,838 → 205,248 (−28.7%; the review's mechanical ceiling was ≈ 240k, beaten by
  cutting the under-budget prose to the same rule), leaf prose −34%, descriptions −60%,
  structural bytes untouched (the schema shapes did not change). What the rewrite removed is
  named per commit; what it kept is the contract: inputs, the refusals the tool enforces
  ("an SRD pack is refused", "a non-empty folder is refused unless deleteContents"), the
  reports, the defaults, and the sibling a description routes to by name. Three things it
  surfaced: (a) eleven verify scripts outside the release set had been reading the pre-M2 array
  shape from the search handlers (`Array.isArray(hits)`) — content-audit, cast-activity,
  loot-copy, prefab-bridge, actor-read-fixes, icon-tier2, scale-report, faceted-lookup,
  table-tooling, reads, write-tools — all re-pointed to `.results` and green, except
  icon-tier2's three product assertions (the icons family's own pre-existing FAIL from M5);
  (b) authoring-policy.md rule 12 said content-audit does NOT scan description prose — it
  has since 59516a6 (rule 12, item descriptions only) — corrected, with the fix-up doctrine
  the tool description used to hold moved into rule 11; (c) two unit tests pinned the old
  wording (NONE / INHERIT, ALWAYS-PREPARED) and now pin the same facts in the new. Skills were
  not re-pointed — no tool or argument was renamed. **Next: M8** (the CRUD consolidation, one
  family per commit, each family's advertised bytes ≤ today's).
- 2026-09-21 — **M8 started**: the union builder (`src/tools/_union.ts` — root `type:"object"`
  with the discriminators as enums and the shared target leaf described ONCE, one closed
  `anyOf` member per op with `const` discriminators and the op's old tool description; dispatch
  selects the member, refuses an unknown value / key by name against THAT member — the registry's
  closed-top-level check skips union tools for it — then parses with the member's own zod,
  refinements included) and the first family: **tiles / lights / walls / drawings → one
  `manage-placeables`** (`kind` × `action`), 16 tools → 1, uniform keys (`items` / `patches` /
  `ids` — the old `tiles` / `tileIds` are refused by name, never silently dropped), their list
  results on the §3 line shape (`N tile(s) on "Scene" (id) [active]: id x y …` then one row
  per record; a space in a value is JSON-quoted, a missing cell is `-`, a numeric array one
  cell). Measured: the naive b2 union of the sixteen was 26,802 chars (+5.4% — the review's
  +4.5% reproduced); the shared `sceneIdentifier` hoisted to the root, `const`-only
  discriminators and the sentences every member repeated ("GM-only", "missing ids are
  reported, never fatal", "Returns the ids") moved into the family description bring it to
  **24,711 vs 25,440** (−2.9%); tools/list 205,248 → **204,521**, names 151 → **136**
  (11,147 → 10,106 chars); `src/measure.ts` counts a member description as a description
  (the ≤ 400 budget), not a leaf. Re-pointed: scene-builder's one line (`list-tiles` /
  `list-walls` / `list-lights`), `skills-matrix` 0 unresolved / 0 stale, `tool-results` and
  `schema-decompose`, the sibling grep clean (one historical build-handoff note in the
  campaign repo names `list-lights` — history, not a call). Decision #20 for the sixteen: all
  kept as actions (create / update / delete of the four kinds are what the sidecar path and
  the app's slow edit loops need). Live: verify-placeables-tooling **64/64** with the new
  section G (every kind × action through `dispatch`, the line headers, the four refusals —
  which caught the registry's generic check answering before the member-precise one; fixed),
  integration 80 passed / 6 skipped. What the first-use load costs a deferred client: the one
  tool is 24.7k chars ≈ 6.9k tokens where a per-op tool was ≈ 1.6k — the union's price in
  Claude Code, paid once per session, against 16 × 45 = 720 name-chars saved on every prompt.
  Next: sounds → notes → tokens → regions into the same tool, then macros.
- 2026-09-21 — **M8 sounds** into `manage-placeables` (`kind: "sounds"`): 4 tools → 0 new
  names, the union 24,711 → 30,107 (+5,396) against the four's **5,726** (−5.8%); tools/list
  204,187, names 132. Re-pointed: playlist-builder (1 body line) and soundscape-builder (2 body
  lines); both front-matter descriptions named `create-sounds` in a parenthetical and now say
  "an AmbientSound placeable" — the trigger phrases untouched and the ≤ 8,000 budget kept
  (7,986). Live: verify-placeables-tooling **69/69** (section G now creates / lists / updates /
  deletes a sound; a list row renders the `darkness` object as JSON — the dump's shape, left
  for the page), integration 80 passed / 6 skipped.
- 2026-09-21 — **M8 notes** into `manage-placeables` (`kind: "notes"`): 4 tools → 0 new names
  (`create-scene-notes` / `list-notes` / `update-note` / `delete-note`), the union 30,107 →
  33,397 (+3,290) against the four's **3,406** (−3.4%); tools/list 204,067, names 128. Two shapes
  made uniform with the other kinds: `update` takes `patches` (the single-target `noteId` form
  is gone — the pin-nudge loop passes one patch) with the batch formatter's wording ("Updated 0
  of 1 matched" + the warning where the old tool said "No changes applied"), and `sceneIdentifier`
  is optional (the active scene) where the three write tools had required it. Re-pointed:
  tom-cartos-import (steps 4 and 6), plot-drift-check (the pins row); two registry tests that
  named the old tools now assert the notes kind. Live: verify-placeables-tooling **74/74**,
  integration 80 passed / 6 skipped.
- 2026-09-21 — **M8 tokens** into `manage-placeables` (`kind: "tokens"`): 4 tools → 0 new names
  (`list-tokens` / `place-tokens` / `update-token` / `delete-tokens`), the union 33,397 → 38,362
  (+4,965) against the four's **5,225** (−5.0%); tools/list 203,793, names 124 (9,270 chars).
  `place` is `action: "create"` (`items`); `update` keeps its bespoke shape — targets `ids`
  and/or `actorIds` (every placed copy), ONE patch for every match, the per-token report — with
  its scene miss now `isError` (§3; it had been a prose string); `delete` takes `ids`.
  Re-pointed: plot-drift-check, session-audit (3 lines), soundscape-builder (2), token-cutout,
  `_shared/authoring-policy.md`, and the two tool descriptions that routed to `update-token` by
  name (update-actor, set-actor-art's stale-copies report). **Found live, fixed on the page:**
  section G views the fixture scene (the tile-bounds check), so a token update ANIMATES and the
  v13+ TokenDocument reports x / y / rotation / elevation mid-flight for a moment (a rotation to
  90 read 54 a few ms after the write) — the update report and the list dump now read `_source`
  for the animated fields (`stored()` in `src/page/placeables/token.ts`; the old tool had the
  same report and the old verify never viewed the scene). Live: verify-placeables-tooling
  **78/78**, verify-token-tooling 11/11, verify-token-reskin 10/10, integration 80 passed /
  6 skipped.
- 2026-09-21 — **M8 regions** into `manage-placeables` (`kind: "regions"`) — the placeables
  done: **35 tools → 1**. The four CRUD ops plus the three specials as their own actions
  (`create-teleporter`, `add-behavior`, `remap-teleporters` — regions-only; another kind
  refuses them by name, and the two that carry their own targets advertise no
  `sceneIdentifier`), the union 38,362 → 48,359 (+9,997) against the seven's **10,026**
  (−0.3% — the naive fold was 32 over; two phrases the update member repeated from its leaf
  paid for it); tools/list 203,763, names 117 (8,747 chars). `update` takes `patches` (the
  single-target `regionId` form and its shape echo are gone; list reads the shape back);
  `delete` takes `ids`; the region / scene misses of add-behavior and create-teleporter are
  `isError` (§3). The legacy per-op module contract and the JSON list pass-through are deleted
  with the last kind. Re-pointed: scene-builder (8 lines), tom-cartos-import (5), scripts/README
  (2), create-scene's three prose lines that named `remap-teleporters`; skills-matrix 0 / 0.
  Live: verify-placeables-tooling **87/87** (G: region create / list / update-by-rect / delete,
  a same-scene one-way teleporter, a teleportTo behavior resolved onto it, a no-op remap, the
  region-miss refusal), verify-region-tooling 22/22, verify-region-effects 37/37,
  verify-teleporter-scene-fields 13/13, integration 80 passed / 6 skipped. What a deferred
  client now loads on first use of any placeable: 48.4k chars ≈ 13.4k tokens, once per session.
  Next: macros → folders → playlists → cards → tables → items → journals → scenes → actors.
- 2026-09-21 — **M8 macros → `manage-macros`** (`action`: create / list / delete): 3 tools → 1,
  the union **2,056** against the three's **2,057** (−0.05%). The small-family overhead measured:
  the naive fold was 2,238 (+8.8% — the `action` enum, three `const`s and three member wrappers
  are ≈ 300 chars a three-member family cannot amortise); paid for in prose that said nothing the
  schema did not: "GM-only" once in the family description, the `type` leaf's "Default script."
  (the advertised `default` already says it), the list description no longer restating its own
  filter leaves, the delete leaf's "Find them with list-macros", the img leaf tightened.
  tools/list 203,760, names 115 (8,613 chars). The list moves to the §3 line shape —
  `N macro(s): id name type author pins`, verbose appends `hotbar command`, an empty result is
  the header alone — and create / delete are one-line confirmations (the `✅` / `🗑️` markdown
  gone). The §3 line helpers are now shared: `src/utils/lines.ts` (`listLines` / `cell` /
  `warningBlock`), the placeables formatter re-pointed to it — every family from here uses the
  same three. Re-pointed: nothing in `.claude/skills` or the siblings named a macro tool
  (skills-matrix 0 / 0); tool-results and the registry tests. Decision #20 for the three: kept as
  actions (the hand-a-player-a-one-click-button op is a GM ask no skill scripts yet). Live:
  verify-macro-tooling **38/38** with the new section 9 (create / list / verbose + user filter /
  delete through `dispatch`, the three refusals, the member refinement surviving dispatch),
  verify-placeables-tooling 87/87 (the moved formatter), integration 80 passed / 6 skipped.
  Next: folders → playlists → cards → tables → items → journals → scenes → actors.
- 2026-09-21 — **M8 folders → `manage-folders`** (`action`: create / list / update / delete):
  4 tools → 1, the union **2,441** against the four's **2,846** (−14.2%) — the first family to
  land well under, because the document-type enum the four each advertised (85 chars × 3) is the
  `shared` root leaf described once ("create requires it; list omitted = every type; update /
  delete default Actor") and every member advertises it bare. tools/list 203,696, names 112
  (8,404 chars). `delete-folder` moves out of `actor-creation.ts` into the union (its `type`
  becomes the same enum the other three took; the free string it accepted named no folder type
  the page lists). The §3 shapes: list is `N folder(s)` / `N <Type> folder(s)` then
  `id name type depth path color sort parent docs subfolders` (+ `orphaned` only when a row
  dangles) in the page's DFS order; create / update / delete are one-line confirmations; a folder
  miss on update / delete is `isError` (both had answered prose in a success shape). Re-pointed:
  plot-drift-check (1 line), tom-cartos-import (3), README's organization parenthetical,
  bulk-delete's "Folders:" pointer, tool-results, the registry tests (115 → 112, the dogfood-gap
  test names the union); skills-matrix 0 / 0; siblings 0. Decision #20 for the four: kept as
  actions. Live: verify-folder-tooling **25/25** (the new dispatch section: create under a parent
  with a color, the list header + row for the child and the parent's subfolder count, rename +
  reparent-to-root + sort read back, the two refusals by name, the two misses as errors, the
  non-empty delete refused, the empty delete), verify-folder-sort 8/8, integration 80 passed /
  6 skipped. Next: playlists → cards → tables → items → journals → scenes → actors.
- 2026-09-21 — **M8 playlists → `manage-playlists`** (`action`: create / list / update /
  delete): 4 tools → 1, the union **2,102** against the four's **2,129** (−1.3%; the naive fold
  was 2,258, +6.1%). The `mode` enum is the `shared` root leaf (create and update each carried
  it); leaf prose that restated an advertised default or range paid the rest ("Whether each
  track loops (default false)" beside `default:false` → "Each track loops."). tools/list
  203,666, names 109 (8,183 chars). The §3 shapes: list is `N playlist(s): id name mode tracks
  playing` with the mode BY NAME (the page had returned Foundry's number); create is one line
  (the per-track echo of the paths passed is gone); update's miss is `isError`; delete is the
  shared `deletedLine` (`src/utils/lines.ts`, over the page's `deleteByResolver` shape — cards /
  tables / scenes / bulk-delete take it as they land). **Found live, fixed on the page:** v14 has
  NO soundboard playlist mode — `CONST.PLAYLIST_MODES` is DISABLED / SEQUENTIAL / SHUFFLE /
  SIMULTANEOUS and the schema's `mode` choices are `[-1, 0, 1, 2]` (probed); "Soundboard Only" is
  the UI's label for DISABLED. The page had mapped `soundboard` to a phantom 3, stored it as
  sequential, and the create echo reported the REQUESTED name — the union's dispatch section
  (create soundboard → list reads sequential) caught it. Now `soundboard` and `disabled` are
  both DISABLED, the create echo reads the stored mode back, DISABLED lists as `soundboard`, an
  unknown mode is refused (playlist-builder's mode table — "nothing auto; each track triggered
  manually" — was right all along). Re-pointed: playlist-builder (5 lines), scene-builder (2),
  plot-drift-check (1), README (the tool row + counts), tools-reads.int.test + verify-read-tools
  (both called the class method), tool-results; skills-matrix 0 / 0; siblings 0. Decision #20:
  the four kept as actions. Live: verify-playlist-tooling **19/19** (the dispatch section: create
  soundboard, the list row, rename + re-mode + fade read back, the two refusals, the miss, the
  delete with the not-found tail), verify-read-tools 7/7, integration 80 passed / 6 skipped.
  Next: cards → tables → items → journals → scenes → actors.
- 2026-09-21 — **M8 cards → `manage-cards`** (`action`: create / import / list / delete): 4 tools
  → 1, the union **2,007** against the four's **2,009** (−0.1%; the naive fold was 2,132, +6.1%).
  `folderName` (create + import) is the `shared` root leaf; the rest was prose that restated
  its own leaves (the create description listing the card fields, the import description saying
  "a standard 52-card deck" beside the preset leaf's keys, "Stack type (default "deck")" beside
  the enum). tools/list 203,661, names 106 (7,980 chars). The §3 shapes: list is `N stack(s): id
  name type cards`; create / import are one line; delete is `deletedLine`. Re-pointed:
  cards-builder (6 lines), README (counts + the CRUD parenthetical), tool-results, the registry
  tests (109 → 106); skills-matrix 0 / 0; siblings 0. Decision #20: the four kept as actions.
  Live: verify-cards-tooling **15/15** (the dispatch section: a pile with one card, the poker
  preset import, the list header + both rows, the two refusals by name, the delete with the
  not-found tail), integration 80 passed / 6 skipped. Next: tables → items → journals → scenes
  → actors.
- 2026-09-21 — **M8 tables → `manage-rolltables`** (`action`: create / import / list / get /
  update / delete): 6 tools → 1, the union **5,578** against the six's **5,646** (−1.2%; the naive
  fold was 5,703, +1.0%). `roll-on-table` stays its own tool (a play op, not CRUD — the family the
  plan named). `identifier` (get + update) and `folderName` (create + import) are the `shared`
  root leaves; the result-entry `uuid` leaf (inlined twice, under create's and update's
  `results`) no longer restates the @UUID / SRD sentence the family description carries, and
  the update description no longer restates its `results` / `editResults` leaves. tools/list
  203,588, names 101 (7,605 chars). The §3 shapes: list is `N table(s): id name formula results`;
  create / import / update are one line (import's "Roll it with roll-on-table" gone); get / update
  / roll-on-table misses are `isError` (all three had answered prose); delete is `deletedLine`.
  `get` keeps its entry rendering (the reader the skills copy raw text from). Re-pointed:
  table-builder (7 lines), plot-drift-check (2), README (counts + the CRUD parenthetical), the two
  page-side error hints that named `get-rolltable`, the SRD refusal's tool label, tool-results,
  the registry tests (106 → 101); skills-matrix 0 / 0; siblings 0. Decision #20: the six kept as
  actions. Live: verify-table-tooling **52/52** with the new section 9 (create with a weight + a
  uuid result, the list row, get's ranges-from-weights + resolved link, rename + one in-place
  edit, roll-on-table through dispatch, the two refusals, three misses as errors, the delete with
  the not-found tail) — and its DMG-draw check made deterministic (the Arcana table has plain-text
  entries; one d100 draw could miss a link and had flaked twice) — integration 80 passed /
  6 skipped. Next: items → journals → scenes → actors.
- 2026-09-21 — **M8 items → `manage-items`** (`action`: create / list / get / update / delete /
  import): 6 tools → 1, the union **4,613** against the six's **4,679** (−1.4%; the naive fold was
  4,767, +1.9%). `import-item` (the dnd5e compendium copy, `src/tools/dnd5e/import-item.ts`)
  is the `import` member — the file keeps its contract, its dnd5e / SRD guards and its
  confirmation, the class is gone; `remove-from-actor` stays its own tool (an actor-side op) and
  add-feature's un-advertised add-to-actor route calls `handleAddActorItems` directly. **Toolset
  note:** `import` now rides the `items` toolset (`import-item` had sat in `actors`) — a
  registration that names `actors` alone no longer carries the compendium copy; `actors,items`
  does. `folder` (create / list / import) is the `shared` root leaf; the family description
  carries the unidentified-mask sentence once (get / update had each said it) and the import
  description no longer lists the leaves beside it. tools/list 203,549, names 96 (7,280 chars).
  The §3 shapes: list is `N item(s): id name type folder` (+ `trueName` only when a row is
  masked; the old JSON `{items,total}` gone); create / update / import are one line naming each
  id + type (+ the true name); delete is `deletedLine`; get stays JSON. Re-pointed:
  physical-item-builder (11 lines), stat-block-builder (8), pc-builder (5), authoring-policy (4),
  table-builder (3), plot-drift-check (2), the four tool descriptions that named `import-item`
  as the gear path (add-item, add-feature, group, author-npc), README (counts + the CRUD
  parenthetical), tool-results, the registry tests (101 → 96); skills-matrix 0 / 0; siblings 0
  (the campaign repo's one mention is a session note). Decision #20: the six kept as actions.
  Live: verify-item-tooling **24/24** with the new section 11 (create two into a folder, the list
  row under the folder filter, the get JSON, rename + system patch, a PHB Dagger imported into the
  sidebar with a rename, the two refusals, the SRD refusal, the get miss, the delete with the
  not-found tail), verify-loot-copy 11/11 (the import path), integration 80 passed / 6 skipped.
  Next: journals → scenes → actors.
- 2026-09-21 — **M8 journals → `manage-journals`** (`action`: create / list / get / update /
  delete / delete-page): 5 tools → 1, the union **3,415** against the five's **3,442** (−0.8%; the
  naive fold was 3,668, +6.6%). `list-journals` had been three tools in one (a list, a journal
  read by `journalId`, a page read by `pageId`) — the union splits them per §3: `list` is the
  line shape `N journal(s): id name pages` (the page manifest no longer rides every row; the
  `includeContent` preview — N extra page reads no skill named — is dropped, decision #20) and
  `get` is the JSON read (the entry: first text page + page list with visibility; with
  `pageId`, that page), now resolving by exact name as the writes do (the page's
  `getJournalContent` / `getJournalPageContent` used `game.journal.get` — id only). `journalId`
  is the `shared` root leaf (get / update / delete-page). create / update / delete-page are one
  line (create names each page id; update says what changed); a page miss on delete-page is
  `isError`; delete is `deletedLine`. The styled-block quest tools, `search-journals`,
  `set-journal-page-visibility` and `add-journal-image` stay their own tools. tools/list 203,526,
  names 92 (**6,982** chars — the M8 name target ≤ 7,000 is met with three families still to go).
  Re-pointed: tom-cartos-import (5 lines), bestiary-builder (4), plot-drift-check (3),
  journal-builder (3), session-audit (2), scene-builder (2), session-scribe (1), the artificer's
  illustration-builder (1 line — a sibling tool list; edited in that repo, uncommitted), README,
  tools-reads.int.test + verify-read-tools, the error-handler test's sample tool name, the page's
  multi-page note, tool-results, the registry tests (96 → 92); skills-matrix 0 / 0. Live:
  verify-journal-tooling **32/32** with the new section 6 (create with a handout page, the list
  row, get by exact name with the page visibility, get by pageId, rename + page write, delete-page,
  the two refusals, the page miss, the entry miss, the delete with the not-found tail),
  verify-read-tools 7/7, integration 80 passed / 6 skipped. Next: scenes → actors →
  search-compendium ×4 → the actor projections.
- 2026-09-21 — **M8 scenes → `manage-scenes`** (`action`: create / list / update / delete): 4
  tools → 1, the union **10,323** against the four's **11,811** (**−12.6%**) — the biggest win
  of the diet: create-scene and update-scene had each inlined the same 25 geometry / mood /
  common leaves (the `environment` / `fog` / `initial` objects among them); they are now the
  `shared` root leaves described ONCE, with the members advertising them bare (`{type:"object"}`
  for the mood objects — the root carries the full shape and, being root `properties`, still
  validates the instance) and create still requiring `backgroundPath`. The view / routing tools
  (get-current-scene, activate-scene, pull-users-to-scene, set-landing-scene,
  get-scene-dimensions, screenshot-scene) stay their own. tools/list **202,035**, names 89
  (6,779 chars). The §3 shapes: list is `N scene(s): id name active width height grid darkness
  weather tokens walls` (+ `flags` under `flagScope`; width / height are the padded canvas as
  before); create / update keep their fact reports (dimensions, imported counts, the effective
  settings — what scene-builder and tom-cartos-import read back), update's miss is `isError`;
  delete is `deletedLine`. Re-pointed: scene-builder (13 lines incl. two call-shaped snippets),
  tom-cartos-import (9), plot-drift-check / session-audit / soundscape-builder / playlist-builder
  (1 each), the artificer's illustration-builder (1, sibling, uncommitted), README (counts + the
  tool table row), scripts/README, the soundscape page's scene-miss hint, tools-reads.int.test +
  verify-read-tools, the error-handler test, the toolset tests (they had named create-scene as
  the out-of-set example), tool-results, the registry tests (92 → 89); skills-matrix 0 / 0.
  verify-toolsets read the surface from the TOOLSETS table (it had a hard-coded 151 that went
  stale with the first M8 commit). Live: verify-scene-tools **24/24** (the sidecar import now
  through the union; the new dispatch section: create with darkness / weather / flags, the list
  row under a filter with `flags[flagScope]`, rename + darkness with weather cleared, the two
  refusals, the miss, the delete with the not-found tail), verify-scene-sidecar 13/13,
  verify-teleporter-scene-fields 13/13, verify-read-tools 7/7, verify-toolsets 10/10,
  integration 80 passed / 6 skipped. Next: actors → search-compendium ×4 → the actor projections.
- 2026-09-21 — **M8 actors → `manage-actors`** (`action`: list / get / update / delete): 4
  tools → 1, the union **13,381** against the four's **13,403** (−0.2%; the naive fold was 13,621,
  +1.6% — the update member's description had listed every field group its leaves already
  name). The members ride their modules — `update-actor`'s contract, dnd5e guard and
  confirmation stay in `src/tools/dnd5e/update-actor.ts` (`UpdateActorSchema` / `updateActor`;
  the class is gone), `delete-actor`'s in `actor-creation.ts` (`DeleteActorSchema` /
  `deleteActors`; the class keeps create-from-compendium + duplicate) — and `get` takes
  `actorIdentifier` like the rest of the family (`get-actor` had been the one `identifier`),
  the `shared` root leaf get and update advertise bare; delete keeps its strict `identifiers`
  array. The reads that stay their own: get-actor-entity, export-actor, search-actor-contents
  (the projections step folds the first two). tools/list **202,010**, names **86** (6,582 chars
  — both M8 name targets met: ≤ 90 names, ≤ 7,000 chars). The §3 shapes: list is `N actor(s): id
  name type`; get stays the compact-sheet JSON; update is one line naming the groups applied;
  delete is `deletedLine` + the removed folders. **F45 rides this commit:** `src/page/actors.ts`
  (2,257 lines, 14 exports) is split along its export groups into `src/page/actors/reads.ts`
  (771: list / sheet / export / entity / search / find), `writes.ts` (837: create-from-compendium,
  delete, duplicate, add / remove items), `update.ts` (665: updateActor / updateActorItem) with
  an `index.ts` barrel (page/index.ts and dnd5e/advancement.ts import through it); each file
  carries only the imports and constants it uses; the two pure spell builders are exported for
  `reads.test.ts` (6 cases) beside the moved `writes.test.ts` (extractDamageProfile). Re-pointed:
  stat-block-builder (21 lines), physical-item-builder (12), pc-builder (8), session-audit (7),
  authoring-policy (4), plot-drift-check (3), token-cutout / session-scribe (1 each), the
  artificer's illustration-builder (2, sibling, uncommitted), the six tool descriptions / leaves
  that named an old actor tool (items, token, pc, create-actor-from-compendium), the group page's
  hint, README (counts + three mentions), the measure test's strict-tool set, the error-handler /
  system-detection tests' sample names, tools-reads.int.test + verify-read-tools (the first row's
  name cell parsed as the §3 line prints it), tool-results, the registry tests (89 → 86);
  skills-matrix 0 / 0. Live: verify-actor-tooling **47/47** (the new dispatch section: the list
  row, the sheet JSON, an update naming its groups, the two refusals, the get miss, the strict
  delete — a substring of the name deletes nothing where the fuzzy get finds it — then the
  delete), verify-pc-build 70/70, verify-reskin-visibility 18/18, verify-effects-6 51/51,
  verify-item-tooling 24/24, verify-actor-export 9/9, verify-read-tools 7/7, integration 80 passed
  / 6 skipped (the split bundle under every one). Next: search-compendium ×4 → the actor
  projections.
- 2026-09-21 — **M8 search-compendium ×4 → one with `type`** (`type`: any / creatures / spells /
  items): 4 tools → 1, the union **4,447** against the four's **4,721** (−5.8%). The name search
  keeps its `query` (name terms, all must appear); the three faceted searches share the root
  `name` leaf (the substring facet) and their own facets; `limit` stays per member (the four
  had different ceilings — 50 / 500 / 200 / 200 — and the lenient string unions). The search
  bodies keep M2's one hit shape + `totalFound` (JSON; the §3 line rule is the list's — a search
  hit carries a `facets` object and a uuid). The per-tool "Parameter validation failed …
  Received args" wrappers are gone — the union parses with the member's zod and the central
  mapper renders a ZodError like everywhere else. tools/list **201,746**, names **83** (6,299
  chars). Re-pointed: stat-block-builder (6 lines), physical-item-builder (4), table-builder
  (3), pc-builder (2), authoring-policy (2), journal-builder (1), the manage-activity page hint,
  two source comments, README (counts + the CRUD paragraph), tools-reads.int.test +
  verify-read-tools (three faceted checks added: CR-¼ goblins, level-3 fire spells finding
  Fireball, rare wands), tool-results, the error-handler test, the registry tests (86 → 83);
  skills-matrix 0 / 0; siblings 0. Live: verify-read-tools **10/10**, integration 80 passed /
  6 skipped. Next: the actor projections (get-actor-entity / export-actor into manage-actors).
