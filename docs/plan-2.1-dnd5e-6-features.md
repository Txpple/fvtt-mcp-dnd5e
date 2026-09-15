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
| 10 | **System automation settings** (all new in 6.0) | `dnd5e` settings `disableFalling`, `tokenSizeSync`, `senseVisionSync`, `disableExhaustion`, `initiativeGroupCombatants`, `initiativeGroupRoll`, `autoApplyDowned`, `allowPlayerDamageTray`, `allowPlayerEffectsTray`, `chatCardSummary`, `encounterPlacementBehavior`, `bastionTurns` | new **`configure-dnd5e-settings`** (GM-only, allow-listed keys, read + set, reports current values) — and `get-world-info` gains an `automation` block | start-session reports them; session-audit can warn ("falling automation is on but this scene has no Levels") | 1.5 h |
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
- [ ] **2.1.1** — milestone: tag after the regression + the README.

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
