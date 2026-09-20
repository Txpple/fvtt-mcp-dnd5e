# Architecture & performance review — 2026-09-20

> **State reviewed:** `main` @ v2.2.0 (`3839bbe`), 151 tools, 1,730 unit tests green (biome · tsc ·
> vitest · build · knip), sandbox dnd5e **6.0.3** / Foundry **14.368**; prod (Molten) on dnd5e 5.3.3 /
> Foundry 14.364. Produced by a multi-agent pass: 6 review dimensions (`perf-results`, `perf-schema`,
> `arch-seams`, `user-facing`, `siblings`, `skills`) + 2 research streams (`research-clients`,
> `research-dnd5e`) → lead-architect synthesis → adversarial verification: **50 findings, 9 confirmed,
> 41 corrected (a line number, a count, an estimate or a fix detail — no claim refuted), 0 refuted;
> every correction is folded in below.** The streams were read-only on the world: their numbers come
> from the 2026-09-20 sandbox capture (`scratch/measure-2026-09-20c.json`,
> `scratch/bodies-2026-09-20/`) or from offline scripts over `dist/` and the source; scripts are cited
> by path. The orchestrator added three live measurements the streams could not take
> (`scratch/profile-search-compendium-2026-09-20.txt`, `scratch/pin-6.0.3-targeted-2026-09-20.txt`,
> the `verify-wake` run) and the two commits that landed while the review ran (`96ed726`, `c53c2de`).
> Tokens ≈ chars / 3.6 throughout (no tokenizer was run). Where a claim rests on source alone it is
> marked **unmeasured**.
>
> **Frame.** The code is judged against its history — a Molten-Hosting-specific MCP
> (`fvtt-mcp-molten5e`, 2026-06) that grew into a full dnd5e authoring surface and, on 2026-09-20,
> was renamed and given a host seam — and against the owner's 3.0 decisions: **3.0 = the token/perf
> fix + first official dnd5e 6.x support + the refactor that makes it *the dnd5e MCP* with
> molten / local / generic as endpoints. 3.0 is terminal. Phase 2 is removed from every document.
> The repo is user-facing. The `fvtt-mod-*` / artificer repos are first-class consumers.** Nothing
> here proposes work beyond 3.0.

**Verdict: sound core, Molten-shaped contract, and a token bill that is mostly results and names —
not schema bytes.** The three load-bearing bets from the 2026-06 review still hold (one Playwright
import, one registry, one zod→schema path) and the 2.2 host seam holds where it was built. What
3.0 must change is the *contract around* those seams — env vars, defaults, packaging, skills that
know their host — and the shape of what tools *return*.

---

## 1. Headline findings

1. **In Claude Code the bill is results, names and skill descriptions — schema bytes are deferred.**
   One 24-call read baseline puts **154,534 chars ≈ 42.9k tokens** into the conversation; every prompt
   carries **302 tool names (11,147 chars ≈ 3.1k tokens)** and **17 skill descriptions (15,382 chars ≈
   4.3k tokens)**. The eager `tools/list` (283,948 chars ≈ 78.9k tokens per registration) costs only
   in Claude Desktop / claude.ai. (§3)
2. **Fewer tools does not mean fewer bytes.** A lossless `kind × op` union of 48 tools → 3 costs
   **+4.5%** (78,572 → 82,130 chars); the only shape that shrinks the eager list defers the same prose
   into tool *results*, which is the wrong direction for Claude Code. **67.4% of `tools/list` is
   English** (leaf `.describe()` 43.2%, tool descriptions 24.2%); structure is 25.8%. The byte diet is
   a prose diet; the CRUD consolidation pays through the **name list** (82 CRUD names = 53.1% of it).
   `$defs/$ref` is not a lever: `reused:'ref'` grows the list **+18.75%** and genuine reuse is worth
   0.34%. (§4)
3. **Two results were self-inflicted 186k / 228k-char surveys.** `search-compendium-creatures` has
   no `name` facet, so `{query:"goblin"}` was silently stripped (zod non-strict) and the default
   `limit: 500` returned the whole creature pool cut mid-JSON with `totalFound` lost;
   `list-actor-ownership` emits 7 user rows for all 168 actors even when every row is "inherited
   NONE" (227,662 chars; the explicit-only shape is 12,240). A compact projection of the other
   list/search bodies that keeps `uuid` on search hits saves **27%** of the baseline (154,534 →
   ≈112,600); line records halve the biggest lists again. (§3, F6–F9)
4. **The 2.2 seam holds in `src/`; the contract around it is still Molten.** `FOUNDRY_HOST` unset =
   `molten`; `FOUNDRY_URL` alone is silently ignored in favour of `https://your-server.moltenhosting.com`,
   and a stranger's first call spins for the **600 s** wake budget before the first error.
   `MOLTEN_*` is canonical, the integration suite gates on `MOLTEN_SERVER_URL`, 24 scripts and one
   shipped skill script bypass the env selector — **one of them, `verify-wake.mjs`, took the world
   down as its first step and ran against prod when invoked with `FOUNDRY_HOST=local` during this
   review (caught two minutes in; fixed in `96ed726`)** — `start-session` hard-codes
   `mcp__foundry-molten5e__get-world-info`, `send-chat-message` advertises `embed: "webdav"`, and the
   `generic` host has **no file plane** although Foundry's own `FilePicker.upload` works through the
   bridge on every host (9 tools and 7 of 17 skills dead on generic). (§5)
5. **The rename broke every sibling, and the hosts commit broke one silently.** 40 code files + 17
   docs across 6 repos name `fvtt-mcp-molten5e`; battleflow's `smoke-saves.mjs --list` fails at import,
   fxstudio's `classicLevel()` throws, and `e53958e` dropped `FoundryConfig.magicUrl` that battleflow's
   prod target still passes. The cause is an **undeclared library surface**: no `exports`, no `bin`,
   `main` starts a stdio server at import, `playwright` is a devDependency of the module that imports
   it, and this repo's `.env` is the family's secrets file (4 sibling keys in it that no tracked file
   names). (§7)
6. **The central error mapper destroys information.** It classifies by message substring and
   replaces the text with canned guidance without appending the original; page-side throws (395) are
   re-wrapped as plain `Error` by `page.evaluate` (custom properties do not survive it — measured),
   so the `FormattedToolError` escape hatch cannot reach where domain errors originate. **11 of 12**
   realistic errors lose their text (`Actor "Gren" not found (did you mean "Grendel"?)` → `Invalid
   request or missing data`). (F5)
7. **The skills ↔ tools line holds in shape and leaks in detail.** ≈150–185 SKILL.md lines restate
   enum/grammar the schemas already advertise (29/31, 21/21, 19/19, 16/16 token overlap) and that
   duplication has drifted twice; three skill steps read fields no tool returns (`list-scenes`
   flags/darkness); `scene-builder` spends 65 lines on a hazard `create-scene`'s `placeablesPath`
   already removes. 26% of the skill-description budget is non-triggering boilerplate; six rewrites
   **measure 15,382 → 11,982 chars (−22%)** with all 40 trigger phrases kept, and the same ratio over
   the other 11 would reach ≈7,400 (a target, not a measurement). (§8)
8. **A stranger cannot run it from the README.** No skills install step (skills load only when Claude
   Code runs inside this repo), three spellings of the registration name, no "create the bridge user"
   step, `playwright` missing from a production install, the owner's user name `DM Assistant` in a
   shipped tool description, `CLAUDE.md` (house rules, the release verify list) gitignored. (§6)
