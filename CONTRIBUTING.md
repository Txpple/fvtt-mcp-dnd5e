# Contributing — the house rules

Read [`design.md`](design.md) (binding) before changing tool behaviour. A change is a
compatibility event, a bug fix, a premium book brought into scope, or a feature that passes
design.md's gate (§1, §9): it serves onboarding or the table, it keeps no assistant resident in
the session, and it is written into design.md before it is built. Open work is the repo's GitHub
issues. The closed trackers, with the numbers every gate below still ratchets against, are under
[`docs/history/`](docs/history/README.md)
([`plan-3.0-consolidation.md`](docs/history/plan-3.0-consolidation.md) and its measured basis,
[`architecture-review-2026-09.md`](docs/history/architecture-review-2026-09.md)).
[`docs/RELEASE.md`](docs/RELEASE.md) is the release gate. A gitignored `LOCAL.md` holds the real
per-instance values (hosts, worlds, registration names) — nothing in a tracked file names them.

## The shape of the code

One package: a Node-side MCP server (`src/`) that drives a headless Foundry page through the
`foundry.call(name, args)` seam, plus a page-side library (`src/page/**`, bundled into
`dist/page.bundle.js` and injected as `window.__fvtt`). Adding or changing a tool touches both
halves:

1. **The tool** (`src/tools/<family>.ts`) — declare the input contract **once** as a hoisted zod
   schema; the advertised JSON Schema is generated from it (`src/utils/schema.ts`), never
   hand-written. A CRUD family is one `manage-*` tool with an `action` discriminator
   (`src/tools/_union.ts`); shared leaves (`actorIdentifier`, `sceneIdentifier`, …) come from
   `src/tools/_targets.ts` so their prose is written once.
2. **The registry** (`src/registry.ts`) — the single source of truth for name → handler; the
   advertised list is derived from it, so a handler with no definition (or the reverse) fails at
   startup and in `src/tools/registry.test.ts`.
3. **The page op** (`src/page/<domain>.ts`) — register it in `src/page/index.ts`. It runs *inside*
   the live Foundry page (the real `Document.create` / `update` / `delete`): browser + Foundry
   globals only, never Node or Playwright. Throw a coded `PageError` (`src/page/errors.ts`) — the
   code rides to the tool as a `BridgeError` and the error mapper adds one hint per code. Every
   page op is also `fvtt.<name>` to a `run-script` program, so its public reference,
   `docs/run-script-api.md`, is regenerated in the same commit (`npm run api-doc`); `npm test`
   fails while the file is stale.
4. **The result shape** — design.md §3: a list is one line per record with a header, a `get` is
   JSON, a mutation is a one-line confirmation, a miss is `isError` (a tool's own refusal throws a
   coded `ToolError`, never a "Refused: …" string). A write that can change what no receipt holds
   (a file in `Data/`, a player's view) carries the `NO_RECEIPT` tag (`src/tool-kinds.ts`) and calls
   `noteUnrecorded()` once it did; `src/tools/registry.test.ts` lists every write tool in the tagged
   or the recorded set, so a new one is placed there by hand. A write resolves a fuzzy identifier
   with `mode: 'write'` (`resolveActorFuzzy`, `resolveActorItem`, `resolveWorldItem`,
   `resolveUser`): a tie is refused, never picked.
5. **The prose budget and the context budgets** — a leaf `.describe()` ≤ 120 chars, a description
   ≤ 400, no tours of sibling tools, no Foundry-internals asides (the skills carry those). `npm test`
   prints three context budgets, each with the client that pays it, and fails when one climbs past
   its ratchet (`src/measure.test.ts`): **per prompt** for a deferred client such as Claude Code
   (the tool names once per registration plus the skill descriptions), **per fetch** (the largest
   tool with its `anyOf` flattened the way that client shows it, and no key described in two
   shapes across a union's members — the merge shows the first member's shape only), and **the
   eager `tools/list`** with a row per toolset. A change that adds advertised chars pays in its own
   toolset's row or raises that row in the same commit, with the reason beside it; a union member
   that takes a key another member takes reuses that leaf, never re-describes it.
6. **The skills** (`.claude/skills/**`, tracked) — a skill decides, a tool does (design.md §2.1).
   A renamed or re-shaped tool is re-pointed in every skill that names it **in the same commit**;
   `node scripts/measure/skills-matrix.mjs` must report 0 unresolved names.

Where Foundry runs is a *host* (`src/hosts/**`, design.md §2.6) and nothing outside that
directory may know one from another: a tool that needs a file plane asks `filePlaneFor`, a script
that needs a connection uses `connectFoundry` / `resolveHostConfig` and reads `FOUNDRY_HOST`.
`git grep MOLTEN_ src` must keep answering `src/hosts/env.ts` (and its test) only, and
`src/hosts/env.test.ts` fails when another file names one: a legacy name is read through the
selector's tables (`namesOf`, `IDENTITY_NAMES`), and a host's label is its preset's (`hostLabel`).

## The gates

Offline, before and after every commit:

```bash
npm run check && npm run typecheck && npm test && npm run build && npm run knip
```

Live proof, for anything that touches what the page does — `npm test` **mocks `foundry.call`**,
so a green offline gate proves arg shaping and pure logic, not the write paths:

- **Sandbox only** (`FOUNDRY_HOST=local`; a Foundry install on this machine —
  [`docs/hosts.md`](docs/hosts.md), [`docs/local-sandbox.md`](docs/local-sandbox.md)). The family's
  verify script (`scripts/verify-<family>.mjs`) and, for a family change,
  `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`.
- **ONE world-driver at a time.** Verify scripts and the integration suite run sequentially,
  never in parallel — two drivers on one world race each other's writes.
- **Temp documents are tagged `ZZ-*` and deleted in `finally`.** Restore `worldTime` and any
  setting you flip. A verify script that leaves a world dirty is a bug.
- **Read a script's header before a live run.** Every script reads `FOUNDRY_HOST` (unset =
  `generic`, refused). `verify-wake.mjs` is DESTRUCTIVE (it takes the world down to prove the cold
  bring-up); `pull-prod-to-local.mjs` wakes the *source* instance as its first step by design.

