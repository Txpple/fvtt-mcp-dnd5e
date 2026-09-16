# HANDOFF — fix the 2.1 review findings (written 2026-09-15, owner-requested)

> For a fixing agent in a fresh window. This is the output of the owner-requested review of the
> dnd5e 6.0 / Foundry 14 line (`241ab67..2232b9c` — the 6.0.1 compat pass `58c9687`/v2.0.0 and the
> 2.1 feature line, v2.1.0–v2.1.2). Read this, then `design.md` (binding) and
> `docs/plan-2.1-dnd5e-6-features.md` (the tracker). `HANDOFF-REVIEW.md` is the reviewed agent's own
> map of the work; it is superseded by this file — delete both when the fixes ship.
>
> Review method, so you can weigh the findings: 11 static lenses read the changed code against the
> dnd5e 6.0.1 source on disk (`scratch/dnd5e-6.0.1/module/**`) and core 14.367; every finding was
> adversarially verified by up to three independent skeptics (99 → **90 confirmed / 9 refuted**); the
> reviewer re-ran the whole live proof on the sandbox (23 verify scripts + the integration suite —
> every claimed number reproduced) and live-probed the top findings. **Verdict: 7/10** — the compat
> half is sound (an independent sweep of every 6.0.1 migration/shim found no further P0/P1 miss);
> the feature half is well-proven at the *shape* level but breaks on the second call / the edit /
> the combination. Fix P1 and P2 below and it is a 9.

## Environment facts (check before you touch anything)

- **Prod = Foundry 14.364 / dnd5e 5.3.3, by owner decision** (restored 2026-09-15 for the
  2026-09-22 game; Battle Flow `ce2ac5f`). Read with `get-world-info` on `foundry-molten5e` —
  it answers `system.version 5.3.3`. The compat doc, README, the plan, `HANDOFF-REVIEW.md` and the
  dev-state memory all *say* prod is 6.0.1 — they are wrong; correct them (P3-docs below).
  **Do not author on prod with 2.x** — it writes native 6.0 keys (`ac.override/calcs`,
  `movement.speeds.*`, `system.rarities`, `attributes.exhaustion`) that a 5.3.3 schema prunes on
  write (`SchemaField#cleanKeys`, `prune:true`). Both user-scope MCP registrations
  (`foundry-molten5e`, `foundry-local5e`) run `dist/index.js` from this repo.
- **Sandbox = Foundry 14.367 / dnd5e 6.0.1, DESKTOP-NY only** (`FOUNDRY_PROFILE=local`,
  `scripts/local-foundry.mjs start|stop|status`). ONE world-driver at a time. If `status` shows a
  connected user and nobody is in it, it is a ghost session: `stop --force` then `start` (owner
  authorised this 2026-09-15). Tag temp docs `ZZ-*`, clean up in `finally`, restore `worldTime`
  and any setting you flip. Prod stays untouched.
- Offline gate (must be green before and after): `npm run check && npm run typecheck && npm test
  && npm run build && npm run knip` (biome · tsc · 1622 tests / 3 skipped · esbuild · knip).
- Live proof (build first — the scripts drive `dist/`):
  `FOUNDRY_PROFILE=local node scripts/verify-{effects-6,region-effects,activities-6,settings-calendar,item-tooling,pc-build,actor-tooling}.mjs`
  and `FOUNDRY_PROFILE=local RUN_LIVE=1 npm run test:integration` (84 passed / 2 skipped).
- Reviewer probe scripts (local-only, gitignored) live in `scratch/probes/` on DESKTOP-NY:
  `probe-expiry.mjs`, `probe-calendar.mjs`, `probe-batch2.mjs` (exhaustion change, get-actor
  duration, transform preset, calendar switch, edit-behaviors). Each connects via
  `dist/foundry.js` + `scripts/lib/bridge-config.mjs`, tags `ZZ-PROBE`, cleans up. Re-run them
  after each fix — they are the regression cases the verify scripts lack. Remember
  `Foundry.evaluate` takes ONE argument (pass an object).

