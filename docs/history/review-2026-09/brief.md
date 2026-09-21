# Review brief — fvtt-mcp-dnd5e architecture & perf review, 2026-09-20

You are one agent in a multi-agent review of this repository. Read this whole brief first. Your
findings feed a synthesis that becomes `docs/architecture-review-2026-09.md` and then the 3.0 plan.

## Ground rules (binding for every agent)

- **Read-only on the world. Do NOT connect to Foundry, do NOT call any `mcp__foundry-*` tool, do NOT
  run any `scripts/verify-*.mjs`, `measure-*.mjs`, `spike-*.mjs` or `local-foundry.mjs`.** Only one
  process may drive the sandbox at a time and the orchestrator owns it. Everything live you need is
  already captured under `scratch/` (see "Measurements already taken").
- You MAY run offline things: `node`, `npx tsc --noEmit`, `npm test`, small scratch scripts that
  import from `dist/` (already built, fresh) or `node_modules`. Put scratch scripts and their
  outputs in `scratch/` (gitignored) with a name prefixed by your dimension, e.g.
  `scratch/perf-schema-shapes.mjs`. Never modify tracked files.
- **Measure, don't guess.** Every claim about size, count or time carries a number and how it was
  obtained (a script path, a command, a file:line). If you cannot measure something, say so in
  `could_not_verify` instead of estimating.
- Cite code as `path:line`. Keep each finding's evidence concrete enough that a skeptic can refute
  it by reading the same lines.
- Backticks inside a double-quoted bash string execute as commands — write scratch scripts to a
  file with a heredoc (`cat > file <<'EOF'`) and run the file.

## What this project is (and where it came from)

`fvtt-mcp-dnd5e` is an MCP server (stdio, TypeScript, `@modelcontextprotocol/sdk`) that drives a
live Foundry VTT world (v14, dnd5e 6.x) through a headless Playwright Chromium session that logs in
as a real Foundry user. 151 tools in `src/tools/**` call page-side code in `src/page/**` (bundled
into the browser by esbuild) through one seam, `foundry.call()` in `src/foundry.ts`. 17 skills in
`.claude/skills/**` hold the D&D judgment and compose the tools. `design.md` is binding — read it.
Key rules: "skills decide, tools do" (§2.1, §3), compendium-first / never the SRD (§2.3),
host-agnostic core with hosts as options (§2.6), one registry that derives the advertised list
(§9), schemas generated from one zod definition (`src/utils/schema.ts`).

**History — the review must read the code against it.** The project began (2026-06) as
"fvtt-mcp-molten5e": a Molten-Hosting-specific MCP (Magic-URL wake, WebDAV file plane, `MOLTEN_*`
env vars, `pull-prod-to-local`, house-module deploy scripts). It grew tool by tool into a full
dnd5e authoring surface. On 2026-09-20 (v2.2.0) it was renamed and the host-specific parts were
moved behind `src/hosts/**` (`molten` / `local` / `generic`). Anything still *shaped* by the
Molten origin — names, env vars, assumptions, scripts, docs, defaults — is a finding.

**Owner's decisions for 3.0 (2026-09-20), which frame every finding:**

1. 3.0 = (a) the token/perf fix, (b) first official dnd5e 6.x support, (c) the refactor that makes
   it *the dnd5e MCP* — molten / local / generic are just endpoints.
2. **3.0 is terminal.** After it the project is in maintenance / steady state. No roadmap beyond it.
3. **Phase 2 is removed.** The "DM session assistance" line — the §8 event bridge /
   `wait-for-events` / `session-assist` / companion module / NUC deployment — is gone. Every doc,
   plan, script comment and memory that mentions it must be scrubbed. Already-shipped features
   that were labelled Phase 2 (`session-scribe`, chat tools, `export-chat-log`) stay as plain
   features. (Internal note: a live assistant, if ever, is a separate app that may depend on this
   MCP — never mixed in.)
4. **User-facing repo.** Other users clone it and run it against their own world. Nothing
   campaign-specific (the owner's world "Greenrest" / `the-broken-heart-of-greenrest`, world ids,
   "DM Assistant", the owner's registration names `foundry-molten5e` / `foundry-local5e`, Craig
   recordings, the campaign repo `../fvtt-campaign-greenrest`, absolute `D:/Workbench/...` paths)
   may stay in tracked files except as configuration or examples.
