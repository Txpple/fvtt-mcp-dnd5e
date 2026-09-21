# perf-results — what a client RECEIVES per tool call (review notes, 2026-09-20)

Read-only pass over `scratch/measure-2026-09-20c.json`, `scratch/bodies-2026-09-20/*.txt`, `src/tools/**`,
`src/page/**`, `.claude/skills/*/SKILL.md`, plus the local Foundry/dnd5e sources for the index semantics.
Nothing live was run. Scripts written: `scratch/perf-results-projection.mjs` (the projection table),
`scratch/perf-results-cap.mjs` (record-level cap prototype), `scratch/perf-results-formats.mjs`
(output-format survey via the TS compiler API). Outputs: the matching `*.out` files.

## 0. Two baseline calls were mis-measured — and that is itself the first finding

`search-compendium-creatures {"query":"goblin"}` and `search-compendium-spells {"query":"fire"}`:
neither schema has a `query` key (`src/tools/compendium.ts:55-149` creatures: challengeRating /
creatureType / size / hasSpells / hasLegendaryActions / limit; `:159-227` spells: `name`, not `query`).
zod `z.object` strips unknown keys (verified: `{query:"goblin"}` parses to `{limit:500}`), so both calls
ran UNFILTERED — the bodies begin `"criteriaDescription":"no criteria"` and list Aarakocra… / Acid
Splash… alphabetically. Consequences:

- the "goblin" search returned the whole premium creature pool: 186,611 chars raw (≈493 hits × 379
  chars), cut to 20,073 by the cap, 52 hits visible, `totalFound`/`note` lost (they sit after the array);
- `search-compendium-creatures` has NO name facet at all, although the page engine supports one
  (`src/page/compendium-facets.ts:289-296` `passesPostFilters` checks `args.name`; the creature facade
  `:520-528` just never forwards it). A skill wanting "goblin" creatures must use `search-compendium`
  (7.8 s, every pack) or a CR/type survey;
- a wrong arg name is silently ignored rather than refused (`.strict()` would have returned a 185-char
  error like the placeables did).

## 1. Projection table (node scratch/perf-results-projection.mjs)

Which fields each record carries today (read from the bodies), which a skill actually uses (grep of
the 17 SKILL.md files for the tool name, then the sentence around it), and a compact projection.