9. **The dnd5e 6.0.2/6.0.3 release notes under-report — and the pin is done.** Six unlisted
   commits changed ActiveEffect, Token and migration behaviour. Two of the three targeted live checks
   ran green during the review (a duration-less effect keeps `expiry` null on a combatant; a
   `sourceItem.*` rules condition persists) and the release set + integration passed on 6.0.3:
   `c53c2de`. The `elevation`-on-an-unviewed-scene check (#7470) is the one item left for 3.0.
   Foundry 14.368 is still latest stable — and it moved world shutdown to `POST /setup worldShutdown`,
   which the launcher's `stop` had silently stopped doing (`96ed726`). (§10)
10. **Phase-2 language lives in 18 lines of `design.md`, README:202-204, one tool description
    (`src/tools/journal.ts:282`), four docs and five skills** — plus 8 homonyms ("Phase 2 — write
    acceptance") that are plan-step numbering. The scrub is a bounded edit with a proposed replacement
    for §1/§4. (§9)

---

## 2. Alignment scorecard (design.md)

| design.md | Rating | Reason |
|---|---|---|
| §1 Mission / §4 roadmap / §8 | **Stale** | Still "two halves", a Phase-2 table section and all of §8/§8.1. Owner decision 3 removes them; replacement shape in §9. |
| §2.1 Skills decide, tools do | **Partial** | Tools carry doctrine ("LAST-RESORT path in the §6 ladder … ask before authoring" in `author-npc`; 48/151 descriptions carry a judgment word); skills carry correctness (enum tables, pixel math, the pregen-portrait path, `prepared: 2`). Both directions leak (F28–F32, F10). |
| §2.3 Compendium-first | **Aligned, one gap** | The one definition exists (`src/utils/compendium-sources.ts:40`, 5 prefixes — design.md still says 3); no presence check tells a user which books are installed (F36). |
| §2.6 Hosts are options | **Partial** | Seam holds in `src/` (Playwright at 1 site; no `host.kind` branching outside hosts). Contract around it Molten-shaped: default host, env names, gate, scripts, skills, `webdav` enum, no generic file plane (F1, F12, F14, F38, F46). |
| §3 A tool is a contract | **Partial** | Schemas generated from zod, but 134 of ~151 schemas strip unknown keys silently (F6); output formats 92 string / 51 JSON / 8 mixed with no per-family rule (F20). |
| §9 One registry / generated schemas | **Partial** | Registry derives one-directionally (an orphan definition survives; each name spelled in 3 files, F44); the seam is name-typed but payload-untyped (166 `foundry.call` sites, 0 typed results, F24); error classification by substring (F5). |
| §9 Quality gate | **Partial** | The gate names the offline suite; the proof it relies on is 16.5k lines of ad-hoc verify scripts gated on `MOLTEN_SERVER_URL` (F25). |

---

## 3. The cost model — numbers

### 3.1 What a Claude Code conversation pays today (owner's setup: two registrations, 17 skills)

| Cost | Measured | How |
|---|---|---|
| Tool **names**, every prompt | 302 names = **11,147 chars ≈ 3.1k tokens** (`mcp__<registration>__<name>` form; 11,749 as a comma list) | `scratch/siblings-names-cost.mjs`, `scratch/perf-schema-toolsets.mjs` |
| Skill **descriptions**, every prompt | 17 × front-matter = **15,382 chars ≈ 4.3k tokens** | `scratch/skills-matrix.mjs` |
| Tool **results**, per call | 24 ordinary reads = **154,534 chars ≈ 42.9k tokens**; two calls capped at 20,073 | `scripts/measure-tool-results.mjs` → `measure-2026-09-20c.json` |
| Tool schemas | deferred (loaded on demand by tool search) | research-clients; observed deferred list in this session carries names only |
| Latency | first call **8,840 ms** (bridge connect ≈ 8.1 s of it); `search-compendium` **7,826 ms** (13,200 cold) — of which **one pack's index build is 9.6–11.0 s** (`dnd-dungeon-masters-guide.equipment`, 548 entries) and the warm call is **176 ms**; faceted searches 534–627 ms; other reads 119–190 ms | `measure-2026-09-20c.json`; `scratch/profile-search-compendium.mjs` (live, two runs) |

### 3.2 What an eager client pays (Claude Desktop / claude.ai)

`tools/list` per registration: **151 tools, 283,948 chars ≈ 78.9k tokens** — descriptions 68,957 /
inputSchema 206,472 / names 2,478 / envelope ≈ 6,041 (`scratch/perf-schema-baseline.mjs`). Composition
(`scratch/perf-schema-decompose.mjs`):

| bucket | chars | share |
|---|---|---|
| leaf `.describe()` strings (1,209 fields) | 122,631 | **43.2%** |
| tool descriptions | 68,655 | **24.2%** |
| structure (`type`/`properties`/`required`/`anyOf`…) | 73,193 | 25.8% |
| enums (155 / 826 values) | 8,159 | 2.9% |
| default / const / envelope | 11,310 | 3.9% |

Top 15 tools = 118,253 (41.6%): manage-activity 17,514 · update-actor 16,403 · add-feature 13,906 ·
add-item 11,464 · create-scene 9,735 · manage-effect 8,155 · add-region-behavior 5,807 · update-token
5,288 · configure-soundscape 5,090 · update-scene 4,632 · configure-dnd5e-settings 4,570 · author-npc
4,335 · update-rolltable 4,150 · create-actor-from-compendium 3,621 · create-quest-journal 3,583.
Toolsets: `actors` alone 120,724 (42.5%), `scenes` 93,690 (33.0%); `chat,combat` 22,659 (8.0%); the
always-on `world` set 10,645 of which 8,697 (82%) is configure-dnd5e-settings / manage-calendar /
update-user / set-user-avatar.

### 3.3 The 24-call baseline by tool (as received)

| tool | chars | note |
|---|---|---|
| search-compendium-creatures `{query:"goblin"}` | 20,073 (cap) | arg stripped; 186,611 raw ≈ 493 hits × 379 |
| list-actor-ownership | 20,073 (cap) | 227,662 raw = 168 actors × 7 users × ~190 |
| list-items | 16,392 | img (avg 57 chars) + folderId per record |
| search-compendium-spells `{query:"fire"}` | 14,979 | arg stripped (schema key is `name`) |
| list-actors / `{type:"npc"}` | 13,210 / 11,946 | id,name,type,hasImage |
| list-scenes | 9,698 | 130-char background path × 50 = 6,825 of it |
| list-journals | 9,660 | |
| search-compendium `{query:"sword"}` | 8,954 | `description` is `""` on 42/42 hits |
| list-macros | 8,633 | no skill calls it |
| list-chat-messages / list-folders / list-compendium-packs | 6,135 / 5,763 / 2,861 | |
| get-world-info / get-current-scene | 1,805 / 1,700 | 758-char HTML description + 23-key automation block |
| list-tokens/-walls/-lights/-regions/-notes | 185 × 5 | zod error: `sceneIdentifier` required |

### 3.4 What each proposed diet saves

| Diet | Today → after | Saving | Basis |
|---|---|---|---|
| **Compact projection** of list/search bodies (id, name + the fields a skill reads; search hits keep `uuid`, get-world-info keeps `automation`) | 154,534 → ≈112,600 chars | **≈ −41,900 (−27%)** ≈ 11.6k tokens per baseline | `scratch/perf-results-projection.mjs` + verification: list-items −51%, list-scenes −70%, spells −14% (with `uuid` kept; −56% without), search-compendium −46%, get-world-info −46% (description + background dropped; `automation` kept — start-session :47 and session-audit :194-197 read it) |
| **Line records** for lists (same fields) | list-actors 13,210 → 5,927; list-items 16,392 → 4,769 | −55% / −71% on top of compact JSON | projection addendum |
| **list-actor-ownership** explicit-only shape | 227,662 → 12,240 (all actors) / ≈1,500 (only actors with an entry) | −95% | `src/page/ownership.ts:51-115` + projection |
| **search-compendium-creatures** `name` facet + `limit: 50` + compact hit (132 chars) | 186,611 → ≤ 6,600 for a name search | −96%; the intended call's real size is **unmeasured** | schema `src/tools/compendium.ts:55-149`; engine `compendium-facets.ts:289-296` |
| **Record-level cap** | 20,073 (torn record, counts lost) → 20,073 (whole records, `truncation:{kept,omitted,of}`) | 0 bytes; keeps `totalFound` | `scratch/perf-results-cap.mjs` |
| **Skill descriptions** | six rewrites **measured** 15,382 → 11,982; the other 11 at the same 0.482 ratio ≈ 7,400 (a target — those 11 carry less boilerplate, ~21% vs 31%) | **−22% measured** ≈ −945 tokens **per prompt**; −52% if the target holds | `scratch/skills-desc-budget.mjs`, `skills-desc-check.mjs` |
| **Names: project-scoped sandbox registration** (`FOUNDRY_TOOLSETS=world`) | 302 → 151 names in non-module repos; 302 → 159 in the module repos | −5,498 chars ≈ −1.5k tokens per prompt | `scratch/siblings-names-cost.mjs` |
| **Names: CRUD consolidation** 82 → 17 family names | 5,798 → ≈3,300 chars per registration | ≈ −43% of the name list per registration | perf-schema-names-1 (projected from the 53.1% share) |
| **Schema prose budget** (leaf ≤ 120 chars, description ≤ 400) | 283,948 → 234–254k | −30–50k (−10 to −18%) eager clients | perf-schema-results-1 (projected) |
| **Description rewrite** (15 tools ≥ 70% field-level) | 68,428 → ≈40k | −25–30k | `scratch/perf-schema-descriptions.mjs` (projected) |
| **`world` → `session` + `settings`** | always-on 10,645 → ≈1,939 | −8.7k on every narrow registration | `src/toolsets.ts:22-31` |
| Shape (a) `kind+op+describe` | 283,948 → 208,897 | −26.4% eager, but defers 78k chars into results | **rejected** (§4) |
| First call: skip the second `/join` load | 8,840 ms → **unmeasured** | no phase timing exists | `src/foundry.ts:243,357` |
| `search-compendium`: warm the indexes once per session (after `injectBundle`, or a lazy first-call prefetch); the document-type allow-list on top | 7.8–13.2 s cold → **176 ms warm** (measured); the allow-list alone saves ≈ 1.1 s (the RollTable packs); `Promise.all` saves nothing while one pack is 91% of the wait | live, two runs: 23 of 28 packs already indexed at connect; `dnd-dungeon-masters-guide.equipment` 9,636 / 10,965 ms; the other 27 ≤ 675 ms | `scratch/profile-search-compendium-2026-09-20.txt` |

---

## 4. Does fewer tools mean fewer bytes? — the byte-measured answer

Experiment: the same zod instances, three consolidations of three families (placeables 35 → 1,
items 6 → 1, rolltables 7 → 1), every `$ref` variant lossless-guarded by deep-equality
(`scratch/perf-schema-shapes.mjs`, `scratch/perf-schema-shapes.json`).

| family | tools | bytes today | (a) kind+op+loose `data`+`describe` op | (b1) union, per-tool descriptions **dropped** | (b2) union, descriptions kept | (c) b1/b2 + genuine `$ref` |
|---|---|---|---|---|---|---|
| placeables (8 kinds, 32 CRUD + teleporter/behavior/remap) | 35 | 62,270 | **1,345** (2.2%) | 49,900 (80.1%) | **64,619 (103.8%)** | 46,711 / 61,442 |
| items (create/list/get/update/delete/import) | 6 | 7,332 | 1,076 | 5,408 | 7,903 (107.8%) | 5,408 / 7,903 |
| rolltables (7 ops) | 7 | 8,970 | 1,100 | 7,026 | 9,608 (107.1%) | 6,002 / 8,587 |
| **total** | **48 → 3** | **78,572** | **3,521 (4.5%)** | 62,334 (79.3%) | **82,130 (104.5%)** | 58,121 / 77,932 |
| whole list | 151 | 283,948 | 208,897 (73.6%) | 267,710 (94.3%) | **287,506 (101.3%)** | — / 283,308 |

What the numbers say:

- A tool's envelope (name + 3 keys) is ~56 chars; each union member adds `kind`/`op` literals and an
  `anyOf` wrapper (~65–110 chars). **Merging with nothing dropped costs +4.5%.**
- (b1)'s −20.7% is entirely the 18,952 chars of per-tool descriptions it throws away; its schema part
  *grew* ≈ 8%. Dropping guidance is not a diet.
- (a) is the only shape that shrinks the eager list, and it does so by **deferring** the same prose
  (placeables 61,977 chars, items 7,289, rolltables 8,886) into tool **results** — which in Claude
  Code is what costs. It also turns every first use of a kind into two calls.
- `reused:'ref'` (zod 4.4.3): whole list 283,948 → **337,198 (+18.75%)** — `.describe()` clones the
  schema and the processor re-processes the clone's parent, so the codebase's `.optional().describe()`
  idiom (237 sites, 0 of the reverse) double-counts every inner instance and hoists
  `{"type":"string"}` leaves into `$defs` (1,275 entries, 838 ≤ 60 chars). Genuine intra-tool reuse:
  **−966 chars (0.34%)**. Cross-tool duplication (10.2% theoretical, ~4.3% net) is not expressible —
  MCP `tools/list` has no shared `$defs`. The "shared activity/effect shape" does not exist:
  manage-activity and add-feature share only `damageParts.items` and `healAmount`. The SDK (1.29.0,
  low-level `Server`) passes `$defs/$ref` untouched; `McpServer.registerTool` would instead emit
  draft-07 with `definitions` — the dialect that bricked a live session before — so the low-level
  `Server` + `src/utils/schema.ts` is load-bearing and stays.
- The CRUD-named surface is 82 tools / 140,037 chars (49.3%); the other 69 tools are 50.7%, led by
  manage-activity, add-feature, add-item, manage-effect, add-region-behavior (56,846 chars, 20% of
  the list) — untouched by any consolidation.

**Recommendation for the 3.0 shape:**

1. **Consolidate per family into one tool with `op` (and `kind` for placeables) as a lossless union
   (b2)** — member descriptions kept, wrapped in a top-level `type:"object"` (the SDK's `ToolSchema`
   requires it) — and land the prose diet **before or with** the family commit so the family's
   advertised bytes end **≤ today's**. Rationale: in Claude Code the payoff is the name list (the
   brief's 76 → 10 family plan saves ≈ 2,427 name-chars per registration, 41.8%, ≈ 1.35k tokens per
   prompt with two registrations); but a deferred client loads a b2 family's *whole* schema on first
   use (placeables 64,619 chars ≈ 17.9k tokens against ≈ 1.8k chars per tool today), so the union is
   net-positive only in conversations longer than ≈ 22–26 prompts *unless the diet has already
   shrunk the family*. In eager clients b2 + diet is byte-neutral-to-better; b1 loses guidance; (a)
   moves the cost into results and adds a round trip.
2. **Do not adopt the `describe` op (a).** Do not flip `reused:'ref'`. If `$ref` is ever wanted for
   readability, the preconditions are `.describe().optional()` ordering (a 237-site codemod) and
   deliberately shared zod instances — then re-measure.
3. **The prose diet is shape-independent and larger than any consolidation** (F10): a prose budget
   enforced by a unit test over `buildToolRegistry`, descriptions rewritten to contract-only, field
   semantics once in the leaf, doctrine out.
4. **Split `world` into always-on `session` + opt-in `settings`** (F23) so narrow registrations stop
   carrying 8.7k chars they did not ask for.
5. **Register the sandbox per project** with `FOUNDRY_TOOLSETS=world` (or `session`) in the three
   module repos (fxstudio, battleflow, miscpatches), which use two tools; this repo keeps the full
   sandbox surface for the Claude Code smoke — −1.5k tokens per prompt in every other project,
   available today (`~/.claude.json` has 31 project entries, 16 of them existing directories, and 0
   project-level `mcpServers`).

---

## 5. Architecture seams (design.md §2.6, registry, toolsets, error mapper)

### 5.1 Seam checks

| check | result | evidence |
|---|---|---|
| Playwright quarantine | **PASS** — 1 import site | `src/foundry.ts:18`; all other mentions are comments |
| `host.kind` branching outside `src/hosts/` | **PASS** — 0 runtime; read only for a log line and the `get-world-info` report | `index.ts:51`, `scene.ts:939` |
| "molten" in `src/` outside hosts | 19 lines: 3 comments (one stale `tools/molten` path, `asset-bridge.ts:8`), 15 test-fixture lines, **0 runtime** | `git grep -n -i molten -- src` |
| Asset tools written against `FilePlane` | **PASS** — all 9 plane handlers reach only `FilePlane` + `host.publicUrl`; refuse by tool name on a null plane | `src/tools/assets/index.ts:318-652` |
| Registry derives the advertised list | **one-directional**: handler-without-definition throws; definition-without-handler is dropped — **152 definitions vs 151 handlers**, orphan `add-features-from-compendium` (`features.ts:62-70`); every name spelled in 3 files | `scratch/arch-seams-registry-triplication.mjs` |
| Toolsets: every handler in exactly one set | **PASS** at startup + test; `toolsetOf()` overwrites duplicates silently (caught by test only) | `registry.ts:428-441`, `toolsets.ts:204-210` |
| Node↔page seam typed | **name-typed only**: `call<T = any>(name: keyof PageApi, args?: unknown)`; 166 call sites, 0 typed results; 26 of 108 page handlers take `any` args | `src/foundry.ts:43,447`, `scratch/arch-seams-pageapi-typing.mjs` |
| Request path per-call cost | negligible: registry 17.0 ms once per process, dispatch ≈ 1 µs, bundle (532,338 bytes, unminified) injected per connect not per call | `scratch/arch-seams-registry-timing.mjs` |
| Error mapper | **FAIL** — substring classification, original message dropped, 11/12 cases mangled | `src/utils/error-handler.ts:53-207`, `scratch/arch-seams-error-mangle.mjs` |

### 5.2 Molten-residue inventory

| # | Residue | Where | Fix owner |
|---|---|---|---|
| R1 | Default host `molten` when `FOUNDRY_HOST` unset; `FOUNDRY_URL` read only under `generic` | `src/hosts/env.ts:41-50,102,112`; `env.test.ts:37` locks it | config (F1) |
| R2 | Placeholder `https://your-server.moltenhosting.com` with no guard → 600 s to first error | `env.ts:112`, `foundry.ts:197,250-255` | config (F1) |
| R3 | `MOLTEN_*` canonical, `LOCAL_*` falls back to it ("a byte copy of prod") | `env.ts:15-17,92-96`, `local.ts:6-7`, `.env.example` §Hosts | config (F1) |
| R4 | `MOLTEN_FILEBROWSER_URL` parsed, never used | `env.ts:119-120` | config |
| R5 | Integration suite gated on `MOLTEN_SERVER_URL`; RELEASE.md "needs a live Molten box" | `tests/integration/setup.ts:46,54`; `docs/RELEASE.md:14-16` | scripts (F25) |
| R6 | 24 of 100 scripts read `env.MOLTEN_*` directly and ignore `FOUNDRY_HOST` — the selector's default is prod, so `FOUNDRY_HOST=local node scripts/verify-wake.mjs` shut the **prod** world down during this review (killed in the wake step; the script now goes through `bridgeConfig()` and refuses an implicit host — `96ed726`); 19 remain: `party-stats`, `pull-prod-to-local`, `register-module`, `register-partystash`, `reload-clients`, `shot-partystash-coin`, 5 spikes, `uninstall-modules`, `verify-{actor-export,copy-primitive,icons,partystash-coin,partystash,receipt-settings,soundscape-tooling}`; `local-foundry.mjs` dies on `LOCAL_WORLD_ID / MOLTEN_WORLD_ID` | `scratch/arch-seams-scripts-census.mjs`; `grep -L "bridgeConfig(" scripts/*.mjs`; `local-foundry.mjs:74,172` | scripts |
| R7 | `bestiary-entry.mjs` hand-builds a Molten config with a dead `magicUrl` key | `.claude/skills/bestiary-builder/bestiary-entry.mjs:66-81` | skill (F4) |
| R8 | `start-session` names Molten, EC2, `MOLTEN_*`, the owner's registration | `start-session/SKILL.md:9,16,24-29,40,58,73-75` | skill (F14) |
| R9 | `send-chat-message` `embed: z.enum(['upload','webdav','dataUri'])`, "over WebDAV" ×3; chat-and-narration copies it | `src/tools/chat.ts:40-43,91,276`; `chat-and-narration/SKILL.md:53,58,83,90` | tool (F38) |
| R10 | Generic host has no file plane; `FilePicker` unused (0 hits) | `src/hosts/generic.ts:28`; `git grep FilePicker src` | tool (F12) |
| R11 | `Host.worldId` required for auto-launch though the page knows it post-join and `/setup` tiles are already queried | `foundry.ts:202-217,286-290`; `chat.ts:335` bogus `worlds/world/` fallback | tool (F46) |
| R12 | Owner's user name "DM Assistant" in a shipped tool description; `eoh-test` / `greenrest` in comments and fixtures | `src/tools/bridge.ts:9,39`; `foundry.ts:63`; `webdav.ts:20`; 5 test files | tool (F15, F47) |
| R13 | `dist/tools/molten/*.js` ghost build output (no clean step); stale comment | `dist/tools/molten/`; `asset-bridge.ts:8` | config (F48) |
| R14 | README 35 "molten" hits, "hosted on Molten" in Requirements; `.env.example` 29; `package.json` keyword `molten-hosting` | `README.md:238,406`; `.env.example` | docs (F35) |
| R15 | `tom-cartos-import` rationale "Molten's hosting blocks…", "Molten cold-start ~25 s" | `tom-cartos-import/SKILL.md:24,65` | skill (F33) |

### 5.3 Proposed 3.0 config contract

Canonical on every host: `FOUNDRY_URL` (required) · `FOUNDRY_USER` (default `MCP-Claude`) ·
`FOUNDRY_PASSWORD` · `FOUNDRY_ADMIN_KEY` · `FOUNDRY_WORLD_ID` (optional; sole-world discovery from
`/setup` when absent) · `FOUNDRY_HOST` (**default `generic`**) · `FOUNDRY_WAKE_URL` (any host, secret
redacted) · `FOUNDRY_TOOLSETS`. Plane extras: `FOUNDRY_DATA_DIR` (fs plane) · `FOUNDRY_WEBDAV_URL` /
`_USER` / `_PASSWORD` (WebDAV plane; `molten` derives URL + user from `FOUNDRY_URL`). Sibling
identities: `FOUNDRY_SUITE_USER` / `_PASSWORD`, `FOUNDRY_PLAYER_USER` / `_PASSWORD` (today's
undeclared `BF_SUITE_*` / `MOLTEN_TEST_*`).

Aliases read **only** in `src/hosts/env.ts`, each with a one-line deprecation log:
`MOLTEN_SERVER_URL→FOUNDRY_URL`, `MOLTEN_MAGIC_URL→FOUNDRY_WAKE_URL`, `MOLTEN_ADMIN_KEY/WORLD_ID→FOUNDRY_*`,
`MOLTEN_WEBDAV_*→FOUNDRY_WEBDAV_*`, `LOCAL_SERVER_URL→FOUNDRY_URL`, `LOCAL_FOUNDRY_DATA→FOUNDRY_DATA_DIR`,
`LOCAL_ADMIN_KEY/WORLD_ID/FOUNDRY_USER/FOUNDRY_PASSWORD→FOUNDRY_*`, `FOUNDRY_PROFILE→FOUNDRY_HOST`;
`MOLTEN_FILEBROWSER_URL` dropped. Precedence: registration env block > host-prefixed alias (when that
host is selected) > `FOUNDRY_*` > default — the owner's one-`.env`-two-registrations setup keeps
working; a new user sees only `FOUNDRY_*`. A `serverUrl` still equal to the placeholder is refused at
startup in < 1 s naming the variable. Blast radius: 51 tracked files name a current var (6 src/hosts,
2 tool tests, config.ts, 2 tests/integration, 3 skills, 32 scripts, 5 docs, README, HANDOFF,
.env.example). After the change, `git grep MOLTEN_ src` matches only `src/hosts/env.ts`.

---

## 6. User-facing: what a stranger hits, and the scripts

### 6.1 The clone-and-run checklist (in the order a stranger meets it)

| # | What they hit | Evidence | Fix |
|---|---|---|---|
| 1 | 230 lines before the first install sentence; 26% of README is release narrative; "hosted on Molten" | `README.md:27-141,231,238,406` | README rewrite (HANDOFF §C shape); narratives → `CHANGELOG.md` (F35) |
| 2 | `playwright` in devDependencies, imported at runtime (a plain clone-and-build works today — README:235,244-246 say so; `--omit=dev` and any published install do not); `vitest` compiled into `dist/tools/test-helpers.js` | `package.json`; `src/foundry.ts:18`; `src/tools/test-helpers.ts:12` | move playwright to `dependencies` (dotenv already is); exclude test helpers from the build (F2) |
| 3 | Default host is the owner's; a placeholder URL costs 600 s before the first error | `env.ts:44,112`; `foundry.ts:197` | `generic` default + placeholder guard (F1) |
| 4 | No "create a Gamemaster user with no password" step; no role check at connect; two default names (`MCP-Claude` vs `DM Assistant` in 7 scripts + the `disconnect-bridge` description) | `README:162,238`; `env.ts:92-113`; `bridge.ts:39` | README step 2; role warn after join; one default name (F15) |
| 5 | Registration name spelled three ways; `start-session` calls `mcp__foundry-molten5e__get-world-info` and names the host in its front-matter description (in every prompt) | `README:268,273`; `.mcp.json.example:4`; `docs/local-sandbox.md:139-140,184`; `start-session/SKILL.md:9,40,45,58` | skills name tools bare; with more than one Foundry registered the skill calls the one the user named, never a literal; one documented pair (F14) |
| 6 | No skills install path — 151 tools, 0 skills unless Claude Code runs from this repo; the README's Repository layout (216-228) omits the skills dir | README mentions `.claude/skills` 0 times | install step: symlink/junction `.claude/skills` (each skill dir + `_shared/`) into the project or `~/.claude/skills` — a plain copy breaks `bestiary-entry.mjs:36` (`REPO_ROOT` relative to the skill dir) unless it takes the repo from `FVTT_MCP_REPO` (rides F4) (F13) |
| 7 | `CLAUDE.md` (offline gate, live-proof rules, the 12-script release list, the compatibility procedure) and `LOCAL.md` are gitignored | `.gitignore:2-3` | track as `CONTRIBUTING.md`; release list → `scripts/README.md` (F35) |
| 8 | Live integration suite never runs without `MOLTEN_SERVER_URL` | `tests/integration/setup.ts:46-56` | gate on the host selector (F25) |
| 9 | `local-foundry.mjs` throws bare ENOENT without `.env`, defaults to `C:\Program Files\…\main.js`; `docs/local-sandbox.md` assumes a prod→local mirror (and still says v14.365); `.env.example:93-94` lost its backslashes and carries an embedded CR byte | `local-foundry.mjs:52,71,76-77,154`; `docs/local-sandbox.md:120,124-129`; `.env.example:93-94` | friendly error, platform-aware default, an "existing local install, no prod" path, split the doc; rewrite both `.env.example` lines (F37) |
| 10 | No premium-book presence check; a world without the PHB fails per call; `get-world-info` never lists packs | `src/page/world.ts:55-83`; `spells.ts:321-323` | `library:{…present|missing}` in get-world-info; README hard requirement (F36) |
| 11 | `package.json`: `private: true`, no `bin`/`exports`/`files`; `.env` resolved relative to `dist/` | `src/config.ts:15` | packaging (F2); honest claim until 3.0 = "clone and build" |
| 12 | Owner strings in comments/fixtures (`eoh-test`, `greenrest`) | `foundry.ts:63`, `webdav.ts:20`, 5 test files | 20-line sed (F47) |

### 6.2 Scripts classification (99 `.mjs` + `scripts/lib/bridge-config.mjs`)

Counts: 63 `verify-*` (16,512 lines), 17 `spike-*` (4,260), 19 other (`scratch/user-facing-measure.mjs`,
`scratch/arch-seams-scripts-census.mjs`). knip's `project` is `src/**/*.ts` — `scripts/` is never
analysed. 94 import from `dist/`; 85 build their own `new Foundry(` via `bridge-config.mjs`; 95 of 100
hand-parse `.env` with the same 6-line loop the siblings copied.

| class | count | members | 3.0 disposition |
|---|---|---|---|
| **Product — release set** | 12 | verify-{effects-6, region-effects, activities-6, settings-calendar, item-tooling, actor-tooling, pc-build, teleporter-scene-fields, placeables-tooling, scene-tools, cast-activity, region-tooling} (5,672 lines) | keep under `scripts/verify/`; **promote into `tests/integration/*.int.test.ts`** (F25); fix `verify-region-tooling.mjs:26` (owner's world asset path) |
| **Product — other tool verifies** | 45 | generic acceptance for product tools | keep; 3 carry campaign fixtures (`verify-region-tooling.mjs:25-26`, `verify-token-display.mjs:19`, `verify-scene-sidecar.mjs:21-22`; `verify-folder-sort.mjs:68` is only a comment) → build `ZZ-*` fixtures; keep `verify-landing-scene` (or its `set-landing-scene` half) in the product set |
| **Product — infra** | 3 (+lib) | local-foundry, measure-tool-results, prove-bridge; verify-toolsets/-wake/-asset-plane/-reads/-read-tools | keep; `local-foundry.mjs` is the `local` host's launcher |
| **House-module harnesses** | 10 | verify-landing-scene, -lootshelf, -partystash, -partystash-coin, shot-partystash-coin, audit-partystash-coin-cleanup, clean-stale-ownership, register-partystash, verify-receipt-settings, verify-soundscape | move to the module repos |
| **Owner-ops** | 12 | deploy-house-module, register-module, configure-modules, uninstall-modules, upload-soundscape-library, remap-soundscape-scene-paths, pull-prod-to-local, reload-clients, party-stats, read-user-avatars, reveal-scene-fog, repair-orphaned-container-refs | move out (F27): deploy/register/configure/uninstall → a sibling tooling repo importing `fvtt-mcp-dnd5e/client`+`/hosts` (or keep these 4 as the documented "sandbox toolkit"); the two soundscape scripts → `fvtt-mod-soundscape-sfx`; `pull-prod-to-local` stays as a molten→local host-pair op; `reload-clients` deleted (battleflow owns the used copy); the 4 one-offs deleted |
| **Spikes** | 17 | 7 unreferenced; 10 cited only in comments/plan docs; `package.json` `spike` script | archive under `docs/history/spikes/` or delete; drop the npm script; cite commits not files in `advancement.ts` comments |

Totals: **keep 60 · sibling 22 (or 18 if the 4 sandbox-admin scripts stay) · archive/delete 17**
(reconsider `party-stats`, a `get-combat-stats` CLI); add `scripts/**/*.mjs` to knip's `entry` (with
`project` alone knip reports all 99 as unused — this catches broken imports and unused lib exports,
not dead scripts); `scripts/README.md` names the release set. The siblings' old-path references to
these scripts are 12 doc/comment lines, 0 code call sites.

---

## 7. The sibling contract, and what the rename broke

**What siblings consume** (`scratch/siblings-census.json`): exactly one class — `Foundry` from
`dist/foundry.js` (`new Foundry({serverUrl,user,password,adminKey,worldId[,magicUrl]})`, `connect()`,
`evaluate(fn,null)` at 106 call sites family-wide, `dispose()`; never `call()`), plus this repo's
`.env` parsed by hand (battleflow 14 keys, fxstudio 6, miscpatches 6), a transitive `classic-level`
reached through this repo's `node_modules` (fxstudio `env.mjs:41-48`), and nine ops scripts by path.
`disconnect()` is called by 16 battleflow suites and does not exist (`harness.mjs:336` monkey-patches
it); fxstudio reads the TS-private `page`. In this repo 88 scripts import `dist/foundry.js` by path
(85 of them through `scripts/lib/bridge-config.mjs`).

**What broke** (verified offline, no connect):
- `e06aba2` (rename): battleflow 21 files with `file:///D:/…/fvtt-mcp-molten5e/dist/foundry.js`
  (`harness.mjs:36` is imported by 56 of 83 tools) — `node tools/smoke-saves.mjs --list` →
  `ERR_MODULE_NOT_FOUND`; fxstudio `tools/lib/env.mjs:15` default `../fvtt-mcp-molten5e` → `classicLevel()`
  throws, `connectSandbox()` fails, 10 prototypes hard-code the path; miscpatches
  `smoke-teleports.mjs:10,12`. **40 code files + 17 docs across 6 repos; 0 files name `fvtt-mcp-dnd5e`.**
- `e53958e` (hosts, same day): `FoundryConfig.magicUrl` → `host?: Host`. battleflow `target.mjs:28`
  still passes `magicUrl` for `BF_TARGET=prod` → ignored → a sleeping Molten box is never woken
  (inferred from the diff; not observed live). Same defect as `bestiary-entry.mjs` (F4).
- Four sibling-owned secrets (`BF_SUITE_USER/PASSWORD`, `MOLTEN_TEST_USER/PASSWORD`) live in this
  repo's real `.env`, absent from `.env.example` and every tracked file (`git grep` → 0).

**The 3.0 consumer contract** (F2, F26):

```json
"exports": {
  ".":        { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
  "./client": { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
  "./hosts":  { "types": "./dist/hosts/index.d.ts", "default": "./dist/hosts/index.js" },
  "./env":    { "types": "./dist/env.d.ts", "default": "./dist/env.js" },
  "./package.json": "./package.json"
},
"bin": { "fvtt-mcp-dnd5e": "dist/index.js" },
"files": ["dist", "images", ".claude/skills", ".env.example", "README.md"]
```

- `.` must **not** be `dist/index.js` (`src/index.ts:129` calls `main()` at import). `src/client.ts`
  (~60 lines, no `config.ts` import) re-exports `Foundry`, `FoundryBridge`, the hosts API, `loadEnv(path?)`
  (`dotenv.parse`, no process side effect — also retires the 95 hand-rolled loops in `scripts/`), and
  `connectFoundry({host?, env?, identity: 'bridge'|'suite'|'player'|{user,password}, logger?, tag?,
  watchdogMs?}) → {f, env, host, dispose}` with the raced dispose both siblings wrote; `disconnect()`
  becomes a documented alias of `dispose()`. `playwright` and `dotenv` → `dependencies`.
- Siblings take `"fvtt-mcp-dnd5e": "file:../fvtt-mcp-dnd5e"` (the family layout is fixed to one
  parent) and `import { Foundry, loadEnv, connectFoundry } from 'fvtt-mcp-dnd5e/client'`; battleflow's
  `target.mjs` prod branch becomes `{ host: 'molten' }`, which also fixes the dead `magicUrl`.
- **Artificer:** ~170 lines of copied shape (`schema.ts` identical modulo comments) — copy is right;
  no shared-core package. Its real coupling is 11 dnd5e tool names in `illustration-builder/SKILL.md`,
  five in CRUD families 3.0 renames (`list-journals`, `list-scenes`, `list-assets`, `download-asset`,
  `upload-asset`); its rename touches 10 tracked files (7 docs / skill / notes + 3 code comments);
  the Data-relative-path vocabulary (`upload-asset {localPath,remotePath}` →
  `set-actor-art {imagePath}`) is the actual contract and stays stable.
- **Names siblings call by name** (`scratch/siblings-toolnames-in-siblings.mjs`): keep `get-world-info`,
  `disconnect-bridge`, `get-combat-stats`, `configure-soundscape`, `set-landing-scene` stable. Reverse
  flag contracts this repo reads (battleflow stat stamps `combat-stats.ts:4-17`; soundscape
  `flags.sets` `soundscape.ts:3-27`; openserver `landingScene` `users.ts:41`) are documented here as
  file headers and on the sibling side as prose — no `docs/` page, no version pin; a
  `docs/contracts.md` closes that asymmetry (F39). The family rename checklist is 6 repos / 56 files
  (+ 11 in the owner's campaign repo).
- **Registration names:** keep `foundry-molten5e` / `foundry-local5e` as the owner's (only fxstudio
  `CLAUDE.md:98-99`, `tools/lib/foundry.mjs:7` and this repo's tracked `start-session` depend on them);
  scrub them from tracked user-facing files; demote `foundry-local5e` to a gitignored project-scope
  `.mcp.json` with `FOUNDRY_TOOLSETS=world` in this repo + the three module repos.

---

## 8. Skills ↔ tools

### 8.1 Line findings (design.md §2.1 / §3)

Correctness re-derived in skills (→ tool side): stale claims that have already drifted —
`stat-block-builder:157-161` "add-feature takes no `img`" (it does, `add-feature.ts:224-231`) and
`session-audit:78-81` "get-actor lacks defenses" (fixed 2026-08-14, `actor-stats.ts:203-211`);
`get-actor` reports `hp.max` 0 for PCs (source system, `actor-stats.ts:136-141`) and session-audit
papers over it with a campaign snapshot (F31); `set-actor-art` leaves inherited prototype settings so
two skills prescribe the same 3-param fix-up after every swap (F30); `pc-builder:226-236` calls the
class→pregen-portrait path "DETERMINISTIC … not a judgment call" and then re-derives it, plus the
per-spell `prepared: 2` patch (F32); `scene-builder:82-146` (65 lines) re-explains a sidecar hazard
that `create-scene`'s `placeablesPath` (`scene.ts:295-303,550-565`) already removes — 0 mentions of
`placeablesPath` (F29); `tom-cartos-import:287-289` pin pixel math; ~270 lines of enum/grammar
already in the schemas (F28); three skill steps read fields no tool returns — `list-scenes` flags
(tom-cartos dedup :117-120), darkness (soundscape :50-51) (F17).

Doctrine in tool descriptions (→ skill side): `author-npc` "the LAST-RESORT path in the §6 ladder …
ask before authoring", `create-actor-from-compendium` "(the §6 step-2 bridge)", `import-item` a 3-step
workflow with pack ids pointing at the slow non-faceted search, `duplicate-actor` "THE sandbox path:
clone PCs as (Sim) copies", `place-tokens` "the house token defaults"; 48 of 151 descriptions carry a
judgment word (F10).

Result-shape inconsistency skills gloss over: `search-compendium` returns `pack:{id,label}`; the three
faceted searches return `pack:"<id>"` + `packLabel` (F20).

### 8.2 The description budget

15,382 chars ≈ 4.27k tokens in every prompt. 3,975 chars (26%) is "Composes …" tool lists (1,818) and
the §2.1 ownership sentence (2,157) — zero trigger value, already the body's first paragraph
(journal-builder 46%, stat-block-builder 43%, physical-item-builder 39%, table-builder 34%). Six
rewrites (`scratch/skills-desc-budget.mjs`, checked by `skills-desc-check.mjs` — all 40 quoted trigger
phrases preserved):

| skill | before | after | ratio |
|---|---|---|---|
| pc-builder | 1,317 | 596 | 0.45 |
| session-audit | 1,153 | 604 | 0.52 |
| tom-cartos-import | 1,057 | 460 | 0.44 |
| physical-item-builder | 1,036 | 508 | 0.49 |
| playlist-builder | 1,011 | 544 | 0.54 |
| stat-block-builder | 992 | 454 | 0.46 |
| six | 6,566 | 3,166 | 0.482 |

Six only, **measured**: 15,382 → 11,982 (−22%, ≈ −945 tokens per prompt). All 17 at the same 0.482
ratio: ≈ 7,400 chars ≈ 2.06k tokens (−52%) — a target, likely optimistic (the other 11 carry ~21%
boilerplate against the six's 31%). Rule: description = trigger phrases + one "use when" cue;
mechanism, composition, refusal scripts and ownership boilerplate live in the body. Two further
trims: cards-builder's description carries a "later phase" promise; pc-builder's rewrite still
explains the DDB refusal in one clause — keep it deliberately or trim it.

### 8.3 Skill × tool matrix summary (`scratch/skills-tool-matrix.md`)

151 tools · **100 named by ≥ 1 skill · 51 named by none** (34%: all of drawings and macros, 22 of 45
scene tools incl. every create/update/delete of tiles/lights/walls, 9 of 12 assets, delete-actor,
duplicate-actor, group tools, list-actor-ownership, delete-item/-journal/-page, bulk-delete,
disconnect-bridge, list-users, update-user, set-user-avatar). Most-shared: get-actor 7 skills,
upload-asset 7, list-journals 6, create-journal 5, list-scenes 5, update-actor 5.

3.0 re-point size: **185 SKILL.md lines** name a CRUD-family tool — scene-builder 32, tom-cartos-import
22, stat-block-builder 21, physical-item-builder 18, plot-drift-check 15, table-builder 15; by family
actors 39, scenes 36, items 32, journals 27, tables 19, regions 17, cards 14, playlists 14, tokens 9,
sounds/notes/folders 4 each, tiles/walls/lights 1 each. **Four of eight placeable families (tiles,
lights, walls, drawings) are touched by ≤ 1 skill and only via `list-*`** — consolidating them is
skill-cheap; sounds (2 skills via `create-sounds`), tokens (4 skills, 9 lines), notes (2 skills, all
4 tools) and regions (2 skills, all 7 tools, 17 lines) carry real re-point cost, as do
actors / scenes / items / journals.

Owner/campaign content (configuration to extract, not delete): session-scribe (~50 owner/campaign
lines, ~12 dated owner stamps; 103 lines of owner-locked house style, the campaign repo, Craig,
Edge/PowerShell/CUDA, `scripts/setup.ps1`), soundscape-builder (38
house-module hits, the private 400-template library, the two-box model), start-session (host +
registration), tom-cartos-import (OWNER DEFAULT block, autoexplore stamp), session-audit /
plot-drift-check / bestiary-builder (an undeclared campaign-repo layout `plot/`, `sessions/`,
`party-snapshots/`), chat-and-narration (`embed:"webdav"`, `MOLTEN_WEBDAV_PASSWORD`). Hand-offs are
prose-only; scene-builder → soundscape-builder is absent; the artificer still calls this repo
"molten5e".

---

## 9. Phase-2 scrub inventory and the replacement shape

**True DM-assist references (scrub):**

| file | lines |
|---|---|
| `design.md` | 18, 21-22, 25-26, 28 (two halves / half 2); 151-155 (§4 Phase-2 rows); 161-162 (⛔/◻️ legend); 164-173 (closing paragraphs); 190-191 (§5 "landing zone"); **302-363 (all of §8 + §8.1)** — 18 hits |
| `README.md` | 202-204 ("live session assistance … next phase (see design.md §8)") |
| `docs/alignment-plan.md` | 20, 41, 123, 205 |
| `docs/scene-placeables-architecture.md` | 49, 98, 116, 328, 349, 447, 548-551, 574 |
| `docs/plan-2.1-dnd5e-6-features.md` | 118 |
| `docs/architecture-review.md` | 50, 76, 100, 202 (historical — archive, do not edit) |
| `.claude/skills/journal-builder/SKILL.md` | 18, 48, 87, 140-148 ("§8 landing zone" section) |
| `src/tools/journal.ts` | 282 (a tool **description**), 437 |
| `_shared/authoring-policy.md` 33-34; `cards-builder/SKILL.md` 10-11 (in the **description**), 89-92; `playlist-builder` 113-117; `stat-block-builder` 66-67 ("the future PC-actor builder" — it exists) | |

**Homonyms** (plan-step numbering; rename to "Step 2" so the grep goes quiet): `scripts/verify-wake.mjs:6,118-119`;
`verify-actor-tooling.mjs:346`; `verify-write-tools.mjs:1`; `verify-dnd5e-writes.mjs:1`;
`verify-journal-tooling.mjs:1`; `src/page/dnd5e/cast-spells.ts:218`; `docs/compendium-lookup-plan.md:54`;
`docs/scene-placeables-architecture.md:505`. HANDOFF.md and CLAUDE.md: 0 hits. Memory
`three-point-oh-is-terminal.md` records the removal — keep. README:202-204 is NOT matched by the
brief's grep (it says "next phase (see design.md §8)") — the scrub grep must add `next phase|§8`.

**Replacement shape for `design.md`:**

- **§1 Mission** (replace lines 18-26): one paragraph, no halves — *`fvtt-mcp-dnd5e` builds and
  maintains the content of a D&D 5e (2024) campaign in a live Foundry world — scenes, NPCs and PCs,
  items, journals, tables, cards, playlists — and records what happened at the table afterwards
  (chat export, combat analytics, session recaps written into the journal). It is a Foundry MCP first
  (§2.6). It does not run the game: there is no live in-session assistant in this project, by
  decision (2026-09-20); one may exist as a separate app that depends on this MCP.* Keep "Where
  things stand today" (28-38) retitled.
- **§4 Scope** — areas, no Phase column, legend `✅ done · 🔨 3.0`: **Content creation** (today's
  rows); **Session record** (chat tools, `export-chat-log`, `get-combat-stats`, `session-scribe` — ✅
  plain features); **Platform** (hosts ✅, toolsets ✅, rename ✅; CRUD consolidation + response/schema
  diet + config contract 🔨 3.0). Replace 164-173 with: *3.0 is the last feature line. After it the
  project is in maintenance: Foundry / dnd5e compatibility events, bug fixes, premium books brought
  into scope via `src/utils/compendium-sources.ts`. There is no roadmap beyond 3.0.*
- **§5** 190-191 → "This is also where session recaps are filed (`session-scribe`)."
- **§8** delete; renumber §9 → §8, §10 → §9. One sentence from §8.1's ground truth ("the bridge is a
  logged-in client and receives the live feed") survives in the implementation snapshot as a fact.
- **§2.3** list the five prefixes actually in scope.
- README:202-204 → "Out of scope: live in-session assistance (by decision), non-5e systems, map
  generation." `journal.ts:282,437` and journal-builder → "session recap path".

---

## 10. dnd5e 6.0.2 / 6.0.3 — targeted-verify table for the pin

Sources: GitHub release bodies **and** the tag-to-tag diffs (`scratch/research-dnd5e-6.0.{2,3}.diff`:
15 commits / 19 files, 7 / 9). Six commits carry no issue number and are absent from the notes.
`system.json compatibility.minimum` is **14.367** — prod (14.364) cannot take dnd5e 6.x before a
Foundry upgrade. Foundry **14.368** is still latest stable (nothing above it on foundryvtt.com/releases).

| Rel | Change | Our module | Verify | Action |
|---|---|---|---|---|
| 6.0.2 #7442 | `system.==advancement` → `_replace` in `createAdvancement` | we only call `adv.apply` (`advancement.ts:526,529`) | verify-pc-build, verify-scale-report | regression |
| 6.0.2 #7450 | Rules-condition data: `item` = **rolled** item; new `sourceItem`/`sourceScaling` | Filter vocabulary `effect-changes.ts:84-156,400-450`; tool text `manage-effect.ts:37-38,85-89,141-142` | verify-effects-6, verify-actor-tooling | **TARGETED**: a rules change keyed on `item.*` on a feature-carried effect, rolled from a weapon — assert `item` = rolled, `sourceItem` = the effect's item; add `sourceItem.*` to the docs |
| 6.0.2 #7452 | Druid Primal Order AE key (SRD classes24 pack) | never a source | NONE | a Druid build shows `cantrips-known`; PHB module fix unverified |
| 6.0.2 #7455 | `createScrollFromCompendiumSpell`, scroll Cast gets `duration.concentration` | not our path (`add-item.ts:242` authors scrolls) | NONE | skill note for physical-item-builder |
| 6.0.2 #7459/#7462/#7463/#7466 | concentration getter lazy; roll-breakdown render; enricher click; NPC embed i18n | render-only / unused; chat text export shape shifts slightly (`chat.ts:50-53,71,101`) | `chat.int.test.ts` (RUN_LIVE) | integration suite |
| 6.0.2 #7443 | `GroupData#rollSavingThrow/rollSkill(config, dialog, message)` | group.ts uses addMember/removeMember only | verify-group-tooling | regression |
| 6.0.2 51f6e8f | dependent effects (`flags.dnd5e.dependentOn`) survive out-of-combat expiry | no handling; our effects never set it | verify-effects-6 §5b | regression |
| 6.0.2 b642ce0 | `preImportAdventure` wraps delta condition effects | tom-cartos never uses `Adventure#import` (`pack-reader.ts:206-224`) | NONE | — |
| 6.0.2 8c10c1a | `data.statuses?.[0]` guard | apply-condition (`conditions.ts:167-197`), manage-effect statuses (`effects.ts:131,157`) | verify-actor-tooling, verify-effects-6 | regression |
| 6.0.2 cac30cc #7470 | Falling: designated user no longer needs `viewedScene === scene`; `concrete` no longer needs `isView` — a headless GM client can toggle `falling` / post fall damage on unviewed scenes | elevation writers update-token (`token.ts:238,346`), place-tokens (:75), region changeLevel/teleport; `disableFalling` read (`world.ts:56-63`) | none writes `elevation` today | **TARGETED**: an `elevation` write with `disableFalling=false` on a Levels scene the bridge does not view; restore in `finally` |
| 6.0.3 #7474 | `simplifyBonus` typo | unused | NONE | — |
| 6.0.3 #7475 | `D20RollModificationField.initialize(value ?? {})` — `system.rolls.attack.*` effects now apply | no `system.rolls` in src; rules changes target categories (`effect-changes.ts:264-350`) | verify-effects-6 | regression; a core-type change on `system.rolls.attack.bonus` is now a viable path |
| 6.0.3 #7480 | container sheet filter | UI | NONE | — |
| 6.0.3 #7482/#7484 | `expiry:"turnStart"` stamped in combat **only when `duration.value` is finite** | duration/expiry normalisation `effect-changes.ts:471-560`, read-back :539-558; `manage-effect.ts:170-200,240` | verify-effects-6:488-509, §5b | **TARGETED**: a no-duration effect on a combatant must keep `expiry` null; our read-back returns `null` for "permanent" — assert |
| 6.0.3 0fd354f | migration: unlinked-token ActorDeltas persist only managed collections | one-shot on first GM load (sandbox done); ActorDelta reads `actors.ts:392,506`, `token.ts:268` | verify-token-item-editing, verify-token-reskin | regression; let a GM login finish the migration before the bridge's first connect on any other world |
| 6.0.3 160e7ff | official-content adds `dnd-arcana-unleashed`, `dnd-deadfall` | `PREMIUM_BOOK_PREFIXES` (`compendium-sources.ts:40`) | NONE | candidates if installed (open decision) |

**Done during the review (`c53c2de`):** the source diff confirmed 15 content-changed files between
6.0.1 and 6.0.3 (the other 466 differ by whitespace only); targeted live
(`scratch/pin-6.0.3-targeted.mjs`, 4/4): a no-duration effect created on a combatant in combat keeps
`expiry` null — through core and through `manage-effect` — and our read-back reports it permanent
(#7482); a `dnd5e.bonus` rules change with a `{k:'sourceItem.type'}` condition is accepted and
persists verbatim (#7450, persistence only — a roll-based assertion of `item` vs `sourceItem` is
optional follow-up). Then the 12-script release set (effects 51/51 · region effects 37/37 ·
activities 37/37 · settings + calendar 52/52 · items 13/13 · actor 34/34 · pc-build 66/66 ·
teleporter + scene fields 13/13 · placeables 34/34 · scene tools 11/11 · cast activity 25/25 ·
region tooling 22/22) and `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` (85 passed / 1
skipped); pins moved (README ×3, the 2.1 plan's Progress list, `LOCAL.md`).

**Left for 3.0:** the #7470 check — an `elevation` write with `disableFalling=false` on a Levels
scene the bridge does not view (writers `src/page/placeables/token.ts:75,238,346`; restore in
`finally`); `sourceItem.*` added to the `manage-effect` prose (`manage-effect.ts:37-38,85-89,141-142`).

---

## 11. Merged findings (ranked; stable ids; sources = stream finding ids)

Side = where the fix belongs (design.md §2.1): tool · skill · docs · scripts · sibling · config.

### High

**F1 — Default host is the owner's: `FOUNDRY_HOST` unset = `molten`; `FOUNDRY_URL` alone is ignored; a placeholder URL costs 600 s before the first error.** *config.* Evidence: `src/hosts/env.ts:41-50` returns `'molten'`; `:102` reads `FOUNDRY_URL` only under `generic`; `:112` defaults `https://your-server.moltenhosting.com`; verified `resolveHostConfig({FOUNDRY_URL:'https://vps.example.com'})` → `kind:'molten'` with the placeholder; `foundry.ts:250-255` maps the navigation error to "booting", loops until `wakeTimeoutMs` 600,000 (`:197`); no placeholder guard (`git grep your-server src`); the 600,000 ms budget is `foundry.ts:194`, the navigation-error → "booting" mapping `foundry.ts:242-245`. Fix: default `generic`; refuse the placeholder at startup in < 1 s naming the variable; the §5.3 contract; `.mcp.json.example` with explicit `FOUNDRY_HOST`. Sources: arch-seams-2, user-facing-clone-1. *Verified.*

**F2 — Undeclared library surface and broken packaging: no `exports`/`bin`/`files`, `main` starts a server at import, `playwright` is a devDependency of the module that imports it, `.env` resolved relative to `dist/`.** *config.* Evidence: `package.json` (`private:true`, `main: dist/index.js`); `src/index.ts:129` `main()` at top level; `src/foundry.ts:18` imports `playwright`; `src/tools/test-helpers.ts:12` imports vitest and is compiled to dist; `src/config.ts:15` loads `../.env`; 88 scripts + 3 siblings import `dist/foundry.js` by path. A plain clone-and-build works today (README:235,244-246 say so); what the defect blocks is `--omit=dev`, any published install, and the sibling import contract — that is the *high*. Fix: §7 contract (`exports` `.`/`./client`/`./hosts`/`./env`, `bin`, `files`, `src/client.ts`, `loadEnv`, `connectFoundry`, `disconnect()` alias); playwright → dependencies (dotenv already is); exclude test helpers; `FVTT_MCP_ENV` override; README says "clone and build" until published. Sources: user-facing-clone-4, user-facing-pkg-1, siblings-contract-1, arch-seams-7. *Verified.*

**F3 — The rename broke every sibling (battleflow 21 files, fxstudio default path, miscpatches), and `e53958e` silently dropped `magicUrl` that battleflow's prod target still passes.** *sibling.* Evidence: `ls ../fvtt-mcp-molten5e` → missing; `node tools/smoke-saves.mjs --list` → `ERR_MODULE_NOT_FOUND` at `harness.mjs:36` (56 of 83 tools import it); fxstudio `tools/lib/env.mjs:15`, `classicLevel()` throws; `git show e53958e -- src/foundry.ts` removes `magicUrl`; battleflow `target.mjs:27-31` passes it. 40 code + 17 doc files across 6 repos; 0 name `fvtt-mcp-dnd5e`. Fix: one commit per sibling to `import … from 'fvtt-mcp-dnd5e/client'` via `file:../fvtt-mcp-dnd5e` (sed to the new name until then); `target.mjs` prod → `{host:'molten'}`; fxstudio drops the `node_modules` reach for a declared `classic-level` or a `readPack` export. Sources: siblings-broken-1, siblings-broken-2, siblings-broken-3. *Verified.*

**F4 — `bestiary-entry.mjs` bypasses the host seam: hand-parsed `MOLTEN_*`, a dead `magicUrl` key, `'DM Assistant'`, `FOUNDRY_HOST` ignored — broken for any non-Molten clone and unable to wake a sleeping box.** *skill / scripts.* Evidence: `.claude/skills/bestiary-builder/bestiary-entry.mjs:66-81`; `FoundryConfig` (`src/foundry.ts:62-95`) has `host?`, not `magicUrl`; the script polls `/join` for up to 600 s without a wake; `git log -- bestiary-entry.mjs` untouched by `e53958e`; the skill runs a second bridge session because two capabilities have no tool (SKILL.md:20-24 — partly stale: `update-journal` already opens an entry for a player-visible page, `journals.ts:285-293`; what is missing is a page-targeted compendium-journal read — whole-entry `fullData` exists but hits the cap — page re-sort, and the lore-stripping). Fix: short — replace `:74-81` with `new Foundry(bridgeConfig(env))` from `scripts/lib/bridge-config.mjs` (2–3 lines; it exports `bridgeConfig`/`hostFor`, not `loadEnv`) and take the repo root from `FVTT_MCP_REPO`; right — land the page-targeted read + page sort, correct SKILL.md:20-24, delete the script; a grep guard that no file outside `src/hosts` and `scripts/lib` reads `MOLTEN_*`/`LOCAL_*`. Sources: arch-seams-3, user-facing-skills-1, skills-scripts-1. *Verified.*

**F5 — The central error mapper replaces classified errors with canned text and drops the original message; page-side errors cannot escape it.** *tool.* (Severity by the brief's rubric: **medium** — no retry cost was measured; it stays in the high list because it is the one finding that makes every other tool's error worse.) Evidence: `src/utils/error-handler.ts:53-188` classifies by substring (`permission`, `connection|timeout|browser|game.ready`, `not found|invalid|missing`, `scene`…); `formatErrorMessage` (`:195-207`) never appends `details`; `foundry.ts:465` re-wraps every page throw as plain `Error`; `src/page/**` 395 `throw new Error(`, 0 `FormattedToolError`, 112 literals trip a heuristic; 11 of 12 realistic errors mangled (`scratch/arch-seams-error-mangle.mjs`); custom properties on a page-side error do not survive `page.evaluate` (measured: `code` undefined, keys `['log','name']`). Fix: (1) always append the raw message after stripping the `page.evaluate: Error:` prefix and the folded in-page stack (3 lines, today); (2) the page encodes an error code in the Error's `name` or a message prefix — the only channels that survive — and `foundry.ts` maps it → guidance, drop the substring classifier except for errors `foundry.ts` throws itself; the 12 scratch cases become unit tests. ~1 day. Sources: arch-seams-1. *Verified.*

**F6 — `search-compendium-creatures` has no `name` facet; a wrong arg is silently stripped; default `limit: 500` guarantees a mid-JSON cut.** *tool.* Evidence: schema `src/tools/compendium.ts:55-149` (no name/query); zod strips unknown keys (verified `{query:'goblin'}` → `{limit:500}`); body starts `"criteriaDescription":"no criteria"`; 186,538 chars raw ≈ 492 × 378, capped at 20,073 with 52 hits and `totalFound` lost (`:534-541`); the engine supports `name` (`compendium-facets.ts:289-296`) but the facade (`:520-528`) never forwards it; **no tool schema uses `.strict()` (0/151)** — `scene.ts` (13) and `region.ts` (4) use `.passthrough()` on nested sub-schemas. Fix: add `name`, forward it; default limit 50 like siblings; `.strict()` on top-level schemas only (≈ 4.2k chars of `additionalProperties:false` on `tools/list`); ONE compact hit shape shared with F9 that keeps `uuid` (table-builder :75) — `{id,name,uuid,pack,img?,facets}` (131 chars, −65%); update `compendium.test.ts:311/335`, `docs/compendium-lookup-plan.md:36`, `stat-block-builder/SKILL.md:35` in the same commit. ~2 hours. Sources: perf-results-1. *Verified.*

**F7 — `list-actor-ownership` emits 7 user rows per actor for all 168 actors (227,662 chars); the explicit-only shape is 12,240.** *tool.* Evidence: `src/page/ownership.ts:51-115` loops actors × non-GM users and pushes a 7-field row regardless of source; rebuilt 228,748 vs measured 227,662; 13 of the 14 visible actors have no explicit entry; compact 73 chars/actor; no skill calls it. Fix: per actor `{id,name,default,explicit{user:level}?}`; `verbose` flag for the matrix; one-line count of actors with nothing explicit. ~30 lines. Sources: perf-results-2. *Verified.*

**F8 — `capResponse` cuts mid-JSON and always drops the trailing counts; a record-level cut keeps them for ~50 lines.** *tool.* Evidence: `src/index.ts:30-34` slices at `toolResponseMaxChars` (default 20,000, `config.ts:68`) + a 73-char marker; no script or skill `JSON.parse`s tool text (never programmatically wrong); the cut tears hit 53 and loses `totalFound/criteria/note` (`compendium.ts:534-541`) and `total/filtered` (`actor.ts:309-318`); prototype `scratch/perf-results-cap.mjs` keeps 51/493 with counts intact, strings cut at the last newline. Fix: `capRecords` — largest array property, binary-search the longest fitting prefix, stamp `truncation:{kept,omitted,of,note}`; strings cut at `\n` + omitted-line count. Sources: perf-results-3. *Verified.*

**F9 — List/search bodies carry fields no skill reads; a compact projection saves ≈ 27% of the baseline (≈ 41,900 chars).** *tool.* Evidence: `scratch/perf-results-projection.mjs`, corrected by verification: list-items 16,392→7,986 (img + folderId), list-scenes 9,698→2,873 (130-char background × 50), spells 14,979→12,924 with the unified hit shape that keeps `uuid` (−14%; 6,568 only if `uuid`/`img` are dropped and table-builder :75 / stat-block-builder :35 / `docs/compendium-lookup-plan.md:36` are re-pointed), search-compendium 8,954→4,825 (`description` "" on 42/42), get-world-info 1,805→967 (drop the 758-char HTML description and background; **keep `automation`** — start-session :47 and session-audit :194-197 read it); 24-call total 154,534 → ≈ 112,600; field use per skill in `scratch/perf-results-notes.md` §1 and `scratch/skills-notes.md` §3. Fix: per list/search tool return id, name + the documented fields; `img`/`background`/`description` move to `get-*` or behind `include`; unify the search hit shape `{id,name,uuid,pack,img,facets}` with `pack` a string on all four. Sources: perf-results-4, skills-seams-2. *Verified.*

**F10 — 67% of `tools/list` is prose; half of description bytes are field-level detail; tool descriptions carry skill doctrine.** *tool.* Evidence: leaf `.describe()` 122,631 (43.2%), descriptions 68,655 (24.2%), structure 25.8% (`scratch/perf-schema-decompose.mjs`); 38 leaf strings ≥ 300 chars (14,719); four tools carry zero leaf prose and 1.0–1.7k descriptions instead (`npc.ts` 0 `.describe(`); field-level sentences 214/552 = 33,661 chars (49.2%), 15 tools ≥ 70%; boilerplate only 1.7%; ~8 descriptions carry prefer / ask-first / ladder doctrine (`author-npc` "LAST-RESORT … ask before authoring", `create-actor-from-compendium`, `import-item` workflow + pack ids, `add-item`, `add-feature`, `update-actor-item`, `create-item`, `duplicate-actor` "THE sandbox path") — the 48 regex hits include 26 contract-only "never"s and ~7 dnd5e/Foundry terms. Fix (*tool + skill*): prose budget (leaf ≤ 120, description ≤ 400) enforced by a unit test over `buildToolRegistry`; descriptions = contract (inputs, refusals, returns) routing to siblings by name; field semantics once in the leaf; the ladders / "prefer" / "ask first" / design.md section numbers / owner workflows move into stat-block-builder / physical-item-builder / `_shared/authoring-policy.md`. The budget's mechanical ceiling is −44k chars (−15.6%, `tools/list` → ≈ 240k): expect −30–44k and let M7's ≤ 230k rest on F22/F23 for the remainder; verify with `perf-schema-decompose.mjs`. Sources: perf-schema-results-1, perf-schema-docs-1, skills-tool-1. *Verified.*

**F11 — Fewer tools does not mean fewer bytes: a lossless union costs +4.5%; in Claude Code the CRUD consolidation pays through the name list — and only after the prose diet; the sandbox registration can be project-scoped today.** *tool / config.* Evidence: §4 table (`scratch/perf-schema-shapes.mjs`); names 302 = 11,147 chars ≈ 3.1k tokens per prompt in every project (`~/.claude.json`: 31 entries, 16 existing directories, 0 project-level `mcpServers`); the regex-82 CRUD names include 10 singletons no consolidation merges — the brief's 76 → 10 family plan saves ≈ 2,427 name-chars per registration (41.8%, ≈ 1.35k tokens per prompt with two registrations); a deferred client then loads a family's whole schema on first use (placeables b2 = 64,619 chars ≈ 17.9k tokens vs ≈ 1.8k chars per tool today), so the union is net-positive only past ≈ 22–26 prompts unless the diet lands first; the union must be wrapped in a top-level `type:"object"` (SDK `ToolSchema`, `types.js:1240`); the three module repos use two tools; `FOUNDRY_TOOLSETS=world` = 8 names / 299 chars. Fix: §4 recommendation — prose diet **before or with** the b2 union per family, no `describe` op, no `reused:'ref'`; project-scope `foundry-local5e` with `FOUNDRY_TOOLSETS=world` in fxstudio/battleflow/miscpatches only (this repo keeps the full sandbox surface for the Claude Code smoke). Sources: perf-schema-shapes-1, perf-schema-names-1, siblings-registration-1. *Verified.*

**F12 — The `generic` host has no file plane although Foundry's own `FilePicker` upload works on every host through the bridge — 9 tools and 7 of 17 skills are dead on generic.** *tool.* Evidence: `src/hosts/generic.ts:28` `files = null`; 9 handlers return `filesNotConfigured` (`assets/index.ts:318-652`); `chat.ts:400-402,510-512` lose upload/remote copy; 4 skills are blocked outright (tom-cartos-import, token-cutout, bestiary-builder, cards-builder) and 3 degrade to hand-typed paths (scene-, playlist-, soundscape-builder); `git grep FilePicker src` → 0; the 9 dead definitions still cost 7,664 chars on a generic registration; `list-assets`/`asset-info`/`download-asset` descriptions omit the "needs the host's file plane" sentence. Fix: a page-side `bridge` `FilePlane` — browse / `createDirectory` / `upload` via `FilePicker` as the GM or Assistant user, read via HTTP GET of `publicUrl`; remove / move / copy unsupported by name; its limits stated in the tool descriptions (uploadable media extensions only — no `.html`, so `export-chat-log`'s remote copy stays plane-dependent; no overwrite of non-media files; bytes travel through the bridge, so drop "bypass the bridge entirely" from `upload-asset`) — as every host's default, with WebDAV / fs as the fast path; design.md §2.6's "a host without a file plane says so" becomes "every host has the bridge plane; molten / local add a fast path". ~2–3 days incl. live verify. Sources: arch-seams-4. *Verified.*

**F13 — The skills have no install path: a stranger gets 151 tools and zero skills.** *docs.* Evidence: README mentions `.claude/skills` 0 times, the word "skills" 4; the Repository layout (216-228) omits the skills dir; README:259-291 registers the server in `~/.claude.json` for use from any directory; project skills load per working directory. Fix: README 60-second start step "install the skills" = symlink / junction `.claude/skills` (each skill dir + `_shared/`) into the project's `.claude/skills` or `~/.claude/skills` — a plain copy breaks `bestiary-entry.mjs:36` (`REPO_ROOT` relative to the skill dir) unless that script takes the repo from `FVTT_MCP_REPO` (rides F4); optional `scripts/install-skills.mjs`; `files` including the skills dir waits for a published package. Sources: user-facing-clone-2. *Verified.*

**F14 — The registration name is spelled three ways and `start-session` hard-codes `mcp__foundry-molten5e__…`; start-session and chat-and-narration name their host, env vars and registration.** *skill / docs.* Evidence: `README.md:268,273` (foundry-prod/-sandbox), `.mcp.json.example:4` (foundry-molten5e), `docs/local-sandbox.md:139-140,184`, `start-session/SKILL.md:9` (the front-matter description — in every prompt), `:40,58` (the literal), `:45` (`MCP-Claude`); start-session :16 "Bring the Molten-hosted Foundry world up", :24-29 `MOLTEN_*`, :27 "wake the EC2 box"; siblings pin the names (fxstudio `CLAUDE.md:98-99`, `tools/lib/foundry.mjs:7`). Fix: skills name tools bare; when more than one Foundry is registered the skill calls the registration the user named (prod by default in start-session's prose, never by literal name); start-session rewritten against `get-world-info`'s `host` block ("the bridge wakes the host if it has a wake step; the error names the variable"); one documented pair in README / `.mcp.json.example` / local-sandbox; `chat.ts:91` "over WebDAV" → "through the host's file plane" in the same commit; the owner's names stay in the gitignored `~/.claude.json`. ~2 hours. Sources: user-facing-clone-3, siblings-registration-2, arch-seams-9, skills-user-facing-1. *Verified.*

**F15 — The bridge-user story is one clause with no create-a-GM-user step, no role check, and two default names; "DM Assistant" ships in the `disconnect-bridge` description.** *docs / tool.* Evidence: `README:162,238`; role checked only in `calendar.ts:165`, `settings.ts:101`; defaults `MCP-Claude` (`env.ts:92-113`) vs `DM Assistant` in 7 script lines + `bestiary-entry.mjs:77`; `src/tools/bridge.ts:9,39`, `registry.ts:150`, `registry.test.ts:80`, `scene.test.ts:182,187`. Fix: README step 2 ("Users → create `MCP-Claude`, role Gamemaster, no password; set `FOUNDRY_USER`"); after join read `game.user.role`, warn/refuse below Assistant GM; one default everywhere; description → "the bridge user (`FOUNDRY_USER`)". Sources: user-facing-clone-5, user-facing-clone-6, arch-seams-15. *Verified.*

**F16 — 26% of the skill-description budget is non-triggering boilerplate; six rewrites measure 15,382 → 11,982 chars (−22%, ≈ −945 tokens per prompt); the same ratio over the other 11 would reach ≈ 7,400 (−52%) — a target.** *skill.* Evidence: §8.2; `scratch/skills-desc-boilerplate.mjs`, `skills-desc-budget.mjs`, `skills-desc-check.mjs`. Fix: apply the six texts (decide whether pc-builder's one-clause DDB-refusal explanation stays); trim the other 11 with the same rule. ~1 hour. Sources: skills-desc-1. *Verified.*

**F17 — Three skill steps read fields no tool returns (`list-scenes` flags and darkness, `get-current-scene` darkness); `list-scenes` prints a 130-char background path no skill reads.** *tool.* (High on the contract break; the byte cost is 4.2% of the baseline.) Evidence: `tom-cartos-import/SKILL.md:117-120`, `soundscape-builder/SKILL.md:49-51`; `src/page/scenes.ts:380-395` (id, name, active, dimensions, gridSize, background, counts, navigation — no flags/darkness); `src/tools/scene.ts:641-655` (list-scenes) and `:830-857` (get-current-scene, `hasBackground` at :838); 49 background lines = 6,475 chars = 67% of the 9,698-char body; the scene provenance flag is hand-passed at tom-cartos :212 (the region flag is auto-stamped, `scenes.ts:286-300`); the skill's name is hard-coded page-side (`scenes.ts:280`). Fix: `list-scenes` fields = id, name, active, W×H, grid, darkness, weather, tokens, walls, `flags[scope]` on request; drop background from the list **and add the path to `get-current-scene` in the same commit** (or gate it behind `include` on list-scenes) — otherwise no read tool returns it and soundscape-builder :51 dead-ends; `create-scene` takes `provenance:{scope,sourceModule,sourceId}`; re-point the two skills. Half a day. Sources: skills-seams-1, perf-results-8. *Verified.*

### Medium

**F18 — `search-compendium`'s first call pays ≈ 11–12 s of cold `getIndex`, 91% of it one pack (`dnd-dungeon-masters-guide.equipment`, 548 entries, 9.6–11.0 s); 23 of the 28 packs are already indexed at connect; the warm call is 176 ms.** *tool.* Evidence (live, `scratch/profile-search-compendium.mjs`, two runs): connect 8.1 s; `getIndex` over the 28 searched packs 10,515 / 12,103 ms total, of which the DMG equipment pack 9,636 / 10,965 ms, the four RollTable packs ≈ 150–675 ms each, everything else 0 ms (already indexed); `searchCompendium('sword')` warm 176 / 178 ms, 42 results; `searchCompendiumFaceted` 362 ms. Source: `src/page/compendium.ts:97-112` walks `game.packs` minus SRD minus Scene = 28 of 30 packs of every document type with `for … await pack.getIndex({})`; dnd5e's `CompendiumBrowser.fetch` (`dnd5e.mjs:39901-39947`, the faceted tools) filters to one document class under `Promise.all`. Fix, in payoff order: (1) warm the indexes once per session — after `injectBundle`, or a lazy first-call prefetch — so the first search of a session is not the one that pays; (2) allow-list packs by document type (Actor + Item = 17 of 28; saves ≈ 1.1 s, the RollTable packs); `Promise.all` saves nothing while one pack dominates. Unit test on a fake `game.packs` for the selection; one live re-run for the number. Sources: perf-results-5 + orchestrator profile. *Verified.*

**F19 — 32 placeable tools require `sceneIdentifier`; `configure-soundscape` defaults to the active scene, and `update-token` claims to but resolves `game.scenes.current` (the viewed scene).** *tool.* Evidence: `src/tools/placeables/_module.ts:22-25` `sceneTarget = z.string().min(1)`; `token.ts:52-56` "Omit to use the ACTIVE scene" vs `src/page/placeables/token.ts:313-315` `game.scenes.current`; `soundscape.ts:36-42`; 5 bare calls in the baseline → 185-char errors; `game.scenes.active` is one world-wide document (`scene.ts:476`) — deterministic under §2.1 (`canvas.scene` / `scenes.current` would be the guess). Fix: optional `sceneTarget` resolved to `game.scenes.active` at 5 page sites (`_placeables.ts` :88/:154/:183/:244 + `region.ts:627`), `token.ts:313-315` switched to `active` (or its description corrected), echo `scene:{id,name,active:true}`, error when none is active; 32 descriptions; the 6 scene-document tools stay required. ~20 lines + 32 descriptions. Sources: perf-results-6. *Verified.*

**F20 — Output formats: 92 string / 51 JSON / 8 mixed with no per-family rule; line records are 37–43% smaller than JSON for the same fields; search hits disagree on `pack`.** *tool.* Evidence: `scratch/perf-results-formats.mjs`; the 8 placeable `list-*` return JSON on success and prose on a miss (`placeable-format.ts:68-71`); for the same fields (list-actors id, name, type) compact JSON 10,467 vs markdown 6,599 vs TSV 5,927; against today's bodies, which also carry unread fields and an envelope, 13,210 → 6,599 / 5,927 (−50–55%); `search-compendium` `pack:{id,label}` vs faceted `pack:"<id>"`. Fix (3.0 rule): list/search = one line per record in a documented field order with a header `<N> <noun>(s) [of M]`; `get-*` = JSON with a `compact`/`fields` selector; mutations = one-line confirmation + warnings; a miss is `isError`. Apply per family during consolidation. Sources: perf-results-7, skills-seams-2. *Verified.*

**F21 — `$defs/$ref` is not a lever: `reused:'ref'` grows the list +18.75%; genuine reuse is 0.34%; cross-tool dedup is not expressible in MCP; the "shared activity/effect shape" does not exist.** *tool.* Evidence: §4; `scratch/perf-schema-reused{,-fixed}.mjs`, `scratch/research-zod-reuse{,2,3}.mjs` (+53,250 chars both ways); cause `zod/v4/classic/schemas.js:166-170` + `to-json-schema.js:68-74,205-211`; 237 `.optional().describe(` sites; `scratch/perf-schema-nearDupes.mjs`; SDK `Server` passes `$defs` untouched, `McpServer.registerTool` would emit draft-07. Fix: record in the 3.0 plan — do not flip `reused`; keep the low-level `Server` + `src/utils/schema.ts`; drop "share shapes via `$ref`" from the token plan. Sources: perf-schema-zod-1, perf-schema-seams-1, research-dnd5e (zod/SDK answers). *Verified.*

**F22 — `actorIdentifier` is described 16 ways across 14 tools against TWO page-side rules (fuzzy in ~11 tools; strict in set-actor-art / delete-actor / duplicate-actor), and `add-feature` advertises exact-match but resolves fuzzy; `sceneIdentifier`'s 15 texts all state the same contract.** *tool.* (Medium for the actor half — a wrong contract on `add-feature`; low for the scene half, where 24/43 already share one instance.) Evidence: `scratch/perf-schema-nearDupes.mjs` ("exact name or ID" vs "partial name match supported" vs "also accepts a placed TOKEN id" ×9 vs bare `{type:string}` in level-up-pc; add-feature carries 3 texts for one field). Fix: TWO shared instances in `src/tools/_targets.ts` — `actorTarget` (fuzzy + token id, the rule `resolveActorFuzzy` implements) and `actorTargetStrict` (id or exact name, for the destructive / art tools) — and fold `ownership.ts:22`'s duplicate resolver into `resolveActorFuzzy`; ~14 actor tool files; `sceneTarget` already exists (cosmetic). A unit test that every `*Identifier` property uses a shared instance. Sources: perf-schema-user-facing-1. *Verified.*

**F23 — Toolsets: `actors` alone is 42.5% and `scenes` 33% of the list; the always-on `world` set is 82% non-lifeline weight (an eager-client cost on narrow registrations; in Claude Code the split saves ~4 names ≈ 160 chars per prompt).** *config.* Evidence: `scratch/perf-schema-toolsets.mjs`; `src/toolsets.ts:19-28` (`ALWAYS_ON` :201); world 10,636 chars of which configure-dnd5e-settings 4,570 + manage-calendar 1,971 + update-user 1,340 + set-user-avatar 816 = 8,697; `chat,combat` (22,659 → ≈ 13,962 after the split) carries 38% it did not ask for. Fix: split `world` into always-on `session` (get-world-info, get-current-scene, disconnect-bridge, list-users) and opt-in `settings` (`toolsets.ts`, `registry.test.ts:481`, `README.md:127,307`); consider `actors-read` / `actors-author`; apply F10 to the five heaviest authoring tools first (56,846 chars, 20%). Sources: perf-schema-results-2, perf-schema-config-1, arch-seams-12. *Verified.*

**F24 — The Node↔page seam is name-typed but payload-untyped: 166 call sites, every result `any`; 26 of 150 handlers take `any` args and 74 declare `unknown`/`any` returns.** *tool.* Evidence: `src/foundry.ts:43,447`; `src/page/index.ts:367` `PageApi = typeof api` used for keys only; `_shared.ts:91` "ZERO return-type protection"; `scratch/arch-seams-pageapi-typing.mjs`; `foundry.seam.test.ts` closes G3 (2026-06) for names only; flipping the signature today yields **397 `tsc` errors** — 282 from the 74 untyped returns, 76 `exactOptionalPropertyTypes` arg edits, 8 `{}`-to-no-arg calls, 2 shape casts, ≈ 28 genuine result mismatches (a tool reads a field the handler never returns). Fix, in order: type the 74 returns and 26 arg shapes page-side, then flip `call<N extends keyof PageApi>(name: N, args: Parameters<PageApi[N]>[0]): Promise<Awaited<ReturnType<PageApi[N]>>>`, then fix ≈ 115 tool-side sites. Several days, not half a day. Sources: arch-seams-5. *Verified.*

**F25 — The verify-script corpus (16,476 lines) is the real regression suite while `tests/integration` (1.3k lines) is the declared one, and the live suite gates on `MOLTEN_SERVER_URL`.** *scripts.* Evidence: `scratch/arch-seams-scripts-census.mjs` (63 verify, 60 with `finally{}`, counts pasted into commits by hand); `tests/integration/setup.ts:46-56`; `docs/RELEASE.md:19-21`; `local-foundry.mjs:74,172`. Fix, split: (a) must-do — `setup.ts` gates on `resolveHostConfig(ENV, hostKindFromEnv(process.env)).serverUrl` not being the placeholder, `local-foundry.mjs` takes `worldId` from the selector, RELEASE.md names `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` (~10 lines); (b) optional — promote the 12 release-set scripts (5,672 lines) into `*.int.test.ts`, which `vitest.integration.config.ts` (singleFork, 600 s hooks) already supports (~3–4 days, mechanical); spikes archived. Sources: arch-seams-6, arch-seams-8, user-facing-clone-10. *Verified.*

**F26 — This repo's `.env` is the family's secrets file and does not know it (4 undeclared sibling keys); 97 of 100 scripts and 3 siblings hand-roll the same `.env` loop.** *config / scripts.* Evidence: `comm` of `.env` vs `.env.example` keys → `BF_SUITE_USER/PASSWORD`, `MOLTEN_TEST_USER/PASSWORD`; `git grep` → 0; battleflow `target.mjs:34-47`, fxstudio `foundry.mjs:26,29`, miscpatches :22; 95 scripts carry the identical regex, `local-foundry.mjs:52-56` and `pull-prod-to-local.mjs:56-60` a `(.*?)` variant, only `bridge-config.mjs` / `measure-tool-results.mjs` / `verify-toolsets.mjs` do not; harness.mjs:46-54, foundry.mjs:12-20. Fix: `.env.example` gains `FOUNDRY_SUITE_*` / `FOUNDRY_PLAYER_*` read by `connectFoundry({identity})`; `loadEnv` exported from `fvtt-mcp-dnd5e/env`; a codemod drops the loop from `scripts/` — sequenced **after** the F27 cull (≈ 58 files then, 97 now). Sources: siblings-contract-2, siblings-env-1. *Verified.*

**F27 — 22 of 99 scripts are house-module harnesses or owner-ops; 17 spikes are historical (7 unreferenced); a release-set script hard-codes the owner's world; knip never looks at `scripts/`; `deploy-house-module` hand-rolls two file planes the hosts seam already provides.** *scripts.* Evidence: §6.2; `verify-region-tooling.mjs:25-26` (`worlds/the-broken-heart-of-greenrest/…webp`); `deploy-house-module.mjs:91-115` (`WebDavClient` + raw `fs`); `upload-soundscape-library.mjs:31` hard-codes `../fvtt-mod-soundscape-sfx`; siblings name ops scripts by the old path in 12 doc/comment lines, 0 code call sites; `knip.json` project `src/**/*.ts`. Fix: keep 60 / move 22 / archive 17 as in §6.2; the 3 campaign-bound verifies (`verify-region-tooling`, `verify-token-display:19`, `verify-scene-sidecar:21-22`) build `ZZ-*` fixtures; add `scripts/**/*.mjs` to knip's `entry`; `scripts/README.md`. Sources: siblings-ops-1, user-facing-scripts-1, user-facing-scripts-2. *Verified.*

**F28 — Skills duplicate ≈ 150–185 lines of enum/grammar/field paths the schemas already advertise (≈ 235 cited; the rest are recipes worth keeping), and it has drifted twice.** *skill.* Evidence: vocabulary-only — `stat-block-builder:200-322` grammar/enum bullets, `scene-builder:59-70`, `physical-item-builder:108-130` (cast-param block) and `:145-155` (itemType table); recipes / worked examples the fix retains — `physical-item-builder:66-87`, `pc-builder:140-167`; overlap 29/31, 21/21, 19/19, 16/16, 10/10, 11/11 (`scratch/skills-schema-overlap.mjs`); drift: `stat-block-builder:157-161` "add-feature takes no img" vs `add-feature.ts:224-231` (img since 91bb350, 2026-06-29); `session-audit:78-81` "get-actor lacks defenses" vs `actor-stats.ts:203-210` (eeb3b88). Fix: fix the two stale claims now; skills keep recipes by intent and point at the schema for vocabulary; the tokens the schema lacks (2 in manage-effect: `roll.attack.mode/classification`; 5 wildcard forms in create-pc: `skills:acr`, `skills:ath`, `languages:standard`, `tool:game`, `weapon:mar`) go into the schema. ~1 day across 4 skills. Sources: skills-line-1. *Verified.*

**F29 — `scene-builder`'s 65-line sidecar section re-derives a hazard `create-scene`'s `placeablesPath` already removes.** *skill.* Evidence: `scene-builder/SKILL.md:82-146` (:104 inline arrays, :107-134 dropped `sight`/`config` warning); `src/tools/scene.ts:295-303,550-565`; tom-cartos-import uses it (:220-226); scene-builder mentions `placeablesPath` 0 times. Fix: Step 0.5 → locate the sidecar, pass `placeablesPath`; keep the UVTT refusal. ~50 lines cut, 1 hour. Sources: skills-line-2. *Verified.*

**F30 — `set-actor-art` leaves inherited prototype settings; two skills re-derive the same 3-param fix-up after every art swap.** *tool.* Evidence: `src/page/assets.ts:131-185` writes only `img` + `prototypeToken.texture.src`; `token-cutout/SKILL.md:38-48`, `_shared/authoring-policy.md:75-84` (and :71-72 is wrong: the creation tools bake auto-rotate / ring / randomImg but NOT scale, and should not). Fix: `normalizePrototype` (default true) writes exactly `{prototypeToken.texture.scaleX/scaleY: 1, prototypeToken.ring.enabled: false}`, only when the token texture actually changes (skip on `applyToToken:false` or a no-op write); `autoRotate?: boolean` as a separate opt-in (the facing check in token-cutout :49-52 is judgment); do not reuse `tokenDefaults()` from the create path (it would rewrite disposition / sight / display); report placed tokens still carrying old settings; delete the duplicate prose and fix authoring-policy :71-72. Half a day. Sources: skills-line-3. *Verified.*

**F31 — `get-actor` reports 0 for a PC's max HP; session-audit papers over it with a campaign-repo snapshot.** *tool.* Evidence: `actor-stats.ts:135-143` reads source `hp.max ?? 0` (:140) and `:27` reads `system.attributes.hp.max` → null; `extractDerived` (`actors.ts:331-387`) has no hp; `session-audit/SKILL.md:76-81`. Fix: `hp:{value,max,effectiveMax,temp,tempmax}` from the live actor in `extractDerived`, and the two consumers `actor-stats.ts:27` and `:140` read `actorData.derived?.hp?.max ?? hp.max ?? 0` (the AC pattern at :33/:146); then drop the party-snapshots fallback. ~10 lines. Sources: skills-line-4. *Verified.*

**F32 — `pc-builder` re-derives two deterministic rules it says are not judgment: the class→pregen portrait path and `prepared: 2`.** *tool.* Evidence: `pc-builder/SKILL.md:226-236` (`modules/dnd-players-handbook/assets/journal-art/<class>.webp`, `phbprg<Class>0000`; 0 implementations in src — `phbprg` appears only as a fixture id in `pc.test.ts:280,283`); `_shared/authoring-policy.md:127-133`, `pc-builder:196-199`; `free-cast.ts:175-176,250` already does the write. Fix: `create-pc` gets `defaultArt` (portrait + token from the primary class's PHB pregen; warn when `dnd-players-handbook` is absent) and `spells.alwaysPrepared: boolean` (applied in the `addSpellsToActor` call, `advancement.ts:917-927`); `level-up-pc` imports no spells — either add a `spells` block or leave the per-spell `update-actor-item` patch in the skill (not "a flag on an existing input"); the skill keeps only WHICH classes. Half a day. Sources: skills-line-5. *Verified.*

**F33 — Owner/campaign content in skills: session-scribe is the owner's pipeline (~50 owner/campaign lines, ~12 dated owner stamps); soundscape-builder is the house module's skill (38 hits, private library); tom-cartos-import bakes an OWNER DEFAULT; session-audit / plot-drift-check / bestiary-builder assume an undeclared campaign-repo layout.** *skill / sibling.* Evidence: `session-scribe/SKILL.md:61,109,114,141-243` (103 lines owner-locked style, `msedge.exe` path, Greenrest, PC names; `scripts/setup.ps1`); `soundscape-builder/SKILL.md:307-318,342`; `tom-cartos-import/SKILL.md:24,35-44,65`; `session-audit:31,37` (ultracode), `:45,59,77,156`, `:220,222` (owner rule); `plot-drift-check:27-31`; `bestiary-builder:33-38`; the artificer's `illustration-builder/SKILL.md:20,25,244` still say "molten5e". Fix: session-scribe → per-campaign `STYLE.md` + `campaign.json` (or move to the campaign repo), mark Windows-only; soundscape-builder → the module repo, or keep with a README "companion module" section; tom-cartos: pack-faithful default, maps-only + autoexplore stamp as options; one `_shared/campaign-repo.md` convention the three audit skills reference; strip owner-rule stamps; scene-builder offers a soundscape. Sources: user-facing-skills-2/3/4/5, skills-user-facing-2/3, skills-siblings-1. *Verified.*

**F34 — Phase-2 language in design.md (18 lines), README, four docs, four skills + `_shared/authoring-policy.md`, and one tool description; journal-builder's "§8 landing zone" section is stale twice over.** *docs / skill.* Evidence: §9 inventory (skills: journal-builder, cards-builder, playlist-builder, stat-block-builder, `_shared/authoring-policy.md`; homonyms in `verify-wake.mjs:6,118-119`). Fix: §9 replacement shape; "later phase" → "out of scope"; delete §8 references; rename the 8 homonyms; the scrub grep adds `next phase|§8` (README:202-204 is not matched by the brief's regex). Sources: user-facing-scrub-1, skills-docs-1. *Verified.*

**F35 — README is 26% release narrative and Molten-first; CLAUDE.md/LOCAL.md are gitignored; 8 of 10 `docs/` files (+ HANDOFF) are historical; no CHANGELOG.** *docs.* Evidence: `README.md` 449 lines, 27-141 narratives (25.6%), 231 Requirements, 238 "hosted on Molten" / 405 "to Foundry on Molten", 35 hits; `.gitignore:2-3`; `docs/` 10 files / 2,485 lines, 8 done trackers / reviews; tags v2.1.1…v2.2.0 with no CHANGELOG; `docs/RELEASE.md` — the declared gate — omits the 12-script release set and the one-driver rule, which live only in CLAUDE.md (:34-36, :43-50) once HANDOFF (tracked; :100-102 carries the list today) retires. Fix: the 3.0 doc set = README (the owner's "git-friendly page, plain English" — written after 3.0's tool changes), CHANGELOG, design.md (scrubbed), CONTRIBUTING (today's CLAUDE.md), docs/hosts.md, docs/RELEASE.md (rewritten in place, naming the release set), scripts/README.md; the 8 done trackers / reviews → `docs/history/` with an index; local-sandbox.md rewritten in place; HANDOFF retired into the 3.0 plan. Sources: user-facing-clone-8, user-facing-clone-9, user-facing-docs-1. *Verified.*

**F36 — No premium-book presence check; `get-world-info` never says which books are installed; design.md §2.3 lists 3 prefixes, the code 5.** *tool / docs.* Evidence: `src/utils/compendium-sources.ts:40-48` (`PREMIUM_BOOK_PREFIXES`: MM, PHB, DMG, heroes-faerun, ravenloft); `src/page/world.ts:55-83`; `spells.ts:321-323`, `compendium-features.ts:87` per-call errors; `packPriority` tier 1 (`:128-132`) admits any non-SRD pack. Fix: `library:{'dnd-monster-manual': present|missing, …}` for all five in get-world-info; README states MM / PHB / DMG as **required for authoring** (module ids `dnd-monster-manual`, `dnd-players-handbook`, `dnd-dungeon-masters-guide` — design.md:64 "assumed always installed") and heroes-faerun / ravenloft as optional extensions; the non-authoring tools work without any; §2.3 lists the five. ~25 lines. Sources: user-facing-clone-7. *Verified.*

**F37 — `local-foundry.mjs` and `docs/local-sandbox.md` assume the owner's Windows install and the prod→local mirror; `.env.example:93-94` is mangled.** *scripts / docs.* Evidence: `local-foundry.mjs:52` (reads `.env`), `:71` (dies on `LOCAL_FOUNDRY_DATA`), `:76-77` (default app path), `:154` (admin-key enforcement); `docs/local-sandbox.md:120` (stale "v14.365"), `:124-129` (setup; step 4 = pull-prod-to-local); `.env.example:93-94` lost its backslashes and :94 carries an embedded CR byte. Fix: friendly ENOENT, platform-aware default app path, an "existing local install, no prod" path; split the doc into generic vs owner-ops; rewrite both `.env.example` lines. Sources: user-facing-clone-11. *Verified.*

**F38 — `send-chat-message` advertises the plane name `webdav` in its schema and descriptions.** *tool.* Evidence: `src/tools/chat.ts:23,26,40-43,91,276,357-358,365`; on `local` the upload is `node:fs`, on `generic` refused; the only host-shaped token in an advertised contract; its only caller is the in-repo skill. Fix: drop `webdav` outright in the major (a `.transform` alias would keep `webdav` in the advertised input-mode enum; `z.preprocess` over `z.enum(['upload','dataUri'])` if an alias is wanted); "through the host's file plane"; `chat-and-narration/SKILL.md:53,58` (`upload` is the default) and `:83-84` (`MOLTEN_WEBDAV_PASSWORD` → host file plane) in the same commit. ~10 lines. Sources: arch-seams-10, skills-config-1. *Verified.*

**F39 — Cross-repo contracts have no `docs/` page and no version pin: the artificer names 11 tool names (5 in CRUD families), three reverse flag contracts are documented only as file headers here and prose there, and the 3.0 rename checklist spans 6 repos / 56 files (+ 11 in the campaign repo).** *docs / sibling.* Evidence: `scratch/siblings-toolnames-in-siblings.mjs` (artificer 13 names / 8 files; battleflow 5 / 6 incl. `target.mjs:91`; campaign 21 / 15); `combat-stats.ts:4-17` ↔ battleflow ARCHITECTURE.md:303-330; `soundscape.ts:3-27`; `users.ts:41`, `scenes.ts:924`; the artificer's rename = 10 tracked files (`illustration-builder/SKILL.md:20,25,244` "molten5e" among them). Fix: `docs/contracts.md` (tool, input, output path, sibling doc + version); the rename checklist in the 3.0 plan; artificer docs/skill rename in the same move. Sources: siblings-artificer-1, siblings-rename-checklist-1, skills-siblings-1. *Verified.*

**F40 — dnd5e 6.0.2/6.0.3: the notes under-report six behaviour changes; the pin is DONE (`c53c2de`) with two of three targeted checks live.** *scripts.* (Severity → **low**: what remains is one live check and a prose edit.) Evidence: §10; `scratch/research-dnd5e-6.0.{2,3}.diff`; `scratch/pin-6.0.3-targeted-2026-09-20.txt` 4/4; release set + integration green on 6.0.3. Remaining for 3.0: the #7470 elevation / falling check on an unviewed scene (writers `token.ts:75,238,346`; restore in `finally`); `sourceItem.*` in the `manage-effect` prose (`:37-38,85-89,141-142`); optionally a roll-based assertion of `item` vs `sourceItem`. Sources: research-dnd5e + orchestrator. *Verified.*

### Low

**F41 — `list-macros`: 8,633 chars for 105 macros, no skill calls it, no filters, the description promises an icon + command preview the output lacks.** *tool.* Evidence: `src/tools/macros.ts:73,112-114,146-153`; the hotbar text is 12–21% of the body (7,639 with a pin count, 6,811 without); `m.img` / `m.commandPreview` are already in the page payload (`src/page/macros.ts:41-42`) and simply not printed. Fix: `nameFilter` + user filters; hotbar behind `includeHotbar`; print `img` / `commandPreview` in the formatter at `macros.ts:151` (or drop them from the description at :112-113). Sources: perf-results-9. *Verified.*

**F42 — The first call carries the bridge connect (8.8 s): `/join` is loaded twice; the phase split is unmeasured.** *tool.* Evidence: `src/foundry.ts:140-158,243,357,410`; bundle 532,338 bytes; no phase timing. Fix: reuse the probe page; add phase timestamps and measure once live before touching anything else. Sources: perf-results-10. *Verified.*

**F43 — `list-actors` and `list-journals` have no name filter (list-items and list-scenes do), so an ad-hoc name→id lookup pulls the whole list (13,210 / 9,660 chars).** *tool.* Evidence: `actor.ts:61-66`, `journal.ts:90-`; no skill is shown doing list-then-pick — actor tools accept names directly and `search-journals searchType:'title'` covers journals — so the gain is ad-hoc lookups and symmetry with `items.ts:52` / `scene.ts:341`. Fix: `nameFilter` on both (`page/actors.ts:287`, `page/journals.ts:67` + schema field + pass-through at `actor.ts:301` / `journal.ts` listJournals); `folder` on list-actors optional, not skill-driven. Sources: perf-results-11. *Verified.*

**F44 — Two never-advertised `getToolDefinitions()` survive as dead code, and every name is spelled three times.** *tool.* Evidence: `defByName` is 151 today; the "orphan" is an uncollected dead `getToolDefinitions()` on `DnD5eFeaturesFromCompendiumTools` (`features.ts:62-98`; `registry.ts:159-201` never spreads it) and likewise `DnD5eAddFeatureTool.getToolDefinitions()` at `add-feature.ts:554`; `registry.test.ts:320-329` tautological; the `toolsetOf()` duplicate case is guarded by `registry.test.ts:450-465`. Fix: delete both dead definitions (and `features.test.ts:52-55`); add the `defByName.size === handlers.length` assertion for the structural case (it does not detect these two); in the consolidation each module exports `{name, toolset, schema, description, handler}` and both maps derive from it. Sources: arch-seams-11. *Verified.*

**F45 — `src/page/actors.ts` is the one monolith worth splitting: 2,243 lines, 14 exports, 5 tests covering 1 export.** *tool.* Evidence: wc; `actors.test.ts` (all on `extractDamageProfile`); 16 real page modules untested (excluding `foundry-doc-mock.ts` and `index.ts`); 50 `(globalThis as any).X` refs in non-test `src/page` (3 in actors.ts). The June review demoted this split to P4 (`docs/architecture-review.md:196,216,221`). Fix: it returns only as a rider on the actor-family consolidation commit (split along export groups; pure-builder tests), not as standalone 3.0 work; leave `scenes.ts` / `advancement.ts`. Sources: arch-seams-13. *Verified.*

**F46 — `Host.worldId` is required config the page already knows; the wake is generic in mechanism.** *tool.* Evidence: `foundry.ts:202-217,286-290`; `chat.ts:335`; `world.ts:68`; `molten.ts:62-79`. Fix: worldId from `getWorldInfo` (cached); sole-world discovery on `/setup`; `FOUNDRY_WAKE_URL` on generic so `molten` = generic + WebDAV defaults. Rides F1. Sources: arch-seams-14. *Verified.*

**F47 — Owner's box name `eoh-test` and `greenrest` survive in src comments and test fixtures.** *tool.* Evidence: `foundry.ts:63`, `webdav.ts:20`, `webdav.test.ts`, `assets/index.test.ts`, `env.test.ts:16,65,97,151`, `actor.test.ts:104`, `content-audit.test.ts:68`. Fix: 20-line sed to `your-server` / `example`. Sources: user-facing-clone-12. *Verified.*

**F48 — Stale `dist/tools/molten/` build output and a `tools/molten` comment survive the rename.** *config.* Evidence: `dist/tools/molten/` — 9 files (js + d.ts + map) on the owner's box only; no sibling imports it; `package.json` build has no clean; `asset-bridge.ts:8`; keyword `molten-hosting`. Fix: a dependency-free `prebuild` (`node -e "require('fs').rmSync('dist',{recursive:true,force:true})"`) or rimraf — not `tsc --build --clean`, which leaves the ghost; fix the comment; drop the keyword. Sources: perf-schema-molten-residue-1. *Verified.*

**F49 — 51 of 151 tools are named by no skill; 4 of 8 placeable families (tiles, lights, walls, drawings) are touched by ≤ 1 skill and only via `list-*`.** *docs.* Evidence: `scratch/skills-tool-matrix.md` (22 of 44 scene tools unnamed; sounds 2 skills via `create-sounds`, tokens 4 skills / 9 lines, notes 2 skills / all 4 tools, regions 2 skills / all 7 tools / 17 lines). Fix: the placeable consolidation is skill-cheap for those four families only — regions and tokens carry real re-point cost; use the per-family table as the checklist; decide per unnamed tool: plain feature (document in README) or drop. Sources: skills-results-1. *Verified.*

**F50 — House-style journal HTML is re-derived in three places instead of the structuring tool.** *skill / tool.* Evidence: `journal.ts:358-363` renders `.mcp-journal`; `session-scribe/SKILL.md:250-251` hand-writes it; `bestiary-entry.mjs:186-190` (its wrapper also drops the inline `<style>`). Fix: session-scribe → `update-quest-journal` with `newPageName` + `playerVisible: true` + heading / lead / readaloud / list blocks (~1 hour, skill side); bestiary rides F4 (tool side): an upsert-by-page-name path and a page-sort capability (or an `html` block with `newPageName` plus a sort option) before the hand-built wrapper can go. Sources: skills-line-6. *Verified.*

---

## 12. Current-state map

- **Core infra** — *SOLID*: quarantine, registry, schema generation, toolsets, hosts seam in `src/`.
  *Named debts*: error mapper (F5), payload-untyped seam (F24), one-directional registry (F44),
  `actors.ts` (F45), unminified 532 KB bundle (fine — per session).
- **Config / packaging** — *MOLTEN-SHAPED*: default host, env names, placeholder, no exports/bin,
  playwright placement, `.env` location (F1, F2, F26, F46, F48).
- **Results** — *OVERSIZED*: two self-inflicted surveys, no projection rule, three formats, character
  cap (F6–F9, F19, F20, F41, F43).
- **Advertised schema** — *PROSE-HEAVY*: 67% English; doctrine in descriptions; 16 spellings of one
  concept; heavy authoring tools dominate; `world` set bloated (F10, F22, F23).
- **Skills** — *SOLID in shape*, leaking in detail; owner content to extract; descriptions 2× budget
  (F16, F17, F28–F33, F49, F50).
- **Docs** — *ACCRETED*: Phase-2 text, Molten-first README, gitignored house rules, 10 historical
  docs live (F13, F34, F35, F37).
- **Scripts** — *THE REAL SUITE, UNDECLARED*: 60 product / 22 sibling / 17 archive (F25, F27).
- **Siblings** — *BROKEN BY THE RENAME*, contract undeclared (F3, F39).
- **dnd5e 6.x** — *PINNED* (`c53c2de`); one live check (#7470) and a prose edit left (F40).

---

## 13. The 3.0 roadmap — milestones in order, one family = one commit, measured definition of done

| # | Milestone | Commits | Definition of done (numbers to hit) |
|---|---|---|---|
| **M0** | **Measure & guard.** Promote the measurement scripts (`measure-tool-results`, `perf-schema-decompose`, `skills-matrix`, `siblings-names-cost`) to `scripts/measure/`; unit tests that print the budgets; delete the orphan definition; clean step in `build`. | 1 | The scripts reproduce today's numbers: `tools/list` 283,948 · baseline 154,534 · descriptions 15,382 · names 11,147; `dist/tools/molten` gone; 152 = 151 definitions. |
| **M1** | **The 6.0.3 pin (official 6.x).** ✅ **Done `c53c2de`** (2026-09-20): source-diff review, targeted checks 4/4 (#7482, #7450), the 12-script release set, integration 85/1, pins moved. Left: the #7470 elevation check and `sourceItem.*` in the manage-effect prose (fold into M2's effects commit). | done | 12/12 release scripts green; README / LOCAL / plan say 6.0.3 / 14.368 — met. |
| **M2** | **Results diet** (F6, F7, F8, F9, F17, F18, F19, F20 rule, F41, F43): name facet + limit 50 + `.strict()`; ownership reshape; record-level cap; compact projections (search hits keep `uuid`); `list-scenes` fields (+ background on `get-current-scene`); active-scene default; `nameFilter`s; unified search-hit shape; the compendium index warm-up. | one per tool family (compendium, actors/ownership, scenes, items, journals, macros, cap) | Re-run the 24-call baseline with the corrected creature/spell args: **≤ ~112,600 chars**; **0 capped results**; **0 zod errors** on bare placeable `list-*`; `totalFound` present on every search body; `search-compendium` first call **< 1 s** after the session warm-up (re-run `scratch/profile-search-compendium.mjs`). |
| **M3** | **Skill descriptions + line fixes** (F16, F28 drift, F29, F31, F32, F30): six descriptions applied and the other 11 trimmed; the two stale claims fixed; sidecar → `placeablesPath`; `hp` in `extractDerived`; `defaultArt`/`alwaysPrepared`; `normalizePrototype`. | 1 (descriptions) + 1 per tool fix | Descriptions **≤ 8,000 chars** (the measured six give 11,982; ≈ 7,400 is the projection) with all 40 trigger phrases (`skills-desc-check.mjs`); `scene-builder` sidecar section ≤ 15 lines; 0 skill lines prescribing the post-art fix-up. |
| **M4** | **Config contract + hosts** (F1, F12, F38, F46, F15 role check, F36): `FOUNDRY_*` canonical, `generic` default, placeholder guard, aliases only in `env.ts`, `FOUNDRY_WAKE_URL`, worldId discovery, bridge `FilePlane`, chat enum, `library` in get-world-info, role warning. | 1 (env) + 1 (bridge plane) + 1 (chat/world-info) | `git grep MOLTEN_ src` matches only `src/hosts/env.ts`; `resolveHostConfig({})` → generic and a refusal in < 1 s; generic registry advertises **0** "unavailable" asset tools; live verify: `upload-asset`/`list-assets`/`create-asset-folder` on `local` through the bridge plane with counts. |
| **M5** | **Package + sibling contract + scripts** (F2, F3, F26, F27, F25 gate): `exports`/`bin`/`files`, `client.ts`, `loadEnv`, `connectFoundry`, `disconnect()`; playwright → deps; integration gate on the selector; scripts classified (60 keep / 22 out / 17 archive); knip covers scripts; siblings switched. | 1 here + 1 per sibling (battleflow, fxstudio, miscpatches, soundscape-sfx, artificer docs) | battleflow `node tools/smoke-saves.mjs --list` passes; **0** files in any sibling name `fvtt-mcp-molten5e`; **0** hand-rolled `.env` loops in `scripts/`; `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration` runs without `MOLTEN_SERVER_URL`; `.env.example` declares every key the family reads. |
| **M6** | **Error taxonomy + seam typing** (F5, F24) — the error code travels in the Error's `name` / a message prefix (the only channels that survive `page.evaluate`); the 74 page returns and 26 arg shapes typed first, then the signature flip, then ≈ 115 tool-side fixes (397 `tsc` errors today). | 2–4 | 12/12 scratch error cases keep their original text (unit test); `foundry.call` results typed — **0** `any` results (`tsc`). Several days, not half a day. |
| **M7** | **Schema prose diet + toolsets** (F10, F22, F23): prose budget test, 15 descriptions rewritten, `_targets.ts` (`actorTarget` / `actorTargetStrict`), doctrine → skills, `world` → `session` + `settings`. **Lands before M8** — a deferred client loads a consolidated family's whole schema on first use. | 1 per tool family, 1 for toolsets | `tools/list` **≤ 230,000 chars** (−19%; the prose budget's mechanical ceiling is ≈ 240k — the identifier dedup and toolset split carry the rest); every leaf ≤ 120 chars, every description ≤ 400 (test); always-on set **≤ 2,100 chars**; 2 shared actor-target descriptions, 1 scene, 1 item. |
| **M8** | **CRUD consolidation — one family per commit** (F11, F20, F44, F45, F49): b2 lossless union + `op` (+ `kind` for placeables), member descriptions kept, the family's skill lines re-pointed (from the 185-line table), its verify script re-pointed, sibling checklist entries, `actors.ts` split in the actor commit, module-exports-one-record registry. Order: placeables (skill-cheap) → macros → folders → playlists → cards → tables → items → journals → scenes → actors. | 10–17 | Per family: advertised bytes **≤ today's** for that family; names → 1 (or per-op); 0 unresolved tool names in `.claude/skills` (`skills-matrix.mjs`); the family's verify counts pasted. Overall: names **151 → ≤ 90**; two-registration name chars **≤ 7,000** (from 11,147); `tools/list` still ≤ 230k. |
| **M9** | **Skills owner-content + Phase-2 scrub + docs** (F13, F14, F33, F34, F35, F37, F39, F47): start-session/chat-and-narration host-neutral; session-scribe/soundscape/tom-cartos per the open decisions; `_shared/campaign-repo.md`; design.md §1/§4/§5/§8; README rewrite; CHANGELOG; CONTRIBUTING; docs/hosts.md; docs/contracts.md; docs/history; owner strings scrubbed. | 1 (design.md) + 1 (README/CHANGELOG/CONTRIBUTING) + 1 (skills) + 1 (history move) | The Phase-2 grep → **0** hits outside `docs/history/`; the owner-string grep (`greenrest|broken-heart|DM Assistant|eoh-test|foundry-molten5e`) → **0** outside `.env.example` examples and `docs/history/`; README ≤ 250 lines with the 60-second start before line 40 and a skills install step; `.claude/skills` carry 0 server prefixes. |
| **M10** | **Release 3.0.** Full offline gate, the release set, integration, the measurement scripts' numbers in the release notes; tag. | 1 | All M0–M9 numbers restated and met; sandbox 6.0.3 / 14.368 verified; prod upgrade path documented (Foundry ≥ 14.367 first). |

Ordering rationale: M1 (done) gave the live gate on today's names before anything renames; M2/M3
are the largest per-prompt savings and touch no names; M4/M5 make the repo runnable by a stranger and
the siblings whole before the surface changes; M6/M7 are name-neutral hardening — and M7 must
precede M8 so a consolidated family never loads more bytes than its tools did; M8 is the only
renaming milestone and lands with every dependent edit; M9 is text; M10 ships.

---

## 14. Could not be verified (read-only pass)

- Live behaviour on a real `FOUNDRY_HOST=generic` instance; whether `FilePicker.upload` through the
  headless bridge user succeeds on Molten specifically.
- The split of the 8.8 s first call (no phase timing exists). (The `search-compendium` split IS
  measured — §3.4, F18.)
- The real size of the intended `search-compendium-creatures {name:"goblin"}` / `spells {name:"fire"}`
  calls (the baseline's args were stripped).
- The biggest single-document results (`get-compendium-entry` full, `get-actor` on a leveled PC) —
  not in the baseline; likely the next cap offenders.
- Token figures are chars/3.6, not `count_tokens`; the exact per-prompt string Claude Code emits for
  deferred MCP tools (names observed; whether descriptions are also sent is unconfirmed) and whether
  prompt caching makes it a cache read.
- Whether every MCP client (Desktop, claude.ai, third-party) and the Anthropic API accept `$defs/$ref`
  inside `input_schema` at runtime (2020-12 permits it; the SDK passes it; no live call made).
- Claude Code `${VAR}` expansion inside `.mcp.json`; npm `file:` install behaviour on this machine
  (symlink vs copy); whether Claude Code loads `.claude/skills` from a registered server's directory.
- Whether a `BF_TARGET=prod` battleflow run has happened since `e53958e`; whether fxstudio's 10
  prototypes are still run; whether the sibling absolute-path imports are their only coupling.
- Live behaviour of #7470 (falling on unviewed scenes) and a roll-based `item` vs `sourceItem`
  assertion (#7450 was verified as persistence, #7482 live — §10); whether the premium PHB module
  carries the #7452 Druid fix.
- Whether compendium searches on a world with no premium packs silently surface third-party packs;
  whether `verify-region-tooling.mjs` fails or warns when its Greenrest path is absent.
- The exact `it.each` expansion behind the 1,730 test figure (static count 1,687–1,698 `it(` sites).
- The zod.dev `unrepresentable` function form (installed 4.4.3 types allow only `'throw'|'any'`).
- (Housekeeping: the `verify-wake.mjs` / `measure-tool-results.mjs` / `local-foundry.mjs` edits the
  streams saw in `git status` were the orchestrator's — `96ed726`, and the `--bodies` option that
  captured `scratch/bodies-2026-09-20/`.)

---

## 15. Open decisions for the owner

1. **Consolidation shape** — confirm the b2 lossless `op` union per family (names −43%, bytes
   neutral after the prose diet) over (a) `describe`-op (rejected here) or leaving the CRUD tools as
   they are (prose diet only; names unchanged).
2. **Default host** — `generic` as the default means the owner's `foundry-molten5e` registration
   must set `FOUNDRY_HOST=molten` explicitly (today it sets nothing). Accept?
3. **Skill descriptions** — accept the six rewrites in `scratch/skills-desc-budget.mjs` verbatim, and
   the ≤ 7,500-char budget for all 17.
4. **soundscape-builder + `configure-soundscape`** — move into `fvtt-mod-soundscape` as that module's
   skill/tool, or keep here under a README "tools that need a companion module" section (same
   question for `get-combat-stats` and `set-landing-scene`).
5. **session-scribe** — move to the campaign repo (or a sibling skill repo), or genericize with a
   per-campaign `STYLE.md` + `campaign.json` and a Windows-only note.
6. **bestiary-builder** — land the two missing tools (compendium journal page read; entry-level
   journal ownership) and delete the script, or only route the script through `bridge-config`.
7. **Registration names** — keep `foundry-molten5e` / `foundry-local5e` privately, demote
   `foundry-local5e` to a gitignored project-scope `.mcp.json` with `FOUNDRY_TOOLSETS=world` in the
   four sandbox repos; `.mcp.json.example` shows a neutral name (`foundry` / `foundry-sandbox`).
8. **Ops scripts destination** — a new `fvtt-tools` sibling for deploy/register/configure/uninstall
   (importing `fvtt-mcp-dnd5e/client`+`/hosts`), or keep those four here as the "sandbox toolkit".
9. **Bridge file plane on generic** — build it in 3.0 (2–3 days incl. live verify) or accept that
   the asset tools and 7 skills stay dead on `generic`.
10. **Output format for lists** — Markdown lines or TSV (5,927 vs 6,599 for list-actors); one rule
    for every list.
11. **Active-scene default** for the 34 placeable tools (echoing the scene it used).
12. **Promote the 12 release scripts into `tests/integration`** (3–4 days) or keep the verify corpus
    as the documented gate.
13. **CLAUDE.md** — track it (as `CONTRIBUTING.md` + a 3-line pointer) so a stranger gets the gate
    and the compatibility procedure.
14. **Premium set** — add `dnd-arcana-unleashed` / `dnd-deadfall` to `PREMIUM_BOOK_PREFIXES` if
    installed; design.md §2.3 lists all five current prefixes.
15. **Error contract** — accept the `PageError {code, message}` shape as the page→node error seam
    (replacing substring classification) or only the 3-line "append the raw message" fix.
16. **tom-cartos-import defaults** — pack-faithful import as the default with maps-only and the
    autoexplore stamp as asked-for options.
