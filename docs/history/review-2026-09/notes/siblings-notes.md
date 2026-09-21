# siblings — notes (review dimension: the fvtt-mod-* / artificer / campaign repos as CONSUMERS)

Date 2026-09-20. Read-only on the world; nothing tracked was modified. Scripts and outputs:

- `scratch/siblings-grep.sh` — tracked-file hit counts per pattern per sibling (git grep).
- `scratch/siblings-census.mjs` → `scratch/siblings-census.json` + `siblings-census-summary.txt` —
  per-file census: which files name the old repo, the absolute / relative path, import the class,
  parse `.env` by hand, which env keys, which scripts, which registration names, which `f.<member>`.
- `scratch/siblings-toolnames-in-siblings.mjs` — every one of the 151 tool names found verbatim in
  sibling files (built from `dist/registry.js` offline, fake bridge).
- `scratch/siblings-names-cost.mjs` — the character cost of the tool names under one / two registrations.
- `scratch/siblings-contract-probe.mjs` — offline probe of what `dist/foundry.js` + `dist/hosts/index.js`
  already give a sibling (no connect).

Sibling heads at review time (git ls-files counts): battleflow ca14209 (217 files), fxstudio 8628080
(162), miscpatches c49f378 (10), soundscape-sfx dd25498 (1232), artificer d4497c1 (48), campaign
3c3bd09 (528); plus autoexplore, combatplus, lootshelf, openserver, partystash, soundscape (no
consumption of this repo's code; lootshelf/soundscape name tools in docs only).

## 1. The library surface actually consumed

**Class:** `Foundry` from `dist/foundry.js` — the only export (`dist/foundry.js:31`). Members used
(census, `f.<member>` over battleflow/tools, fxstudio/tools+prototypes, miscpatches/tools):

| member | battleflow | fxstudio | miscpatches | note |
|---|---|---|---|---|
| `new Foundry({serverUrl,user,password,adminKey,worldId[,magicUrl]})` | 22 sites (17 via `foundryConfig(env)`, 3 `playerConfig`, 2 inline) | 1 (`tools/lib/foundry.mjs:29`) | 1 (`smoke-teleports.mjs:20`) | `magicUrl` (battleflow `target.mjs:28`, prod only) **no longer exists** in `FoundryConfig` — removed by `e53958e` (2.2 hosts); it is now `host?: Host` |
| `connect()` | yes | yes | yes | |
| `evaluate(fn, null)` | 106 call sites family-wide | yes | yes | the ONLY page access; `f.call()` (the page API) is never used by a sibling |
| `dispose()` | yes (raced, `harness.mjs:266`) | yes (`foundry.mjs:40`) | yes | |
| `disconnect()` | called by 16 suites | – | – | **does not exist** on `Foundry`; `harness.mjs:336` monkey-patches it on |
| `page` | – | `foundry.mjs:34` (FX_TRACE) | – | TS-`private`, reachable from JS; not on `FoundryBridge` |
| `call()`, `screenshot()`, `isReady()` | – | – | – | unused |

**Env keys read BY HAND from THIS repo's `.env`** (siblings re-implement the same 6-line regex loop;
battleflow `harness.mjs:46`, plus 17 battleflow files, fxstudio `tools/lib/foundry.mjs:12`,
miscpatches `smoke-teleports.mjs:13`):
- battleflow (14 keys): BF_SUITE_USER BF_SUITE_PASSWORD FOUNDRY_USER FOUNDRY_PASSWORD LOCAL_ADMIN_KEY
  LOCAL_SERVER_URL LOCAL_WORLD_ID LOCAL_FOUNDRY_USER(comment) MOLTEN_ADMIN_KEY MOLTEN_MAGIC_URL
  MOLTEN_SERVER_URL MOLTEN_WORLD_ID MOLTEN_TEST_USER MOLTEN_TEST_PASSWORD; `world-snapshot.mjs`
  also LOCAL_FOUNDRY_DATA.