| tool | records | fields today | fields a skill uses | compact | before | after | saved |
|---|---|---|---|---|---|---|---|
| list-actors | 168 | id,name,type,hasImage | id,name (plot-drift-check, token-cutout: name→id) | id,name,type | 13,210 | 10,490 | 21% |
| list-actors {type:npc} | 153 | same | same | same | 11,946 | 9,459 | 21% |
| list-items | 84 | id,name,type,img,folderId,folderName | id,name (plot-drift-check → get-item) | id,name,type,folder | 16,392 | 7,986 | 51% |
| list-journals | 22 / 80 pages | id,name,type,pageCount,pages[id,name,type,playerVisible] | id,name,page id/name,playerVisible (journal-builder, bestiary-builder) | id,name,pages[id,name,type?,playerVisible?] | 9,660 | 7,072 | 27% |
| list-scenes (md) | 50 | name,id,[active],W×H,grid,background | name,id (5 skills); darkness + flags wanted but ABSENT | name,id,[active],W×H,grid | 9,698 | 2,873 | 70% |
| list-folders (md) | 79 | name,id,color,sort,docs,subfolders,nesting | name,id (plot-drift-check) | name,id,docs,subfolders,nesting | 5,763 | 3,789 | 34% |
| list-macros (md) | 105 | name,id,type,author,hotbar[user slot…] | — (no skill calls it) | name,id,type,author,pinCount | 8,633 | 7,639 / 6,496 | 12% / 25% |
| list-chat-messages (md) | 50 | id,time,alias,whisper,80-char preview | id (delete), preview (chat-and-narration) | same | 6,135 | 6,135 | 0% |
| list-compendium-packs | 30 | id,label,type,system | id,type (table-builder) | id,label,type | 2,861 | 2,313 | 19% |
| get-world-info | 1 | id,title,description(758 HTML),background,system,foundry,host,users,activeUsers,automation(23 keys) | versions, users, host (start-session, session-audit, token-cutout) | id,title,system,foundry,host,users,activeUsers | 1,805 | 354 | 80% |
| get-current-scene | 7 tokens | tokens[id,name,position{x,y},size{w,h},actorId,disposition,hidden,hasImage] | id,name,active (soundscape-builder, start-session) | tokens[id,name,x,y,actorId,disposition,hidden?,size?] | 1,700 | 1,182 | 30% |
| list-users / playlists / rolltables / cards (md) | 10/10/2/0 | line per record | name,id | same | 835/690/181/21 | same | 0% |
| list-tokens/-walls/-lights/-regions/-notes | error | zod "sceneIdentifier required" | — | — | 185 ×5 | 185 ×5 | 0% |
| search-compendium | 42 | id,name,type,pack{id,label},description,hasImage,summary | id,name,pack.id (5 skills) | id,name,type,pack | 8,954 | 4,825 | 46% |
| search-compendium-spells | 50 | id,name,type,uuid,pack,packLabel,img,facets{spellLevel,spellSchool} | pack+id (stat-block-builder), uuid (physical-item-builder, table-builder), facets | id,name,pack,facets (A) / uuid,name,lvl,school (B) | 14,979 | 6,568 / 5,868 | 56% / 61% |
| search-compendium-creatures (uncapped est.) | ~493 | id,name,type,uuid,pack,packLabel,img,facets{cr,type,size,hasSpells,hasLegendary} | pack+id, facets | id,name,pack,cr,type,size,spells?,legendary? | 186,611 | 65,067 | 65% |
| list-actor-ownership (uncapped est.) | 168 × 7 users | per actor: id,name,type,defaultPermission,numericDefaultPermission, ownership[7 × {userId,userName,permission,numericPermission,source,explicitPermission,numericExplicitPermission}] | — (no skill calls it) | id,name,default,explicit{user:level}? | 227,662 | 12,240 | 95% |

`description` in `search-compendium` is `""` on 42/42 hits — the pack index carries no description
(`src/page/compendium.ts:141`), so the field is dead weight on every hit; `summary` = "type from
label" is derivable. `img` is never read from a search hit by any skill (stat-block-builder takes art
via `get-compendium-entry`/`update-actor-item img`); `packLabel` is never read; `uuid` ≡
`Compendium.<pack>.<Doc>.<id>` duplicates `pack`+`id`.

**24-call total (as a client receives it): 154,534 chars ≈ 42.9k tokens → 105,650 chars ≈ 29.3k tokens
(−32%)**; the 12 list/search bodies that actually change: 142,242 → 95,327 (−33%). The two capped
results still hit the cap in variant A, so that total understates the raw saving (see §2).

JSON-key overhead vs a line format (same fields): list-actors 168 records — today 13,210 · compact
JSON 10,467 · markdown lines 6,599 · TSV 5,927 (−55%); list-items 84 — 16,392 · 7,965 · TSV 4,769
(−71%); creatures 379 chars/hit today · TSV 98 chars/hit (a 500-hit survey: 189k → 49k).

## 2. The cap (src/index.ts:30-34, src/config.ts:40/68)

- `capResponse` slices the TEXT at 20,000 chars and appends
  `\n…[N chars omitted — response exceeded toolResponseMaxChars (20000)]` (73 chars). The marker is
  unmistakable (constant wording, the number, the config name) and the measure script greps it
  (`scripts/measure-tool-results.mjs:127`).
