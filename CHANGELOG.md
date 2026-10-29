# Changelog

What changed for a user of the tools and skills, release by release. The measured numbers
(`npm test` budgets, `npm run measure`) ride each entry from 3.0 on. Dates are tag dates.

## 4.7.0 — 2026-10-29 — clues, and create-pc's prepared spells

- **`manage-clues`** (list / collect / uncollect, in the `journals` toolset): the party's record in house
  module [Clue Board](https://github.com/Txpple/fvtt-mod-clueboard), worked through the module's own API.
  `collect` takes world Clues by exact id or name, refuses before writing when one does not resolve, and
  reports one already on the record instead of collecting it twice; `stamp: false` leaves the scene and
  date out, for a clue found before it was collected (Clue Board 1.2.0+). `list` shows the record and the
  world Clues not yet collected; `uncollect` takes one off, its readers and note with it. The writes ride
  the receipt like any other. Refused, with the reason, in a world without the module. 81 tools.
- **`manage-items` `create` makes a module's own Item type.** The type check read the system's types
  alone, so `fvtt-mod-clueboard.clue` (or any module's `documentTypes`) was refused; it now takes the
  world's (`game.documentTypes.Item`).
- **`create-pc`: `spells.prepared` picks land prepared** (#20). The levelled spells in the prepared list
  came out `system.prepared: 0`, as if only in the spellbook; they now land 1. `alwaysPrepared` still
  gives every spell 2; cantrips are as before.
- **The `clue-builder` skill**: making a Clue (from a carried item's sheet when a PC already has it) and
  collecting it. `docs/contracts.md` names the one tool that meets a module on its API, not a flag.

**Budgets** (`npm test`): per prompt 14,103 (ceiling 14,000 → 14,200: the tool's name and the skill's
description); names ×2 6,133; skill descriptions 7,970 / 8,000; tools/list 209,542 (81 tools); the
`journals` row 16,053 (ceiling 14,700 → 16,100); per fetch unchanged.

**Verified** (2026-10-29, the local sandbox: Foundry 14.369, dnd5e 6.0.6, Clue Board 1.2.0):
- offline: biome · `tsc --noEmit` · vitest **115 files, 2,133 tests** (3 skipped) · build (page bundle
  586.9 kB) · knip · `npm run measure` (0 unresolved, 0 stale; seam 159 handlers, 0 `any` / `unknown`);
- the release set **14 / 14**: effects-6 51 · region-effects 37 · activities-6 37 · settings-calendar 52 ·
  item-tooling 24 · actor-tooling 51 · pc-build 73 (D3d new: #20) · teleporter-scene-fields 13 ·
  placeables-tooling 87 · scene-tools 24 · cast-activity 25 · region-tooling 22 · receipts 30 ·
  toolsets 19; and the new **verify-clue-tooling 9 / 9**;
- the live integration suite **7 suites ran, 85 passed / 2 skipped** (the same two as 4.6.5);
- the MCP smoke over a Claude Code restart is the user's (the registration's schemas change with
  `manage-clues`).

## 4.6.5 — 2026-10-28 — set-landing-scene retired

- **`set-landing-scene` is gone.** Open Server 1.4.0 dropped its per-user landing scene (a crosshair in
  the Players list jumps a player to their character's token instead), so the User flag the tool wrote,
  `flags["fvtt-mod-openserver"].landingScene`, is read by nothing. The tool, its page function
  (`fvtt.setLandingScene`), `list-users`' "lands on" line and the `verify-landing-scene` live script go
  with it. `get-world-info` still names Open Server among the family modules for its version, but no
  longer warns when it is inactive: nothing here needs it. 80 tools; `pull-users-to-scene` remains the way
  to move a connected player's view.

**Verified** (2026-10-28, the local sandbox: Foundry 14.369, dnd5e 6.0.6):
- offline: biome · `tsc --noEmit` · vitest **114 files, 2,122 tests** (3 skipped) · build (page
  bundle 568.2 kB) · knip · `npm run measure` (0 unresolved, 0 stale; seam 156 handlers, 0 `any` /
  `unknown`);
- the release set **14 / 14** (the sandbox fresh from a prod mirror, only the bridge connected):
  effects-6 51 · region-effects 37 · activities-6 37 · settings-calendar 52 · item-tooling 24 ·
  actor-tooling 51 · pc-build 72 · teleporter-scene-fields 13 · placeables-tooling 87 ·
  scene-tools 24 · cast-activity 25 · region-tooling 22 · receipts 30 · toolsets 19;
- the live integration suite **7 suites ran, 85 passed / 2 skipped** (the same two as 4.6.4);
- the MCP smoke over a Claude Code restart is the user's, after the reboot (the registration's
  process predates this build).
- Budgets: per prompt 13,916 (≤ 14,000), names 6,064 (≤ 7,000), skill descriptions 7,852
  (≤ 8,000), tools/list 208,124 (80 tools; ≤ 220,000), always-on 1,702 (≤ 2,100).

## 4.6.4 — 2026-10-28 — a choices entry nothing reads is refused

- **`create-pc` and `level-up-pc` refuse a `choices` entry nothing reads** (issue #21). An entry
  keyed by a word instead of the advancement id (`"subclass"`), a mistyped id, or a level the build
  never reaches was dropped without a trace; with `acceptDefaults` the advancement then took its
  default and the answer said `success` with no warning. The build now records every key an
  applied advancement reads (the class's, a multiclass's, the species', the background's and the
  subclass's own, whose ids exist only once the subclass is applied) and refuses the rest:
  `rolled-back`, each entry named with a did-you-mean when it reads as a pick's type or title, and
  the `level → id` pairs the build asks for. Nothing persists; a level-up is put back. Live:
  `verify-pc-build` 72/72 (the case added), the PC integration suite 4/4.

**Verified** (2026-10-28, the local sandbox: Foundry 14.369, dnd5e 6.0.6, only the bridge
connected throughout):
- offline: biome · `tsc --noEmit` · vitest **114 files, 2,130 tests** (3 skipped) · build (page
  bundle 571.2 kB) · knip · `npm run measure` (0 unresolved, 0 stale; seam 157 handlers, 0 `any` /
  `unknown`);
- the release set **14 / 14**: effects-6 51 · region-effects 37 · activities-6 37 ·
  settings-calendar 52 · item-tooling 24 · actor-tooling 51 · pc-build 72 ·
  teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 · cast-activity 25 ·
  region-tooling 22 · receipts 30 · toolsets 19;
- the live integration suite **7 suites ran, 85 passed / 2 skipped** (the same two as 4.6.3);
- the MCP smoke on the sandbox registration: `get-world-info`; a Fighter 2 / Rogue 1 (`success`,
  HP 27, 0 unresolved `@scale`); a bad subclass uuid on the Subclass advancement is an error,
  `[rolled-back]`, no actor persisted. The registration's process predates the build (bridge
  4.6.2); the refusal itself was driven on the built code (`verify-pc-build` E-keys).
- Budgets: per prompt 13,995 (≤ 14,000), names 6,143 (≤ 7,000), skill descriptions 7,852
  (≤ 8,000), per fetch 38,981 (≤ 39,000), tools/list 208,918 (81 tools; ≤ 220,000), always-on
  1,778 (≤ 2,100).

## 4.6.3 — 2026-10-28 — a token's own light, copies by uuid, one search leaf

- **A placed token's own light.** `manage-placeables` tokens `create` and `update` take `light{}`
  (dim / bright radii, color, alpha, angle, luminosity, attenuation, the animation, `negative`):
  a carried torch or a glowing creature without opening the token config. A partial `light` keeps
  the rest of the emission (create merges onto the prototype's, update writes `light.*` paths);
  `list` shows `lightDim` / `lightBright`, the update report `light dim/bright`. The per-fetch
  ratchet moves 36,800 → 39,000 and the scenes row 62,500 → 64,700 for it.
- **`manage-items` `import` on a container keeps quantity 1.** A `quantity` asked on a container
  copy is reported as a warning and not written, the rule `add-item` already applied; dnd5e treats
  a container as one document however many it holds.
- **`search-compendium` `type: "any"` takes `name`**, the leaf the other three types share; its
  `query` leaf is gone (an unknown argument, refused by name). The body's head says `name` too.
  The run-script skill's example now passes the page function's real arguments (`query`,
  `packType`) and reads a hit's `pack`.
- **`add-feature` mode `items` copies by uuid.** An entry is either the raw `{name, type, img?,
  system?}` or `{uuid, name?, quantity?, system?}`: the Item at that compendium or world uuid is
  copied whole (art, system data, activities, effects), renamed and stacked on request, its
  `system` patch merged in; an SRD uuid is refused like `manage-items` `import`'s pack. The
  actors row moves 75,000 → 75,700.
- **Teleporters no longer ask by default.** `manage-placeables` `create-teleporter`'s `confirm` and
  `add-behavior`'s `teleportToken` `system.choice` now default to false. The confirmation dialog
  parked every token on the pad until its owner answered, so a party moving together stranded
  anyone who missed it or declined; the copies a GM then drops to keep play moving stop Foundry
  pulling those players on the next GM move (a user who still owns another sighted token on the
  scene left behind is not pulled). Both reproduced on a live server with four players at once.
  `confirm:true` still asks. scene-builder carries the rule and the pull trap.

- **The live integration suite reads the searches' `{ results }` again.** Two tests still read
  the compendium searches as the bare array they stopped being in 3.0, so the actor chain
  (`createActorFromCompendium`, `addActorItems`, `removeActorItems`, `deleteActor`) and the
  compendium-entry read had skipped on every live run since: five of "the same six" skips. They
  run now, with a uuid copy in the chain.

**Verified** (2026-10-28, the local sandbox mirrored from prod that day: Foundry 14.369, dnd5e
6.0.6, one world-driver at a time):
- offline: biome · `tsc --noEmit` · vitest **114 files, 2,123 tests** (3 skipped) · build (page
  bundle 569.0 kB) · knip · `npm run measure` (0 unresolved, 0 stale; seam 157 handlers, 0 `any` /
  `unknown`);
- the release set **14 / 14**: effects-6 51 · region-effects 37 · activities-6 37 ·
  settings-calendar 52 · item-tooling 24 · actor-tooling 51 · pc-build 70 ·
  teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 · cast-activity 25 ·
  region-tooling 22 · receipts 30 · toolsets 19, each clean in `finally`;
- the four changes live through the registry on the built code **17 / 17** (a token lit, re-lit in
  part and put out; a container imported at quantity 1 with the warning; `query` refused by name;
  an Arrows copy by uuid at 20 with its art; an SRD uuid refused);
- the live integration suite **7 suites ran, 85 passed / 2 skipped** (`post-item-card`: no file
  plane for it here; `rollOnTable`: the mirrored world has no table);
- the MCP smoke on the sandbox registration: `get-world-info` (host `local`, role ASSISTANT, 4
  books present / 1 missing); a Fighter 2 / Rogue 1 in one `create-pc` call (`success`, HP 27, 0
  unresolved `@scale`); a bad subclass uuid on the Subclass advancement is an error,
  `[rolled-back]`, naming the advancement, no actor persisted. The registration's process predates
  the build (bridge 4.6.2), so the new schemas were driven on the built code, above, not over it.
- Budgets: per prompt 13,995 (≤ 14,000), names 6,143 (≤ 7,000), skill descriptions 7,852
  (≤ 8,000), per fetch 38,981 (`manage-placeables`; ≤ 39,000), tools/list 208,787 (81 tools;
  ≤ 220,000), always-on 1,778 (≤ 2,100).

## 4.6.2 — 2026-10-19 — the bestiary in the campaign's own art, brief

- **`bestiary-builder` uses the campaign's own art and keeps a page brief.** A page is the
  creature's portrait from the world (the actor's `img`, passed as `--art`; the Monster Manual's
  journal art stays the default only for a campaign without its own illustrations), the MM epithet
  and pull quote, at most two MM narrative paragraphs (`--paras <n>`, default 2), and one short
  callout of the party's own encounter in dnd5e's `notable` block (`--story <file>`, an HTML
  fragment, written from the session recap and never a GM secret). session-scribe runs it at every
  wrap.
- **`bestiary-entry.mjs` reads the env through the family's loader**, so `FVTT_MCP_ENV` picks the
  file the same way it does for the server (prod: `FOUNDRY_HOST=molten FVTT_MCP_ENV=.env.halruaa`);
  it read only the repo's `.env` before.
- No server code changed since 4.6.1: the tools and schemas are 4.6.1's, and so are its live
  verifies. The longer description cost the per-prompt budget, which the rewrite first broke
  (14,031 of 14,000); it is worded to fit. Budgets: skill descriptions 7,852 (17 skills; ≤ 8,000),
  per prompt 13,995 (≤ 14,000), per fetch 36,758 (`manage-placeables`; ≤ 36,800), tools/list
  205,896 (81 tools; ≤ 220,000).

## 4.6.1 — 2026-10-19 — flatten-safe schemas and three context budgets; a vetoed delete, a miss and a refusal are errors; the Area Sounds mirror under contract

- **The Area Sounds mirror is tested against the module.** `configure-area-sounds` repairs a set
  the way Area Sounds' own `normalizeSet` does, in TypeScript; `src/page/areasounds.contract.test.ts`
  now runs both over a corpus of edge values from the module's clone beside this repo, checks the
  day/night gate, the flag's scope and the library path against the module's `store.js`, reads
  back what `setsUpdate` stores through the engine unchanged, and holds the mirror to the module's
  `contracts/sets.json` at the version `contracts/consumes.json` names. Without the clone (CI) the
  module half is skipped, saying so.
- **Three context budgets, each with the client that pays it** (the suite's review of 2026-10-15,
  issue #18). The one `tools/list` ceiling measured an eager client, and at 4.6.0 it had 13 chars of
  headroom, so a lights change had to trim the token fields to fit. `npm test` now prints and
  ratchets three: **per prompt** for a deferred client such as Claude Code (the tool names once per
  registration plus the skill descriptions: 13,916 chars, ceiling 14,000); **per fetch** (the
  largest single tool with its `anyOf` flattened the way Claude Code shows it — `manage-placeables`,
  13,164 chars, ceiling 13,200 — and a flatten-safety rule: that merge shows a key in the first
  member's shape only, so no key may be described in two shapes across a union's members; 17 keys
  were, listed in the test until the commits that fix them); and **the eager `tools/list`**
  (204,987 chars) with a row per toolset at today's number and the total raised from 205,000 to
  220,000, so a family that grows pays in its own row or raises it in the same commit, never in a
  neighbour's prose. `node scripts/measure/schema-decompose.mjs` prints the flattened view and the
  lossy keys of every union tool.
- **`manage-placeables` is flatten-safe: each kind's entries ride its own key.** A deferred client
  folds the union into one object, the first owner of a key winning, so `kind: "lights"` showed the
  tiles' fields under `items`, `patches` and `ids` for every kind. The keys are per kind now:
  `tiles` / `tilePatches` / `tileIds`, `lights` / `lightPatches` / `lightIds`, `walls`, `drawings`,
  `sounds`, `notes`, `tokens` and `regions` the same way; the tokens kind's `update` and `delete`
  take `tokenIds` (was `ids`, beside `actorIds`); `add-behavior` names the behavior with `label`
  (was `name`, which the tokens kind's `update` takes for the nameplate). The shared keys are
  refused by name, never silently dropped, so an old call fails loudly with what the kind takes.
  The page functions (`fvtt.createSceneTiles` and the rest, `run-script`) keep `items` / `patches`
  / `ids`. Every skill line that named the keys is re-pointed (`tom-cartos-import`, `token-cutout`,
  `plot-drift-check`, the shared authoring policy). Budgets: the flattened `manage-placeables` is
  36,758 chars (was 13,164 showing one kind's shapes; ceiling 36,800 — the view is now right for
  every kind, paid once per session that uses the tool); tools/list 204,987 → 205,279, the scenes
  row 62,106 → 62,398 (ceiling 62,500); the lossy keys 17 → 13.
- **The other lossy keys are gone: one leaf per shared key.** Where two members of a union
  described the same key differently (`manage-scenes`, `manage-cards`, `manage-playlists`,
  `manage-journals` and `manage-folders` on `name`; `manage-folders` on `parentFolder`;
  `manage-journals` on `pageId`; `manage-rolltables` on `name`, `formula`, `replacement`,
  `displayRoll` and `results`; `search-compendium` on `limit`), the members now share one zod
  leaf, so every client sees one shape. What changed for a caller: `search-compendium` takes
  `limit` up to 500 for every `type` (the name search was capped at 50; a numeric string is
  accepted everywhere); `manage-rolltables` `update` refuses an empty `formula` or an empty
  `results` (a replacement set has at least one entry; one entry: `editResults`);
  `manage-journals` `update` refuses an empty `name`, and `get` / `update` an empty `pageId`.
  The flatten-safety assertion holds an empty list from here. Budgets: tools/list 205,279 →
  205,873; the rows that grew, the same prose now on both members: compendium 6,541 → 6,662
  (ceiling 6,700), journals 14,380 → 14,635 (14,700), tables 5,935 → 6,138 (6,200),
  organization 5,775 → 5,806 (5,900).
- **A vetoed delete is an error, not a success.** A module may refuse a delete from its
  `preDelete<Doc>` hook (By the Books keeps a standing companion's effect); Foundry then skips the
  document and resolves as if nothing were wrong, and `manage-effect` `delete` answered "Deleted"
  with the effect still on the actor. `manage-effect` `delete`, `remove-from-actor`,
  `manage-journals` `delete-page` and `manage-placeables` `delete` now check that each document went
  and refuse naming the ones that did not (`[unsupported]`); a refused document is in no receipt,
  and the receipt of a batch keeps only the deletes that happened.
- **design.md names the 4.x line** (the suite's review of 2026-10-15, decision 3). It and
  CONTRIBUTING said the project had been in maintenance since 3.0.0 with no roadmap, while 4.x
  shipped receipts and undo, `run-script`, the read-only mode, `init` and `doctor`, seat records,
  the op cap, the lights whole and `asToken`, none of them written there. The feature line is open
  behind a gate: a feature lands when it serves onboarding or the table and is written into
  design.md before it is built; no live in-session assistant. design.md §4 gains a row per 4.x
  capability and the three budgets, §8 the mechanisms (receipts, the script facade, the tool kinds,
  the seat, the budgets), §1 and §9 the gate; CONTRIBUTING's opening, `CLAUDE.md` and `AGENTS.md`
  say the same.
- **`npm test` ignores the gitignored `scratch/`.** A scratch `*.test.ts` left there on one machine
  was collected by the offline suite and changed the gate's count on that machine only.
- **The `run-script` reference is held to the program.** `docs/run-script-api.md` is generated
  from the page API and had gone stale with 4.6.0 (`screenshot-scene`'s page op gained `asToken`,
  in its argument and its result), and nothing ran `scripts/measure/run-script-api.mjs --check`.
  `npm test` runs it now (`src/run-script-api.test.ts`); the reference is regenerated
  (`npm run api-doc`).
- **The hosts rule holds again: legacy names live in the host selector.** `git grep MOLTEN_ src`
  answered six files where CONTRIBUTING allows `src/hosts/env.ts` and its test. The 2.x names of
  the suite and player identities (`BF_SUITE_*`, `MOLTEN_TEST_*`) are the selector's
  `IDENTITY_NAMES`; the `.env` license-key check and the doctor's withheld admin key read every
  name of `FOUNDRY_ADMIN_KEY` from `namesOf` (the selector's alias table) instead of listing them;
  `src/hosts/env.test.ts` fails when another file under `src/` names a `MOLTEN_*` variable.
  **`targetLabel` (`fvtt-mcp-dnd5e/client`) is the host preset's own label**: `local install`,
  `Molten Hosting`, `generic` (was `local sandbox` / `prod (Molten)`), so a script's `target:` line
  and the doctor's `config:` line read that way; library code no longer tells one host from another.
  **`npm run init` and the doctor name no host either**: they branched on the host kind (init's
  questions, its flag checks and refusals, its `--help`; the doctor's Foundry-app check) and init
  printed a host's label and its panel's words. Each preset's onboarding facts now live with the
  presets (`src/hosts/onboarding.ts`: how init names it, whether Foundry runs on this machine, the
  URL it shows, the registration name it offers, the extras it asks or takes from a flag, and why
  another is refused), and init and the doctor read them; what they ask and print is unchanged (the
  `--host` help line wraps one word later). The bridge's placeholder-URL guard no longer builds a
  `generic` config to call it. `src/hosts/onboarding.test.ts` fails when a file under `src/` outside
  `src/hosts` names a host kind or a host's label in its code (proved against the old `init.ts`,
  `doctor.ts` and `foundry.ts`, and a planted file).
- **A miss or a refusal is an error, everywhere** (design.md §3). The asset file tools and the chat
  tools answered misses and refusals as successful text ("Refused: …", "Not found: …", "Does not
  exist", "`<tool>` failed: …"), so a client saw a success. They are errors now, with a code and its
  hint: a Data path that is not there (`list-assets`, `asset-info`, `delete-asset`, `move-asset`,
  `copy-asset`), a local file or directory that is not there, an `upload-asset-tree` filter that
  matches nothing: `[not-found]`; an existing file without `overwrite`, a world-DB path, a directory
  without `recursive`, a referenced file without `force` / `relink`, a `create-asset-folder` onto a
  file, `delete-chat-messages` `clearAll` / `beforeTimestamp` without `confirm`, an `export-chat-log`
  destination it refuses, a `send-chat-message` `dataUri` image that is a URL: `[invalid]`; a
  reference check with the bridge down: `[connection]`. A scene that does not resolve in
  `activate-scene`, `pull-users-to-scene`, `set-landing-scene`, `get-scene-dimensions` or
  `screenshot-scene` (each answered "Scene not found: … Nothing changed." as its result) is a
  `[not-found]` error too; nothing is changed, pulled or captured. `post-item-card` answered a card
  it could not post as text ("Could not post a rich card: …"); the page now refuses it with a code:
  an item with no activities, and a use or a roll a module's hook vetoed (By the Books'
  require-target rule; nothing reaches chat), are `[unsupported]`, as a vetoed delete is; a named
  `activity` the item does not have is `[not-found]`, listing the ones it has (it was misreported as
  "item has no activities"); `attack` on an item with no attack activity, or `damage` on an activity
  that rolls none, is `[invalid]` (it was misreported as a veto). The page result (`fvtt.postItemCard`)
  is `posted: true` only; the reference is regenerated. A file plane's own failure is
  coded by its status (404 `not-found`, 400 / 409 / 412 `invalid`, 401 / 403 `permission`, 415 /
  501 `unsupported`; anything else its words). An `export-chat-log` whose Data copy is refused after
  the local copy was written says so in the error. `create-asset-folder` onto an existing folder and
  a `move-asset` whose relink failed after the move stay answers (the call did its work). The `invalid`
  hint no longer says "the page" (a tool can refuse before it): "The arguments were refused — fix or
  add the field it names and retry."
- **A PC build or level-up whose advancement failed is an error, `[rolled-back]`.** `create-pc` and
  `level-up-pc` answered `{success:false, errors[]}` as a normal result; the page now throws
  `rolled-back` naming each failed advancement (nothing persisted, or the PC put back at its prior
  level), the code whose hint says just that and which nothing threw before. A level-up whose
  rollback itself failed is its own words (it is not "nothing written"), and the call's receipt names
  what stayed. `needsChoices` (a dry run) is still an answer. The page result loses `errors`; the
  tool descriptions say "is an error". `docs/RELEASE.md`'s smoke step expects the error.
  `scripts/verify-asset-plane.mjs` checks the refusals as errors.
- **A change no receipt can hold says it is not undoable.** A receipt records the world's
  documents, so a call that changed a file in `Data/` or a player's view answered like a read: no
  receipt line and no warning. Such a call now ends its answer with one line, e.g.
  `not undoable: the delete in Data/ (a receipt holds the world's documents only)`, after the receipt
  of any documents it also wrote (a `move-asset` relink, a `send-chat-message` with an uploaded
  image). The tools carry a `NO_RECEIPT` tag (`src/tool-kinds.ts`): `upload-asset`,
  `upload-asset-tree`, `create-asset-folder`, `delete-asset`, `move-asset`, `copy-asset`,
  `export-chat-log` (its `Data/` copy), `send-chat-message` (an uploaded image),
  `pull-users-to-scene` (a view it moved) and `run-script`, whose answer names the page functions a
  run completed that write past the recorder (`fvtt.uploadFile`, `fvtt.createDirectory`,
  `fvtt.pullUsersToScene`; the page result's `receipt.unrecorded`). The line appears only once the
  change was made (not on a refusal, an existing folder, a pull that moved nobody), and a failed
  call carries it like its receipt line. `src/tools/registry.test.ts` sorts every write tool into the
  tagged ten or the recorded 48 by name, so a new write cannot join unnoticed. The README's "every
  write tool answers with a receipt" now says what is true; design.md §3 and §8 and the `run-script`
  skill say the same. Library: `dispatchWithReceipt` answers `notUndoable` beside `receiptLine`.
- **A write never breaks a tie: a fuzzy name that matches several documents is refused, naming
  them.** The actor resolver (one function, imported under three names at 32 sites) took the first
  substring match, also for a write, so `"gob"` could add a feature to whichever goblin came first.
  It answers by tiers now — exact id, exact name, the name without case, then a substring; the first
  tier that matches answers — and every write site refuses a tier with several actors
  (`[ambiguous]`: `Actor "gob" matches 4: "Goblin" (a1), "Goblin Boss" (a2), … A write changes one
  actor, so it is not picked for you: name it by its id.`): the sheet edits, `add-feature`,
  `add-item`, `manage-effect` / `manage-activity` (but `list`), `apply-condition`, `level-up-pc`,
  `add-free-cast`, the group members, `set-primary-party`, `update-user`'s character,
  `send-chat-message`'s `speakerActor`, `post-item-card`, `link-quest-to-npc`, and
  `set-actor-ownership`. Reads still take the best match (now the case-insensitive exact name over
  an earlier substring). The user lookups share the tiers: `update-user`, `set-user-avatar`, the
  macro owner and hotbar, `pull-users-to-scene` and `set-landing-scene` (every name resolved before
  the first write) refuse a name two users share without case; `duplicate-actor`'s owner the same;
  `set-actor-ownership`'s player is one player or `"party"` — a name that matches several players
  is refused, listing them (it wrote to all of them), and no actor or no player is a `[not-found]`
  error instead of `0 ownership assignments completed`. The page resolver is one name everywhere
  (`resolveActorFuzzy`, `resolveActorTarget` for the token it came through); the call sites say
  `'write'`. The run-script reference names `findActor`'s `forWrite`. **The item lookups share the
  tiers** (`resolveActorItem`, `resolveWorldItem`; a call that names a type narrows every tier to
  it): they took the first substring match on a write too, so `"sword"` could patch whichever
  sword came first. `update-actor-item`, `add-free-cast` (its spell and its granting feature), and
  `manage-activity` / `manage-effect` (but `list`) on an actor's item or a world item refuse an item
  name that matches several (`[ambiguous]`: `Item "sword" matches 3: "Longsword" (i1), …`); a
  read takes the best match (now the exact name over the case-insensitive one). The strict item
  lookups on a write refuse a name two items share the same way: `post-item-card`'s `item` (an id
  or the exact name), `remove-from-actor`'s `itemNames` (the exact name, then without case) and
  `manage-items` `delete` (an id or the exact name) each took the first of them, so a delete by a
  shared name removed whichever came first; every name is resolved before the first delete, so a
  refused call deletes nothing (the ids still remove several).
- **`set-actor-ownership` with a placed token's id writes that token** (issue #19). The token was
  lost between the lookup and the write, so an unlinked token's write landed on its base actor and
  every other copy. The page call carries the scene and the token now: an unlinked token's own
  entry is merged into its ActorDelta (only the token's entries, merged per user over the base
  actor's the way Foundry builds the token's actor; the first one carries the token's current
  default, since Foundry fills a missing default with NONE, which would lock every other player out
  of the token; never a non-recursive write, which would rebuild the token's actor from the base
  actor and drop the token's own hit points and changes on every client), INHERIT removes it (the
  server ignores a deletion in an ownership map or of the map, so the token's map is written whole,
  as Foundry's own ownership dialog writes it: the base actor's entries, the token's others over
  them, the user's base entry or none; read back, and an error if Foundry kept the entry), and the
  base actor is untouched; a linked token
  has no ownership of its own, so the write
  goes to its base actor and the answer says so (`token "…" is linked … the write went to its base
  actor`). `list-actor-ownership` with a token id reads that token and names it (`token: {id,
  scene, linked}`). A miss in the page's `setActorOwnership` is a `not-found` error; the tool
  answers the first refusal as its error when no assignment landed. `src/tools/ownership.test.ts`
  holds the token case (the identifier resolving to a token's synthetic actor), the linked case and
  the ties; `scripts/verify-ownership-inherit.mjs` §7 proves it live: 27/27 on the sandbox (Foundry
  14.369, dnd5e 6.0.6), the token set, the default and the hit points kept, INHERIT and the linked write.

## 4.6.0 — 2026-10-12 — lights read and write whole; a screenshot through a token

- **Lights read and write whole.** `manage-placeables` `kind: "lights"` `list` returned only the
  centre, radii, colour, angle and the animation's type, so a light someone tuned by hand could
  not be read or copied, and several of its settings could not be written at all. Every field of
  the v14 AmbientLight now reads back under the name its input takes, so a read row passes
  straight back as a patch: `alpha`, `luminosity`, `attenuation`, `coloration`, `saturation`,
  `contrast`, `shadows`, `negative`, `priority`, `animationSpeed`, `animationIntensity`,
  `animationReverse`, `darknessMin` / `darknessMax`, `elevation`, `locked`. The ones that had no
  input (`coloration`, `saturation`, `contrast`, `shadows`, `negative`, `priority`,
  `animationReverse`, `locked`) are now settable on create and update.
- **`animationType: ""` (or `"none"`) clears an animation.** It was documented as "none" but
  silently ignored, so a light's animation could never be removed.
- **`screenshot-scene` can see through a token.** `asToken` (a token id or name on the scene)
  captures the player's view (that token's vision, fog and lighting), so a light's edge can be
  judged the way the table sees it; the GM's all-seeing view hid the hard ring at a light's dim
  radius. Every shot now releases controlled tokens first, so it never leaves one selected.
- The light field descriptions are shorter, to pay for the new fields inside the tools/list ceiling.
- **`scene-builder` lights by the darkness floor.** A dim global light floors the darkness and
  kills the hard ring at a light's dim radius; campfires keep bright 0 with a layered core and
  halo, glows take bright ≈ half of dim in a saturated teal without a pulse; emission fields are
  flat (a nested config is dropped); a re-light keeps each light's animation and centres on the
  painted flame; lights are judged with `screenshot-scene` `asToken`.
- **`stat-block-builder`'s finishing pass makes the art.** Every new actor gets an imagegen token
  (a library token restyled with `edit-image` `kind: "token"`, matched to the campaign's finished
  tokens with a `style` reference) and a matching `generate-image` `kind: "portrait"` in the
  campaign's house style, the token attached as `character`. Both are shown for approval before
  install; the compendium's or the library's art never ships as-is. Recipe: the imagegen
  `illustration-builder` skill.
- Budgets: tools/list 204,651 → 204,987 chars (81 tools; 13 under the 205,000 ceiling); always-on
  1,778, skill descriptions 7,773 unchanged.

## 4.5.0 — 2026-10-11 — Battle Flow is By the Books

- **The bridge reports By the Books.** Battle Flow became Open Roll 5e: By the Books
  (`fvtt-mod-bythebooks`) at its 3.0.0. `get-world-info`'s `bridge.modules` names it under
  `bythebooks` (was `battleflow`): its version when active, else `not active`, and the warning
  reads `By the Books is not active in this world: the combat report needs it`. `npm run doctor`
  and `npm run smoke:bridge` print `By the Books <version>`.
- **A world still on Battle Flow 2.x reads as something true.** When By the Books is not active and
  Battle Flow is, `bythebooks` is `Battle Flow 2.17.0 (legacy)` (the page fact carries
  `legacy: true`), the doctor's line says `Battle Flow 2.17.0 (legacy, now By the Books)` with a !,
  and the warning is `Only the legacy Battle Flow 2.17.0 is active in this world: it is now By the
  Books; install fvtt-mod-bythebooks and disable Battle Flow`. Nothing here reads the module's
  chat-card stat stamps (the scribe does): new cards carry `flags["fvtt-mod-bythebooks"]`, older
  ones keep `flags["fvtt-mod-battleflow"]`; `docs/contracts.md` names both.
- Docs that state current facts follow the rename (the contracts row, the sandbox deploy example,
  the start-session and scene-builder skills); dated history stays as written.
- **The sandbox server starts in its data folder.** `node scripts/local-foundry.mjs start` spawned the
  headless server in the caller's folder, and a process pins its working folder for its whole life:
  one started inside a module's clone blocked renaming that clone (the Battle Flow rename,
  2026-10-11). It now starts in the Foundry data folder, wherever it is launched from.
- Budgets unchanged: tools/list 204,651 chars (81 tools), always-on 1,778, skill descriptions 7,773.

## 4.4.1 — 2026-10-11 — the PC builder's own switch leaves the receipt

- **`create-pc` and `level-up-pc` no longer report their advancement switch in the receipt.** The
  builder turns `dnd5e.disableAdvancements` on for the build and restores it in `finally`; that
  toggle rode into the call's receipt as `1 updated (Setting "dnd5e.disableAdvancements": value)`,
  also on a refused build that persisted nothing, and an undo had nothing to put back. The switch
  is now written as the bridge's own bookkeeping (the same `UNRECORDED` option the seat marker
  uses), so a PC build's receipt names the actor and nothing else. `verify-receipts` holds it
  (27/27); `verify-pc-build` 70/70.
- Budgets unchanged: tools/list 204,651 chars (81 tools), always-on 1,778, skill descriptions 7,773.

## 4.4.0 — 2026-10-11 — the last pass before sharing: receipts on every write, readonly, init, the bridge in get-world-info

- **Every write tool answers with a receipt** (issue #6). The bridge reaches every page op through
  one choke point: a write runs under the page's write lock, one at a time, while Foundry's own
  document hooks record each document it creates, updates or deletes, with the pre-image an undo
  needs (an update keeps the prior value of each path it changes, a delete the whole document). The
  server groups one call's writes into one receipt and appends one line to the answer, also when
  the call failed after it wrote:
  `receipt rcpt_ab12cd: 1 created, 1 updated, 0 deleted (Actor "Goblin 3": system.attributes.hp.value) · undo: run-script { "undo": "rcpt_ab12cd" }`.
  `run-script { "undo": … }` reverses any receipt, a tool call's or a run's, newest write first:
  it deletes what the call created, puts back the paths it changed (removing the ones it added)
  and re-creates what it deleted with its id. An undo answers with its own receipt
  (`reverses rcpt_…`), so it can be undone in turn (a redo); a receipt is undone once, and only
  when every write of it was reversed: an undo that cannot reverse them all names the ones it
  could not and says `receipt rcpt_… stays undoable` (its own receipt `partly reverses` it), and
  undoing it again leaves alone what is already back. An undo that finds every value already back
  (put back by hand) writes nothing, keeps no receipt of its own and says `nothing to put back`;
  the receipt counts as undone. Receipts are kept on the bridge's machine, not in the page
  (`fvtt-mcp-dnd5e/receipts/` under the OS temp dir, keyed by server URL and world id), the newest
  50 per world for a day and 64 MB at most, never the one just written, so they survive a
  `disconnect-bridge` and a restart and are never applied to another world. Not undoable: a
  pre-image over 2 MB (8 MB per call, across all of its page writes; the line counts them), the
  file plane, chat already seen, a pulled view. A registration without `scripting` gets the line
  with how to enable the undo. A sibling harness driving `fvtt-mcp-dnd5e/client` asks for no
  receipt and pays nothing. Two sessions on one seat keep separate receipts but still interleave
  their writes at the server, where no write lock reaches: an undo puts back a value the other
  session has changed since, as the seat warning at connect says. The delete tools
  (`manage-actors` `delete`, `bulk-delete`, `delete-chat-messages`) no longer say a delete cannot
  be undone. Measured in the page on the sandbox: the recorder's hooks cost 0.07 ms per write, a
  delete's pre-image 0.15 ms for a 26 kB actor, and a real update's time is unchanged within its
  noise (8–9 ms). `scripts/verify-receipts.mjs`: 25/25.
- **`FOUNDRY_TOOLSETS=readonly`: a registration that only reads** (issue #8). It advertises every
  toolset's reads: the read tools whole, and each family tool narrowed to its read actions
  (`manage-actors` `list` / `get` / `get-entity` / `export`, `manage-placeables` `list` for every
  kind), 41 tools, 56,627 chars ≈ 15,730 tokens (27.7% of the full list). Every other call,
  advertised or not, is refused by name before its handler runs (`manage-actors action "delete" is
  not a read: this registration is read-only (FOUNDRY_TOOLSETS=readonly); use a registration
  without it.`). A configure call that names a field and an `export-chat-log` copy into `Data/`
  (`remotePath`) are writes; `run-script` is never a read. `readonly` stands alone: beside a
  toolset it stops the server at startup. Pair it with a Player or Trusted Player join user,
  whose role is the boundary the server cannot cross: the bridge warns at connect, and
  `npm run doctor` on its login line, when a read-only registration joins as a Gamemaster or
  Assistant GM. The tags, per tool and per action, are `src/tool-kinds.ts`; `.mcp.json.example`
  carries a `foundry-readonly` entry.
- **`npm run init`: from a built clone to a checked registration in one command** (issue #7). It
  says first what it cannot do (the Foundry user the bridge joins as must exist in the world), then
  asks for the host (`local`, `molten`, `generic`), the URL, that user and its password, the admin
  password, the host's extras (Molten's wake URL and File Manager password; a local install's
  `Data` folder, offered at the platform's default), whether the first run is read-only, and where
  the registration goes: this clone's `.mcp.json`, another project's, or `~/.claude.json` (copied
  to `.bak-<time>` first; only its `mcpServers` entry changes). Every answer is also a flag; `--yes`
  asks nothing, and a missing required answer exits 2 naming its flag. Secrets go only to the
  `.env`: a new one gets the minimal block `.env.example` opens with, an existing one is copied to
  `.bak` and changed in place where an answer differs (on the 2.x alias's line when that is what
  the host reads, so the answer is not shadowed), every other line kept. The registration is the
  full Node path, `dist/index.js` and an env block that names the instance (`FOUNDRY_HOST`,
  `FOUNDRY_URL`, `FOUNDRY_TOOLSETS`, and `FVTT_MCP_ENV` for a `.env` that is not the repo's). Then
  it runs the doctor, whose lines are the join report, and prints the entry as an `mcpServers`
  block for any other MCP client; Claude Code's config is the only one it writes. `AGENTS.md`
  ships beside `CLAUDE.md`. The legacy names are one table in the host selector (`legacyNameOf`),
  and `runDoctor` takes the environment it reads as an argument.
- **`get-world-info` reports the bridge itself** (issue #9): a `bridge` block after `host` with
  this server's version, since when it holds the seat (the join user is `bridgeUser`'s), `woken`
  (this connect found the world asleep, not launched, or booting), Chromium's renderer
  (`GPU: <name>` or `software: <name>`, the canvas's unmasked WebGL renderer), `canvasReady`, the
  Open Roll 5e modules the skills lean on (Battle Flow, Area Sounds, Open Server: a version, or
  `not active`), the registration's `toolsets` (`all`, `readonly`, or the list), and `warnings` for
  whatever of it is amber: a software renderer, an inactive family module (naming what needs it),
  a read-only registration joined as a user that can write, Foundry below 14.368 or dnd5e below
  6.0.5 (the README's requirements line). It stands in for the proposed `bridge-status` tool: a
  tool would have pushed tools/list (204,714 of 205,000) and the always-on set (1,778 of 2,100)
  past their ceilings, where a block in a result costs neither. `npm run doctor` prints a
  `bridge:` line after the login (a ! for a software renderer or an inactive module),
  `npm run smoke:bridge`'s line gains the renderer and the modules, and the `start-session` skill
  reports the block and surfaces every warning. Library: `FoundryBridge.info()` (server URL, user,
  since, woken); the page's `getWorldInfo` result carries `bridge` (renderer, canvasReady,
  viewport, modules). `scripts/verify-bridge-status.mjs`: 13/13.
- **A journal page can carry an NPC's stat block** (issue #11): an `html` block holding
  `@Embed[<uuid> statblock]`, which dnd5e draws from the live actor when the page renders (its own
  stat-block template: title, tags, abilities, actions, in a figure captioned with the name;
  `inline`, `caption=false` and `label="…"` as the system reads them), so a later edit to the actor
  shows on the page. The quest tools already store enricher text as written (4.2.0), so no tool or
  schema changed (0 chars of tools/list): `journal-builder` documents the block, where its uuid
  comes from (`search-compendium` for a book creature, `manage-actors` `list` for a world NPC), that
  it is NPC only (a `character`'s embed is its description) and that the page's visibility is the
  only gate; `bestiary-builder` appends one beside a creature's lore when the table wants it.
  `scripts/verify-journal-tooling.mjs` holds the rendered classes, 54/54 (was 48), and now removes
  the `ZZ-JOURNAL-IT Journals` folder its first section used to leave behind.
- **What a run-script call does is declared per function** (issue #14): every `fvtt.*` function
  is tagged read, write or delete by what its handler does (`src/page/_ops.ts`), where a verb
  guessed from its name used to decide. A dry run had executed `remapSceneTeleporters` for real,
  uncounted; it is now listed and stubbed like every write. Reads a dry run now runs instead of
  stubbing: `configureAreaSounds` `list` / `library`, `rollOnTable` (it neither draws nor posts),
  `manageCalendar` without an action, a configure function called with no field
  (`configureDnd5eSettings`, `configureCombatTracker`, `configurePrimaryParty`), and a
  `bulkDelete` / `relinkAsset` preview (`dryRun: true`). `configureAreaSounds` `remove` counts
  against the delete cap. A page function added without a tag does not compile.
- **`run-script`** (issue #4, the `scripting` toolset): one tool whose argument is a short JavaScript
  program. It runs in the GM's page against `fvtt.*` — the page functions behind every tool, with
  the tools' own argument shapes — so a loop or a bulk job is one round trip and only the return
  value comes back. It runs with the bridge user's rights, and that user's role is the boundary:
  the shadowed globals (`game`, `canvas`, `window`, the document classes, `fromUuid`, `fetch`) and
  the words refused before the script travels (`import`, `eval`, …) guard against accidents and
  are not a sandbox (issue #15). Writes are counted and capped (150 writes, 30 deletes, 60 s;
  raisable), a run's writes land in one receipt with their pre-images (the one every write tool
  answers with, above), and `dryRun` stubs the writes and lists them. The `run-script` skill
  carries the rules; the facade's reference, `docs/run-script-api.md` (155 functions), is
  generated from the program by `scripts/measure/run-script-api.mjs`.
- **The seat has a record** (issue #12). While connected, the bridge leaves one file per process
  under the OS temp dir (`fvtt-mcp-dnd5e/holders/`, keyed by server URL and user) and the same
  facts on its User document (`flags.world.fvttMcpBridge`: pid, host, label, Claude Code session,
  since), cleared on disconnect. A second bridge joining the same seat on the same machine names
  the first in its log instead of joining silently; the Battle Flow suites' preflight prints
  *held by pid N — Claude Code session S — since T* instead of a bare user name. The label is
  `FOUNDRY_BRIDGE_LABEL`, default the Claude Code session that started the server.
- **`disconnect-bridge` names the other holders and takes `{ "all": true }`**, which ends every
  other session's browser on this seat on this machine (their servers keep running and reconnect
  on their next call) — the cure that used to run through the process table.
- **Idle logout.** A bridge that has served no call for `FOUNDRY_IDLE_LOGOUT_MIN` minutes
  (default 20; 0 disables) logs out on its own; the next call reconnects, exactly as after
  `disconnect-bridge`. A forgotten session's seat no longer blocks a battery an hour later.
- Library: `listHolders`, `describeHolder`, `seatKey` and the `Holder` type are exported from
  `fvtt-mcp-dnd5e/client`; `Foundry` takes `label` and `idleLogoutMs`.
- **run-script's word check reads code, not prose** (issue #15). Strings, template-literal text
  and comments are blanked before the check (a `${…}` expression stays code), so a content job
  with `'Go fetch the relic'` or `'<p>Trade goods import duties</p>'` in it is no longer refused.
  `constructor`, `Reflect`, `getPrototypeOf` and `__proto__` are refused as code and as a
  computed key (`x['constructor']`): the obvious way back to the page's real globals past the
  shadowing. The tool's description, the refusal and the skill no longer call the facade a
  boundary. Decided: no Worker-based runner, and `scripting` stays advertised by default,
  because undo lives on this tool.
- **A page op has a cap** (issue #16). A call that hangs in the page no longer holds the bridge's
  seat until `disconnect-bridge`: past its cap (10 min; `run-script`: its timeout + 30 s) the
  bridge asks the page whether it still answers. A page that answers is slow, not stuck, and the
  op keeps its time (asked again each interval, 30 min at most); a page that does not is closed,
  the call fails saying its outcome is unknown (a write may or may not have landed) and is never
  retried, and the next call reconnects. A script stuck in `while (true) {}` with a 5 s timeout
  now fails at about 40 s. The connect is never capped (a cold box keeps its wake and ready
  budgets). Library: `Foundry` takes `opCapMs`.
- **A write is never run twice after the page went away** (issue #16's review). A call whose page
  bridge vanished under it (a world reload, a page the op cap closed under another call) was
  recovered and run again; now only a read is. A write fails as a `connection` error saying its
  outcome is unknown, and the bridge reconnects for the next call.
- **A run abandoned at its timeout can write no more** (issue #16's review): every `fvtt.*` call
  after the timeout is refused, where the script's body used to keep writing, unrecorded.
- **`disconnect-bridge { "all": true }` ends only the recorded browser** (issue #17). A seat record
  names the bridge's browser by pid and executable path (the pid from a CDP `SystemInfo` call, the
  path from the operating system), and eviction ends that pid only while it still runs that
  executable: a record left by a hard-killed server whose pid was since reused is cleared and
  nothing is killed. The result says per holder which browser it ended, or why it ended none. No
  `pgrep`: Windows ends the browser's tree (`taskkill /T`), Linux its process group. An evicted
  bridge's next call re-joins with a new browser; it used to fail on the dead one (`Target page,
  context or browser has been closed`) until its server restarted. Library: `Holder` carries
  `browserPid` / `browserExe`, and `evictOtherHolders()` returns one entry per holder.
- **A seat record stays until its browser is known ended or gone** (issue #17's review).
  `disconnect-bridge { "all": true }` dropped every other holder's record, also when it ended
  nothing: a record from a server on an older build (no browser recorded), from a lookup that
  failed at its connect, or from macOS (where the lookup has no answer) went while its browser
  kept the seat, and the next preflight could no longer name the holder. Such a record now stays,
  nothing is killed, and the answer says `record kept` and why; a record goes when its browser was
  ended, its pid is dead, or its pid now runs another program. The browser's executable is read
  asynchronously (on Windows a PowerShell start, which held the server's event loop on every
  connect), and an eviction never ends the evicting bridge's own browser when another record
  names its pid. Library: `evictOtherHolders()` returns a promise, and each entry carries `kept`.
- **A receipt holds its own call's writes and no other's** (issue #6's review). A `run-script` run
  that ends, or is abandoned at its timeout, with a call still in flight waits for it (15 s at
  most) with its lock held, so those writes land in its own receipt and never in the next call's,
  and a call its script makes after the run ended is refused; a create made by another session
  joined as the same user no longer lands in this session's receipt, whose undo would delete it;
  two writes from one session wait for each other in the server, so a write's op cap no longer
  counts the time it queued, while writes issued together still share one connect (and fail
  together when it fails, instead of each paying the wake in turn), and a call that arrives during
  a connect joins it instead of failing it; a call that wrote and then lost its page answers with
  its receipt without reconnecting first; and a read that views a scene no longer puts the
  previous scene's fog into an open receipt.
- `set-primary-party` with no arguments sends an empty call, which the page's op table reads as
  the read it is (it sent `clear: false` and counted as a write).
- **Not planned here:** pre-images in a world journal and the dry run as an approval hash (issue
  #13: receipts are kept on the bridge's machine instead); the client-neutral set (issue #5:
  skills as MCP prompts, a neutral default user, a registration for every client; `npm run init`
  writes Claude Code's and prints the generic `mcpServers` block for the rest); the Linux GPU
  check (issue #10) is a row of the suite's Ubuntu issue (Txpple/fvtt-suite-openroll5e#5), and
  `GPU_ARGS` gets a Linux flag in a patch release only if its numbers say so.
- Budgets (`npm test`), 4.3.0 → now: tools/list 203,259 → 204,651 chars (80 → 81 tools:
  run-script; ≤ 205,000; the `undo` leaf is 5 chars shorter than it was, the delete tools 63),
  names ×2 6,078 → 6,143, skill descriptions 7,534 → 7,773 (16 → 17 skills; ≤ 8,000), always-on
  1,578 → 1,778 (≤ 2,100), readonly 56,627 (41 tools; reported, no ceiling). No ceiling was
  raised.
- Release set on the sandbox (Foundry 14.369, dnd5e 6.0.6), 14 / 14 scripts, 536 / 536:
  effects-6 51/51, region-effects 37/37, activities-6 37/37, settings-calendar 52/52, item-tooling
  24/24, actor-tooling 51/51, pc-build 70/70, teleporter-scene-fields 13/13, placeables-tooling
  87/87, scene-tools 23/23, cast-activity 25/25, region-tooling 22/22, receipts 25/25, toolsets
  19/19. Live integration: 7 suites, 78 passed, 8 skipped.

## 4.3.0 — 2026-10-10 — Soundscape is now Area Sounds

- **The companion module is renamed** `fvtt-mod-soundscape` → `fvtt-mod-areasounds` (Open Roll 5e:
  Area Sounds, 2.0.0), since another Foundry module already had the name. The tool follows it:
  **`configure-soundscape` is `configure-area-sounds`**, with no alias for the old name (an alias
  would cost every session a second tool description). The `audio` toolset lists the new name.
- **The skill is `area-sounds-builder`** (was `soundscape-builder`); `playlist-builder` points at it.
- **Sets are read from `flags["fvtt-mod-areasounds"].sets`**, and from the old
  `flags["fvtt-mod-soundscape"].sets` when a scene has no sets under the new scope (a world whose
  GM has not loaded Area Sounds 2.0.0 yet; `list` says so). Writes go only to the new scope, and a
  write to a scene read from the old one unsets the old scope in the same update, so the two never
  fork. File paths are copied unchanged: a `soundscape-sfx/…` path may be the user's own folder;
  the library repo's `remap-areasounds-scene-paths.mjs` repoints the house library's. Writes are a
  plain scene update now, not `setFlag`, which refuses a scope whose module is not active.
- **The template library is `areasounds-sfx/library.json`.** When it is missing the tool reads
  `soundscape-sfx/library.json` once (a box whose library has not been republished), uses its paths
  as they are, and says so in a warning.
- **A world still running the old module** gets a warning that names it, says it gets no more
  updates and does not read sets written under the new scope, and points at Area Sounds; `list`
  shows `only the OLD module (fvtt-mod-soundscape v…)` instead of `module NOT INSTALLED`.
- `scripts/verify-soundscape-tooling.mjs` is `scripts/verify-areasounds-tooling.mjs`; it snapshots
  and restores the old scope too, so an unmigrated scene is handed back unmigrated.
- `verify-areasounds-tooling`'s keep-and-warn probe adds a path no library ships instead of
  looking for a template whose audio the world lacks, so it no longer depends on how much of the
  library a sandbox carries: 32/32.
- Budgets (`npm test`): tools/list 203,262 → 203,259 chars ≈ 56,461 tokens (80 tools), names ×2
  6,076 → 6,078, skill descriptions 7,525 → 7,534 (16 skills), always-on 1,578.
- Release set on the sandbox (Foundry 14.369, dnd5e 6.0.6): effects-6 51/51, region-effects
  37/37, activities-6 37/37, settings-calendar 52/52, item-tooling 24/24, actor-tooling 51/51,
  pc-build 70/70, teleporter-scene-fields 13/13, placeables-tooling 87/87, scene-tools 23/23,
  cast-activity 25/25, region-tooling 22/22. Live integration: 7 suites, 78 passed, 8 skipped.
  Over MCP: a Fighter 2 / Wizard 1 built with zero unresolved `@scale`; a bad subclass uuid
  returned `success:false` with `errors[]` and created nothing. Prod runs Area Sounds 2.0.0 and
  `configure-area-sounds` reads its migrated scene and the 400-template library.

## 4.2.0 — 2026-10-10 — dnd5e's journal block kit; npm run doctor

- **`npm run doctor`** (`scripts/doctor.mjs`) checks a setup in order, one line each (✓, ✗
  with its fix, ! worth a look, - skipped), and exits non-zero on any ✗: Node against
  `engines`, `dist/` built and not older than `src/`, Playwright's Chromium, the `.env` read
  as the server reads it (`FVTT_MCP_ENV`, `FOUNDRY_HOST`, the process environment over the
  file; commented-out keys and legacy names flagged), the Foundry app (local host), Foundry
  answering `/api/status`, the admin key (tested against `/auth` only when no world is running),
  the world (dnd5e 6+), and a login as `FOUNDRY_USER` with its role, then a disconnect. It never
  launches or stops a world (the admin key is withheld from its login) and does not wake a
  sleeping box, so it is safe against prod.
- **No world and no admin key: the error leads with the cause and the fix.** `No world is
  running at <url> and FOUNDRY_ADMIN_KEY is not set, so the bridge cannot launch one`, then the
  host's fix: locally, set the key and run `node scripts/local-foundry.mjs start`, or click
  Launch World on `<url>/setup`. A connect failure that already names its fix (this one, a
  `FOUNDRY_USER` the world lacks, a rejected admin key, a world /setup does not list) no longer
  gets the generic `[connection]` hint appended; `BridgeError.explained` marks it.
- **The server refuses to start without Playwright's Chromium**, naming
  `npx playwright install chromium` (it checks for the headless shell a headless launch runs),
  instead of failing at the first tool call.
- **`connectFoundry` cleans up a refused connect**: it closes the browser and clears its
  watchdog before rethrowing. A missing bridge user used to leave a script (`smoke:bridge`,
  a sibling harness) sitting until the watchdog aborted it with exit 3.
- **`allowScripts`** in `package.json` approves the two dependencies with install scripts, so
  `npm ci` on npm 11 no longer lists them as unreviewed. `classic-level` (through
  `@foundryvtt/foundryvtt-cli`) is the LevelDB binding `read-pack` uses for v11+ compendium
  packs; its `node-gyp-build` step does nothing where a prebuilt binary ships (Windows, macOS,
  Linux x64/arm64) and compiles one elsewhere. `esbuild` (the page bundle's build, a dev
  dependency, also under Vitest's Vite) checks its platform binary in `postinstall`.
- `scripts/local-foundry.mjs` and the doctor share one Foundry app probe
  (`scripts/lib/foundry-app.mjs`).
- Issue #3, the rest: items 7, 9 and 10 and the doctor.

- **Typed-block journals use dnd5e's own block kit** (`create-quest-journal`,
  `update-quest-journal`, `link-quest-to-npc`). The `<section class="mcp-journal"><div
  class="wrap">` wrapper and its inline stylesheet are gone, and so are the classes nothing in a
  world styled (`lead`, `readaloud`, `grid-2`, `spaced`): pages written through these tools
  rendered as plain text. Now `readaloud` is `<div class="fvtt narrative">`, `lead` is a plain
  `<p>` (scene-setting text is a `readaloud`), `heading` is a bare `<h2>` / `<h3>`, and `grid`
  draws each headed list as an `<aside class="notable">` (dnd5e has no column layout and a page
  cannot carry a stylesheet). The markup is the dnd5e wiki's System-HTML page; the system's
  stylesheet draws it in its journal sheet. Issue #1.
- **New blocks:** `notable` (`<aside class="notable">`, optional `title`), `advice` and `quest`
  (`<div class="fvtt advice|quest">`, optional `title` and round icon `img`; without one the card
  keeps an empty inset where the icon would sit), and `quote` (`<aside class="quote-lg
  float-right">`, optional `author` as `<p class="quote-author">`). Bare text in a box block is
  wrapped in one `<p>`, since dnd5e draws a box's lower corners on its last child.
- **Appending to a page written before this release** puts the new section after the old
  `mcp-journal` section, never inside it; the old part keeps its (unstyled) markup.
- **`manage-journals` create makes dnd5e's page types:** `kind` `rule`, `map` (Map Location),
  `spells`, `class` or `subclass`, with that type's `system` data (e.g. `{code:"A1"}` for a map
  location); `system` on a text or image page is refused.
- **journal-builder skill:** the block table with what each renders as, dnd5e's enricher syntax
  (`[[/check …]]`, `[[/save …]]`, `[[/damage …]]`, `[[/heal …]]`, `[[/attack …]]`,
  `&Reference[…]`, `[[language …]]`), which the tools store as written, and the page types.
- **bestiary-builder:** a Bestiary page has no `mcp-journal` wrapper and no `lead` class (the
  epithet is a plain italic paragraph); the Monster Manual's pull quotes, in all their book
  variants (`quote`, `quote-left size-two`, …), become dnd5e's `<aside class="quote-lg
  float-right|float-left">` instead of a bare blockquote or aside. Sandbox dry runs: Aboleth
  (right) and Basilisk (left).
- Budgets: tools/list 200,756 → 203,262 chars (four blocks, carried by both block tools, and the
  page `system` leaf). Sandbox: `verify-journal-tooling` 48/48 (was 35), now holding every block
  class against the computed style dnd5e's stylesheet gives it, the enrichers enriched, a map and
  a rule page with their system data, and an append after the old wrapper.

## 4.1.0 — 2026-10-10 — GM notes are Foundry secrets; a missing bridge user fails at once

- **A `gmnote` block is a real Foundry secret** (`create-quest-journal`, `update-quest-journal`,
  and the note `link-quest-to-npc` appends). It renders as core Foundry's
  `<section class="secret" id="secret-<randomID>">`, the markup the editor's own Secret button
  writes: players who can observe the page never see it, even when the page is shared, and the
  GM's sheet shows it with a Reveal button. Before, it was a grey `<div class="gmnote">` that
  showed its text to anyone who could open the page. Each secret gets its own 16-character id;
  an update appends to the page as before, so secrets already on it keep theirs. Every other
  block and the `.mcp-journal` wrapper are unchanged. Issue #1 (the GM-note part).
- Budgets: tools/list 200,702 → 200,756 chars (the `gmnote` leaf). Sandbox:
  `verify-journal-tooling` 35/35, including the secret persisting with its id and
  `enrichHTML` dropping it for a non-owner.
- **A bridge user the world does not have is refused at once**, naming the world and its users:
  `user 'X' not found in world 'Y'; users: A, B, C — set FOUNDRY_USER to an existing
  Gamemaster/Assistant GM user or create 'X' in the world`. It reaches the tool call that asked
  (a `connection` error) in about two seconds; the next call checks again. The list and the
  world title are read off the /join form, held against the saved page of each Foundry build.
  (The 14.367 free-text field lists nobody; there a wrong name is still the server's answer.)
- **`.env` slips are named at startup** (server log, and stderr for scripts): a
  `# FOUNDRY_*=<value>` line with no active definition of that key (the value is never printed),
  and a license-key-shaped `FOUNDRY_ADMIN_KEY`.
- **`.env.example` opens with a minimal local and a minimal Molten block**, says that
  `FOUNDRY_ADMIN_KEY` is the Setup screen's Administrator Password and not the license key, and
  that `FOUNDRY_URL` stays unset for a local install.
- **Registration docs:** `.mcp.json.example`, the README and `docs/local-sandbox.md` give the full
  `node.exe` path and the `~/.claude.json` `mcpServers` route (a desktop-app install may not have
  `claude` on PATH); the sandbox registration is `foundry-local5e`, as across the family.
- **`scripts/local-foundry.mjs`** finds a per-user Windows install
  (`%LOCALAPPDATA%\Programs\Foundry Virtual Tabletop\`) as well as Program Files, and `start`
  exits non-zero unless it leaves a world active (or `--no-world`).
- Issue #3, the fail-fast part; the `doctor` script it suggests is not done.

## 4.0.2 — 2026-10-10 — the bridge draws on the GPU

- **The headless bridge renders Foundry's canvas on the GPU.** Chromium is launched with
  `--enable-gpu --ignore-gpu-blocklist` (and `--use-angle=d3d11` on Windows) instead of
  falling back to SwiftShader. `screenshot-scene` is about 2.8× faster and its PNGs no longer
  carry Foundry's "hardware acceleration not enabled" banner. Data-only tools are unchanged.
  No setting and no `.env` change: when the GPU process fails, Chromium falls back to software
  rendering by itself. Closes #2.
- Measured on the local sandbox (Foundry 14.369, dnd5e 6.0.6, Chromium 149, Windows, NVIDIA),
  over real MCP stdio, two runs each, five screenshots per run:

  | | WebGL renderer | Connect | Screenshot median | Foundry FPS |
  | --- | --- | --- | --- | --- |
  | 4.0.1 | SwiftShader | 6.2 s | 2.55 s | 4 |
  | 4.0.2 | D3D11 on the GPU | 5.2 s | 0.89 s | 48 |

- Offline gate green, budgets unmoved (tools/list 200,702 chars). Sandbox: `prove-bridge` OK,
  `verify-scene-tools` 23/23, `verify-scene-view-tooling` 4/4.

## 4.0.1 — 2026-10-09 — Foundry 14.369 compatibility

- **The bridge joins a 14.369 world again.** 14.369 renders the /join user list as
  `<select name="userId">` (14.368 and earlier: `userid`); the bridge matched only the old
  spelling, never saw the form, and spent its ten-minute boot budget "waiting" on a world that
  was already live. The user field is now matched case-insensitively, in the bridge and in
  `scripts/register-module.mjs` / `scripts/uninstall-modules.mjs`. No `.env` change.
- Verified on the local sandbox: Foundry 14.369, dnd5e 6.0.6. Older 14.x builds still join.

## 4.0.0 — 2026-09-23 — session summaries and analytics move to fvtt-app-sessionscribe

**Breaking:** one tool and one skill leave this MCP, by the owner's ruling of 2026-09-23. It
reverses 3.0 decisions #16 and #17 for them; see design.md §4.

- **`get-combat-stats` is removed** (81 → 80 tools). Its successor is `analyze-combat` in the
  sibling `fvtt-app-sessionscribe`, which reads Battle Flow's stat stamps from its own Foundry
  user. The `combat` toolset is now just `configure-combat-tracker`.
- **The `session-scribe` skill is removed**, along with its Python (`session_scribe.py`), setup
  script and templates. It now lives in `fvtt-app-sessionscribe`, rewritten to that repo's tools.
  The session diary is still written through `manage-journals`.
- **`export-chat-log` stays** as the general chat exporter.
- **The campaign-repo contract** (`.claude/skills/_shared/campaign-repo.md`) documents
  `sessions.speakers` (Discord id → transcript label) and the record's `transcript-public.md`
  (the spoiler-free transcript).
- **The docs follow:**
  - README: 80 tools; `chat,combat` is 11; two companion-module tools, not three.
  - `docs/contracts.md`: the stat-stamp row's reader is now the sibling. `get-combat-stats`
    never warned when Battle Flow was absent, so it is gone from the list of tools that do.
  - `docs/hosts.md`, `journal-builder`.

**Parity before removal** (fvtt-app-sessionscribe 3e2b493), on the sandbox (Foundry 14.368,
dnd5e 6.0.5, Battle Flow 2.0.5):
- `analyze-combat` vs `get-combat-stats`: 10/10 windows deep-equal, report text identical.
- `export-session-chat` vs `export-chat-log`: 10/10.
- `snapshot-party` vs `manage-actors export`: 4/4 PCs byte-identical.

**Verified** (2026-09-23):
- offline: biome · `tsc --noEmit` · vitest **96 files, 1,774 tests** (3 skipped; the four
  combat-stats test files' 30 went with them) · build (page bundle 524.0 kB, from 530.5) · knip;
- `node scripts/measure/skills-matrix.mjs`: 0 unresolved, 0 stale;
- `verify-toolsets` **10 / 10** (80 tools; `chat,combat` 11);
- the live integration suite on the sandbox: **7 suites ran, 80 passed / 6 skipped** (the same
  six) in 279 s;
- The release set was not re-run: no page write path changed since 3.0.1, which ran 12/12 on
  the same sandbox mirror that afternoon.

**Budgets** (`npm test`), 3.0.1 → 4.0.0:
- tools/list 201,726 → **200,702** chars (−1,024);
- names ×2 6,153 → **6,076**;
- skill descriptions 7,986 → **7,526** (17 → 16 skills);
- always-on 1,578 (unchanged).
- The ceilings stay where they are.

## 3.0.1 — 2026-09-23 — dnd5e 6.0.5, exhaustion on immune creatures, a narrator speaker

A maintenance release: one compatibility event (dnd5e 6.0.3 → 6.0.5) and two bug fixes.

- **`send-chat-message` never speaks as a selected token.** With no `speakerActor` the speaker
  was left to `ChatMessage.getSpeaker()`, which infers one from whatever token the bridge's
  headless page has controlled — the Session 8 hoard announcement (2026-09-22) posted under
  Gren's name. It now speaks as the bridge user, or as the new `speakerAlias` ("Narrator", "The
  Innkeeper"); with `speakerActor`, `speakerAlias` renames that character's line.
- **dnd5e 6.0.5 is the verified system** (Foundry 14.368). Update past 6.0.3: dnd5e 6.0.0–6.0.3
  delete every actor effect without an expiry on a short or long rest — `apply-condition`'s
  conditions and exhaustion, and `manage-effect` effects created without a duration. Skip 6.0.4:
  rolling an activity's check or save from its chat card can throw there.
- **`apply-condition` keeps exhaustion in step on an exhaustion-immune creature.** From dnd5e
  6.0.4 a level change on the suppressed effect left the actor's stored
  `attributes.exhaustion` at the old level; it now follows the effect (and still never adds a
  second level on 6.0.0–6.0.3).

**Verified** (2026-09-23, the local sandbox mirrored from prod that day: Foundry 14.368, dnd5e
6.0.5, one world-driver at a time — the gate is [`docs/RELEASE.md`](docs/RELEASE.md)):

- offline: biome · `tsc --noEmit` · vitest **98 files, 1,804 tests** (3 skipped) · build (page
  bundle 530.5 kB) · knip — green on `main`;
- the cold bring-up (`verify-wake`): the bridge relaunched the world and joined in 13 s;
- the release set, **12 / 12 scripts, 493 / 493** assertions (3.0.0: 490 — the three new
  immune-exhaustion checks), a `ZZ-*` sweep afterwards finding nothing: effects-6 51 ·
  region-effects 37 · activities-6 37 · settings-calendar 52 · item-tooling 24 · actor-tooling 51 ·
  pc-build 70 · teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 ·
  cast-activity 25 · region-tooling 22;
- the live integration suite, **7 suites ran, 80 passed / 6 skipped** (the same six) in 215 s;
- the MCP smoke after a restart: `get-world-info`; a Fighter 3 / Rogue 1 in one `create-pc` call
  (`success`, HP 35, 39 advancements, **0 unresolved `@scale`**); a bad subclass uuid answers
  `success:false` + `errors[1]` with **no actor persisted**; `apply-condition` exhaustion 3 → 5 on a
  Monster Manual Zombie (immune): stored 5, derived 5, the effect at 5 and suppressed;
- prod, read-only over its own registration: `get-world-info` reports Foundry 14.368 / dnd5e
  6.0.5 and the premium books; `search-compendium` answers;
- the numbers: `tools/list` **201,726** chars ≈ 56,035 tokens for 81 tools (leaf prose 77,106 ·
  descriptions 24,993 · structural 81,985; longest leaf 120; 0 over budget) — +164 over 3.0.0, the
  `speakerAlias` leaf; names ×2 **6,153** (3,117 + 3,036); skill descriptions **7,986** (17
  skills); always-on `session` **1,578**; the seam 156 handlers, 0 `any`; the 24-call live
  baseline **87,895** chars ≈ 24,415 tokens, 1 capped (the walls list), 0 errors — the growth is
  the world's, not the code's: the sandbox is today's prod, and 3.0.0's 73,492 was measured on
  the 2026-09-21 mirror.

## 3.0.0 — 2026-09-21 — the dnd5e MCP: cheaper in context, official 6.x, hosts as endpoints

Tracked in [`docs/history/plan-3.0-consolidation.md`](docs/history/plan-3.0-consolidation.md);
measured in [`docs/history/architecture-review-2026-09.md`](docs/history/architecture-review-2026-09.md).
The last feature line — after it the project is in maintenance (compatibility events, bug fixes,
premium books).

- **Context.** `tools/list` 283,948 → 201,562 chars; the two-registration name list 11,147 →
  6,153 chars (151 tools → 81); skill descriptions 15,382 → 7,986 chars; the 24-call result
  baseline 154,534 → 73,492 chars with 0 capped and 0 errors. Every tool's prose is contract-only
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
- **Upgrading a world to this line.** Foundry to ≥ 14.367 **first** (dnd5e 6.x declares that
  minimum; 14.368 verified), then dnd5e to 6.x (6.0.3 verified) with its migration run to
  completion before the bridge joins; the order, the back-out and the mirrored-sandbox rehearsal
  are in [`docs/hosts.md`](docs/hosts.md#bringing-a-world-up-to-the-30-line). 1.5.2 remains the
  last release for dnd5e 5.3.x.

**Verified** (2026-09-21, the local sandbox: Foundry 14.368, dnd5e 6.0.3, one world-driver at a
time — the gate is [`docs/RELEASE.md`](docs/RELEASE.md)):

- offline: biome · `tsc --noEmit` · vitest **98 files, 1,799 tests** (3 skipped) · build (page
  bundle 530.1 kB) · knip — green on `main`;
- the release set, **12 / 12 scripts, 490 / 490** assertions, every one cleaning its `ZZ-*`
  documents and restoring `worldTime`: effects-6 51 · region-effects 37 · activities-6 37 ·
  settings-calendar 52 · item-tooling 24 · actor-tooling 48 · pc-build 70 ·
  teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 · cast-activity 25 ·
  region-tooling 22;
- the live integration suite, **7 suites ran, 80 passed / 6 skipped** (the same six conditional
  skips as every milestone since M4) in 154 s;
- the MCP smoke on the sandbox registration: `get-world-info` reports host / bridge role /
  library; a Fighter 3 / Rogue 1 built in one `create-pc` call (`success`, HP 35, 40
  advancements, **0 unresolved `@scale`**); a bad subclass uuid answers `success:false` +
  `errors[1]` with **no actor persisted**;
- the numbers (`npm test`, `npm run measure`, the live `tool-results`): `tools/list` **201,562**
  chars ≈ 55,989 tokens for 81 tools (leaf prose 76,976 · descriptions 24,993 · structural
  81,951; longest leaf 120; 0 over budget); names ×2 **6,153** ≈ 1,709 tokens (3,117 + 3,036 per
  registration); skill descriptions **7,986** (17 skills); always-on `session` **1,578**; the
  24-call live baseline **73,492** chars ≈ 20,414 tokens, 0 truncated, 0 errors;
  `search-compendium` 20 s after connect **353 ms**; the seam 156 handlers, 0 `any` / 0
  `unknown`; skills-matrix 0 unresolved / 0 stale.

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
