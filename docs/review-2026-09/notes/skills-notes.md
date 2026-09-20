# Skills dimension — notes (2026-09-20 review)

Scope: the skills ↔ tools line (design.md §2.1, §3), the skill-description budget, the 3.0 re-point
checklist. Read-only; nothing live was called. Scripts: `scratch/skills-matrix.mjs` (matrix),
`scratch/skills-tooldesc.mjs` (tool descriptions dump), `scratch/skills-schema-overlap.mjs`,
`scratch/skills-desc-budget.mjs` + `skills-desc-check.mjs` (budget), `skills-desc-boilerplate.mjs`,
`skills-repoint-size.mjs`, `skills-nontools.mjs`. Outputs: `scratch/skills-tool-matrix.md`,
`scratch/skills-matrix.json`, `scratch/skills-tooldesc.json`.

## 1. The matrix (scratch/skills-tool-matrix.md)

- 151 registered tools (`dist/toolsets.js`). **100** are named by at least one skill (SKILL.md or a
  bundled script — the scripts add none). **51 are named by no skill** (34%): all of `drawings` (4),
  `macros` (3), 9 of 12 `assets`, 22 of 45 `scenes` (every create/update/delete of tiles, lights,
  walls, drawings; list/update/delete-sounds; place-tokens, delete-tokens, activate-scene,
  pull-users-to-scene, set-landing-scene, delete-scene), plus disconnect-bridge, list-users,
  update-user, set-user-avatar, duplicate-actor, delete-actor, create-group, manage-group-members,
  set-primary-party, list-actor-ownership, delete-item, delete-journal, delete-journal-page,
  configure-combat-tracker, update-folder, delete-folder, bulk-delete.
- The brief's "121 distinct tool names" counts looser patterns; the extra ~21 are non-tools
  (`read-aloud`, `level-up`, `set-piece` …), the removed `parse-ddb-character` (pc-builder:64), the
  artificer's `cutout-image` / `generate-image` / `edit-image` (token-cutout), and `place-tile`
  (tom-cartos-import:174 says "there's no place-tile tool"). `scratch/skills-nontools.mjs`.
- Tools per skill: stat-block-builder 22, plot-drift-check 22, scene-builder 20, pc-builder 17,
  physical-item-builder 16, tom-cartos-import 16, session-audit 13, table-builder 12, token-cutout 9,
  journal-builder 8, playlist-builder 8, soundscape-builder 8, chat-and-narration 6, session-scribe 6,
  bestiary-builder 5, cards-builder 5, start-session 3.
- Most-shared tools: get-actor 7 skills, list-journals 6, create-journal 5, list-scenes 5,
  update-actor 5, get-actor-entity 4, get-compendium-entry 4, import-item 4, list-tokens 4,
  update-journal 4, upload-asset 7 (bestiary, cards, playlist, scene, soundscape, token-cutout,
  tom-cartos).

### 3.0 re-point checklist (17 CRUD families → which skills name which tool)

| family | skills to re-point | family tools no skill names |
|---|---|---|
| tiles | scene-builder (list-tiles only, for rotateArea ids) | create/update/delete-tiles |
| lights | scene-builder (list-lights only) | create/update/delete-lights |
| sounds | playlist-builder, soundscape-builder (create-sounds, as a hand-off pointer) | list/update/delete-sounds |
| drawings | — | all four |
| walls | scene-builder (list-walls only) | create/update/delete-walls |
| tokens | plot-drift-check, session-audit, soundscape-builder, token-cutout (list-tokens; update-token ×3) | place-tokens, delete-tokens |
| notes | tom-cartos-import (create-scene-notes/update-note/delete-note), plot-drift-check (list-notes) | — |
| regions | scene-builder (all 6 + remap), tom-cartos-import (remap-teleporters) | — |
| items | physical-item-builder (create/update-item, import-item), plot-drift-check (list/get/update-item), pc-builder, stat-block-builder, table-builder (import-item) | delete-item |
| tables | table-builder (all 6), plot-drift-check (list/get/update-rolltable) | — |
| journals | bestiary-builder, journal-builder, plot-drift-check, session-audit, tom-cartos-import (create/update/list), session-scribe (update-journal), scene-builder (list-journals) | delete-journal, delete-journal-page |
| actors | pc-builder, physical-item-builder, plot-drift-check, session-audit, session-scribe, stat-block-builder, token-cutout (get/update-actor; list-actors ×2) | delete-actor |
| folders | tom-cartos-import (create-folder), plot-drift-check (list-folders) | update-folder, delete-folder |
| scenes | scene-builder, tom-cartos-import (create/update/list), plot-drift-check, session-audit, soundscape-builder (list), playlist-builder (update-scene) | delete-scene |
| playlists | playlist-builder (all 4), scene-builder + plot-drift-check (list-playlists) | — |
| cards | cards-builder (all 4) | — |
| macros | — | all three |