- Nobody parses a capped result as JSON: `grep JSON.parse scripts/ .claude/skills/**/scripts` → the
  verify/measure scripts only regex the text; `session_scribe.py` parses `chatlog.json`, a file
  `export-chat-log` writes itself (uncapped); `encounter-math.mjs` parses a file Claude assembles; the
  integration suite calls handlers directly. So the cut is never *programmatically* wrong.
- It IS model-wrong in two ways: (1) the trailing metadata — `totalFound`, `criteria`, `note` in the
  search tools (`compendium.ts:534-541`), `total`/`filtered` in list-actors — is always the part that
  is lost, so the model does not learn how much it did not see; (2) the cut lands mid-record
  (creatures: hit 53 cut inside `"img":"modules/dnd-heroes-faerun/assets/portraits/axe-beak.w`), which
  reads like a mangled record.
- **list-actor-ownership = 227,662 chars because** `getActorOwnership` (`src/page/ownership.ts:51-115`)
  emits, for EVERY world actor (168) × EVERY non-GM user (7), a 7-field row (~190 chars) even when the
  row is `inherited NONE` — 168 × (7 × 190 + 120) ≈ 228k (rebuilt: 228,748). In the 14 complete actors
  visible before the cut, 13 have no explicit entry at all. The right shape is per actor
  `{id,name,default,explicit:{<user>:<level>}}` (explicit entries only; 73 chars/actor → 12,240 for all
  168), or better only actors with an explicit entry or a non-NONE default plus a one-line count of
  the rest (≈1.5k). Verbose per-user rows stay available when `actorIdentifier`/`playerIdentifier`
  narrows the call.
- **Record-level cut** (prototype `scratch/perf-results-cap.mjs`): for an object result, find the
  largest array property, binary-search the longest prefix that fits with a
  `truncation:{kept,omitted,of,note}` stamp; for a string result cut at the last newline and append
  `…[N more line(s) omitted …]`. On the rebuilt bodies: ownership keeps 14/168 actors with the count
  preserved (today: 14 + a torn 15th and no count); creatures keeps 51/493 with `totalFound`+`note`
  intact (compact A: 147/493; TSV: 207/493). Cost: ~40 lines in `src/index.ts` + ~10 for the string
  path + a unit test — under half a day; no tool changes needed because every big result is one
  array under one key (`results`, `characters`, `items`, `journals`, `ownership`, `packs`).

## 3. list-macros (8,633 chars / 105 macros = 82 chars each)

No skill calls it (grep of `.claude/skills`: 0 hits; only `scripts/measure-tool-results.mjs`). Its
own description says "the read to run before delete-macro" and promises "icon, a command preview"
(`src/tools/macros.ts:112-114`) that the formatter never prints (`:146-153`: name, id, type, author,
hotbar). Schema is `z.object({})` — no name/user filter, so any use pulls all 105. Recommend: keep the
line format (it is already the dense one), add `nameFilter` + `user` filters, put the per-slot hotbar
detail behind `includeHotbar` (−25% → 6,496; a pin count otherwise), and either print the promised
preview or drop it from the description. Size is fine for the one read it exists for, once filtered.

## 4. search-compendium 7.8–13.2 s vs 0.5–0.6 s for the faceted tools

`src/page/compendium.ts:75-174 searchCompendium`:
- walks `game.packs` minus SRD minus Scene packs — 28 of the world's 30 visible packs, of EVERY
  document type (JournalEntry 4, Item 11, RollTable 4, Actor 6, Macro 2, Adventure 1; the JB2A and
  psfx patreon packs included — the body shows `jb2a_patreon.jb2a-actors` hits);
- `for (const pack of packs) { if (!pack.indexed) await pack.getIndex({}) … }` — SEQUENTIAL socket
  round trips (`:109-112`), one server-side LevelDB scan per un-indexed pack;
