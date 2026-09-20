# 2.1 — tools for the dnd5e 6.x features · plan & tracker

> Checkbox-driven tracker, aligned to [`design.md`](../design.md). 2.0 made every existing tool
> speak dnd5e 6.x natively ([`dnd5e-6.0-compat-review.md`](dnd5e-6.0-compat-review.md)); 2.1 adds
> the tools for what 6.0 **introduced**. Ground truth for every shape below: the 6.0.1 source tree
> (`data/active-effect/*`, `data/activity/*`, `data/region-behavior/*`, `config.mjs`,
> `settings.mjs`) and the system wiki pages *Filters*, *Active-Effect-Rules*, *Activity-Behaviors*,
> *Activity-Type-Teleport*, *Activity-Type-Transform*, *Calendar* (all stamped "up to date as of
> 6.0.0"). Nothing here is inferred from memory.

## Framing (binding)

- **Compendium-first still holds.** A creature or spell copied from the MM/PHB/DMG carries its 6.0
  effects, conditions, behaviors and activities with it — no tool needed. These tools exist for
  (a) the **authored** path (a custom monster feature, a homebrew item), (b) **DM-side placement**
  (an area on the map that applies an effect), and (c) **reading** — a skill can only reason about
  a rules-type effect if `get-actor` shows it.
- **Skills decide, tools do.** Every row below is a tool-contract change *plus* a knowledge
  section in the owning skill (`stat-block-builder`, `physical-item-builder`, `scene-builder`).
  The tool validates shapes; the skill knows when "advantage on saves while Bloodied" is the right
  model for a trait.
- **Never SRD — resolved.** 6.0 ships a stock Active Effect compendium, `dnd5e.effects` (the
  conditions and common buffs as standalone effects, referenced by the new region/activity
  behaviors). design.md §2.3 bars every `dnd5e.*` pack as a *content* source; this pack holds
  mechanics, not book content. **Owner decision 2026-09-15: allowed as a mechanical source, by
  default** — recorded as the §2.3 amendment. Effect resolution accepts a `dnd5e.effects` entry, an
  effect authored with `manage-effect` (on a world item), or an effect carried by a premium-pack
  spell/item, all by name or uuid.

## Feature inventory → work

Sizes are single-session estimates for tool + unit tests + skill section; live proof is separate
(see *Verification*).

| # | 6.0 feature | Persisted shape (6.0.1) | Tool change | Skill | Size |
|---|---|---|---|---|---|
| 1 | **Effect conditions** (effect applies only when…) | `effect.system.conditions` — a Filter JSON: `{k, o?, v}` or `{o: AND\|OR\|NOT\|…, v: [...]}`; keys are roll-data paths (`statuses.bloodied`, `item.type.value`, `item.properties`…); comparisons `exact` (default) `in has hasany hasall contains gt gte lt lte …` | `manage-effect`: `conditions` (object or JSON string) on create/edit; page validates operators against the Filter vocabulary and round-trips through `JSON.stringify`; `get-actor` effects show `conditions` | stat-block-builder: "conditional traits" section with the Bloodied / weapon-type examples | 1 h |
| 2 | **Per-change conditions + replacement** | `system.changes[].conditions` (same Filter JSON; `roll.*` keys only valid here), `changes[].replacement` ∈ `origin` \| `target` (#3809 — substitute the source's/target's data into the value) | `manage-effect` `changes[]` gains `conditions?`, `replacement?`; `effect-changes.ts` normalizes + validates | same | 30 min |
| 3 | **Rules-type changes** (roll-time modifiers) | change `type` ∈ `dnd5e.advantage` \| `dnd5e.bonus` \| `dnd5e.maximum` \| `dnd5e.minimum`; `key` ∈ `attack` `check` `d20` `save` (all four) / `damage` `healing` (bonus only); advantage values `+1 -1 =+1 =-1 >=0 <=0`; bonus = number, dice, `@prof`, `1d4[fire]`; min/max = deterministic formula | `manage-effect`: accept the four types, validate key×type combos and the advantage vocabulary; `summarizeChanges` renders them readably ("advantage on d20 rolls when roll.ability = str") | stat-block-builder + physical-item-builder: the wiki's worked examples (ranged min 10, thrown +1d4, fire +@prof, STR disadvantage, History/Medicine +1d4) as the authoring recipes | 1.5 h |
| 4 | **Expiry events** | `duration.expiry` — core `combatStart roundStart turnStart combatEnd roundEnd turnEnd`, dnd5e `shortRest longRest`, pseudo `sourceStart sourceEnd targetStart targetEnd`; activities: `duration.expiry` too (#7267), and applied effects inherit the activity duration (#2667) | `manage-effect` (already accepts `duration.expiry` since 2.0 — add the enum), `manage-activity` `duration.expiry` | chat-and-narration / stat-block-builder: "until the end of the target's next turn" ⇒ `targetEnd` | 30 min |
| 5 | **Region-attached effects** | region behavior `dnd5e.applyActiveEffect` `{effects: Set<AE uuid>, dispositions: Set<number>, sizes: Set<size>, types: Set<creatureType>}`; also new `dnd5e.rotateArea` | `add-region-behavior` already passes any registered type + `system` through — **verify live**, then add effect resolution by NAME (stock `dnd5e.effects` entry, a world item's effect, or a premium-pack spell's effect) so a skill can say `effects: ["Poisoned"]` | scene-builder: "areas that do something" (lava, poison cloud, consecrated ground) | 1 h |
| 6 | **Activity AoE behaviors** | `activity.behaviors[] {_id, type: applyActiveEffect \| difficultTerrain, name, level:{min,max}, config}` — applyActiveEffect config `{effects, sizes, types}`, difficultTerrain config `{types}`; respects the activity's target (allies/enemies) | `manage-activity`: `behaviors[]` on add/edit (any activity with an area template) | stat-block-builder / physical-item-builder: "Web", "Grease", "Spike Growth"-style authored areas | 1 h |
| 7 | **Teleport activity** | `type: "teleport"`, `teleport: {value (formula), units, override}`; distance defaults to the activity's range | `manage-activity` `type: 'teleport'` builder (activation/range/target as the other builders) | stat-block-builder: Misty Step-style traits | 45 min |
| 8 | **Multiple rarities** ("Rarity Varies") | `system.rarities` (Set) | `add-item` / `update-actor-item`: `rarity` accepts a string **or array**; write `rarities` natively (2.0 still writes the shimmed `rarity`) | physical-item-builder: one line | 20 min |
| 9 | **Reading it all back** | as above + effect `type` (`base` \| `condition` \| `enchantment`), `system.magical`, `system.rider.statuses` | `get-actor` / `get-actor-entity`: effect `type`, `magical`, `conditions` (present/JSON), rules changes in the readable form; `content-audit`: flag a rules change whose key×type combo is invalid | session-audit / plot-drift read them | 45 min |
| 10 | **System automation settings** (all new in 6.0) | `dnd5e` settings `disableFalling`, `tokenSizeSync`, `senseVisionSync`, `disableExhaustion`, `initiativeGroupCombatants`, `initiativeGroupRoll`, `autoApplyDowned`, `allowPlayerDamageTray`, `allowPlayerEffectsTray`, `chatCardSummary` (client — read-only), `encounterPlacementBehavior`, `bastionConfiguration.{enabled,duration}`, `calendarConfig.{enabled,dailyRecovery}`, `calendar` | new **`configure-dnd5e-settings`** (GM-only, allow-listed keys, read + set, reports current values) — and `get-world-info` gains an `automation` block | start-session reports them; session-audit can warn ("falling automation is on but this scene has no Levels") | 1.5 h |
| 11 | **PC builder: Modify Item advancement** | new advancement type `ModifyItem` (uses Enchantments to alter an existing item, #6335) | `planAdvancementApply` currently returns "no player pick" for unknown types — confirm it is applied as a forced step (`initial`), find a PHB item that uses it, add it to `verify-pc-build` | pc-builder: none | 1 h |
| 12 | **Transform "Select Form" mode** | Transform activity `profiles` with mode `select` — forms defined by the item's own active effects (lycanthropes, Disguise Self) | `manage-activity` `type: 'transform'` builder — the largest new surface (profiles, settings, form effects) | stat-block-builder: shapeshifters | 2–3 h — **2.1.1 (owner, 2026-09-15)** |
| 13 | **Calendar** (dawn/dusk/day recovery, bastion turns, set date, advance time) | `game.time` + dnd5e calendar settings (`dnd5e.calendar` config, four built-in calendars); recovery is automatic once the calendar is enabled | **`manage-calendar`** (read the current date/time · advance time · set the date; GM-only) plus the enable switch via #10 — session-flavoured, but pulled in by the owner so the 6.0 surface ships whole | start-session reports the date; session-scribe stamps it | 1 h — **2.1.1 (owner, 2026-09-15)** |
| 14 | Falling, senses→token vision, size→token size, bloodied via AE, piety, actor identifiers, group effects tab, welcome dialog, adventure importer | runtime automation or sheet UX | **no tool** — #10 exposes the switches; nothing to author | — | 0 |

## Milestones

- [x] **2.1.0 — effects & areas** (#1 #2 #3 #4 #5 #6 #8 #9) — **shipped 2026-09-15** (`v2.1.0`). The release
  that lets an authored monster or item express what a 2024 book entry can.
- [x] **2.1.1 — teleport, settings, ModifyItem, transform, calendar** (#7 #10 #11 #12 #13) — built 2026-09-15.
  (Owner 2026-09-15: #12 and #13 pulled forward; the former "2.2" milestone is empty.)

### Progress

- [x] #1 #2 #3 #4 #9 — **effects** (2026-09-15): `manage-effect` conditions (effect + change Filter JSON),
  the four rules types with key × type × value validation, `replacement`, `magical`, the 12-event
  `duration.expiry` enum (core / rest / source-target); `manage-activity` `duration` override with
  expiry; `get-actor` / `manage-effect list` read back type · magical · parsed conditions · readable
  rules; `content-audit` `dead-rules-change` (rule 0). Pure layer `effect-changes.ts` (+44 tests);
  vocabularies in `utils/dnd5e-canonical.ts`. Live: `scripts/verify-effects-6.mjs` **47/47** on the
  sandbox — a ranged-only `+1d4` lands in the longbow's `rollAttack` (`1d20min10 + 2 + 2 + 1d4`), a
  melee-only advantage flips the shortsword's mode (`2d20advmin10 …`), `1d4[fire]` lands in
  `rollDamage`, the conditional +2 AC toggles with HP.
- [x] #5 #6 — **areas** (2026-09-15): `add-region-behavior` `effects` / `dispositions` / `sizes` /
  `creatureTypes` (dnd5e.applyActiveEffect) + `terrainTypes` / `magical` (dnd5e.difficultTerrain);
  `manage-activity` `template` / `affects` / `behaviors[]` (applyActiveEffect · difficultTerrain).
  Effect refs resolve by NAME from the stock `dnd5e.effects` pack (the §2.3 amendment, now encoded in
  `compendium-sources.ts` as the one exempt `dnd5e.*` pack), a world item (`"Item#Effect"`), or a
  uuid — never an actor's effect (`src/page/dnd5e/effect-refs.ts`). Live:
  `scripts/verify-region-effects.mjs` **26/26** — a token entering the pool gets "Poisoned" (origin =
  the behavior), leaving removes it; an authored Web's behaviors persist with their config and
  `createBehaviorData` yields the region behavior.
- [x] #8 — **rarities** (2026-09-15): `add-item` `rarity` takes a string or a LIST; `buildPhysicalItemData`
  writes `system.rarities` natively (no more shimmed `rarity`); `update-actor-item` maps a
  `system.rarity` / `system.rarities` patch onto the Set. `verify-item-tooling.mjs` 13/13.

- [x] #7 #12 — **teleport + transform** (2026-09-15): `manage-activity` `type: "teleport"`
  (`teleportDistance`, self-targeted by default, `affects` widens) and `type: "transform"` in all three
  modes — `cr` (profiles with cr / sizes / creatureTypes / restrictMovement / level + a preset), `direct`
  (profile `actor` by MM name — the MM wins a tie with the DMG's copies — or uuid, SRD refused) and
  `form` (Select Form: `forms` = the item's own effect names → `effects[]` ids, `formless`). Live:
  `scripts/verify-activities-6.mjs` **25/25**. Skill: stat-block-builder Step 7 (teleport, shapeshifters).
- [x] #11 — **ModifyItem** (2026-09-15): confirmed against the 6.0.1 source — `ModifyItemAdvancement#apply`
  takes no player data and ignores `initial`, so the engine's forced `apply({initial:true})` step (the
  same one ItemGrant / ScaleValue get) applies it; `summarizeChoice` reports no pick. Unit-tested in
  `advancement.test.ts`. No premium book on disk carries one yet (the books are 5.x builds), so the live
  case is a fixture in `verify-pc-build.mjs` (Test L: a feat with a ModifyItem change enchanting the
  `fighter` class item, applied with the engine's exact call) — **66/66**.

- [x] #10 #13 — **settings + calendar** (2026-09-15): new **`configure-dnd5e-settings`** (allow-list in
  `utils/dnd5e-settings.ts` — 15 settable keys incl. the bastion / calendar DataModel fields, written
  whole; `chatCardSummary` reported only, client-scoped; old → new + `reloadRequired`) and new
  **`manage-calendar`** (read in display terms with localized month names; advance by rounds / minutes /
  hours / days; set by month name or number + day + time of day); `get-world-info` carries `automation`
  (switches + `calendarNow`). Live: `scripts/verify-settings-calendar.mjs` **35/35** (restores every
  switch and the worldTime). Skills: start-session reports them; session-audit judges them. Tool
  count 149 → **151**.
- [x] **the last two shapes** (owner 2026-09-15, "wrap up the shapes"): `add-region-behavior` `rotate`
  for `dnd5e.rotateArea` (stop angles, the placeables that turn, direction / time; ids validated on
  the scene; `verify-region-effects` turns a tile to 90° — **30/30**) and `manage-activity`
  `transformSettings` (keep / merge / effects / minimumAC / tempFormula / spellLists / transformTokens
  → `transform.customize` + `settings`; `verify-activities-6` **27/27**). Nothing in the 6.0
  inventory is pass-through any more.
- [x] **2.1.1 shipped 2026-09-15** (`v2.1.1`; `v2.1.2` the same evening = 2.1.1 + the duration-less expiry read-back fix found by the MCP smoke). Regression on the sandbox: live integration 84 passed /
  2 skipped, effects 47/47, region effects 30/30, activities 27/27, settings + calendar 35/35, items
  13/13, actor 29/29, cast 25/25, region 22/22 (×3 after the kernel order fix), dnd5e-writes 16/16,
  content-audit 8/8, pc-build 66/66, reads 25/25, spellcasting 32/32, free-cast 28/28, placeables
  34/34 (×2), placeables library 43/43, scene tools 10/10, update-token 11/11. RELEASE.md step 3
  done over MCP after the CC restart (sandbox): `configure-dnd5e-settings` read, `manage-calendar`
  read, `get-world-info` automation block, and a `manage-effect` create → list round trip of a
  conditional rules effect on a tagged Scout (deleted after). **Maintenance mode resumes** (owner):
  bug fixes + small dogfood gaps only; Phase 2 stays shelved unless asked.

- [x] **2.1.3 — the review fixes (2026-09-15)**: an owner-requested review of the 2.0/2.1 line
  (11 static lenses + a second independent source-vs-code audit) confirmed six P1s and found four
  more; all landed. **Second-call / edit / combination bugs:** `apply-condition` changing an
  existing exhaustion level threw (dnd5e `ConditionData._onUpdate` reads an undefined `Infinite`
  unless `originalLevel` is passed — now passed; remove waits for dnd5e's un-awaited `exhaustion:0`
  write); `manage-effect` refused a value-less core combat expiry on a misreading of core (a bare
  `{expiry:"turnEnd"}` expires at the FIRST matching event — proven live in a scripted combat);
  `manage-calendar set` without `day` stepped back a day (dnd5e `jumpToDate` defaults from core's
  0-based `dayOfMonth`) — all three parts are always passed, `day` bounded by the month, `advance`
  reads the calendar's hours/minutes/seconds; transform `transformSettings` now SEEDS from the
  preset (`CONFIG.DND5E.transformation.presets[preset].settings`) and overrides per key, like the
  sheet; `manage-activity edit {behaviors}` accepts an inherited item-level template (PHB *Web*
  proven); `edit` REFUSES the typed add-only params by name instead of silently dropping them.
  **Pruned writes:** `update-actor` initiative bonus → `attributes.init.roll.bonus` (the 5.x path is
  a getter-only shim); `.custom` no longer written to treasure / masteries. **New surface:**
  `manage-activity` `appliesEffects: [{ref, onSave?, level?}]` populates `activity.effects[]` (the
  6.0 "on use / on failed save apply X" model — ref = an effect on the item by name → `_id`, a stock
  `dnd5e.effects` / world effect → `uuid`); `list` shows effects / transform / profiles; `subtract`
  change type + `phase`; `months` / `years` durations (unknown unit now refuses); six more settings
  gates (`movementAutomation`, `bloodied`, `allowPolymorphing`, `allowSummoning`,
  `disableConcentration`, `pietyScore`); `calendarDailyRecovery` is `auto|calendar|manual` (the
  blank choice was unwritable — dnd5e's field has no `blank`). **Guards:** `assertDnd5e` refuses a
  world below dnd5e 6.0 (2.x writes keys a 5.3.3 schema prunes — prod stays on 5.3.3 until the owner
  upgrades it); `dnd5e.effects` is hidden from pack enumeration again (still the effect resolver's
  source); `roll.*` conditions refused on core-type changes and flagged by content-audit; camelCase
  status ids (`coverHalf`…) validate; `DAMAGE_TYPES` = the real 13, `week` dropped from activity
  units, `jump` added to movement. Offline: 1684 tests / 3 skipped. Live (sandbox): actor 34/34 ·
  effects 51/51 · region effects 37/37 · activities 37/37 · settings + calendar 52/52 · items 13/13 ·
  pc-build 66/66 · integration 84 / 2 skipped. Docs: prod version corrected everywhere (14.364 /
  5.3.3), design.md §1 DDB line + §4 rows, skill recipe slips (`roll.type` for saves, Wild Shape
  2024, Luckstone, copied armor drives AC). Not done (owner's call, maintenance mode): item-carried
  effects in `get-actor` reads, region-behavior edit/remove, the calendar `requiresReload` bridge
  reload, class spell lists.
- [x] **Foundry 14.368 compatibility pass** (2026-09-19, v2.1.4): the sandbox moved to 14.368
  (stable, 2026-09-16). Two of its changes hit us: (1) every POST must now look same-origin or 400s
  ("The request could not be processed.") — `scripts/local-foundry.mjs` launch/stop now send an
  `Origin` header (the bridge itself posts from inside the page, so it was never affected); (2)
  `teleportToken.destinations` became a `relativize: true` DocumentUUIDField (core #14703), so a
  written `Scene.A.Region.X` is STORED as `...A.Region.X` (or `..X` for a same-scene region) —
  `absoluteTeleportDest` in `region.ts` now restores the absolute form on every read (dump, remap,
  orphan scan, placement check) through core's own `parseUuid(…, { relative })`, with a shape-based
  fallback for mocks. The three 14.368 bug fixes we care about (duration-only effects lingering until
  world time advanced, Scene bulk delta updates not re-initialising synthetic actors, Region Config
  Level order) needed no workaround removal — we never carried one. Levels' default top elevation
  is now `4 × grid distance` (same resulting foreground elevation), and darkness may only be
  updated on a locked scene when `darknessLock` is passed explicitly — `update-scene` never writes
  darkness alone against a lock. Offline: 1690 tests / 3 skipped. Live (sandbox 14.368): effects
  51/51 · region effects 37/37 · activities 37/37 · settings + calendar 52/52 · items 13/13 · actor
  34/34 · pc-build 66/66 · teleporter + scene fields 13/13 · placeables 34/34 · scene tools 10/10 ·
  cast activity 25/25 · region tooling 22/22 · integration 84 / 2 skipped. `CLAUDE.md` now carries
  the upgrade-review rule (notes → launch → connect → verify before trusting an update).
- [x] **dnd5e 6.0.2 / 6.0.3 compatibility pass** (2026-09-20): the sandbox moved to 6.0.3 (6.0.2
  2026-09-15, 6.0.3 2026-09-17; `compatibility.minimum` stays 14.367). Reviewed from the
  tag-to-tag source diff, not the notes alone (six of the commits carry no issue number): 15
  files changed in content between 6.0.1 and 6.0.3, all bug fixes, no data-model change. What
  touches us — 6.0.2: rule-type conditions now see `sourceItem.*` (the effect's own item) while
  `item.*` is the item being rolled (#7450 — our Filter normaliser is open-vocabulary, so the
  key writes verbatim; the tool text is a 3.0 doc pass); dependent effects survive out-of-combat
  expiry; the falling toggle's designated user no longer needs to view the scene (a headless GM
  can be it); group roll signatures gained dialog/message args; request cards carry `messageId`.
  6.0.3: an effect with NO duration created in combat keeps `expiry` null instead of a stamped
  `turnStart` (#7482 — our read-back reports it permanent, as it should); `system.rolls.*`
  initialises when absent (#7475); ActorDelta migration inheritance. Targeted live
  (`scratch/pin-6.0.3-targeted.mjs`): 4/4. Release set on the sandbox (6.0.3 / 14.368): effects
  51/51 · region effects 37/37 · activities 37/37 · settings + calendar 52/52 · items 13/13 ·
  actor 34/34 · pc-build 66/66 · teleporter + scene fields 13/13 · placeables 34/34 · scene tools
  11/11 · cast activity 25/25 · region tooling 22/22 · integration 85 passed / 1 skipped;
  verify-wake on local: world down 5 s → cold bring-up 12 s. Offline: 1730 tests / 3 skipped.
  Found on the way: Foundry 14.368 moved world shutdown to `POST /setup worldShutdown` (the
  launcher's stop was a silent no-op) and `verify-wake` ignored `FOUNDRY_HOST` — fixed in
  96ed726.

### 2.1.0 release proof (2026-09-15, sandbox)

Offline gate green (biome · tsc · 1601 tests · build · knip). Live: `verify-effects-6` 47/47,
`verify-region-effects` 26/26, `verify-item-tooling` 13/13, and the regression — integration suite
84 passed / 2 skipped (86), `verify-actor-tooling` 29/29, `verify-cast-activity` 25/25,
`verify-region-tooling` 22/22, `verify-dnd5e-writes` 16/16, `verify-content-audit` 8/8,
`verify-pc-build` 63/63, `verify-placeables-tooling` 34/34 (timing-flaky when run straight after a
heavy session — re-run standalone). RELEASE.md step 3 (the MCP-level smoke) needs the CC restart.
`HANDOFF.md` retired with this release, as it asked.

## Execution discipline

- One feature = one commit: tool + `effect-changes.ts`-style pure validator with unit tests +
  the skill section + the verify-script case. `npm run check` · `typecheck` · `test` · `build` ·
  `knip` green before each push; `gh run list` after.
- Live proof on the **sandbox only** (`FOUNDRY_PROFILE=local`), tagged `ZZ-*` docs, cleaned in
  `finally`. Prod stays pure until the release; CC restart on both boxes after (new tool schemas).
- New verify scripts: `verify-effects-6.mjs` (conditions / rules / replacement / expiry round-trip,
  then a real `rollAttack` proving a `dnd5e.bonus` rule adds its term and a `dnd5e.advantage` rule
  flips the mode), `verify-region-effects.mjs` (apply-effect region → token enters → effect present
  → leaves → gone), and `verify-cast-activity` extended for teleport + behaviors.
- Docs: `docs/RELEASE.md` unchanged; README "2.1" paragraph listing the new tool contracts;
  design.md amendment for the `dnd5e.effects` decision.

## Decisions (owner, 2026-09-15 — all four answered)

1. `dnd5e.effects` is an allowed **mechanical** source, **by default** (design.md §2.3 amendment).
2. `configure-dnd5e-settings`: **read + set** with the allow-list; GM-only; every set reports old → new.
3. Calendar tools: **in this run** (2.1.1) — `manage-calendar`, see row 13.
4. Transform "Select Form": **2.1.1**.

## Key gotchas (so the next session can act cold)

- Filter JSON is stored as a **string** (`FiltersField extends JSONField`, initial `"{}"`); write
  `JSON.stringify(obj)`, read with `JSON.parse`. An invalid JSON string bricks the filter editor
  (fixed to be editable in 6.0.1, still worth validating before write).
- Rules changes carry `skipConditions: true` in their type config — their per-change `conditions`
  are evaluated **at roll time** by `ActiveEffect5e._applyChangeRule`, not at prep; `roll.*` keys
  exist only there.
- `changes[].type` must be `"dnd5e.bonus"` etc. — the plain core `add` on `key: "attack"` is not a
  rule, it is a (pruned) write to a non-existent path.
- Region `applyActiveEffect.effects` wants **compendium/world effect uuids**; the behavior creates
  fresh copies on entry and deletes them on exit — never point it at an effect that lives on the
  entering actor.
- Activity `behaviors[].config` is a `TypeDataField5e` keyed by `behaviors[].type`; write the
  `type` and the `config` together or the clean step drops the config.
- `teleport.value` is a deterministic FormulaField (string) like Cast's `challenge` — write `"30"`.