Effort: 185 SKILL.md lines name a CRUD-family tool (scene-builder 32, tom-cartos-import 22,
stat-block-builder 21, physical-item-builder 18, plot-drift-check 15, table-builder 15,
session-audit 12, playlist-builder 11, cards-builder 10, pc-builder 9, soundscape-builder 6,
journal-builder 5, bestiary-builder 4, token-cutout 3, session-scribe 2). By family: actors 39,
scenes 36, items 32, journals 27, tables 19, regions 17, cards 14, playlists 14, tokens 9.
(`scratch/skills-repoint-size.mjs`.) Note 6 of the 8 placeable families are touched by ≤1 skill and
only through `list-*` — consolidating them changes almost nothing skill-side; the skill-heavy
families are actors / scenes / items / journals.

## 2. Line violations (design.md §2.1 / §3)

### Skill re-derives a correctness detail that belongs in (or already lives in) a tool

1. **stat-block-builder:157-161 says `add-feature` "takes no `img`"** and prescribes a follow-up
   `update-actor-item img`. The tool accepts `img` (`src/tools/dnd5e/add-feature.ts:224-231`) and
   `_shared/authoring-policy.md:49-50` says so. Stale correctness in the skill, contradicting the
   shared policy in the same tree.
2. **session-audit:78-81 says `get-actor` "does not surface damage vulnerabilities, resistances, or
   immunities"** and tells the agent to read `get-compendium-entry` instead. `extractDefenses` has
   emitted `stats.defenses` since eeb3b88 (2026-08-14, `src/tools/dnd5e/actor-stats.ts:203-211`);
   the skill was last edited 2026-09-15. Stale workaround — an extra compendium read per monster.
3. **session-audit:76-78 — `get-actor` returns 0 for a PC's max HP** (real: `extractActorStats`
   reads `hp.max ?? 0` from the SOURCE system, `actor-stats.ts:136-141`; a dnd5e character's source
   `hp.max` is null, the value is derived). The skill papers over it by reading
   `party-snapshots/*.md` from the campaign repo — a tool correctness gap closed on the skill side,
   with a campaign-specific fallback. The skill itself says "propose extending get-actor" (:81).
4. **scene-builder:82-146 (65 lines) — the sidecar import.** The skill instructs passing the
   sidecar's `walls`/`lights` arrays INLINE (:104) and then spends :107-134 (28 lines) warning that
   a hand-built remap drops `sight` / light `config` (the 2026-06-28 Tom Cartos lesson). `create-scene`
   already reads a `{walls,lights,regions}` JSON file server-side via `placeablesPath`
   (`src/tools/scene.ts:295-303, 550-565`) — exactly a Dungeon-Alchemist/Foundry-export sidecar's
   shape — and the arrays never transit the agent. scene-builder never mentions `placeablesPath`
   (0 hits). The hazard the skill lectures about is one the tool already removed.
5. **set-actor-art leaves the inherited prototype config** (`src/page/assets.ts:131-185` writes only
   `img` + `prototypeToken.texture.src`). Two skills re-derive the same 3-param fix-up after every
   art swap: token-cutout:38-45 and `_shared/authoring-policy.md:75-81` (`update-actor` `tokenScale:1`,
   `tokenRing:false`, `tokenAutoRotate:true`), plus the placed-token follow-up (token-cutout:46-48,
   policy:82-84). The create tools already bake these (policy:72-74); set-actor-art should too.