- Foundry (`resources/app/client/documents/collections/compendium-collection.mjs:276`) defines
  `indexed` as "every CONFIG index field is already in `#indexedFields`"; the constructor seeds only
  core fields from the server (`:62-67`), and dnd5e pushes
  `CONFIG.Item.compendiumIndexFields.push("system.container","system.identifier","system.source")`
  (`systems/dnd5e/dnd5e.mjs:95936`), so all 11 Item packs are un-indexed at join and each pays a full
  index fetch on the first search of every browser session. The cache is per session — each measure
  run (fresh Playwright session) pays again, which is why the second run was still 7.8 s (13.2 s cold).
- then a JS name scan over every index entry and a 50-cap.

`src/page/compendium-facets.ts:362-379 runFetch` → dnd5e `CompendiumBrowser.fetch`
(`dnd5e.mjs:39901-39947`): packs filtered to the ONE document class, `p.visible`, the browser's
source set, and `flags.dnd5e.types ∩ requested types`; `getIndex({fields})` for those packs runs
under `Promise.all` (parallel); filters evaluated on the index. Creatures: 6 Actor packs in parallel
with 5 extra fields = 627 ms; spells: the spell-bearing Item packs in parallel = 534 ms.

Where the 7.8 s goes cannot be split offline (no per-pack timing exists); the code says: the 11
Item-pack index builds in series, plus any pack a module's CONFIG push un-indexes. The fix, in order
of payoff: (1) pack allow-list by document type — a NAME lookup that feeds `get-compendium-entry` /
`create-actor-from-compendium` / `import-item` only needs Actor + Item packs (17 of 28), and the
premium-book set is already "one definition" (`src/utils/compendium-sources.ts`); (2) `Promise.all`
over `getIndex` like dnd5e does; (3) optional index warm-up in the background right after
`injectBundle` so the first search of a session is not the one that pays. A session-cached index is
what Foundry already gives (`#indexedFields`); there is nothing to add there. Offline verification:
a unit test on a fake `game.packs` asserting the pack selection and that `getIndex` calls are issued
concurrently; the wall-clock number itself needs one live run (`could_not_verify`).

## 5. Placeable list-* and `sceneIdentifier`