One feature or fix = one commit, and the commit message carries the numbers: the verify counts,
the integration result, and — for anything that changes the advertised surface — the budgets
`npm test` printed (per prompt, per fetch, tools/list and the toolset row that moved) before and
after.

## Foundry / dnd5e upgrades are compatibility events

Point releases — even "minor" stable ones — have repeatedly broken the bridge's connect path or
the scripted launch. On record:

- **Foundry 14.365 → 14.367**: the `/join` user field changed from a `<select>` to a free-text
  input (`src/join-form.ts`) — the Playwright join broke.
- **Foundry 14.368**: every POST must look same-origin (`Sec-Fetch-Site: same-origin` or a
  matching `Origin` header) or it gets 400 "The request could not be processed." — the launcher
  broke until it sent `Origin`. The same release stores Teleport Token destinations as RELATIVE
  uuids (`…<sceneId>.Region.<regionId>`), which broke the teleporter read-back / remap, and moved
  world shutdown: `POST /join {action:"shutdown"}` now answers `{}` (a silent no-op); it is
  `POST /setup {action:"worldShutdown", adminPassword}` → 302 `/setup`.
- **Foundry 14.369**: the user field is a `<select>` again, now `name="userId"`; the bridge
  matched only `userid` and waited out its whole boot budget on a live world. Since then the
  join selectors are held against a saved page per build (`test/fixtures/join/`) in `npm test`.
- **dnd5e 6.0.2 → 6.0.3**: bug fixes only, no data-model change — but the release notes
  under-report; read the tag-to-tag diff, not the bullets.
- **dnd5e 6.0.3 → 6.0.5** (6.0.4 regressed activity check/save rolls; 6.0.5 is that one-line
  fix — never stop on 6.0.4): the derived `attributes.exhaustion` now reads the exhaustion
  effect's level even while immunity suppresses it, which left `apply-condition`'s persisted
  field stale on an immune creature until it keyed off the derived value; rests no longer delete
  every actor effect without an expiry (6.0.0–6.0.3 did — `manage-effect`'s "permanent" was not);
  an effect created without an `_id` is no longer reclassified as a condition (not in the notes).
  The same refresh also slowed the region enter/exit edges from under 400 ms to ~1 s with the
  behavior's source unchanged — verify scripts poll for a state, bounded, never sleep a beat.

So when a new Foundry or dnd5e version lands, in this order — and never call it "verified" on the
offline gate alone:

1. Read the release notes and list every item touching: HTTP routes / auth / CSRF, the `/join`
   and `/setup` pages, document schemas (ActiveEffect, Region, Scene placeables, Combat, Calendar,
   ChatMessage), uuid handling, Levels.
2. Sandbox launch: `node scripts/local-foundry.mjs start` (`FOUNDRY_HOST=local`).
   For a Foundry release, save its rendered `/join` page as `test/fixtures/join/<version>.html`
   (the DOM after the form draws, trimmed to the form and the version watermark, world title and
   user names replaced; see the 14.369 file) and run `npm test`. A red `src/join-form.test.ts`
   is the join break, found before any live world hangs on it.
3. Bridge connect: `FOUNDRY_HOST=local npm run smoke:bridge` (read-only: joins as the bridge user,
   reads the versions, leaves; its one line goes into the fvtt-mcp-dnd5e row of the suite's
   upgrade review issue), `FOUNDRY_HOST=local node scripts/verify-wake.mjs` (destructive — see
   above) and a real MCP `get-world-info` on the sandbox registration.
4. Targeted live verify scripts for every noted item, then the release set (the list is in
   [`docs/RELEASE.md`](docs/RELEASE.md)) and `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`.
5. Update the version pins (README, `LOCAL.md`, design.md §8, `CHANGELOG.md`) and record what the
   release changed for us in the commit message.

The 2.x / 3.x tools refuse a pre-6.0 dnd5e world; 1.x is the line for dnd5e 5.3.x.

## Working with Claude Code here

- `CLAUDE.md` is a three-line pointer to this file, and `AGENTS.md` the same pointer for the
  clients that read that name; keep them that way.
- Several agent sessions may work on this repo at once: `git status` / `git log` before editing,
  stop with a clean tree at a milestone breakpoint.
- The Bash tool runs commands inside backticks in a double-quoted string — write patch scripts
  to a scratch file and run them, rather than `node -e "…\`…\`"` or `sed -i` with escapes.