## P1 — fix first (all live-confirmed on the sandbox 2026-09-15)

### P1-1 `apply-condition`: changing an existing exhaustion level throws and desyncs
- **Where:** `src/page/dnd5e/conditions.ts:85` and `:107` — `setExhaustion` does a bare
  `eff.update({ 'system.level': lvl })` on an existing exhaustion effect.
- **Ground truth:** dnd5e 6.0.1 `data/active-effect/condition.mjs:173`
  `const delta = this.level - (options.dnd5e?.originalLevel ?? Infinite);` — `Infinite` is an
  undefined identifier (upstream typo for `Infinity`), evaluated whenever `originalLevel` is
  absent. dnd5e's own paths (`increase`/`decrease`/`set` at `:110`/`:124`) always pass
  `{ dnd5e: { originalLevel } }`, so the system never trips it.
- **Observed:** set 2 (fresh) OK → set 4: `ReferenceError: Infinite is not defined` from
  `ConditionData._onUpdate`; the effect IS at 4 but `_source.attributes.exhaustion` stays 2 (line
  88 never runs). Removal afterwards left `_source` at 2 with no effect.
- **Fix:** never write `system.level` bare. Either pass the option
  `eff.update({ 'system.level': lvl }, { dnd5e: { originalLevel: readExhaustionLevel(eff) } })`
  (mirrors `condition.mjs:124`), or drive every transition through the persisted lever
  `actor.update({ 'system.attributes.exhaustion': lvl })` and poll for the effect level (the
  path the fresh-create case already uses). Then verify `_source` and the effect agree after
  set → change up → change down → remove.
- **Tests:** add the level-CHANGE case (2 → 4 → 1 → remove, asserting both `_source` and
  `effect.system.level`) to `scripts/verify-actor-tooling.mjs`; unit-test the option in
  `conditions.test.ts`.
- Related lows to close in the same pass: `R1-033` an inactive/immune exhaustion effect doubles
  the level (`:88`); `R1-034` `active:false` ignored when `exhaustionLevel > 0` (`:43`);
  `R1-032` ids are lower-cased so camelCase statuses (`coverHalf`, `heavilyEncumbered`…) never
  validate (`:133`); `R1-044` exhaustion hard-coded as the only leveled status (`:140`) — 6.0
  routes any status with `levels` through `_applyDelta` regardless of `active`.

### P1-2 `manage-effect` refuses a duration-less core combat expiry on a misreading of core
- **Where:** `src/page/effect-changes.ts:466-475` (`normalizeDuration` throws for
  `combatStart/roundStart/turnStart/combatEnd/roundEnd/turnEnd` without a finite `value`);
  the same wrong claim in `effect-changes.ts:30`, `src/utils/dnd5e-canonical.ts:115`, the schema
  text `src/tools/dnd5e/manage-effect.ts:153-155`, `HANDOFF-REVIEW.md:96-99` ("verified in
  active-effect.mjs" — it was not), and `.claude/skills/stat-block-builder/SKILL.md:242-244`.
- **Ground truth:** core 14.367 `ActiveEffectRegistry#refresh` (foundry.mjs:49532)
  `durationReached = remaining <= 0 || !Number.isFinite(remaining)`; `_prepareDuration`
  (:50026) yields `remaining: Infinity` when `value` is not finite; `isTemporary = !!expiry ||
  isFinite(value)` (:49919). A value-less core expiry is registered and expires at the event.
- **Observed:** a bare `{expiry:'turnEnd'}` effect (created directly) was `expired:true` after
  the actor's first turn end; bare `roundEnd` at the round end. The tool threw on the same shape.
- **Fix:** delete the value-required branch (keep the vocabulary check); reword the four prose
  copies to "a core expiry with no value expires at the first matching event; with a value, at
  the first matching event after the value elapses". Flip `effect-changes.test.ts:593` and
  `scripts/verify-effects-6.mjs:474` from "refuses" to "creates `{expiry:'combatEnd'}` and the
  source keeps `value: null`"; add a positive live check (create on a combatant, end combat,
  assert `duration.expired`).