`src/tools/placeables/_module.ts:22-25` `sceneTarget = z.string().min(1)` is required by all 35
placeable tools' schemas — except `update-token` (`token.ts:52-56`, "Omit to use the ACTIVE scene")
and, outside the family, `configure-soundscape` (`soundscape.ts:36-42`, "Omit to target the ACTIVE
scene"). So the repo already takes both positions. A skill must pass a scene id or exact name today;
session-audit/soundscape-builder/scene-builder all do `list-scenes` → `list-tokens per scene`.

Position: the ACTIVE scene is a fact, not a guess. `game.scenes.active` is a single world-wide
document (the repo's own words: "Foundry allows exactly ONE active scene world-wide",
`scene.ts:476`); resolving an omitted `sceneIdentifier` to it is deterministic — same world state,
same answer — which is what §2.1 demands. What WOULD be a guess is `canvas.scene` (the scene the
bridge user happens to view, which depends on its landing scene / a pull) — never use that. Two
conditions: the result must echo the scene it used (`scene:{id,name,active:true}` — the placeables
list already returns `sceneId`/`sceneName`), and "no active scene" is an error, not an empty list.
Cost: make `sceneTarget` optional, resolve in `src/page/_placeables.ts` (4 call sites: 88/154/183/244)
via `game.scenes.active`, update 35 descriptions — ~20 lines + tests.

## 6. Output formats (node scratch/perf-results-formats.mjs → scratch/perf-results-formats.out)

Of 151 tools: **92 return a string** (markdown/text; 64 declared `Promise<string>`, 1 string-bodied,
27 placeable create/update/delete/teleporter/behavior/remap formatters), **51 return JSON** (29
`return {…}` bodies + 22 via `format*Response(): any` helpers that all build objects), **8 are
MIXED** — the placeable `list-*` tools return the JSON `{found, sceneId, sceneName, items[]}` on
success and the STRING `Scene not found: "…" (no tokens).` on a miss
(`src/utils/placeable-format.ts:68-71`). Inside one family the split is arbitrary: list-scenes /
-folders / -macros / -users / -playlists / -rolltables / -cards / -chat-messages are markdown;
list-actors / -items / -journals / -compendium-packs / -actor-ownership and the searches are JSON;
list-tokens & co. are JSON-or-string. It costs twice: a skill must know per tool what it will read,
and JSON lists carry 40–55% key overhead for the same fields (list-actors 13,210 vs 6,599 as lines).

Rule for 3.0 (one sentence a description can quote): **list/search results are one line per record
in a fixed, documented field order with a header line `<N> <noun>(s)` (and `of M` when cut);
single-document reads (`get-*`) are JSON with a `compact`/`fields` selector; mutations are a one-line
confirmation plus warnings; a miss is `isError`, never a prose string inside a JSON tool.** The
line format also makes the record-level cap trivial (cut at `\n`).

## 7. The first call (8.8 s on get-world-info)

`src/foundry.ts:140-158 doConnect`: `chromium.launch` → `newContext/newPage` → `wake()` (local host:
no-op) → `ensureWorldReady` → `probeJoinState` loads `/join` (`:243`) and polls until the user field
renders (the form is client-rendered after world data arrives over the socket) → `joinWorld` loads
`/join` AGAIN (`:357`), waits for the same field, fills, submits → `waitForFunction(game.ready)`
(`:410`) — Foundry's full client world load, including the canvas draw of the active 3080×2380
scene under headless SwiftShader — → `injectBundle` = `addScriptTag` of `dist/page.bundle.js`
(532,338 bytes). Avoidable: the second `/join` navigation (reuse the page the probe already has on
the form); measurable by timestamping each phase in `doConnect` (the logger is already there).
Not avoidable while the bridge is a real client: `game.ready`. Possible but needs a measurement and
breaks `screenshot-scene`: `core.noCanvas` for the bridge user. The bundle parse is on the order of
tens of ms and not worth touching.

## 8. Smaller things seen on the way

- `list-actors` filters only by `type` (`actor.ts:61-66`); no name/folder filter, so a name→id lookup
  is the whole 168-record list. `list-journals` has `filterQuests`/`includeContent` but no name
  filter (`journal.ts:90-`). `list-macros`/`list-users` take `{}`. `list-items` and `list-scenes` do
  have name filters. A `nameFilter` on the two big ones is 3 page-side lines each.
- Skill↔tool field mismatches on list-scenes: `soundscape-builder/SKILL.md:49-50` expects the
  darkness level + weather from `get-current-scene`/`list-scenes` (neither returns them:
  `scenes.ts:380-395`, `get-current-scene` body); `tom-cartos-import/SKILL.md:117-118` dedups on
  `flags["tom-cartos-import"].sourceId` "via list-scenes" (no flags in the list). Meanwhile the
  130-char background path is printed for every scene and no skill reads it from the list.
- `search-compendium-creatures` default `limit` 500 (`compendium.ts:147`) × 379 chars/hit guarantees a
  mid-JSON cut on any survey wider than ~52 hits; spells/items default to 50.
- `get-world-info` carries the 23-key dnd5e `automation` block that `configure-dnd5e-settings` (read)
  already owns, and the 758-char world-description HTML.

## 9. Housekeeping

- Only `src/tools/scene.ts` (13 schemas) and `src/tools/placeables/region.ts` (4) use `.strict()`;
  every other tool schema strips unknown keys silently (zod default), which is how
  `{"query":"goblin"}` became an unfiltered 186k-char survey instead of a 185-char refusal.
- `git status` at the end of this pass shows `scripts/verify-wake.mjs` modified in addition to
  `scripts/measure-tool-results.mjs`; this agent touched neither (only files under `scratch/`).