6. **pc-builder:226-236 — the default PC portrait rule.** The skill calls it "DETERMINISTIC: the
   PC's class → that class's PHB pregen art … a fixed 1:1 mapping, not a judgment call" and then
   re-derives the path `modules/dnd-players-handbook/assets/journal-art/<class>.webp` and the pregen
   id pattern `phbprg<Class>0000`, with a 3-call confirmation dance. No tool owns it (0 hits for
   `journal-art`/`phbprg` in src/). By the skill's own words this belongs in `create-pc`.
7. **The always-prepared house rule (`system.prepared: 2`)** is a field-path + magic value re-derived
   in `_shared/authoring-policy.md:127-133` and pc-builder:196-199 as a per-spell
   `update-actor-item` patch. The rule (which classes) is judgment; the mechanism is a tool param
   (`create-pc` / `level-up-pc` `spells.alwaysPrepared`) — `free-cast.ts:175-176, 250` already does
   the write for its own case.
8. **tom-cartos-import:117-120 dedups on `flags["tom-cartos-import"].sourceId` "via `list-scenes`"** —
   `listScenes` returns no `flags` (`src/page/scenes.ts:380-395`; captured body
   `scratch/bodies-2026-09-20/list-scenes.txt`). The step cannot work as written; the provenance
   stamp is also hand-passed by the skill at :212 and :184 while :317 says the tool stamps it. The
   scope name `tom-cartos-import` is hard-coded page-side (`src/page/scenes.ts:280`) — a skill's
   name inside a tool.
9. **soundscape-builder:50-51 reads "the darkness level" from `get-current-scene` / `list-scenes`** —
   neither returns darkness (`scenes.ts:380-395`; `src/tools/scene.ts:834-840`). Only
   `configure-soundscape list`'s idle line carries it (:229).
10. **tom-cartos-import:287-289 — pin pixel math** `x = sceneX + (col + 0.5) * size` done by the
    skill; `create-scene-notes` has no cell/col/row input (`skills-schema-overlap.mjs`: absent). The
    padding-offset arithmetic is correctness.
11. **Grammar/enum duplication.** stat-block-builder:200-322 (123 lines: manage-effect rules keys,
    Filter operators, expiry values, manage-activity template/behaviors/teleport/transform enums),
    scene-builder:44-71 (28 lines: region behavior enums, terrainTypes), physical-item-builder:66-87,
    108-130, 145-155 (56 lines: rules recipes, the cast-activity param block, the itemType table).
    `skills-schema-overlap.mjs` shows the tool schemas ALREADY carry 29/31, 21/21, 19/19, 16/16,
    10/10, 11/11 of the tokens — this is the same correctness detail in two places, and it drifts
    (items 1–2 above are the drift). Only two tokens the skill spells out are missing from the
    schema: `roll.attack.mode`, `roll.attack.classification` (manage-effect) and the
    `skills:acr…`/wildcard vocabulary (create-pc, 5/10 absent).
12. **House-style HTML re-derived in three places.** The `.mcp-journal` wrapper/`lead`/`readaloud`
    layout is what `create-quest-journal`/`update-quest-journal` blocks render; session-scribe:246-253
    hand-writes it into `update-journal` raw HTML, and `bestiary-entry.mjs:184-189` hand-builds
    `<section class="mcp-journal"><div class="wrap">`.
13. **bestiary-builder runs its own bridge session** (`bestiary-entry.mjs:37, 74-81`) because two
    reads/writes "sit outside the tool surface" (SKILL.md:20-24: reading a compendium journal page,
    entry-level journal ownership). design.md §3: "the answer is usually a new or extended tool, not
    a skill workaround". The script also hand-parses `.env`, passes `magicUrl` (not a `FoundryConfig`
    field any more — `src/foundry.ts:62-95` takes `host`), so it cannot wake a sleeping Molten box,
    ignores `FOUNDRY_HOST` (a `local`/`generic` user gets `serverUrl: undefined`), and defaults the
    user to `'DM Assistant'` (:77) while the hosts default is `MCP-Claude`. `scripts/lib/bridge-config.mjs`
    is the host-aware config every other script uses.