5. **Sister to the `fvtt-mod-*` families.** Separate repos, but this MCP is often the core
   component when AI is used for Foundry module dev and world dev. The house modules
   (`../fvtt-mod-battleflow`, `../fvtt-mod-fxstudio`, `../fvtt-mod-miscpatches`,
   `../fvtt-mod-soundscape-sfx`, `../fvtt-mcp-artificer`) are first-class consumers. Known today:
   battleflow (26 files) and miscpatches import the `Foundry` class from
   `file:///D:/Workbench/FVTT/Repos/fvtt-mcp-molten5e/dist/foundry.js` — an absolute path to the
   OLD directory name, so the rename broke them; fxstudio resolves `../fvtt-mcp-molten5e` by
   default (`tools/lib/env.mjs`, overridable by `FXS_MCP_REPO`) and reads this repo's `.env` by
   hand; they also call `scripts/local-foundry.mjs`, `scripts/deploy-house-module.mjs`,
   `scripts/configure-modules.mjs`, `scripts/upload-soundscape-library.mjs`. `package.json` has no
   `exports` field — `dist/foundry.js` is an undeclared library surface.
6. Prod (Molten) stays on dnd5e 5.3.3 / Foundry 14.364 for now; the sandbox is 6.0.3 / 14.368.
   The README rewrite waits for 3.0. There is no 2.3 — the response/schema diet ships inside 3.0.
7. The CRUD consolidation is parked for 3.0: 70 of 151 tools are `list/create/update/delete-X`
   across 17 families (placeables: tiles lights sounds drawings walls tokens notes regions — 36
   tools incl. teleporter/behavior/remap; documents: items 6, tables 6, journals 5, actors 4,
   folders 4, scenes 4, playlists 4, cards 4, macros 3). 121 distinct tool names appear across the
   17 `SKILL.md`s.

## Why the review exists — the cost model

The owner runs out of tokens in Claude Code and `/explain-usage` named this MCP. In Claude Code,
MCP tool *schemas* are deferred (loaded on demand) — what costs context there is (1) the tool
**results**, (2) the 302 tool **names** in every prompt (two registrations × 151), and (3) the 17
skill **descriptions** in every prompt. In eager clients (Claude Desktop, claude.ai) the full
`tools/list` (schemas) is loaded up front — ~79k tokens per registration.

## Measurements already taken (sandbox, 2026-09-20, dnd5e 6.0.3 / Foundry 14.368)

Files: `scratch/measure-2026-09-20c.json` (rows), `scratch/bodies-2026-09-20/<tool>.txt` (the
full text each call returned — read these to see the SHAPE of what a client receives),
`scratch/skill-desc.txt`. Scripts: `scripts/measure-tool-results.mjs`, `scripts/verify-toolsets.mjs`.

**tools/list** (unset `FOUNDRY_TOOLSETS`): 151 tools, **283,948 chars ≈ 78.9k tokens**; input
schemas 206k chars (73%), descriptions 68k. Heaviest schemas: `manage-activity` 16k,
`update-actor` 15k, `add-feature` 13k, `add-item` 9k, `create-scene` 9k chars.
`FOUNDRY_TOOLSETS=chat,combat` → 16 tools, 22,659 chars ≈ 6.3k tokens.

**24 ordinary read calls → 154,534 chars ≈ 42.9k tokens of results** (tokens ≈ chars/3.6):

| tool | args | chars | ~tokens | truncated | error | ms |
|---|---|---|---|---|---|---|
| `search-compendium-creatures` | `{"query": "goblin"}` | 20073 | 5576 | YES |  | 627 |
| `list-actor-ownership` | `{}` | 20073 | 5576 | YES (227,662 chars before the cap) |  | 190 |
| `list-items` | `{}` | 16392 | 4553 |  |  | 145 |
| `search-compendium-spells` | `{"query": "fire"}` | 14979 | 4161 |  |  | 534 |
| `list-actors` | `{}` | 13210 | 3669 |  |  | 140 |
| `list-actors` | `{"type": "npc"}` | 11946 | 3318 |  |  | 709 |
| `list-scenes` | `{}` | 9698 | 2694 |  |  | 153 |
| `list-journals` | `{}` | 9660 | 2683 |  |  | 140 |
| `search-compendium` | `{"query": "sword"}` | 8954 | 2487 |  |  | 7826 (13,200 on the first run) |
| `list-macros` | `{}` | 8633 | 2398 |  |  | 134 |
| `list-chat-messages` | `{"limit": 50}` | 6135 | 1704 |  |  | 152 |
| `list-folders` | `{}` | 5763 | 1601 |  |  | 135 |
| `list-compendium-packs` | `{}` | 2861 | 795 |  |  | 152 |
| `get-world-info` | `{}` | 1805 | 501 |  |  | 8840 (carries the bridge connect) |
| `get-current-scene` | `{}` | 1700 | 472 |  |  | 167 |
| `list-users` | `{}` | 835 | 232 |  |  | 124 |
| `list-playlists` | `{}` | 690 | 192 |  |  | 157 |
| `list-tokens` | `{}` | 185 | 51 |  | ERR (wants `sceneIdentifier`) | 1 |
| `list-walls` | `{}` | 185 | 51 |  | ERR | 1 |
| `list-lights` | `{}` | 185 | 51 |  | ERR | 1 |
| `list-regions` | `{}` | 185 | 51 |  | ERR | 3 |
| `list-notes` | `{}` | 185 | 51 |  | ERR | 2 |
| `list-rolltables` | `{}` | 181 | 50 |  |  | 140 |
| `list-cards` | `{}` | 21 | 6 |  |  | 119 |

