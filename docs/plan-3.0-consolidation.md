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
| **M3** | **Skill descriptions + line fixes** — six descriptions applied, the other 11 trimmed; the two stale claims fixed; sidecar → `placeablesPath`; `hp` in `extractDerived`; `defaultArt` / `spells.alwaysPrepared`; `normalizePrototype` | F16 F28 F29 F30 F31 F32 | descriptions **≤ 8,000 chars** with all 40 trigger phrases (`skills-desc-check`); scene-builder's sidecar section ≤ 15 lines; 0 skill lines prescribing the post-art fix-up |
| **M4** | **Config contract + hosts** — `FOUNDRY_*` canonical (`FOUNDRY_URL / _USER / _PASSWORD / _ADMIN_KEY / _WORLD_ID / _HOST / _WAKE_URL / _TOOLSETS`; plane extras `FOUNDRY_DATA_DIR`, `FOUNDRY_WEBDAV_*`), **default host `generic`**, the placeholder refused at startup, aliases only in `src/hosts/env.ts`, worldId discovery, the bridge `FilePlane` (FilePicker) on every host, `send-chat-message` drops `webdav`, `library:{book: present|missing}` in `get-world-info`, a role warning after join, one default bridge-user name | F1 F12 F15 F36 F38 F46 | `git grep MOLTEN_ src` → `src/hosts/env.ts` only; `resolveHostConfig({})` → `generic` and a refusal in < 1 s; a generic registry advertises **0** "unavailable" asset tools; live: `upload-asset` / `list-assets` / `create-asset-folder` on `local` through the bridge plane |
| **M5** | **Package + sibling contract + scripts** — `exports` (`.` / `./client` / `./hosts` / `./env`), `bin`, `files`, `src/client.ts` (`Foundry`, `loadEnv`, `connectFoundry`, `disconnect()` alias), playwright → dependencies; the integration gate on the host selector; scripts classified (60 keep / 22 out / 17 archive), knip covers `scripts/`, the `.env` loop codemod; every sibling switched to `fvtt-mcp-dnd5e/client` | F2 F3 F25(a) F26 F27 | battleflow `node tools/smoke-saves.mjs --list` passes; **0** files in any sibling name `fvtt-mcp-molten5e`; **0** hand-rolled `.env` loops in `scripts/`; `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` runs without `MOLTEN_SERVER_URL`; `.env.example` declares every key the family reads |
| **M6** | **Error contract + seam typing** — the raw message always appended; the page encodes an error code in the Error's `name` (the channel that survives `page.evaluate`); the 74 page returns and 26 arg shapes typed, then `foundry.call` typed end to end | F5 F24 | 12/12 scratch error cases keep their text (unit test); **0** `any` results from `foundry.call` |
| **M7** | **Schema prose diet + toolsets** — prose budget (leaf ≤ 120, description ≤ 400) enforced by a test; 15 descriptions rewritten to contract-only; doctrine moved into the skills; `actorTarget` / `actorTargetStrict` shared instances; `world` → `session` + `settings`. **Before M8.** | F10 F22 F23 | `tools/list` **≤ 230,000 chars**; every leaf ≤ 120 / description ≤ 400; always-on set **≤ 2,100 chars** |
| **M8** | **CRUD consolidation — one family per commit** — the lossless `op` union (+ `kind` for placeables), member descriptions kept, top-level `type:"object"`; the family's skill lines re-pointed (185 SKILL.md lines name a CRUD tool), its verify script re-pointed, the sibling checklist entries; `actors.ts` split rides the actor commit. Order: tiles / lights / walls / drawings (skill-cheap) → sounds → notes → tokens → regions → macros → folders → playlists → cards → tables → items → journals → scenes → actors → `search-compendium` ×4 → one with `type` → the actor projections (`get-actor` / `get-actor-entity` / `export-actor`) | F11 F20 F44 F45 F49 | per family: advertised bytes **≤ today's**; **0** unresolved tool names in `.claude/skills` (`skills-matrix`); the family's verify counts in the commit. Overall: names **151 → ≤ 90**; two-registration name chars **≤ 7,000**; `tools/list` still ≤ 230k |
| **M9** | **Owner content out, docs in** — start-session / chat-and-narration host-neutral; session-scribe / soundscape-builder / tom-cartos-import per the decisions below; `_shared/campaign-repo.md`; owner strings scrubbed; design.md (already scrubbed here) re-checked; README rewritten (the owner's "git-friendly page, plain English, describes the project"); `CHANGELOG.md`; `CONTRIBUTING.md` (today's CLAUDE.md, tracked); `docs/hosts.md`; `docs/contracts.md`; the 8 done trackers → `docs/history/` | F13 F14 F33 F34 F35 F37 F39 F47 | Phase-2 grep (`phase[ -]?2\|wait-for-events\|event bridge\|session-assist\|next phase\|§8\|NUC`) → **0** outside `docs/history/`; owner-string grep (`greenrest\|broken-heart\|DM Assistant\|eoh-test\|foundry-molten5e`) → **0** outside `.env.example` and `docs/history/`; README ≤ 250 lines with the 60-second start before line 40 and a skills install step; `.claude/skills` carry **0** server prefixes |
| **M10** | **Release 3.0** — full offline gate, the release set, integration, the measurement scripts' numbers in the release notes; tag; the prod upgrade path documented (Foundry ≥ 14.367 first, then dnd5e 6.x) | — | every M0–M9 number restated and met |

Sequence: M0 → M2 → M3 (the largest per-prompt savings, no renames) → M4 → M5 (a stranger can run
it; the siblings are whole) → M6 → M7 (name-neutral hardening; the prose diet) → M8 (the only
renaming milestone) → M9 → M10.

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
  the system's rule; noted on the leaf). **Next: M3** (skill descriptions + line fixes; the six
  measured rewrites first, then the other 11 trimmed to ≤ 8,000 total). Open for the owner:
  `verify-wake.mjs` ran against prod for
  ~2 min before `96ed726` (its first step is a world shutdown; the wake was in progress when
  killed) — check the Molten panel; a bridge connect relaunches the world if it went down.
  Nothing pushed yet.
