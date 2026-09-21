# arch-seams — notes (2026-09-20, read-only review; no world contact)

Scratch scripts (all offline, against `dist/`):
- `scratch/arch-seams-error-mangle.mjs` — what `ErrorHandler.toUserMessage` does to 12 realistic page/tool errors
- `scratch/arch-seams-throw-census.mjs` — throw sites in src/page vs src/tools and which literals trip the classifier
- `scratch/arch-seams-pageapi-typing.mjs` — how typed the 150 page handlers are (args / return)
- `scratch/arch-seams-test-shape.mjs` — where the 1,687 `it()` sites live; untested page modules
- `scratch/arch-seams-scripts-census.mjs` — scripts/ vs dist/ imports, env-selector bypass, verify vs integration size
- `scratch/arch-seams-registry-timing.mjs` — registry build time, dispatch cost, generic-host plane answers
- `scratch/arch-seams-registry-triplication.mjs` — orphan definitions, name spelled 3× per tool

## 1. design.md §2.6 seam checks

### `git grep -n -i molten src` outside `src/hosts/` — 19 hits, classified
| class | hits | where |
|---|---|---|
| comment / example | 3 | `src/foundry.ts:63` (example URL), `src/tools/asset-bridge.ts:8` (STALE path `tools/molten` — no such dir), `src/tools/assets/index.ts:20` |
| test fixture (hand-built molten-shaped `Host` stub) | 15 | `src/tools/assets/index.test.ts:59-72,143,147,261,470`; `src/tools/chat.test.ts:24-35` |
| real runtime coupling by the word "molten" | 0 | — |