14. **Pack ids in skills:** stat-block-builder:147 (`dnd-players-handbook.origins` as a
    `compendiumPacks` override — the origins pack is not in `add-feature`'s default set, so racial
    features need a pack id the skill must know); pc-builder:159,161 (literal `Compendium.…` uuids in
    the example — fine as examples); physical-item-builder:110 (uuid format); table-builder:114
    (`dnd-dungeon-masters-guide.tables`). design.md §2.3 wants the premium set in ONE definition.
15. **Result-shape inconsistency the skills gloss over:** `search-compendium` returns
    `pack: {id,label}` while `search-compendium-*` return `pack: "<id>"` + `packLabel`
    (`scratch/bodies-2026-09-20/search-compendium.txt` vs `…-creatures.txt`). Skills say "feed the
    hit's `pack` + `id`" for both (stat-block-builder:34-37, physical-item-builder:33-34,
    pc-builder:233-235).

### The reverse — judgment / doctrine inside tool descriptions

- `author-npc` (1,193 chars): "the LAST-RESORT path in the §6 ladder … Prefer
  create-actor-from-compendium … tell the user and ask before authoring rather than inventing" — the
  NPC doctrine (skill judgment) restated; a tool telling the agent to ask the user.
- `create-actor-from-compendium`: "the DEFAULT, preferred path … PREFAB-AS-BASE (the §6 step-2
  bridge)"; `create-pc-from-prefab`: "design.md §2.3 … the §6/§7 analog" — design-doc section
  numbers in descriptions every eager client loads.
- `import-item` (1,041): a 3-step WORKFLOW with pack ids (`dnd-players-handbook.equipment`,
  `dnd-dungeon-masters-guide.equipment`) and "PREFER THIS over add-item" — and it points at
  `search-compendium`, not the faceted `search-compendium-items` the skills call the default.
- `place-tokens`: "so the house token defaults — auto-rotate, ring, disposition — carry over";
  `duplicate-actor`: "THE sandbox path: clone PCs as "(Sim)" copies" — an owner workflow;
  `set-landing-scene`: "the house module fvtt-mod-openserver"; `create-quest-journal`: "the house
  style". 48 of 151 descriptions carry a judgment word (`skills-tooldesc.mjs`); most "never"s are
  correctness by construction (SRD refusal) and fine.
- Tool descriptions total 68,428 chars; the `add-item` description alone (1,972) restates the
  itemType table that physical-item-builder:145-155 also carries.

## 3. What skills need from list-* / search-* (to size the compact projection)