The cap: `TOOL_RESPONSE_MAX_CHARS` default 20,000 (`src/config.ts:68`), applied by `capResponse`
in `src/index.ts:30` — it cuts the text at the character, so a JSON result is cut mid-document.

**Skill front-matter descriptions** (what every prompt carries): **15,382 chars ≈ 4.3k tokens**
over 17 skills; `pc-builder` 1,317, `session-audit` 1,153, `tom-cartos-import` 1,057,
`physical-item-builder` 1,036, `playlist-builder` 1,011, `stat-block-builder` 992,
`soundscape-builder` 960, `session-scribe` 957 … `token-cutout` 575. SKILL.md bodies total 229k
chars (loaded only on use).

**Offline gate** (green today): biome · tsc · 1,730 unit tests · build · knip.
`src/tools` 52 files / 17.5k lines; `src/page` 54 files / 22.2k lines; `src/hosts` 9 / 1.1k;
biggest: `src/page/actors.ts` 2,243, `src/page/scenes.ts` 1,465, `src/page/dnd5e/advancement.ts`
1,374, `src/tools/dnd5e/add-feature.ts` 1,237, `src/tools/compendium.ts` 1,051. 99 scripts in
`scripts/` (63 `verify-*`, 17 `spike-*`, the rest ops/one-offs). Dependencies: zod ^4.4.3,
`@modelcontextprotocol/sdk` ^1.29.0, playwright ^1.61.0.

## Phase-2 language — where it lives (for the scrub inventory)

`git grep -n -i -E "phase[ -]?2|wait-for-events|event bridge|session-assist|live assist|NUC|companion module|half 2"`
→ design.md (18), docs/scene-placeables-architecture.md (10), docs/architecture-review.md (4),
docs/alignment-plan.md (4), scripts/verify-wake.mjs (3), src/page/dnd5e/cast-spells.ts (1),
scripts/verify-{write-tools,journal-tooling,dnd5e-writes,actor-tooling}.mjs (1 each),
docs/plan-2.1-dnd5e-6-features.md (1), docs/compendium-lookup-plan.md (1).

## Campaign / owner-specific strings — where they live

`git grep -n -i -E "greenrest|broken-heart|DM Assistant|partystash|craig"` → session-scribe
(SKILL.md 19, scripts/session_scribe.py 25), scripts/verify-partystash*.mjs / shot-partystash-coin
/ register-partystash / verify-receipt-settings (~40), src/hosts/env.test.ts (4), design.md (3),
src/tools/bridge.ts (2), src/registry.ts (1), src/tools/scene.test.ts (2), and one-offs in ~20
scripts. `molten` appears in README (28), .env.example (21), src/hosts/** (by design),
docs/plan-2.2-hosts.md (16), scripts/pull-prod-to-local.mjs (25), scripts/lib/bridge-config.mjs (6),
tests/integration/setup.ts (6).

## Output contract

Return findings through the StructuredOutput schema you were given. Severity: `high` = blocks a
3.0 goal or a user cloning the repo, or a measured cost ≥ 10% of a budget; `medium` = a real cost
or a design.md violation with a clear fix; `low` = hygiene. `side` says where the fix belongs
(design.md §2.1): `tool`, `skill`, `docs`, `scripts`, `sibling`, `config`. Put numbers in
`evidence`. Put anything you wanted to check but could not in `could_not_verify`.
