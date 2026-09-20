# HANDOFF — the review, the 6.0.3 pin, the README, and the 3.0 plan (written 2026-09-20, owner-requested)

> Read this, then [`design.md`](design.md) (binding), then [`docs/plan-2.2-hosts.md`](docs/plan-2.2-hosts.md)
> (what just shipped and the measurements behind it). Retire this file when the 3.0 plan doc exists and
> its first milestone is checked — the plan's checkboxes are the durable state.

## Where things stand

- **`main` = v2.2.0** (`e06aba2`, tagged, pushed). The repo is **`fvtt-mcp-dnd5e`** as of today
  (GitHub renamed — the old name redirects; directory renamed; both `~/.claude.json` registrations
  repointed; backup `~/.claude.json.bak-2026-09-20-rename`). The registration names
  `foundry-molten5e` / `foundry-local5e` deliberately stayed — `fvtt-mod-fxstudio` and the
  `start-session` skill reference them.
- 2.2 changed **no tool behaviour**: `src/hosts/**` is the one place that knows where Foundry runs
  (`FOUNDRY_HOST=molten|local|generic`; `FOUNDRY_PROFILE=local` still works), the asset file tools
  now run on the sandbox through a real `node:fs` plane, `FOUNDRY_TOOLSETS` lets a registration
  advertise a subset (13 toolsets in [`src/toolsets.ts`](src/toolsets.ts), `world` always on),
  `get-world-info` reports `host`. Verified live (sandbox): `verify-asset-plane` 28/28,
  `verify-reads` 25/25, integration 85/85, `verify-toolsets` 9/9 over the real stdio server.
- Offline gate green: biome · tsc · **1730** unit tests · build · knip.
- **The sandbox is on dnd5e 6.0.3 / Foundry 14.368. The pins say 6.0.1** (README line ~27,
  `LOCAL.md`, the 2.1 plan's Progress list). Everything passed on 6.0.3 today, but the CLAUDE.md
  compatibility procedure (release notes → targeted verifies → pins) has **not** been run for
  6.0.2 / 6.0.3. Prod's version is the owner's to state (README still says prod is on dnd5e
  5.3.3 / Foundry 14.364 — confirm before touching that sentence).
- Sandbox: `node scripts/local-foundry.mjs status` first. It died with the Claude Code restart
  today (stale pid) — `start` brings it back and launches the world. A Claude Code MCP session
  that has called a tool holds a bridge user in the world ("DM Assistant"); `disconnect-bridge`
  before running a suite (ONE world-driver at a time).

## Why this handoff exists — the owner's framing

The owner often runs out of tokens and `/explain-usage` (Claude Code) flagged this MCP as the hog.
2.2 measured the surface and gave eager clients a lever (toolsets). **The next line is about what
actually costs context in Claude Code, where schemas are already deferred:** the tool *results*, the
302 tool *names* in every prompt (two registrations), and the 17 skill *descriptions* in every
prompt. The owner's order: **a perf / arch review first**, then the 6.0.3 pin, the README, and the
3.0 plan — the review informs the plan, so do not write the plan before the review.

## The program — in this order

### A. Perf / arch review (first; a `docs/architecture-review-2026-09.md`, dated like the last one)

The previous one is [`docs/architecture-review.md`](docs/architecture-review.md) (2026-06-24,
superseded snapshot — keep it, add a dated sibling). Same shape: findings ranked by severity, each
with evidence and a fix on the right side of the skills/tools line; a roadmap; the things it could
not verify live. The owner has run multi-agent reviews before (that one was 5 review dimensions +
2 research streams → synthesis → adversarial verification); a workflow is the owner's opt-in, not
yours to launch.

**Perf — measure, don't guess.** The baseline is already taken; reproduce it, then explain it:

```bash
# what a client RECEIVES per call, over the real stdio server (read-only; results table + JSON)
FOUNDRY_HOST=local node scripts/measure-tool-results.mjs --json scratch/measure-<date>.json
# what a client LOADS: tools/list size per toolset selection, and the refusal contract
node scripts/verify-toolsets.mjs
```

Baseline 2026-09-20 (sandbox, 24 ordinary read calls): **154,534 chars ≈ 43k tokens of results** —
more than half a full `tools/list`. Two calls hit the 20k-char cap (`search-compendium-creatures
goblin`, `list-actor-ownership`); `list-items` 16k, `search-compendium-spells fire` 15k,
`list-actors` 13k, `list-scenes` 9.7k, `list-journals` 9.7k, **`list-macros` 8.6k** (why?),
`list-folders` 5.8k. Latency: `search-compendium sword` **13.2 s**; the first call carries the
bridge connect (~12.6 s warm sandbox). The placeable `list-*` tools error on a bare call (they
want a scene) — note what a skill has to pass. Also in every prompt: 302 tool names (two
registrations) and **15,767 chars ≈ 4.4k tokens of skill descriptions** (17 skills; `pc-builder`
1,350 chars, `session-audit` 1,182, `tom-cartos-import` 1,082 …). Full `tools/list` = 283,948
chars ≈ 79k tokens; input schemas are 73% of it; `manage-activity` 16k, `update-actor` 15k,
`add-feature` 13k, `add-item` 9k, `create-scene` 9k chars.

Questions the review must answer with numbers: which list tools return whole documents when a
skill needs ids + names; what a *compact by default, `verbose` on request* projection would save;
whether `TOOL_RESPONSE_MAX_CHARS` (20,000) is the right cap and whether a truncated answer is ever
*silently* wrong (a cut JSON is worse than a short one); where the 13 s in `search-compendium`
goes (page-side full-text over every pack? — profile it in the page bundle); whether the `.describe()`
prose on leaf fields (206k chars of schema) belongs in tool descriptions or docs instead; whether
zod 4's JSON-schema emitter can factor the repeated dnd5e sub-shapes (`manage-activity` /
`add-feature` / `manage-effect` repeat activity + effect shapes — check its `reused` option before
claiming it); whether skill descriptions can be halved without losing triggering (the front-matter
`description` is what every prompt carries; the body is loaded on use).