| tool | today returns | fields a skill filters on / passes onward | skills |
|---|---|---|---|
| search-compendium-creatures/-spells/-items | `{id,name,type,uuid,pack,packLabel,img,facets{…}}` per hit (20k chars uncapped for the MM) | `pack`+`id` → create-actor-from-compendium / import-item / get-compendium-entry; `uuid` → rolltable results, cast `spellUuid`, `@UUID` links; `img` (copy an icon); `facets.challengeRating/creatureType`, `facets.rarity/itemType/magical`, `spellLevel/school/damageType` to choose | stat-block, physical-item, pc, table, journal(uuid) |
| search-compendium | `{id,name,type,pack{id,label},description,hasImage,summary}` | `pack.id`+`id`; `name`; `type` (pregen lookup by `packType: "Actor"`) | pc-builder, physical-item, stat-block, table |
| get-compendium-entry | full entry | `imageUrl` (pc-builder :235), `itemId`; session-audit uses `compact:true` for defenses (now redundant) | pc, physical-item, stat-block, table, session-audit |
| list-scenes | text: id, name, size, grid, background, counts, navigation | `id`/`name` (→ list-tokens, sceneIdentifier); tom-cartos NEEDS `flags.tom-cartos-import.sourceId` (absent); soundscape NEEDS `darkness`, `weather`, `active` (absent) | scene, tom-cartos, plot-drift, session-audit, soundscape |
| get-current-scene | JSON: id, name, active, dims, tokens[] (id,name,pos,size,actorId,disposition,hidden), tokenSummary | `id`; soundscape NEEDS `darkness` (absent) | soundscape |
| list-tokens | per-scene: token id, name, actorId, linked?, disposition | `id` (→ get-actor/update-token), `name`, `actorId`, linkage (session-audit :226 "check linkage first") | session-audit, plot-drift, token-cutout, soundscape |
| list-journals | JSON: id, name, pageCount, pages[{id,name,type,playerVisible}] | journal `id`, page `id` (→ pageId), page `name`, `playerVisible` (leak check, bestiary order check) | journal, bestiary, plot-drift, scene, session-audit, tom-cartos |
| search-journals | hits with doc/page + snippet | doc `id`, page `id`/`name`, snippet, visibility | plot-drift, scene |
| list-actors | JSON: id, name, type, hasImage (13k chars for 100+ actors) | `id`, `name`, `type`; token-cutout wants `folder` to tell same-named actors apart (absent → it uses export-actor :34-35) | plot-drift, token-cutout |
| list-items | JSON: id, name, type, img, folderId, folderName | `id`, `name`, `folderName` (loot folders) | plot-drift |
| list-rolltables / get-rolltable | text: id, name, formula, count / results with resultId, range, raw text | `id`; `resultId`/`roll`, raw `text` (must be copied verbatim for editResults) | table, plot-drift |
| list-playlists | text: id, name, mode, track count, [playing] | `name`/`id` (scene link), `mode`, `playing` | playlist, scene, plot-drift |
| list-folders | text tree: name, id, color, sort, doc counts | names (drift sweep), `id` for move-documents | plot-drift, tom-cartos |
| list-notes | per-scene notes | `label`, note `id` | plot-drift, tom-cartos |
| list-assets | paths | path strings only | scene, soundscape, playlist |
| list-compendium-packs | JSON: id, label, type, system | `id` filtered by `type: "RollTable"` | table |
| list-regions / -tiles / -walls / -lights | ids + names | `id` lists for rotateArea; regions: name/id; **cannot read `choice`** (scene-builder :36) | scene |
| list-chat-messages | text: id, ts, speaker, content | `id`, timestamp (`contentMode:"none"` for pruning) | chat |
| list-cards | text | id, name, type, count | cards |

Compact projection that covers every skill use: search hits → `{id, name, uuid, pack, img,
facets}` (drop `type`, `packLabel`, and pack labels; make `pack` a string on all four search tools);
`list-scenes` → add `darkness`, `weather`, `flags[scope]` (or a `flagScope` filter) and keep
id/name/active/dims; `list-actors` → add `folder`; `list-tokens` → keep id/name/actorId/linked.
Nothing a skill does needs `description`, `summary`, `hasImage`, `packLabel`, per-scene wall/light
counts or `navigation` — those are the bulk of the 154k-char read cost the brief measured.

## 4. The description budget