### P1-3 `manage-calendar set` without `day` steps the date back one day
- **Where:** `src/page/dnd5e/calendar.ts:157-161` — `day` is forwarded only when given.
- **Ground truth:** dnd5e 6.0.1 `data/calendar/calendar-data.mjs:98-116` `jumpToDate`:
  `day ??= components.dayOfMonth` (core's `dayOfMonth` is **0-based**) then `dayOfYear = day - 1`
  (treats it as 1-based). dnd5e's own dialog always submits all three, so the system never hits
  its default; the tool contract ("omitted parts keep their value", `src/tools/dnd5e/calendar.ts:71`)
  is false for the day.
- **Observed:** `set day:15` → 15; `set month:<same>` → 14; `set year:<same>` → 13. `set day:40`
  accepted and overflowed into the next month. (`set hour` is fine.)
- **Fix:** always pass all three from the page's own read:
  `cal.jumpToDate({ year: year ?? before.year, month: mi ?? before.month.index, day: day ?? before.day })`
  (`before.day` is already 1-based); bound `day` by `months[mi].days` (leap-aware:
  `m.leapDays ?? m.days`). Also `R1-059`: `advance` hard-codes 86400/3600/60 — read
  `game.time.calendar.days.hoursPerDay` etc.
- **Tests:** page unit tests for month-only / year-only / out-of-range day (`calendar.ts` has
  none — `R1-060`); a `verify-settings-calendar` case with `day` omitted and one crossing a
  month/year boundary. Restore `worldTime` in `finally`.

### P1-4 Transform `transformSettings` discards the preset instead of starting from it
- **Where:** `src/page/dnd5e/activities.ts:494-504` — `act.settings = { preset, ...caller fields }`
  with `transform.customize = true`.
- **Ground truth:** dnd5e 6.0.1 `applications/activity/transform-sheet.mjs:189-196` builds a
  customised settings object as `mergeObject({ ...presets[preset].settings, preset }, submitted)`
  — preset as base; `data/activity/transform-data.mjs:95-97` uses a `customize:true` settings
  object verbatim. The tool description (`manage-activity.ts:245-250`) and
  `stat-block-builder/SKILL.md:313` promise "start from a preset and override".
- **Observed:** `transformPreset:'wildshape'` + `transformSettings:{minimumAC:'13'}` persisted
  `settings` with `minimumAC:'13'`, the schema-default `keep:['vision']`/`effects:[…7 keys]` and
  **no `tempFormula`, no Moon-druid AC formula, no spell list** — the preset's values are gone.
- **Fix:** seed from the preset. Cleanest: resolve on the page from
  `CONFIG.DND5E.transformation.presets[preset].settings` (`toObject()` — the `keep/merge/effects`
  are Sets) and merge the caller's fields over it; or carry a Node-side copy in
  `dnd5e-canonical.ts` if the pure builder must stay pure (then lock it with a test against the
  6.0.1 `config.mjs` presets). Note the verifier's refinement: omitting `effects` currently ADDS
  `equipment` beyond the wildshape list.
- **Tests:** unit — wildshape + `{keep}` retains `minimumAC`/`tempFormula`/`spellLists`/`merge`;
  extend `verify-activities-6.mjs` to read back the persisted `settings` and compare with the
  preset (it currently asserts only the fields it passed).

### P1-5 `manage-activity edit { behaviors }` refuses book spells whose template is inherited
- **Where:** `src/page/dnd5e/manage-activity.ts:285` — the guard reads the activity's SOURCE
  `target.template.type`; a compendium spell's activity has `target.override:false` and inherits
  the item-level template.
- **Observed:** PHB *Web* copied to an actor → `edit { behaviors:[difficultTerrain web] }` →
  "behaviors ride on an AREA TEMPLATE — this activity has none"; passing `template` alongside
  works but forces `override:true` and duplicates the item's target.
- **Fix:** read the prepared activity (`item.system.activities.get(id).target.template.type`)
  or accept `override:false` when the ITEM carries a template type. Add the compendium-spell case
  to `verify-region-effects.mjs` (it is the compendium-first path, so it is the common one).
- Same file, same pass: `R1-021` edit silently drops every typed teleport/transform param
  (`:257`) — either refuse them on edit naming `patch`, or re-run the add-path resolution;
  `R1-057` the skill says `manage-activity list` names transform profiles/forms — it returns
  neither (`:162`): add them to the list projection.

### P1-6 `get-actor` loses the effect duration at the tool boundary
- **Where:** `src/tools/actor.ts:514-519` projects `duration.type` (never emitted since
  `58c9687`) and drops `value`/`units`; `src/tools/actor.test.ts:202/247/421` fixture the stale
  shape. And `src/page/actors.ts:470` still gates on `typeof dur.value === 'number'` — the exact
  bug 2.1.2 (`e60055d`) fixed in `effects.ts:109` with `Number.isFinite` but not here.
- **Observed:** over the page seam a 1-round effect reads `{value:6, units:'seconds',
  expiry:'turnStart', remaining:6}` and a value-less `targetEnd` reads `{value:null,
  units:'seconds', expiry:'targetEnd', remaining:null}`; the Node projection then reduces both to
  `{remaining, expiry?}` with `type: undefined`.
- **Fix:** one shared `projectDuration(dur)` (pure, in `effect-changes.ts`) used by both
  `actors.ts` and `effects.ts`: `Number.isFinite(value) ? {value, units, expiry?, remaining} :
  expiry ? {expiry} : null`; `formatEffects` forwards `value`/`units`/`expiry`/`remaining`; fix the
  fixtures to the real page shape so the seam cannot drift again (`R1-026`: the 2.1.2 fix has no
  regression test — tighten `verify-effects-6.mjs:193` to compare the whole duration object).

## P2 — medium (one maintenance session)

| id | where | defect | fix |
|---|---|---|---|
| R1-012 | `effect-changes.ts:388` | `roll.*` conditions accepted on core-type changes (`add`/`override`…) where dnd5e evaluates them at prep with no `roll` data → the change never applies; content-audit rule 0 does not flag it | pass scope `'change'` only when `isRuleType(type)`, else `'effect'` (refuse `roll.*` naming the rules types); extend `ruleChangeProblem` to flag a persisted core change whose conditions reference `roll.*` |
| R1-013 | `dnd5e-canonical.ts:152` | activity `duration.units` offers `week`, which 6.0.1 `timePeriods` marks `option:false` → nulled | drop `week`; test the list against 6.0.1 `config.mjs` `timePeriods` keys |
| R1-010 / R1-046 | `manage-effect.ts:57`, `effect-changes.ts:425` | change `type` enum omits core `subtract` (foundry.mjs:3374; dnd5e gives it `>=` floors and Set removal) and no `phase`; duration units reject core `months`/`years` and the page silently deletes unknown units | add `subtract` (+ optional `phase: initial\|final`), add `months`/`years`, and warn instead of deleting an unknown unit |
| R1-014 | see P1-5 | | |
| R1-015 / R1-020 | `effect-refs.ts:173`, `manage-activity.ts:60` | duplicate-name effect (stock pack ships two "Silenced") → first wins with a warning; transform direct-mode name → hard-coded `dnd-monster-manual.` prefix outside `compendium-sources.ts`, `hits[0]` on a residual tie | refuse on >1 hit listing the candidate uuids (matches `pickItemEffect` / `resolvePremiumCharacter`); export the MM ranking from `compendium-sources.ts` — "skills decide, tools do" |
| R1-016 | `settings.ts:112` | `calendar` is `requiresReload`; the headless bridge never reloads → `manage-calendar` kept answering Gregorian after switching to Harptos (live) | after a write with `reloadRequired`, reload the bridge page (the self-heal path in `src/foundry.ts:436` already rejoins) — or have `manage-calendar` compare the setting with the live calendar and warn until reconnect |
| R1-017 | `dnd5e-settings.ts:30` | allow-list omits the gates the new shapes depend on: `movementAutomation` (difficult terrain), `bloodied` (statuses.bloodied conditions), `allowPolymorphing` (player use of transform), `allowSummoning`, `disableConcentration`, `pietyScore` — all world-scope in 6.0.1 `settings.mjs` | add them to the catalogue (same table shape); have transform / Bloodied recipes warn when the gate is off |
| R1-019 | `compendium-sources.ts:51` | the `dnd5e.effects` exemption sits in the global `isSrdPack` gate, so the ActiveEffect pack now surfaces in `list-compendium-packs` / every search enumeration | keep it hidden from enumeration; allow it only at the effect-uuid consumer (`assertNoSrdPacks(ids, ctx, { allowMechanical: true })` from `effect-refs.ts`) — or filter `metadata.type === 'ActiveEffect'` out of the pack list |
| R1-022 | `scene-builder/SKILL.md:71` | region behaviors cannot be edited or removed → the skill teaches delete-the-region | add `remove-region-behavior` (by id) or `replaceBehaviorId` on `add-region-behavior` via `region.updateEmbeddedDocuments('RegionBehavior', …)`; drop the workaround line |
| R1-030 | `scene-builder/SKILL.md:68` | "draw the region centred on the pivot" — `dnd5e.rotateArea` pivots on `region.shapes[0].origin` (`rotate-area.mjs:134`); a rectangle's origin is its x/y corner, a circle's is its centre | say so in the skill (circle/ellipse centred on the axle, or a 1-px rectangle at the axle as shape[0]); optionally warn in the tool when `shapes[0]` is a rectangle; list `long` in the direction set |
| R1-024 | `_placeables.ts:117` | `crudCreate` keepId re-order (touches EVERY placeable create) shipped without a unit test; the input-`_id` branch is dead | `_placeables.test.ts` with a fake scene returning the batch reversed → assert `items[]` order, `keepId:true`, 16-char ids; drop or document the input-`_id` branch |
| R1-025 | `verify-activities-6.mjs:326` | the two "refuses an SRD pack" checks use fabricated ids and pass via the not-found branch | fetch a real `_id` from `dnd5e.monsters24` / `dnd5e.spells24` and assert `/SRD\|premium/` only |
| R1-009 / R1-043 | `npc.ts:193`, `actors.ts:1894` | author-npc writes the flat `senses.darkvision` shape; update-actor writes `attributes.init.bonus` — both land only via shims (senses removed in 6.1; init.bonus until 7.0) | write `senses.ranges.*` and `attributes.init.roll.bonus` natively (the verify scripts assert derived values, so they will not notice either way — assert `_source` too) |
| R1-031 | `update-actor.ts:295` | `movement.jump` is inert — 6.0.1 recomputes `speeds.jump` from STR every prep | remove the knob (or document it as read-only) |
| R1-018 | `advancement.ts:492` | "ModifyItem proven" — Test L calls dnd5e's `apply` directly; the engine never applies advancements on items GRANTED during the level, which is where a ModifyItem lives | either walk granted items in `applyItemAdvancements` (diff `tmp.items` before/after each root item) or downgrade the plan/HANDOFF wording to "ModifyItem#apply proven; engine coverage = root items" |

## P3 — low / nit, batchable (fix while in the file)

- **Effects** (`src/page/effects.ts`): edit drops `description` (`:152`); `replacement` accepted
  on an actor-direct effect where dnd5e never applies it (`:130`); `statuses` not validated
  against `CONFIG.statusEffects` (`:138`); no way to set `img` (rule-8 placeholder default),
  effect `type` (condition/enchantment) or `system.rider.statuses` (`manage-effect.ts:85`);
  a status-conferring effect may reference `statuses.*` in effect-level conditions (evaluated
  before statuses are collected) — warn (`:125`).
- **Activities**: difficultTerrain behaviors silently drop `effects`/`sizes`/`creatureTypes`
  where the region tool throws (`activities.ts:317`); activity `description.value` / `chatFlavor`
  (6.0's compact cards prefer them) only via raw `patch` (`manage-activity.ts:80`); behavior
  read-back echoes `types` for both creatureTypes and terrainTypes (`manage-activity.ts:184`);
  tool descriptions for `manage-activity` / `add-region-behavior` never mention the 6.0 surface
  (`manage-activity.ts:457`, `region.ts:182` — also omit core's unprefixed `applyActiveEffect`).
- **Reads**: `get-compendium-entry` compact `armorClass` reads derived `ac.value` off source →
  always missing (`tools/compendium.ts:907`); summaries still read 4.x item shapes (`:857`);
  `effect.icon` (removed in v14 — `img`) (`page/compendium.ts:243`); `get-actor` `derived.ac`
  always reports `flat: 0` (`actors.ts:365`); `list-chat-messages` drops the `title` it collects
  and renders every card in `contentMode 'none'` (`tools/chat.ts:447`); `post-item-card` refuses
  activity-less items though `Item5e#displayCard` posts the native `item` card, reason text says
  "5.x" (`page/chat.ts:332`); concentration saves skip the bless-margin fold
  (`tools/combat-stats.ts:467`); `list-regions` does not surface dnd5e behavior config
  (`region.ts:302`); `update-actor-item` rarity patch not validated against `itemRarity`
  (`actors.ts:2208`); "Rarity Varies" collapses to `rarities[0]` in facets (`compendium-facets.ts:243`).
- **Vocab hygiene**: second copies of CONFIG tables in `dnd5e-canonical.ts:174` vs
  `actor-fields.ts` (size codes drift — accept long names everywhere via one `normalizeSize`);
  Node-side `CONDITIONS` has 15 entries vs 26 in 6.0.1 (`dnd5e-canonical.ts:50` — 2024 conditions
  flagged "unknown" by author-npc); `DAMAGE_TYPES` carries `none`/`vitality` which are not 6.0.1
  keys (`:10`); `add-feature` attack/aura shells still carry 4.x keys (`attacks.ts:158`).
- **Bridge**: v14 free-text `/join` path dropped the fast-fail user check although `game.users`
  is client-side (`src/foundry.ts:355`); admin auth never fills v14 `adminUsername` (`:247`).
- **Tests**: `effect-refs.ts` has no offline test (duplicate-name / multi-`#` branches never
  run); the "DataModel settings written WHOLE" assertion never compares sibling fields
  (`verify-settings-calendar.mjs:133`); `registry.test.ts` lacks per-tool "registers …" cases for
  the two new tools; settings tool output filter is a no-op with a stray blank line
  (`tools/dnd5e/settings.ts:107`).

## P3-docs — record corrections (cheap, do them in the first commit)

- Prod version: `docs/dnd5e-6.0-compat-review.md` (header + Status), `README.md` requirements
  ("14.367+ / 6.0.1+" is the *2.x target*, not prod today — and "1.x remains the line for 5.3.x"
  contradicts v1.5.2 being the 6.0.1 compat release), `HANDOFF-REVIEW.md`, and the dev-state
  memory in the notes repo (`fvtt-mcp-dev-state.md`): prod = 14.364 / 5.3.3 until the owner
  upgrades; sandbox = 14.367 / 6.0.1.
- Add a **system-version guard**: `assertDnd5e` (or the bridge connect) should read
  `game.system.version` and refuse — or at least warn on every write — below 6.0, since 2.x
  writes pruned keys on 5.3.3. This is design.md-grade correctness, not a feature.
- Skills: stat-block-builder `:216` recipe key `roll.type = "save"` never matches (saving throws
  report `ability`); `:299` Wild Shape 2024 example carries the 2014 swim restriction; `:307`
  suggests gating activities via effect conditions — no such mechanism; `:242-244` the expiry
  rule (P1-2). pc-builder `:208` still says copied armor does not drive AC. physical-item-builder
  `:77` Luckstone / Frightful Presence rules-lore slips. `autoApplyDowned` hint mis-states the
  `npcs` mode (`dnd5e-settings.ts:83`). Comparison list omits `istartswith`/`iendswith`;
  content-audit description says "four rules"; `magical` glossed as "dispellable"
  (`manage-effect.ts:35`).
- design.md §1 still advertises the D&D Beyond import that §7 / pc-builder record as removed;
  §10 says new capability areas get added there first — settings / calendar / areas-with-behaviors
  are not. Plan row 10 still lists `bastionTurns` and omits the calendar keys. Stale "5.3.3 /
  14.364" grounding headers on `chat.ts`, `effects.ts`, `conditions.ts`, `npc.ts`, `advancement.ts`.
  `compendium-sources.ts:15` "sanctioned exception" comment is stale (page code imports three
  utils modules now).

## Value-add backlog (owner decides; maintenance mode says fixes, not features)

Ranked by what a DM authoring 2024 content through this MCP hits first:

1. **An activity cannot apply an effect** (`activity.effects[]` — `AppliedEffectField`
   `{_id | uuid, level, save-only onSave}`, `base-activity.mjs:79`, `save-data.mjs:27-29`). "DC 13
   CON save or Poisoned" and the skill's own Frightful Presence recipe are not buildable; the only
   route is a raw `patch`. Add `appliesEffects: [{ref, onSave?, level?}]` to add/edit resolved
   through the existing `resolveEffectRefs` (item's own effects by name → `_id`, stock/world →
   `uuid`); surface `effects` in `list`; a real `use` in `verify-effects-6` proving the inherited
   duration/expiry. This closes plan row #4's promise.
2. **Item-carried effects are invisible to reads**: `get-actor` / `get-actor-entity` /
   `search-actor-contents` / `manage-effect list` read `actor.effects` only (`actors.ts:434`,
   `:779`, `effects.ts:96`) while 6.0.1 applies transferred item effects from the item
   (`Actor5e#allApplicableEffects`, `actor.mjs:439`). Project `actor.allApplicableEffects()` with
   `source: {itemId, itemName}`; add `effects` to the items projection; `manage-effect list`
   `includeItems: true`.
3. Settings gates (P2 R1-017) — small, do with P2.
4. Class spell lists (`dnd5e.registry.spellLists`) — a `spellList` facet on
   `search-compendium-spells` and an off-list warning in `addSpellsToActor` (pre-existing gap,
   not 6.0's — `R1-027`).
5. Region behavior edit/remove (P2 R1-022).
6. Later / Phase 2 flavour: encounter actors (`type: 'encounter'`, `group.ts:199`), bastion
   facilities + `manage-bastion`, 6.0 `request` messages for `request-roll`, Levels / surfaces for
   the falling automation, Summon / Enchant activity builders, Adventure documents through
   `Adventure#import`.

## Definition of done

- P1-1…P1-6 and P3-docs landed; P2 as far as one session allows (record what is left in the plan
  doc's Progress list — no new handoff file).
- Offline gate green; the seven live scripts and the integration suite re-run green on the
  sandbox; the three reviewer probes re-run and now show the fixed behaviour (paste their output
  lines into the commit message the way the verify counts are pasted today).
- New verify cases for every P1 (the second call, the edit, the preset+override, the omitted day,
  the bare core expiry) — the review's central lesson is that first-write proof is not enough.
- Release as **v2.1.3** per `docs/RELEASE.md`; CC restart on both machines (schemas changed:
  `subtract`, `months`/`years`, settings keys). Prod stays on 1.x-compatible behaviour until the
  owner upgrades it — do not register a 2.x fix against prod as "verified" without the
  version guard in place.
- Delete `HANDOFF-REVIEW.md` and this file when done (the plan doc is the durable record).