**Arch — the seams, against design.md.** Check that nothing outside `src/hosts/**` names a host
(`git grep -n -i molten src --and --not -e hosts/` should hit only comments and the `assets` tool
descriptions' "WebDAV on Molten" example); that `foundry.ts` still imports Playwright alone; that
the registry derives, never duplicates; that every tool sits in one toolset. Then the question 3.0
turns on: **does consolidating tool *count* reduce tool *bytes*?** A `kind + op` tool whose schema
is a discriminated union of every kind's shape carries the same bytes as the tools it replaces —
fewer names (the Claude Code cost) but no smaller schema (the eager-client cost). Lay out the
options with measured byte counts, not opinions (see D).

### B. The 6.0.3 pin (the CLAUDE.md compatibility procedure, to the letter)

1. Release notes for dnd5e 6.0.2 and 6.0.3 (Foundry stays 14.368 — confirm on the sandbox). List
   every item touching document schemas (ActiveEffect, Region, placeables, Combat, Calendar,
   ChatMessage), uuid handling, advancement, the compendium readers.
2. `node scripts/local-foundry.mjs start` · `scripts/verify-wake.mjs` semantics on local (no wake,
   straight to /join) · a real MCP `get-world-info` on `foundry-local5e` (done today: 14.368 / 6.0.3,
   `host.kind: local`).
3. Targeted verifies for every noted item, then the release set
   (`verify-{effects-6,region-effects,activities-6,settings-calendar,item-tooling,actor-tooling,pc-build,teleporter-scene-fields,placeables-tooling,scene-tools,cast-activity,region-tooling}`)
   and `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`. ONE driver at a time.
4. Pins: README (the "developed and verified against" sentence), `LOCAL.md`, the 2.1 plan's
   Progress list; what 6.0.2/6.0.3 changed for us goes in the commit message. One commit.

### C. README revision (one commit; no tool changes)

It is 449 lines of accretion: the 2.0 / 2.1 / 2.2 release narratives sit at the top, the tool count
is a hand-typed literal, and the Tools section is a prose wall. Target shape, in this order: what
it is (the 2.2 opening paragraph is right) → 60-second start (build · `.env` · one registration
per host · toolsets) → what it can do (the skills, one line each — this is the sell) → the tool
surface **by toolset** (generate the table from `src/toolsets.ts` with a small
`scripts/gen-tools-table.mjs` so the count can't drift; keep the registry test's 151 as the
guard) → architecture (why this shape; the two planes; hosts) → configuration by host → live proof
& sandbox → security → contributing/release. Move the version narratives to `CHANGELOG.md`
(default; see decisions). Keep every claim measurable or drop it.

### D. The 3.0 plan — `docs/plan-3.0-consolidation.md` in the tracker style, then the work

Parked by the owner on 2026-09-20 with numbers: **70 of 151 tools are `list/create/update/delete-X`
across 17 families** (placeables: tiles lights sounds drawings walls tokens notes regions — 36
tools with teleporter/behavior/remap; documents: items 6, tables 6, journals 5, actors 4, folders 4,
scenes 4, playlists 4, cards 4, macros 3). It is a 3.0 because it changes every skill that names a
tool (**121 distinct tool names** appear across the 17 `SKILL.md`s) and the verify scripts.

The plan must decide, with the review's byte counts in hand:

1. **Shape.** (a) `placeables` / `documents` tools with `kind` + `op` and a **loose `data` object**
   validated inside the tool (tiny schema; the tool still owns correctness and answers a bad call
   with the zod issues) + a **`describe` op that returns the full JSON schema for one kind on
   demand** — progressive disclosure, the same idea Claude Code's deferred schemas use; or (b) a
   discriminated union (same bytes as today, fewer names); or (c) a `$ref`-factored union. Measure
   all three on two or three families before choosing. The design.md test still applies: the tool
   never guesses; a skill never re-derives a field path.
2. **Scope by family.** Placeables first (the biggest, already sharing one kernel —
   `src/page/_placeables.ts`), then the document CRUD families, then `search-compendium` ×4 → one
   with `type`. `get-actor` / `get-actor-entity` / `export-actor` are three projections of one thing
   — decide whether they become one tool with a `projection`.
3. **Response diet** (can ship earlier than the consolidation, even in 2.x): compact list outputs
   by default (`id`, `name`, the two or three fields a skill filters on) with `verbose: true` for
   the old shape; `get-actor` projection levels; a cap that cuts *records*, never mid-JSON; the
   `search-compendium` latency.
4. **Schema diet** (also 2.x-safe): leaf `.describe()` prose → tool description or docs; factor
   repeated sub-shapes if the emitter allows; measure `tools/list` before/after.
5. **Skills.** Every `SKILL.md` re-pointed in the same line, one family at a time, with the
   verify scripts; `grep -rn "<old-tool-name>" .claude/skills scripts tests ../fvtt-mod-*/tools` is
   the checklist. The house modules' `tools/lib/foundry.mjs` may call tools by name — check.
6. **Definition of done, measured:** tool count, `tools/list` bytes, the 24-call result baseline,
   all skills updated, the release verify set + integration green on the sandbox, and a Claude Code
   smoke after restart (new tool schemas need a restart).

Sequence inside 3.0: response diet + schema diet first (2.x-safe, measurable wins, no skill
churn) → placeables consolidation → document families → compendium search → the actor
projections. One family = one commit, with before/after numbers in the message.

## Open decisions — ask the owner FIRST; defaults if you must proceed

| # | Decision | Default until answered |
|---|---|---|
| 1 | Run the review as a multi-agent workflow (the 2026-06 shape) or a single-agent pass | Single-agent, seeded with the measurement scripts; offer the workflow in one line |
| 2 | README: move 2.0 / 2.1 / 2.2 narratives to `CHANGELOG.md` | Move them; README links the changelog |
| 3 | Prod's pinned version — is it still dnd5e 5.3.3 / Foundry 14.364? | Leave the README sentence as is; pin only the sandbox (6.0.3) |
| 4 | 3.0 consolidation shape (loose `data` + `describe` op vs union) | Decide **after** measuring; the plan doc records the numbers |
| 5 | Response/schema diet in a 2.3 before 3.0, or only inside 3.0 | 2.3 — it is skill-safe and the biggest Claude Code win |
| 6 | Rename the registrations to `foundry-prod` / `foundry-sandbox` | No — fxstudio + start-session reference them; do it only with those in the same move |
| 7 | Drop the global `foundry-local5e` in favour of a per-project `.mcp.json` (halves the names in every other project) | Not without the owner: `fvtt-mod-fxstudio` uses it from its own directory |

## First session — exact steps

1. Cold start: `design.md`, this file, `docs/plan-2.2-hosts.md`, `docs/architecture-review.md`
   (for its shape and its still-open items).
2. Gate: `npm run check && npm run typecheck && npm test && npm run build && npm run knip` — expect
   1730 tests. Scripts import from `dist/`, so `npm run build` before any verify.
3. Sandbox: `node scripts/local-foundry.mjs status`; if a Claude Code MCP session is connected
   (users ≥ 1 named "DM Assistant"), call `disconnect-bridge` on that registration first.
4. Re-take the baseline and keep the JSON: `FOUNDRY_HOST=local node scripts/measure-tool-results.mjs
   --json scratch/measure-<date>.json` (`scratch/` is gitignored) and `node scripts/verify-toolsets.mjs`.
5. Write the review. Then B, C, D in that order, one commit each.

## Gotchas that cost time (all from today)

- **Backticks in a double-quoted Bash string run as commands.** A `node -e "…\`…\`…"` tracker edit
  executed `FOUNDRY_HOST=local node scripts/verify-asset-plane.mjs` against the live sandbox and
  silently skipped the edit; a `cat > file <<'EOF'` truncated a TypeScript file at a `??` line. For
  any patch containing backticks, `$` or `??`: write a `.mjs` patch to the scratchpad and run it,
  or use the Edit tool.
- **The central error mapper rewrites plain errors by tool-name heuristics** (a refused
  `create-scene` became "Failed to read or modify the scene"). A message that must reach the model
  verbatim is a `FormattedToolError` (`src/utils/error-handler.ts`); the toolset refusal is one.
- `exactOptionalPropertyTypes` is on: optional config fields are `?: string | undefined`.
- The global `foundry-local5e` registration still carries `FOUNDRY_PROFILE=local` — it works (alias);
  `FOUNDRY_HOST=local` is the 2.2 spelling. `.mcp.json` (gitignored) in this repo registers prod
  at project scope with the same name as the global — harmless duplicate.
- `Host.worldId` is the configured world id, used for default paths (`worlds/<id>/assets/chat`);
  the bridge's `/setup` launch is Foundry's own flow and stays in `foundry.ts` on every host.
- The `send-chat-message` `embed` enum gained `upload` (default) with `webdav` kept as an alias —
  the only contract that changed wording in 2.2.
- Old project entries keyed by the `molten5e` path (and six `.claude/worktrees/*`) remain in
  `~/.claude.json` — harmless; a stray `__pycache__/*.pyc` was untracked and gitignored.
- Two registrations = every tool schema twice for an eager client; in Claude Code it is 302 names.
  `FOUNDRY_TOOLSETS` is per registration; skills need the whole surface, so leave it unset for the
  campaign registration.

## Definition of done — this handoff

- [ ] `docs/architecture-review-2026-09.md`: ranked findings with numbers (results, names, skill
      descriptions, schema bytes, latency), the arch seam checks, and the byte-measured answer to
      "does fewer tools mean fewer bytes".
- [ ] 6.0.3 pinned per the CLAUDE.md procedure, verify counts in the commit.
- [ ] README revised to the target shape; tool table generated; changelog split (if decision 2 = yes).
- [ ] `docs/plan-3.0-consolidation.md` with the shape decision recorded from measurements, the
      family order, the skills checklist, and the measured definition of done; design.md §4 row
      updated from 🧭 parked to 🔨 active when the first milestone starts.
- [ ] This file retired.