Descriptions today: 15,382 chars ≈ 4.27k tokens, in every prompt. What a description is FOR: the
trigger — Claude Code matches the user's words against it to decide whether to load the body. What
does NOT belong: the tool composition list ("Composes create-pc / inspect-pc-advancement / …"), the
§2.1 ownership boilerplate ("The tools own correctness (field paths, …); this skill owns the parse,
…"), the mechanism ("advancement runs so @scale resolves NATIVELY"), the refusal script, the
step-by-step of what the skill will do. Measured (`skills-desc-boilerplate.mjs`): the "Composes …"
sentences total 1,818 chars and the ownership boilerplate 2,157 → **3,975 chars (26%) of the budget
has zero triggering value** (journal-builder 46%, stat-block-builder 43%, physical-item-builder 39%,
table-builder 34%). Every one of those is already the first paragraph of the body.

Replacements for the six largest (`scratch/skills-desc-budget.mjs`, all 40 quoted trigger phrases
preserved — `skills-desc-check.mjs`):

| skill | before | after | ratio |
|---|---|---|---|
| pc-builder | 1,317 | 596 | 0.45 |
| session-audit | 1,153 | 604 | 0.52 |
| tom-cartos-import | 1,057 | 460 | 0.44 |
| physical-item-builder | 1,036 | 508 | 0.49 |
| playlist-builder | 1,011 | 544 | 0.54 |
| stat-block-builder | 992 | 454 | 0.46 |
| six | 6,566 | 3,166 | 0.482 |

Six replaced only: 15,382 → 11,982 chars (−22%, ≈3.33k tokens). Same ratio across all 17: **7,417
chars ≈ 2.06k tokens** (−52%). The texts are in `scratch/skills-desc-budget.mjs` (the `NEW` map).
Two further trims worth making in the same pass: cards-builder's description carries "Creation only
— dealing / drawing / shuffling in play is a later phase" (Phase-2 promise, see §6); pc-builder's
description carries the DDB refusal *explanation* — the trigger only needs the phrases.

## 5. Campaign / owner assumptions

| skill | what | lines | verdict |
|---|---|---|---|
| session-scribe | campaign repo `fvtt-campaign-greenrest` (:61), `sessions/YYYY-MM-DD/`, `party-snapshots/`, PC names (Morgash, Gren, Jetten, Thomas, Salyth, Lae'zel, Selma), 19 owner directives / feedback notes, the Edge PDF path (:109), `Desktop\<Campaign> Session N` (:114), "Session Diary" in "Adventure Log", the Craig contract; 103 lines (:141-243) of owner-locked recap/combat-log house style | 40 owner/campaign hits | **configuration + move out**: the pipeline (script + templates) is generic; the house style and the repo layout are one campaign's and belong in a per-campaign style file the skill reads (`<campaign-repo>/STYLE.md` or a `campaign.json`), with a short generic default in the skill. Windows-only (setup.ps1 winget, msedge.exe) — say so. |
| session-audit | `plot/`, `sessions/*/recap.md`, `gm-notes.md`, `party-snapshots/*.md` (:59, :77, :156); "Morgash takes the maul, Gren the pearl" (:45); `encounter-math.mjs:36` example `"Morgash"`; "ultracode" harness feature (:31-41); owner rule 2026-08-14 (:222) | 4 + script | **configuration** (the campaign-repo layout is an input: a `--campaign <dir>` convention or a `campaign.json` naming plot/sessions/snapshots dirs); the PC names are examples (rename to generic); ultracode = harness-specific, drop or soften. |
| plot-drift-check | "a campaign pointer memory names it … its `plot/` directory" (:27-31) | 1 | **configuration**: same campaign-repo convention; keep "ask for a path" as the default. |
| bestiary-builder | `sessions/<date>/recap.md` (:38); script hard-codes MOLTEN_* env, `'DM Assistant'` (:75-80); "Adventure Log"/"Bestiary" defaults (fine, overridable flags) | 1 + script | **fix the script** (host seam) — high; recap path = example. |
| start-session | "Molten-hosted" (:16), `MOLTEN_MAGIC_URL/ADMIN_KEY/WORLD_ID` (:24-25, :73), "EC2 box" (:27), `mcp__foundry-molten5e__get-world-info` / `get-current-scene` (:40, :58 — the owner's registration name), `MCP-Claude` (:45), LIVE-GAME owner directive (:89-99) | 8 | **move out / generalize**: name the bare tool, describe the wake in host terms ("if the host sleeps, the bridge wakes it"), point at `FOUNDRY_HOST` docs; the live-game rule is generic advice, keep without the owner stamp. |
| soundscape-builder | "house module fvtt-mod-soundscape (#6)" (desc :4, :18), sandbox 404 trap about the prod→local mirror (:307-321), `scripts/remap-soundscape-scene-paths.mjs` (:342) | 3 | **example**: the module is a sibling dependency (name it, drop "#6"/"house"); the mirror trap is owner-ops, move to docs/LOCAL. |
| tom-cartos-import | "OWNER DEFAULT — MAPS ONLY" block with Greenrest/Ostenwold and the `fvtt-mod-autoexplore` flag (:35-44); "Molten's hosting blocks…" (:24), "Molten cold-start ~25 s" (:65) | 5 | **configuration**: the maps-only default and the autoexplore stamp are per-user import preferences (ask, or a config); Molten lines → host-neutral. |
| token-cutout | artificer hand-off (fine); house rules via `_shared` rule 10 | 1 | keep; artificer is a named sibling dependency. |
| chat-and-narration | `embed: "webdav"` (:53, :58 — the tool's canonical value is `upload`, `webdav` an alias, `src/tools/chat.ts:40-43`), `MOLTEN_WEBDAV_PASSWORD` (:83), "Long chat logs are a known Molten performance drag" (:90) | 4 | **generalize**: use `upload`, "the host's file plane isn't configured", drop the Molten aside. |
| _shared/authoring-policy | 14 numbered rules, 3 owner-stamped (rules 10, 13, 14) | — | keep as the house policy but label the owner-specific table rules (13, 14) as defaults a user may override. |

## 6. Phase-2 language and orphan check

Hits in `.claude/skills` (grep in the notes header pattern): journal-builder :18, :48, :87, :140-148
("§8 landing zone", "design.md §8: later, automated session output (chat + Craig/Whisper …)" — a
whole section framed as Phase-2 plumbing, and already superseded: session-scribe writes the Session
Diary with `update-journal`, not through these blocks); cards-builder :10-11 (in the DESCRIPTION)
and :89-92 ("a later, in-play phase"); playlist-builder :113-117 ("a later, in-play phase");
`_shared/authoring-policy.md:33-34` ("a future phase"); stat-block-builder :66-67 ("the future
PC-actor builder — see project notes" — pc-builder exists). None mention wait-for-events /
session-assist / NUC / companion module. Rewrite each "later phase" as "out of scope" (3.0 is
terminal) and drop the §8 references.

Orphan check: session-scribe composes export-chat-log, get-combat-stats, export-actor, get-actor,
update-journal, level-up-pc — all shipped, none Phase-2-gated; chat-and-narration composes the six
`chat`-toolset tools. Neither references the event bridge. Both stay as plain features. Confirmed.

## 7. Hand-offs

- scene-builder ↔ playlist-builder / journal-builder: explicit in both directions by NAME
  (scene-builder :22-25, :186-190; playlist-builder :106-111). Contract = "build it there, then set
  `playlist`/`journal` to the name; the tool resolves and errors on ambiguity". Adequate.
- scene-builder → soundscape-builder: **absent** (0 mentions of soundscape in scene-builder).
  playlist-builder and soundscape-builder each route the other (playlist :28-34; soundscape :30-41),
  but a scene built from a map is never offered a soundscape — the entry point for "make this scene
  sound alive" is only the soundscape trigger phrases.
- token-cutout ↔ artificer `cutout-image`: token-cutout :15-23 says what to call and to read the
  `*_preview.png`; the artificer writes `<source>-cut.png` (or `output`) and returns coverage
  (`../fvtt-mcp-artificer/src/tools/cutout.ts:59-75`). The returned path being the upload input is
  implied, not stated; the artificer's skill still calls this repo "molten5e"
  (`illustration-builder/SKILL.md:25, :244`) — a rename break in a sibling. Contract is prose on both
  sides, no shared interface doc.
- session-scribe → bestiary-builder (:255-257) and → physical-item-builder / level-up-pc (:261-262):
  named, one line each, adequate.
- tom-cartos-import → start-session (:33, :64) and → journal-builder conventions (:186, :293): named.
- `set-landing-scene` → `fvtt-mod-openserver`, soundscape → `fvtt-mod-soundscape`, tom-cartos →
  `fvtt-mod-autoexplore` flag: three house-module contracts, each stated only in a skill or a tool
  description, none in a sibling-contract doc.

## Measurements summary

- descriptions 15,382 chars (matches the brief) · bodies 212,946 chars (front matter excluded)
- tools 151 · named by skills 100 · unnamed 51 · non-registered names referenced 5
- CRUD-family lines in SKILL.md 185
- description boilerplate 3,975 chars (26%)
- six replacements 6,566 → 3,166 (0.482); projected all-17 7,417
- tool descriptions 68,428 chars; 48 carry a judgment word
- Phase-2 hits in skills: 10 lines across 5 files; owner/campaign hits: 40 in session-scribe, 14 elsewhere