- fxstudio (6): BF_SUITE_USER BF_SUITE_PASSWORD LOCAL_ADMIN_KEY LOCAL_SERVER_URL LOCAL_WORLD_ID
  MOLTEN_WORLD_ID (+ its own FOUNDRY_DATA / FXS_MCP_REPO / FXS_WORLD from process.env).
- miscpatches (6): same six as fxstudio.
- **Four of those keys live in this repo's real `.env` but are NOT in `.env.example` and appear
  nowhere in this repo's tracked files**: `BF_SUITE_USER`, `BF_SUITE_PASSWORD`, `MOLTEN_TEST_USER`,
  `MOLTEN_TEST_PASSWORD` (`comm` of `.env` keys vs `.env.example`; `git grep BF_SUITE_|MOLTEN_TEST_`
  → 0). The siblings deliberately keep them here to have ONE secrets file (battleflow
  `target.mjs:40-41` explains why `LOCAL_FOUNDRY_USER` is not reused). This repo's `.env` is the
  family's secrets file and does not know it.
- Same loop inside this repo: 95 of 100 tracked `scripts/*.mjs` parse `.env` by hand
  (`rg -l` on the regex); `scripts/lib/bridge-config.mjs` wraps the host selection but not the parse.

**Node modules borrowed:** fxstudio `tools/lib/env.mjs:41-48` `createRequire(MCP_REPO/package.json)`
→ `classic-level` (a TRANSITIVE dep here: not in `package.json`, comes via
`@foundryvtt/foundryvtt-cli`; `package-lock.json:689`; used by `src/tools/pack-reader.ts`). 11 of
43 fxstudio tools depend on it through `leveldb.mjs`; the 10 `prototypes/*.mjs` do the same with the
absolute path.

**Scripts shelled out to / named:**
- `scripts/local-foundry.mjs` — battleflow `world-snapshot.mjs:44` (spawns it), fxstudio
  CLAUDE.md:85 + `sandbox-module.mjs:5,7` + NEXT-SESSION.md, miscpatches CLAUDE.md:18.
- `scripts/deploy-house-module.mjs --local` — fxstudio CLAUDE.md:90, tools/README.md:88,
  DESIGN.md, NEXT-SESSION.md; miscpatches CLAUDE.md:20; battleflow PLAN.md:1715, NOTES.md:1416.
- `scripts/pull-prod-to-local.mjs` — battleflow target.mjs:5, fixture-suite.mjs:5, NOTES, PLAN;
  fxstudio CLAUDE.md:94.
- `scripts/configure-modules.mjs` — fxstudio NEXT-SESSION.md:277; campaign
  notes/greenrest-lootshelf-migration.md.
- `scripts/register-module.mjs`, `scripts/uninstall-modules.mjs` — campaign notes only.
- `scripts/upload-soundscape-library.mjs`, `scripts/remap-soundscape-scene-paths.mjs` —
  soundscape-sfx README.md:5,55-56 ("from fvtt-mcp-molten5e"); the upload script hard-codes the
  sibling's location `join(__dirname,'..','..','fvtt-mod-soundscape-sfx')` (`:31`).
- `scripts/reload-clients.mjs` — battleflow has its OWN `tools/reload-clients.mjs` (2026-08-15)
  doing the same socket emit; this repo's copy was created 2026-08-12. Two copies of one op.