The runtime coupling is by the **plane's** name instead: `src/tools/chat.ts:40` advertises
`embed: z.enum(['upload','webdav','dataUri'])` and its descriptions (`chat.ts:43,91,276`) say
"uploaded over WebDAV" — on the `local` host it is `node:fs`, on `generic` nothing. The
`chat-and-narration` skill copies it (`SKILL.md:53,58,83-84`: `embed: "webdav"`, "If
`MOLTEN_WEBDAV_PASSWORD` isn't set…"). No `host.kind ===` branching exists outside hosts/
(`host.kind` is read only for a log line `index.ts:51` and the `get-world-info` report `scene.ts:939`).

### Playwright isolation — PASS
`git grep -E "from 'playwright'" src` → exactly one: `src/foundry.ts:18`. Every other mention is a comment.

### Registry derives — one-directional
`src/registry.ts:159-201` pulls definitions per class into `defByName`, then `tools` = `Object.keys(handlers).filter(isEnabled).map(defByName.get)` (`registry.ts:449-457`). A handler without a definition throws; a **definition without a handler is silently dropped**. Measured: 152 definitions collected vs 151 handlers → orphan `add-features-from-compendium` (`src/tools/dnd5e/features.ts:62-70`), a stale definition kept after the add-feature fold (`registry.ts:108-112,157`). Each tool name is spelled 3× (class definition, `registry.ts` handlers map, `toolsets.ts`) — sampled 5 tools, 3 files each. `registry.test.ts:320-329` ("every advertised tool has a handler") is tautological because `tools` is derived from `handlers`.

### Toolsets — PASS with one soft spot
Startup check `registry.ts:428-441` + test `registry.test.ts:450-465`: every handler in exactly one toolset. `toolsetOf()` (`toolsets.ts:204-210`) overwrites on duplicate, so a double-listing is caught only by the test, not at startup. The always-on `world` set (10,636 chars) is 82% non-lifeline: `configure-dnd5e-settings` 4,570 + `manage-calendar` 1,971 + `update-user` 1,340 + `set-user-avatar` 816 = 8,697 chars ride on every narrow registration; the real lifeline (`get-world-info`, `disconnect-bridge`, `get-current-scene`, `list-users`) is 1,939 chars.

### Central error mapper — the heuristics, and what they mangle
`src/utils/error-handler.ts:53-188` `mapFoundryError` classifies by **substring of the message** (not tool name), in order:
1. `access denied` | `permission` → "Permission denied for this operation"
2. `connection` | `websocket` | `timeout` | `navigation` | `net::` | `target closed` | `target page` | `browser` | `game.ready` → "Connection to the Foundry world failed"
3. `not found` | `invalid` | `missing` → "Invalid request or missing data" — or, if the TOOL NAME contains `compendium`/`creature` (`:105`), "Creature not found in compendiums"
4. `actor creation` | `create actor` → "Failed to create actor"
5. `scene` → "Failed to read or modify the scene"
6. `rollback` | `transaction` → "Operation was rolled back"
7. else → raw message (`toUserMessage:258-260` special-cases the catch-all)

`formatErrorMessage` (`:195-207`) emits `mcpError.message + " Try: " + suggestions` and **never appends `details`** (the raw text). So any classified error loses its original message. Verified offline (`arch-seams-error-mangle.mjs`): 11 of 12 realistic errors mangled, e.g.
- `foundry.call('getActor') failed: Actor "Gren" not found (did you mean "Grendel"?)` → `Invalid request or missing data Try: Check that all required parameters are provided; …`
- `…updateScene… background.src must be a Data-relative path` → `Failed to read or modify the scene Try: …`
- `…setActorOwnership… unknown permission level "OBSERVR" — use OWNER/OBSERVER/…` → `Permission denied for this operation Try: Ensure the MCP user has GM rights…`
- `…searchCompendiumSpells… pack dnd-players-handbook.spells not found — is the PHB installed?` → `Creature not found in compendiums Try: Try searching with a different creature name…`
- `WebDAV PUT timeout after 30000ms` → `Connection to the Foundry world failed Try: Ensure the world is launched…`

Census: `src/page/**` has **395 `throw new Error(`** and **0 `FormattedToolError`** (page code cannot import it — browser-only, and `foundry.ts:465` re-wraps every page throw as a plain `Error` anyway). 112 of those 395 literals contain a trigger word in their first 3 lines (28%); at runtime more do, because interpolated names (`Scene "X"`) add `scene`. `src/tools/**`: 43 plain vs 19 `FormattedToolError`. So the escape hatch covers the tool side only; the page side — where most domain "not found / invalid" errors originate — is un-escapable. The test file's own describe title (`error-handler.test.ts:48` "never degrades already-specific messages") is contradicted by the implementation for every classified case; the tests only cover ZodError and the catch-all.

## 2. The Molten residue in the env contract (for 3.0 "hosts are just endpoints")

- **Default host is `molten`** when `FOUNDRY_HOST` is unset (`src/hosts/env.ts:49`; locked by `env.test.ts:37`). Verified: `resolveHostConfig({FOUNDRY_URL:'https://vps.example.com'})` → `kind:'molten', serverUrl:'https://your-server.moltenhosting.com'` — a user who sets only `FOUNDRY_URL` is silently pointed at a placeholder Molten URL.
- `MOLTEN_*` is canonical; `LOCAL_*` falls back to `MOLTEN_*` (`env.ts:92-96`): `worldId: LOCAL_WORLD_ID ?? MOLTEN_WORLD_ID`. The `local` host is documented as "the sandbox mirrored from prod… a byte copy" (`env.ts:15-17`, `local.ts:6-7`, `.env.example` §Hosts). `scripts/local-foundry.mjs:169` dies with "LOCAL_WORLD_ID / MOLTEN_WORLD_ID missing".
- `tests/integration/setup.ts:46` gates the live suite on `ENV.MOLTEN_SERVER_URL` — a local-only or generic user cannot run `test:integration` even with `FOUNDRY_HOST=local`.
- 24 of 100 scripts read `env.MOLTEN_*` directly (bypassing the "ONE env selector" design.md §9 promises); 85 go through `scripts/lib/bridge-config.mjs`.
- A shipped skill script, `.claude/skills/bestiary-builder/bestiary-entry.mjs:74-81`, hand-builds `new Foundry({ serverUrl: env.MOLTEN_SERVER_URL, magicUrl: env.MOLTEN_MAGIC_URL, user: env.FOUNDRY_USER || 'DM Assistant', … })`. `FoundryConfig` has had no `magicUrl` since e53958e (`src/foundry.ts:62-95`), so the wake is silently dropped, and the script ignores `FOUNDRY_HOST` — it always targets prod. The hosts commit touched 7 scripts but not this one.
- `start-session/SKILL.md:9,16,24-29,40,58,73-75` names Molten, the Magic URL, `MOLTEN_*` vars and the `mcp__foundry-molten5e__` registration — a skill that knows its host, against §2.6's last sentence.
- Advertised surface: `src/tools/bridge.ts:39` description says "Log the DM Assistant bridge user out" (owner's user name); `registry.ts:150` comment likewise.

**What `Host.worldId` does.** Two uses: (a) `src/foundry.ts:202-217` — with `adminKey`, auto-launch the world from `/setup` when the instance is up with no world (Foundry's own admin flow, host-agnostic); (b) `src/tools/chat.ts:335` — default image folder `worlds/${host.worldId ?? 'world'}/assets/chat` (falls back to a bogus `worlds/world/` path). After join the page already knows it (`src/page/world.ts:68` `game.world.id`), so (b) needs no config. (a) is Molten-shaped: a sleeping Molten box comes back with no world active, so the owner needed unattended launch; a local/VPS user launches their own world. The id could also be discovered from the `/setup` tiles (`foundry.ts:286` already queries `li[data-package-id]`) when exactly one world exists. **A user should not need it**; keep it optional, derive it post-join, and make auto-launch pick the sole world when there is one.

**What molten's wake needs that generic cannot have.** `MoltenHost.wake` (`molten.ts:62-68`) is one `ctx.goto(magicUrl)` — a GET before probing `/join`. Nothing about that is Molten-specific; only the secret shape (`?s=<token>`, redacted `molten.ts:75-79`) and the WebDAV plane are. A generic host can have `FOUNDRY_WAKE_URL` with the same semantics; Forge/idle-VPS users benefit. After that, `molten` = generic + wake URL + WebDAV plane + Molten-derived defaults.

### Proposed 3.0 contract
Canonical, every host: `FOUNDRY_URL` (required), `FOUNDRY_USER` (default MCP-Claude), `FOUNDRY_PASSWORD`, `FOUNDRY_ADMIN_KEY`, `FOUNDRY_WORLD_ID` (optional; else sole-world discovery), `FOUNDRY_HOST` (default **generic**), `FOUNDRY_WAKE_URL` (any host; secret-redacted), `FOUNDRY_TOOLSETS`. Plane extras: `FOUNDRY_DATA_DIR` (local fs plane, any host on this machine), `FOUNDRY_WEBDAV_URL` / `FOUNDRY_WEBDAV_USER` / `FOUNDRY_WEBDAV_PASSWORD` (WebDAV plane; `molten` derives URL + user from `FOUNDRY_URL`). Aliases read ONLY in `src/hosts/env.ts`, with a one-line deprecation log: `MOLTEN_SERVER_URL→FOUNDRY_URL`, `MOLTEN_MAGIC_URL→FOUNDRY_WAKE_URL`, `MOLTEN_ADMIN_KEY/WORLD_ID→FOUNDRY_*`, `MOLTEN_WEBDAV_*→FOUNDRY_WEBDAV_*`, `MOLTEN_FILEBROWSER_URL` (drop; unused at runtime — only `.env.example`), `LOCAL_SERVER_URL→FOUNDRY_URL`, `LOCAL_FOUNDRY_DATA→FOUNDRY_DATA_DIR`, `LOCAL_ADMIN_KEY/WORLD_ID/FOUNDRY_USER/FOUNDRY_PASSWORD→FOUNDRY_*`, `FOUNDRY_PROFILE→FOUNDRY_HOST`. Precedence: registration env block > host-prefixed alias (when that host is selected) > `FOUNDRY_*` > default — this keeps the owner's one-.env-two-registrations setup working unchanged while a new user sees only `FOUNDRY_*`.

Files that change (51 tracked files name a current var; `git grep -l -E "MOLTEN_|LOCAL_(SERVER_URL|FOUNDRY_|ADMIN_KEY|WORLD_ID)|FOUNDRY_PROFILE"`): `src/hosts/{env,molten,local,generic,local-files}.ts` + `env.test.ts`; `src/config.ts` (comment); `src/foundry.ts:177-184` (already FOUNDRY_*); `src/tools/chat.ts:40-43,91,276` (drop `webdav` from the enum, say "the host's file plane"); test fixtures `src/tools/assets/index.test.ts`, `src/tools/chat.test.ts`; `tests/integration/setup.ts:46,54`, `chat.int.test.ts`; `scripts/lib/bridge-config.mjs`; `scripts/local-foundry.mjs:39,71,169`; the 24 direct-reading scripts; `.claude/skills/{start-session,chat-and-narration}/SKILL.md`, `bestiary-builder/bestiary-entry.mjs`; `.env.example`; `README.md` §Configuration/§Wire; `docs/{plan-2.2-hosts,local-sandbox,RELEASE,dnd5e-6.0-compat-review,plan-2.1-dnd5e-6-features}.md`; `HANDOFF.md`.

## 3. `src/tools/assets/**` — plane-agnostic?
Yes. All 9 plane handlers (`index.ts:318-652`) do `const plane = this.files(); if (!plane) return this.notConfigured('<tool>')` and reach only `FilePlane` + `host.publicUrl`; `asset-url` is pure mapping (`:671`). On `generic` (`arch-seams-registry-timing.mjs`): `list-assets`/`upload-asset` → "is unavailable: the generic host … has no file plane" (named by tool), `asset-url` → a URL. `find-asset-references`, `relink-asset`, `set-actor-art`, `add-journal-image` are bridge tools and work everywhere.
What a generic user loses: 9 of 151 tools (6%), plus `send-chat-message` image upload (`chat.ts:400-402`, refuses by name) and the remote copy of `export-chat-log` (`:510-512`). 7 of 17 skills call `upload-asset`/`upload-asset-tree`/`list-assets` (bestiary-builder, cards-builder, playlist-builder, scene-builder, soundscape-builder, token-cutout, tom-cartos-import) — so a generic host cannot run scene-builder end to end.
Does every asset tool say so by name? The 6 write tools' descriptions end "Needs the host's file plane configured"; `list-assets`, `asset-info`, `download-asset` (`:219-241`) do not. The registry still advertises all 9 dead definitions on a generic host: 7,664 chars ≈ 2.1k tokens = 2.7% of tools/list.
**The untaken path:** `git grep FilePicker src` → 0. Foundry's own client upload (`FilePicker.upload` / `browse`, over the socket as the joined user) works on **every** host, since the bridge IS a logged-in client. A page-side "bridge plane" implementing `FilePlane` would make asset tools first-class on generic, with WebDAV/fs planes as the fast path for large media. That is the single change that makes "hosts are just endpoints" true for assets.

## 4. Code health, numbers
- Monoliths: `src/page/actors.ts` 2,243 lines / 14 exports / **5 tests covering 1 export** (`extractDamageProfile`); `src/page/scenes.ts` 1,465 / 24 / 42; `src/page/dnd5e/advancement.ts` 1,374 / 21 / 25; `src/tools/dnd5e/add-feature.ts` 1,237; `src/tools/compendium.ts` 1,051; `src/tools/scene.ts` 1,014; 11 files > 800 lines (43,800 non-test src lines). The 2026-06 review measured `actors.ts` at ~1,750 and demoted the 5-way split to P4; it grew 28% since. Verdict: steady-state fine for `scenes.ts`/`advancement.ts` (tested, cohesive); `actors.ts` is the one worth splitting in 3.0 — the CRUD consolidation already re-touches every actor handler, and its 5 offline tests mean the split is proven only by verify scripts.
- Node↔page seam (G3): `FoundryBridge.call<T = any>(name: keyof PageApi, args?: unknown): Promise<T>` (`src/foundry.ts:43`); the class impl is `call<T = unknown>(name: string, …)` (`:447`). `PageApi = typeof api` (`src/page/index.ts:367`) carries full signatures, but the seam uses only its keys. 166 `foundry.call(` sites in `src/tools`, **0** with an explicit `<T>` → every result is `any`; args are `unknown`. `src/foundry.seam.test.ts` is the runtime name-coverage backstop. So G3 as scoped in the 2026-06 plan (P0c: `satisfies` + derived `PageApi` + name test) is closed; payload typing is not. Page side: of 108 handlers my regex resolved, 82 have typed args, 26 take `any`; `src/page/_shared.ts:91` itself says the `satisfies` gives "ZERO return-type protection". Cheap 3.0 fix: `call<N extends keyof PageApi>(name: N, args: Parameters<PageApi[N]>[0]): Promise<Awaited<ReturnType<PageApi[N]>>>` — mechanical, no runtime change, lights up the 26 `any`-arg handlers as the next targets.
- `globalThis` doc-class refs: 62 in `src/page` (non-test); by class: game 14, foundry 9, CONFIG 9, CONST 6, Actor 6, Folder 3, fromUuid 3, then Scene/RollTable/Playlist/JournalEntry/Item/ChatMessage/Cards 1 each. `foundry-globals.d.ts` declares `game`/`CONFIG`/`foundry`/`fromUuid` as `any` yet code still reaches them via `(globalThis as any)` 35 times (test-stub reasons, `actors.ts:1391`). Document classes are module-level captures (`actors.ts:50`, `collections.ts:20-22`) instead of `game.<collection>.documentClass`. Same debt as 2026-06 G10; not blocking.
- Page bundle: `dist/page.bundle.js` 532,338 bytes, unminified (`esbuild.page.mjs` has no `minify`). Loaded once in the constructor (`foundry.ts:123`), injected once per connect (`:155` → `:436 addScriptTag`) and re-injected on recover (`:507`). **Per session, not per call.** Per call: in-page `guardSerialization` walk (`_shared.ts:191-204`) + Playwright serialization + `JSON.stringify` + `capResponse` slice — three passes over the result, all O(n), only the design of the cap matters (other dimension).
- Offline tests: 1,687 `it()` sites by my count (the brief's 1,730 includes `it.each` rows): `src/tools` 921 (55%), `src/page` 637 (38%), `src/hosts` 49, `src/utils` 78, root 2. 36 of 39 `src/tools` test files use the mocked seam (`makeFoundry`) — they prove arg validation → `foundry.call(name, args)` → result formatting, never page logic. 36 of 36 `src/page` test files import a page module directly — the **pure-builder pattern exists** (`effect-changes`, `_shared`, `scenes`, `activities`, `soundscape`, `region`, `items` are the big ones) — but 18 of 53 page modules (5,076 lines, 23%) have no sibling test, and `actors.ts` is effectively one of them. One `foundry-doc-mock.ts` (332 lines) is used by exactly 1 test.

## 5. scripts/ as architecture
100 files: 63 `verify-*` (16,512 lines), 17 `spike-*` (4,260), 1 `measure-*`, `lib/bridge-config.mjs`, ~18 ops/one-offs. 94 import from `dist/`; `dist/foundry.js` is imported by 85 and `new Foundry(` appears in 86 (the scripts build the bridge themselves; 85 via `bridge-config.mjs`); 15 further `dist/tools/*` modules are imported by 1-2 scripts each. `package.json` has no `exports`, no `bin`, no `files`; `main` = `dist/index.js`, which calls `main()` at module top (`src/index.ts:129`) — importing the package starts the stdio server. So `dist/foundry.js` + `dist/hosts/index.js` is an undeclared library that 94 scripts and (per the brief) three sibling repos depend on by relative/absolute path.
Verify pattern vs integration suite: `tests/integration` is 8 files, 1,271 lines, 86 `it()`, gated on `RUN_LIVE=1` AND `MOLTEN_SERVER_URL`; the 12-script release set alone is 5,672 lines. 60 of 63 verify scripts have a `finally{}` cleanup and 63 print counts. Judgment: the verify scripts ARE the regression suite (13× the integration suite by lines) but as ad-hoc executables — no shared assertion vocabulary, counts pasted into commit messages by hand, no aggregate pass/fail, and each carries its own bridge bootstrap. The right steady state for a terminal 3.0 is to promote the release set (12 scripts) into `tests/integration/*.int.test.ts` under the existing harness (`setup.ts` already imports the same `dist/` bridge and namespaces with `ZZ-MCP-IT`), keep the rest of `verify-*` as documented one-offs, and make `npm run test:integration` the gate `docs/RELEASE.md` names. Spikes (17) are archaeology and can move to `scripts/archive/` or be deleted.

## 6. Request path, per-call vs per-session
`buildToolRegistry` runs once per process: 151 tools in **17.0 ms**, all 173 `toInputSchema(` sites live inside `getToolDefinitions()` and are evaluated then; `tools/list` returns the same array object (`index.ts:80`) — schema generation is already per-session. `dispatch('get-world-info')` measured at ~1 µs/call including the zod parse against a mock seam. `ErrorHandler` is constructed once (`index.ts:73`); `toUserMessage` runs only on error. `assertDnd5e` is cached process-wide (`system-detection.ts:20-22`). Nothing per-call on the Node side is worth moving; the only per-call work of note is `JSON.stringify` + `capResponse` and the in-page plainness walk, all linear in result size — the fix is smaller results, not caching.

## Could not verify
- Live behaviour of any tool on a real `generic` host (no world contact allowed).
- Whether sibling repos' `file:///…/fvtt-mcp-molten5e/dist/foundry.js` imports are the only sibling coupling (siblings not in scope; taken from the brief).
- Exact `it.each` expansion behind the brief's 1,730 figure (my static count is 1,687).