**Registration names in instructions:** `foundry-local5e` — fxstudio CLAUDE.md:98,
`tools/lib/foundry.mjs:7`; `foundry-molten5e` — fxstudio CLAUDE.md:99. In this repo:
`.claude/skills/start-session/SKILL.md:40,58` (`mcp__foundry-molten5e__get-world-info` /
`get-current-scene` — a tracked, user-facing skill hard-wiring the owner's registration name),
`.mcp.json.example:4`, docs/local-sandbox.md:139-140,184, docs/plan-2.2-hosts.md:27,44,
scripts/deploy-house-module.mjs:12, HANDOFF.md ×4, docs/dnd5e-6.0-compat-review.md:252.

**Files per sibling that touch this repo at all** (census, tracked): battleflow 26 (+30 more via
`harness.mjs` = 56 importers of harness; 83 `.mjs` in tools/), fxstudio 24 (15 name the repo; 11
tools depend through env.mjs/foundry.mjs), miscpatches 2, soundscape-sfx 1, artificer 12 (6 name
the old repo; 8 name tools), campaign 22 (7 name the old repo; 15 name tools).

## 2. What today's rename broke (2026-09-20, `e06aba2`) — and what `e53958e` broke silently

`ls ../fvtt-mcp-molten5e` → No such file. Verified offline:
- `cd fvtt-mod-battleflow && node tools/smoke-saves.mjs --list` (the offline path — exits before any
  connect) → `ERR_MODULE_NOT_FOUND` at `harness.mjs:36`. Every one of the 56 harness importers and
  the 20 direct importers is dead; 21 battleflow files carry the absolute path
  (`file:///D:/Workbench/FVTT/Repos/fvtt-mcp-molten5e/dist/foundry.js` and `const MCP = ...`).
- fxstudio `tools/lib/env.mjs:15` default `join(REPO,'..','fvtt-mcp-molten5e')` → `MCP_REPO` resolves
  to a non-existent dir; `classicLevel()` throws "classic-level is not installed under …molten5e";
  `connectSandbox()` would fail at the dynamic import. Override exists (`FXS_MCP_REPO`) but nothing
  sets it. 10 `prototypes/*.mjs` hard-code the absolute path too (historical, not gated).
- miscpatches `tools/smoke-teleports.mjs:10,12` absolute path.
- Docs with the old relative path (`../fvtt-mcp-molten5e/...`): fxstudio CLAUDE.md, NEXT-SESSION.md,
  tools/README.md, tools/sandbox-module.mjs; miscpatches CLAUDE.md; battleflow tools/README.md,
  ARCHITECTURE.md; soundscape-sfx README.md; artificer CLAUDE.md/README.md/ROADMAP.md (+ the
  README's public link `github.com/Txpple/fvtt-mcp-molten5e` — redirects today); campaign
  README/BOOTSTRAP/notes.
- Totals: **40 code files + 17 docs** across 6 siblings name `fvtt-mcp-molten5e`; 32 code files carry
  an absolute path; 0 files anywhere name `fvtt-mcp-dnd5e`.

Silent break from the hosts seam (same day, `e53958e`, before the rename): `FoundryConfig.magicUrl`
was replaced by `host?: Host`. battleflow `target.mjs:28` still passes `magicUrl` for
`BF_TARGET=prod` → ignored → a sleeping Molten box is never woken → "never became joinable" after
the wake budget. Not exercised since (prod runs are deliberate and rare) but it is the kind of
undeclared-contract drift the rename makes visible.

Severity framing: owner's repos, one afternoon of `sed`; but the CONTRACT is undeclared — no
`exports`, no `.d.ts` entry named as public, `dist/` gitignored (consumers need a local
`npm run build`), `playwright` is a devDependency although `dist/foundry.js:17` imports it at runtime
(works only because Node resolves it through THIS repo's `node_modules` via the real path).

## 3. The 3.0 consumer contract — proposal

### package.json
```json
"exports": {
  ".":          { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
  "./client":   { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
  "./hosts":    { "types": "./dist/hosts/index.d.ts", "default": "./dist/hosts/index.js" },
  "./env":      { "types": "./dist/env.d.ts", "default": "./dist/env.js" },
  "./package.json": "./package.json"
},
"bin": { "fvtt-mcp-dnd5e": "dist/index.js" }
```
- `.` must NOT be `dist/index.js`: `src/index.ts` calls `main()` at module top level, so a bare
  `import 'fvtt-mcp-dnd5e'` would start a stdio server. The server is a `bin`, the library is `.`.
- Move `playwright` (and keep `dotenv`) to `dependencies`; it is a runtime import of the exported
  module. (`@foundryvtt/foundryvtt-cli` stays only if `pack-reader` stays; fxstudio wants
  `classic-level` directly — declare it, or export a `readPack` from `./client` so fxstudio stops
  reaching into `node_modules`.)
- `files`: `dist/**`, `.env.example`, `README.md` — and keep `private: true` (blocks publish, not
  `file:` installs).

### `dist/client.js` (new `src/client.ts`, ~60 lines, no `config.ts` import — that module runs
dotenv on the process at import)
```ts
export { Foundry, type FoundryConfig, type FoundryBridge, type FoundryLogger } from './foundry.js';
export { resolveHostConfig, hostKindFromEnv, createHost, bridgeConfigOf, type HostConfig, type Host, type HostKind, type FilePlane } from './hosts/index.js';
export { loadEnv } from './env.js';
/** What fxstudio's connectSandbox / battleflow's connectSuite / miscpatches' prologue all wrote. */
export async function connectFoundry(opts: {
  host?: HostKind;                 // default: FOUNDRY_HOST from process.env, else 'molten'
  env?: Env;                       // default: loadEnv() — THIS package's .env
  identity?: 'bridge' | 'suite' | 'player' | { user: string; password?: string };
  logger?: FoundryLogger; tag?: string; watchdogMs?: number;
}): Promise<{ f: Foundry; env: Env; host: Host; dispose(): Promise<void> }>;
```
- `identity: 'suite'` reads `FOUNDRY_SUITE_USER` / `FOUNDRY_SUITE_PASSWORD` (the neutral names for
  today's `BF_SUITE_*`); `'player'` reads `FOUNDRY_PLAYER_USER` / `_PASSWORD` (today's
  `MOLTEN_TEST_*`). Both documented in `.env.example` as "a second identity for sibling test suites,
  never the bridge's". The owner's one-secrets-file preference (target.mjs:40) is kept but declared.
- `dispose()` races the real `Foundry#dispose` against a ceiling (battleflow `harness.mjs:266`,
  fxstudio `foundry.mjs:40` both do this by hand). Add `disconnect()` as a documented alias of
  `dispose()` on `Foundry` so the 16 battleflow suites that call it stop needing the monkey-patch.
- `FoundryConfig` gains nothing; `page` stays private — expose `onPageEvent(kind, cb)` or accept
  `trace: boolean` if fxstudio's FX_TRACE hook is wanted (it uses `page.on('crash'|'close'|'pageerror'|'console')`).

### `dist/env.js`
```ts
export function loadEnv(path = join(pkgRoot, '.env')): Env   // dotenv.parse, no process.env side effect
```
This also retires the 95 hand-rolled loops inside `scripts/` (one import instead), which is the
same fix on both sides of the seam.

### How siblings reference the package
| option | pro | con |
|---|---|---|
| `"fvtt-mcp-dnd5e": "file:../fvtt-mcp-dnd5e"` in each sibling's `package.json` | npm symlinks the dir (npm ≥ 7 default; no copy), `import from 'fvtt-mcp-dnd5e/client'` resolves through `exports`, node resolves `playwright` via the real path; the relative path IS the family's stated layout (campaign BOOTSTRAP.md: "Repo root — UNIVERSAL: D:\Workbench\FVTT\Repos") | siblings that have no `package.json` today (miscpatches: 10 files, plain ESM, no build) gain one + a `node_modules` symlink; a sibling checked out elsewhere needs the same parent |
| absolute path (today) | zero setup | broke today; per-machine; 32 files |
| env var (`FXS_MCP_REPO` pattern) | one knob | nothing sets it; every tool prologue re-resolves it |

Recommend **`file:` dependency**, with the env var kept only as fxstudio's existing override. battleflow
already has `package.json` (npm run verify); fxstudio too; miscpatches gets a 3-line one.

### The ops scripts — do they belong in a user-facing dnd5e MCP?
Nine scripts, 2,007 lines (`wc -l`), none mentioned in README.md, only `docs/local-sandbox.md`
knows them; knip ignores `scripts/`:

| script | lines | consumers | verdict |
|---|---|---|---|
| `local-foundry.mjs` | 328 | 3 module repos + this repo's CLAUDE.md procedure + verify discipline | **stays** — it is the `local` host's launcher; the compat procedure (CLAUDE.md step 2) needs it |
| `pull-prod-to-local.mjs` | 516 | battleflow/fxstudio docs | **stays** as a host-pair op (`molten` → `local` mirror); rename `scripts/hosts/molten-to-local.mjs`; owner-shaped but any Molten user with a sandbox wants it |
| `deploy-house-module.mjs` | 178 | 3 module repos | **move** to a sibling tooling repo; rewrite against `Host.files` (`FilePlane`) — today it uses `WebDavClient` directly (`:34`) AND a raw `fs` copy for `--local` (`:91`), i.e. two code paths that `createHost(cfg).files` already unifies |
| `register-module.mjs` / `uninstall-modules.mjs` | 208 / 214 | campaign notes only | **move** (pure Playwright `/setup` drivers — a Foundry admin op, not dnd5e) |
| `configure-modules.mjs` | 140 | fxstudio notes, campaign notes | **move** (writes `core.moduleConfiguration` via `f.evaluate`; imports only `client`) |
| `reload-clients.mjs` | 57 | none (battleflow has its own) | **delete here**; battleflow's copy is the one that is used |
| `upload-soundscape-library.mjs` / `remap-soundscape-scene-paths.mjs` | 288 / 78 | soundscape-sfx README | **move into `fvtt-mod-soundscape-sfx`** (the script already hard-codes that repo's path); import `FilePlane` + `Foundry` from `fvtt-mcp-dnd5e/hosts|client` |

Where "move" = a new `fvtt-tools` (or `fvtt-mod-tools`) sibling holding house-module ops, importing
`fvtt-mcp-dnd5e/client` + `/hosts`. That repo also becomes the natural home for battleflow's
`harness.mjs` generics (`connectSuite` minus the battleflow ledger), so fxstudio and miscpatches stop
copying it. What each sibling then imports:
- battleflow: `connectFoundry({host:'local', identity:'suite'})` in `harness.mjs`; `target.mjs`
  becomes `{ host: BF_TARGET==='prod' ? 'molten' : 'local' }` (which also fixes the dead `magicUrl`).
- fxstudio: `connectFoundry` replaces `tools/lib/foundry.mjs` (42 → ~10 lines); `env.mjs` drops
  `MCP_REPO`/`classicLevel()` for `import { readPack } from 'fvtt-mcp-dnd5e/client'` (or a declared
  `classic-level` dep of its own).
- miscpatches: the 15-line prologue of `smoke-teleports.mjs` → 2 lines.
- soundscape-sfx: `npm run publish` in its own repo.
- artificer / campaign: nothing to import — docs only (see §4, §6).

## 4. The artificer

Inherited: `src/utils/schema.ts` is byte-identical modulo comments (`diff` → only the doc block
differs; 43 lines); `src/registry.ts` is the same handlers-map → derived-list pattern in 56 lines
(this repo's is 495 with the toolset filter); `src/index.ts` is the same stdio bootstrap in 68 lines
(this repo 132). ≈ 170 lines of shared shape, zero shared code. Both pin `@modelcontextprotocol/sdk
^1.29.0` and `zod ^4.4.3` (the `z.toJSONSchema` draft-2020-12 path is the only real invariant).

Verdict: **copy is right.** A `@txpple/mcp-core` would add a third repo/publish step for 170 lines,
couple two independently-versioned servers, and contradict artificer CLAUDE.md ("Separate from
molten5e … never talks to the Foundry bridge"). What IS worth doing: a 10-line `registry.test.ts`
invariant in each ("every advertised schema is 2020-12-valid") — artificer already has it
(`registry.test.ts:24`). Keep.

Couplings that matter for 3.0:
- `illustration-builder/SKILL.md` (artificer, tracked, 246 lines) names 11 dnd5e tools:
  `get-actor export-actor list-journals search-journals list-scenes list-assets download-asset
  upload-asset set-actor-art add-journal-image screenshot-scene`; CLAUDE.md/README/ROADMAP name
  `upload-asset set-actor-art add-journal-image`. The hand-off is "files on disk + Data-relative
  paths" (`upload-asset {localPath, remotePath}` → `set-actor-art {actorIdentifier, imagePath}` /
  `add-journal-image`, `src/tools/asset-bridge.ts:13-15`). That vocabulary (Data-relative) is the
  real contract; the tool NAMES are what the CRUD consolidation would rename (list-journals,
  list-scenes, list-assets, download-asset, upload-asset are all in the `list/…-X` families).
- `token-cutout` (this repo) ↔ `cutout-image` (artificer): a two-way skill hand-off by name.
  `token-cutout/SKILL.md:6-19` points at the artificer; `illustration-builder/SKILL.md:243-244`
  points back at "the molten5e `token-cutout` skill". Both sides say "molten5e". Fine as a design
  (pixels there, Foundry install here — §2.1 clean), but the artificer's README `## With a Foundry
  MCP server` and its skill treat this repo's tool names as an API.

## 5. Registration names

Who depends on `foundry-molten5e` / `foundry-local5e` (files): this repo —
`.claude/skills/start-session/SKILL.md:40,58` (user-facing, tracked: `mcp__foundry-molten5e__…`),
`.mcp.json.example:4`, `docs/local-sandbox.md:139-140,184`, `docs/plan-2.2-hosts.md:27,44`,
`scripts/deploy-house-module.mjs:12`, `HANDOFF.md`, `docs/dnd5e-6.0-compat-review.md:252`; siblings —
fxstudio `CLAUDE.md:98-99` and `tools/lib/foundry.mjs:7` (instructions to call `disconnect-bridge`
on `foundry-local5e`). Nothing else: no sibling `.mcp.json`, no `.claude/settings*.json` allowlist
names `mcp__foundry-*` (checked incl. untracked), no `.md` in battleflow/miscpatches names either.

Cost, measured (`siblings-names-cost.mjs`): 151 bare names = 2,176 chars; one registration
(`mcp__foundry-molten5e__` prefix, 23 chars/name) = **5,649 chars ≈ 1.6k tokens**; two =
**11,147 chars ≈ 3.1k tokens** per prompt. `~/.claude.json` lists 31 projects (16 existing dirs, 9
FVTT repo roots), 0 with project-level mcpServers — so every project pays the 3.1k. Of the 9 FVTT
siblings only fxstudio/battleflow/miscpatches (and this repo) need the sandbox, and they use TWO tools
from it (`get-world-info`, `disconnect-bridge`); the campaign repo needs prod.

Per-project option: `foundry-local5e` as a `.mcp.json` in this repo + the three module repos, with
`"env": {"FOUNDRY_HOST":"local","FOUNDRY_TOOLSETS":"world"}` → 8 names, **299 chars ≈ 83 tokens**
(`world` = get-world-info get-current-scene disconnect-bridge list-users update-user set-user-avatar
configure-dnd5e-settings manage-calendar). Every other project drops from 302 → 151 names (−1.5k
tokens/prompt); the module repos drop from 302 → 159. The `.mcp.json` carries an absolute path, so
it is gitignored (as here) or uses Claude Code `${VAR}` expansion (not verified offline).

Recommendation for 3.0: **keep the names** (owner's default, and they are the operator's per
plan-2.2 §"Registration names are the operator's") — but (a) scrub them from the TRACKED user-facing
surface: `start-session/SKILL.md` must say "the Foundry registration" not `mcp__foundry-molten5e__`,
`.mcp.json.example` should show a neutral `foundry` name; (b) demote `foundry-local5e` to
project scope in the four sandbox repos with `FOUNDRY_TOOLSETS=world`. If the names ever change,
the checklist is exactly: fxstudio CLAUDE.md:98-99, fxstudio tools/lib/foundry.mjs:7, and the seven
files in this repo listed above — one commit here, one in fxstudio.

## 6. Tool names used by siblings by name — the 3.0 rename checklist beyond this repo

From `siblings-toolnames-in-siblings.mjs` (verbatim, word-bounded, tracked files):

| repo | files | names |
|---|---|---|
| fvtt-mcp-artificer | 8 | add-journal-image create-journal download-asset export-actor get-actor list-assets list-journals list-scenes screenshot-scene search-journals set-actor-art upload-asset upload-asset-tree — load-bearing: `.claude/skills/illustration-builder/SKILL.md` (11 names), CLAUDE.md, README.md, ROADMAP.md |
| fvtt-mod-fxstudio | 2 | disconnect-bridge get-world-info (CLAUDE.md:98-99, tools/lib/foundry.mjs:7) |
| fvtt-mod-battleflow | 6 | disconnect-bridge (target.mjs:92 error text), get-world-info (NOTES), get-combat-stats (ARCHITECTURE §4, DESIGN — the wire-format contract THIS repo reads), level-up-pc, manage-effect (fixture comments recording that `level-up-pc` did not persist advancement, 2026-08-24) |
| fvtt-mod-miscpatches | 1 | disconnect-bridge (CLAUDE.md:29) |
| fvtt-mod-soundscape | 1 | configure-soundscape (design.md — the flag contract this repo writes) |
| fvtt-mod-lootshelf | 1 | list-actors create-item update-actor list-users (HANDOFF.md, prose) |
| fvtt-campaign-greenrest | 15 | add-feature add-free-cast configure-soundscape content-audit create-scene export-actor export-chat-log get-actor get-actor-entity get-combat-stats get-world-info import-item inspect-pc-advancement level-up-pc list-lights list-regions list-scenes search-actor-contents search-journals update-actor update-journal (notes/, sessions/, world-state.md — the owner's notes; historical, not load-bearing) |

Of the 121 names the 17 in-repo skills use, the CRUD consolidation would rename the
`list/create/update/delete-X` families (70 tools). Names in that set that a SIBLING relies on
operationally: `list-journals`, `list-scenes`, `list-assets`, `create-journal` (artificer skill),
`list-lights`, `list-regions`, `update-journal`, `update-actor`, `create-scene` (campaign notes).
Not in the set but named: `get-world-info`, `disconnect-bridge`, `get-combat-stats`,
`configure-soundscape`, `get-actor`, `export-actor`, `set-actor-art`, `add-journal-image`,
`upload-asset`, `download-asset`, `screenshot-scene`, `search-journals`.

Reverse contracts (this repo reads/writes a sibling's flags — documented on the sibling side, which
is the asymmetry): `fvtt-mod-battleflow` stat stamps (`src/page/combat-stats.ts:4-17` ↔ battleflow
ARCHITECTURE.md §4 "this table is the MCP's read contract"), `fvtt-mod-soundscape`
`flags.sets` (`src/page/soundscape.ts:3-27` ↔ soundscape design.md "MCP-authorable by
construction"), `fvtt-mod-openserver` `landingScene` (`src/page/users.ts:41`, `src/page/scenes.ts:924`).

## Could not verify
- Claude Code `${VAR}` expansion in `.mcp.json` (would let a per-project sandbox registration be
  tracked instead of gitignored) — not testable offline.
- npm `file:` install behaviour on this machine's npm (symlink vs copy) — not run (would write
  `node_modules` in a sibling).
- Whether any prod (`BF_TARGET=prod`) battleflow run has happened since `e53958e`; the `magicUrl`
  drop is inferred from the diff, not observed live.
- The fxstudio `prototypes/*.mjs` are described as "the ruled prototype"; whether any is still run.
