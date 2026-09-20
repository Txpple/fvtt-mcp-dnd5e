# dnd5e 6.0.1 compatibility review — MCP tools (2026-09-15)

Scope: every tool that reads or writes dnd5e system data, audited against **dnd5e 6.0.1 on Foundry
14.367** (the SANDBOX versions since 2026-09-15; prod was restored to Foundry 14.364 / dnd5e 5.3.3 by
owner decision until the 2.x line is tested — it upgrades after the 2026-09-22 game). Static review first (the sandbox was in use),
then fixes, then the live smoke on the sandbox — see **Status** below for the outcome.

## Ground truth used (no memory, no guesswork)

- **6.0.1 source**: extracted from `systems/dnd5e/dnd5e-compiled.mjs.map` on the sandbox disk
  (405 files with `sourcesContent`). **5.3.3 source**: sparse clone of `foundryvtt/dnd5e` at
  `release-5.3.3` (`module/` only). Diffed data models, documents, config, migration.
- **Core 14.367**: `resources/app/public/scripts/foundry.mjs` on disk (ActiveEffect schema, field
  cleaning semantics, `CONFIG.statusEffects`).
- Release notes for 6.0.0 / 6.0.1 via `gh release view` (breaking-changes section + the long
  improvements list, which is where most of the quiet data-shape moves hide).
- Premium module manifests on disk: PHB 2.2.0 (min dnd5e 5.1.9), MM 1.4.0 (min 5.3.3),
  DMG 2.0.0 (min 5.1.0) — i.e. the books are still **5.x-era builds**; their pack indexes carry the
  5.x keys until the publisher ships migrated packs.

### Two general facts that decide most verdicts

1. **Core v14 migrates our writes.** `Document#update` → `updateSource` cleans the partial diff with
   `migrate: true, persisted: true` (`_preUpdateSource`), and `TypeDataField._migrate` calls the
   system model's `migrateDataSafe` on that partial. So dnd5e's `_migrateData` shims
   (`_migrateArmorClass`, `MovementField._migrate`, `#migrateRarity`, …) run on **our** legacy-shaped
   updates and creates, and keys marked `persisted: false` are silently pruned. Consequence: most
   legacy writes still land — until the shims are removed (dnd5e says 7.0; core says v16).
2. **Shims are prepared-data only.** Read-side shims (`movement.walk`, `effect.changes`,
   `Advancement#title`, `system.rarity`) are getters on the prepared model or `toObject()`; the raw
   source has only the new keys. Anything that reads pack **indexes** or exported source sees the new
   shape (or the old one, from unmigrated premium packs) with no shim in between.

## Verdict table

| Tool(s) | Status | Why |
|---|---|---|
| `apply-condition` | 🔴 **broken (throws)** | `CONFIG.statusEffects` is a plain object in 6.0.1 → `.map` TypeError |
| `apply-condition` (exhaustion) | 🔴 **wrong result** | `flags.dnd5e.exhaustionLevel` is dead; removal path *adds* a level |
| `update-actor` `ac`, `create-actor-from-compendium` `modifications.ac` | 🟠 shimmed, one path dead | `ac.calc/formula` are non-persisted; migration shim covers all but `calc:"default"` |
| `add-item` `wireAc` | 🔴 **no-op** | writes `ac.calc:"default"` → shim deletes it, `calcs` untouched |
| `get-combat-stats` | 🟠 **degraded** | chat flags moved to `message.system`; roll type is now `message.type`; targets lost `uuid` |
| `search-compendium-items` (rarity facet), `import-item`/`add-item` magic detection | 🟠 drift | `system.rarity` → `system.rarities` (Set); index + `isMagicItem` read the old key |
| `list-chat-messages`, `export-chat-log` | 🟠 degraded | 6.0 usage/roll cards are created with **no `content`**; body renders from `message.system` |
| `manage-effect`, `get-actor` effects | 🟡 shimmed | `changes` lives at `system.changes`; `duration.rounds` → `value`+`units` (core v14, until v16) |
| `update-actor`/`author-npc` movement | 🟡 shimmed | `movement.walk` → `movement.speeds.walk` (until dnd5e 7.0) |
| `create-pc`, `level-up-pc`, `inspect-pc-advancement` | 🟡 shimmed | `Advancement#title` → `name` getter (until 7.0); apply signatures unchanged |
| `get-compendium-entry`, `get-actor-entity`, `export-actor` | 🟡 shape change | raw source now carries `speeds`, `rarities`, `ac.calcs`, `system.changes` |
| `manage-activity`, `add-feature`, attacks, spells, `add-free-cast` | 🟢 compatible | every field we write still exists; 6.0 additions are additive with defaults |
| `post-item-card`, `request-roll`, `send-chat-message` | 🟢 compatible | `Activity#use/rollAttack/rollDamage` signatures unchanged; enrichers unchanged |
| `author-npc` (create) | 🟢 via migration | `ac:{calc:"flat",flat}` → `override`; `{calc:"default"}` → defaults; movement migrated |
| `create-group`, `set-primary-party`, `manage-group-members` | 🟢 | `addMember/removeMember`, `primaryParty` setting unchanged |
| `create-macro` (item macros), `add-region-behavior` (`dnd5e.difficultTerrain`) | 🟢 | APIs present, schemas unchanged (`dnd5e.rotateArea` is new/additive) |
| compendium creature/spell facets | 🟢 | index fields (`details.cr`, `type.value`, `traits.size`, `spell.level`, `legact.max`, `level`, `school`) unchanged |
| `content-audit`, ownership, journals, tables, cards, playlists, placeables, world/users | 🟢 | no dnd5e data dependency, or core-only |

## P0 — broken today

### A. `apply-condition` throws on every call
`src/page/dnd5e/conditions.ts:36` builds the valid-id set with
`(CONFIG.statusEffects ?? []).map(s => s.id)`. In 5.3.3 `_configureStatusEffects` built an array;
in 6.0.1 (`dnd5e.mjs` `_configureStatusEffects`) it is `{ [id]: data }` and assigned to
`CONFIG.statusEffects`. `.map` is not a function → the tool errors before touching the actor.
Fix: `Object.values(CONFIG.statusEffects ?? {})` (works for both shapes; core's own v14 value is an
array-proxy that also supports keyed access).

### B. Exhaustion level is set through a dead flag, and removal adds a level
`conditions.ts:60–95` toggles `exhaustion` on, then retries `eff.update({'flags.dnd5e.exhaustionLevel': lvl})`.
6.0.1 has **zero** references to `exhaustionLevel`. Leveled conditions are now AEs of
`type: "condition"` with `system.type: "exhaustion"` and **`system.level`** (`data/active-effect/condition.mjs`),
id `dnd5e.utils.staticID("dnd5eexhaustion")`. `Actor5e#toggleStatusEffect` routes leveled statuses to
`ConditionData._applyDelta(statusId, actor, { levels: options.levels ?? 1 })` **regardless of
`active`** — so our `toggleStatusEffect('exhaustion', { active: false })` removal path *increases*
exhaustion by one. The requested level is never applied (always 1).
Correct lever in 6.0.1: `actor.update({ 'system.attributes.exhaustion': N })` — the field is
persisted and `Actor5e#_onUpdateExhaustion` syncs the condition effect by delta (0 deletes it).
The 5.3.3 note "writing `attributes.exhaustion` does not stick" is obsolete.

### C. `add-item` `wireAc` no longer switches an NPC to armor-derived AC
`src/page/dnd5e/items.ts:510` writes `system.attributes.ac.calc = 'default'`. In 6.0.1 the AC model
(`data/actor/templates/attributes.mjs`) is:
- persisted: `calcs` (Set of `CONFIG.DND5E.armorClasses` keys, default `["unarmored","armored"]`),
  `flat` (used by `natural`), `formulas[]` (`{formula, label, armored, shielded}`), `override` (fixed AC);
- `persisted: false` (pruned on write): `calc`, `formula`, `bonus`, `armor`, `base`, `cover`, `min`, `shield`.

`_migrateArmorClass` maps legacy writes: `custom`+`formula` → `formulas`, `flat` → `override = flat`,
`natural` → `calcs = ["natural"]`, other keys → `calcs = ["unarmored","armored", key]`, and
**`default` → nothing** (just deletes `calc`). So the reset is a no-op and a natural-armor NPC keeps
`calcs: ["natural"]`. Native write: `{ 'system.attributes.ac.calcs': ['unarmored','armored'],
'system.attributes.ac.override': null }`.

## P1 — silent drift / wrong data

### D. `update-actor` `ac` contract is 5.x-shaped
`src/page/actors.ts:1835–1843` writes `ac.calc / ac.flat / ac.formula`; `ARMOR_CALC`
(`src/page/dnd5e/actor-fields.ts:160`) lists `flat/default/custom`, which are no longer calcs, and
misses `armored/unarmored`. Today the migration shim rescues `natural`/`flat`/`custom`/class calcs
(F-1 above), with edge cases: `calc:"flat"` without `flat` → `override: undefined` → cleaned to
`null` (clears an existing override); `calc:"natural"` without `flat` → `calcs:["natural"]` with
whatever `flat` was. Proposed contract (deterministic mapping mirroring `_migrateArmorClass`):
- `ac.override: number|null` — fixed AC (old `calc:"flat"`).
- `ac.natural: number` — `calcs:["natural"], flat:N` (old `calc:"natural", flat`).
- `ac.calcs: string[]` — qualifying base calculations (`unarmored`, `armored`, `mage`, `draconic`,
  `unarmoredMonk`, `unarmoredBarb`, `unarmoredBard`, `natural`).
- `ac.formulas: [{formula, label?, armored?, shielded?}]` — custom formulas (old `calc:"custom"`).
- keep `calc/flat/formula` as accepted legacy aliases, translated page-side, marked deprecated in
  the schema text. `get-actor` should report `calcs / override / formulas` plus derived `value`,
  `calc`, `label`.

### E. Chat messages: flags → `message.system`, typed messages, new target shape
`src/page/combat-stats.ts:43–46, 73–75, 81, 106` reads `flags.dnd5e.{use.itemUuid,item,targets,
originatingMessage,roll.type}`. In 6.0.1 (`data/chat-message/*`, `migration.mjs`
`migrateMessageData`):
- `message.type` ∈ `usage | attack | damage | healing | save | check | generic | hitDie | hitPoints |
  item | request | …`; `flags.dnd5e.roll.type` is gone. Old "ability/skill/tool" → `type:"check"`
  with `system.skill` / `system.tool` / `system.ability`; death saves → `type:"save"` with
  `system.type:"death"`; concentration → `system.type:"concentration"`.
- `system.item {id,type,uuid}`, `system.activity {id,type,uuid}`, `system.origin` (message id),
  `system.targets[] { actor (uuid), token (uuid), name, ac, img }` — **no `uuid` field** (#4720).
- World migration rewrites existing 5.x messages into the same shape, so one read path suffices;
  keep the flag reads only as a cheap fallback.
Effect today: no d20 records (`D20_TYPES.has(undefined)`), null `itemUuid`, null targets/origin on
stamped receipts → nat-20/1, advantage economy, death saves and target attribution all vanish.
(Cross-repo: `fvtt-mod-battleflow` v1.14 stamps are read alongside; if battleflow itself reads
`flags.dnd5e.roll`, its receipts are affected too — verify in that repo, out of scope here.)

### F. Rarity: `system.rarity` (string) → `system.rarities` (Set)
`src/page/compendium-facets.ts:150` requests index field `system.rarity`; `:209` filters
`{k:'system.rarity', o:'in'}`; `:236` projects `system.rarity`. `src/page/dnd5e/items.ts:352`
(`isMagicItem`, drives the Rule-9 loot mint default) tests `typeof system.rarity === 'string'`;
on a copied 6.0.1 document `toObject()` carries `rarities: [...]` only → falls through to the `mgc`
check. Writes (`items.ts:162`, `add-item`) are shimmed by `#migrateRarity`.
Premium packs are still 5.x builds, so their indexes still say `rarity` **today**; the moment a
migrated book ships (or the packs are unlocked and migrated) the rarity facet returns nothing.
dnd5e's own compendium browser filters both keys (`physical-item.mjs:88–113`) — do the same:
request both index fields, `OR` the predicates, project `rarities?.[0] ?? rarity`.

### G. 6.0 usage/roll cards have no `content`
`documents/activity/mixin.mjs` `_createUsageMessage` creates `{ type, system, title, speaker,
flags }` — `content` only when a legacy card is supplied. `src/page/chat.ts:92` returns
`m.content ?? ''`. `list-chat-messages` / `export-chat-log` (and session-scribe's alignment, which
reads them) get empty bodies for every activity card. Fix: when `content` is empty and
`m.system?.render` exists, use `await m.system.render({})` (ChatMessageDataModel), and surface the
new core `title` field.

## P2 — works through deprecation shims; modernize while touching the files

- **H. ActiveEffects (core v14, until v16).** `changes` is `system.changes`
  (`ActiveEffectTypeDataModel`), `mode` → string `type` (we already do this), `duration.{rounds,
  turns,seconds}` → `duration.value + duration.units (+ expiry)`, `duration.start*` → `start.*`.
  `effect.changes` on a document / `toObject()` is a **non-enumerable** getter (`shimData`).
  `src/page/effects.ts:7` documents the opposite ("changes is TOP-LEVEL, NOT system.changes") —
  that observation was the shim. dnd5e 6.0 adds `system.origin{actor,item,activity,effect,message,
  behavior,profile}`, `system.conditions`, `system.magical`, `system.rider.statuses`, and change
  fields `_id / conditions / replacement`. Modernize: write `system.changes`, read
  `effect.system.changes ?? effect.changes`, duration hints in `manage-effect` (`:77`) → `{value,
  units}`; `get-actor` effects (`actors.ts:416–432`) read `duration.value/units`.
- **I. Movement.** `movement.speeds.{walk,burrow,climb,fly,jump,swim}` (+ `multiplier` non-persisted,
  `ignoredDifficultTerrain`). Writes at `actors.ts:1856` and `npc.ts:180` are migrated; reads at
  `compendium.ts:931–936` and the `verify-actor-tooling` assertions rely on the `_shim` getters.
  Raw exports (`get-compendium-entry`, `export-actor`) already show `speeds`.
- **J. Advancement `title/icon` → `name/img`** (#5782): `advancement.ts:404` reads `adv.title` via
  the deprecation getter. Use `adv.name ?? adv.title`. `apply(level, data, {initial})` signatures
  are unchanged for every advancement type; `ItemGrant.apply` gained `skipExisting` (default true).
- **K. `details.source.*` writes** (`actors.ts:1783`, `advancement.ts:911`) — `system.source` has
  been the home since 4.x; still migrated by `#migrateSource` (NPC) / `SourceField`.
- **L. Comments/docs pinned to "dnd5e 5.3.3"** in `effects.ts`, `effect-changes.ts`,
  `conditions.ts`, `npc.ts`, `advancement.ts`, `chat.ts`; skill docs telling the DM to "set the
  actor's AC calc with update-actor" (`stat-block-builder/SKILL.md:209`,
  `physical-item-builder/SKILL.md:171`).

## Verified unchanged (no action)

- Actor fields we write: `abilities.<k>.{value,proficient}`, `skills.<k>.{value,ability}`,
  `attributes.hp.*` incl. `formula/tempmax`, `attributes.init.{bonus,ability}`,
  `attributes.senses.{ranges.*,units,special}`, `attributes.spell.level`,
  `attributes.spellcasting`, `spells.<lvl>.{value,override}` / `spells.pact.*`, `details.{cr,
  type.*,alignment,biography,habitat,treasure,level,originalClass}`, `resources.{legact,legres}
  .max`, `resources.lair.*`, `traits.{size,dr,di,dv,ci,languages,weaponProf.mastery}`, `currency`.
  `traits.size` is now an `ActorSizeField` (still a string; also accepts full keys like `medium`).
- Item fields: weapon/equipment/consumable/container/loot/tool/feat/spell/class/subclass schemas —
  only `rarity → rarities` changed; `damage.bonus` / `parts[].modifiers` / `duration.expiry` /
  `activity.description.value` / `activity.behaviors` are additive. Spell `method`/`prepared`/
  `sourceItem` unchanged.
- Activity models: `activation / duration / range / target / uses / consumption / effects / attack /
  damage / save / healing / check / spell(cast)` — all fields we write exist; Cast
  `spell.challenge.{attack,save}` became formula strings (our numbers are cast on clean).
- APIs: `Activity#use/rollAttack/rollDamage(config, dialog, message)`,
  `dnd5e.documents.macro.rollItem`, `dnd5e.Filter.performCheck` + operators, group
  `addMember/removeMember`, settings `disableAdvancements` / `primaryParty` / `rulesVersion`,
  `dnd5e.difficultTerrain` behavior schema, `Actor#toggleStatusEffect` for non-leveled statuses,
  `flags.dnd5e.cachedFor` on cast-cached spells.
- CONFIG key sets our validators embed: `conditionTypes` (26), `damageTypes` (13),
  `creatureTypes` (14), `skills` (18), `abilities`, `movementTypes` — identical in 6.0.1.
  `CONFIG.DND5E.senses` values are objects now, but nothing in `src/` reads them.
- Senses → token vision (#4698) and actor size → token size (#6676) are **derived at
  TokenDocument prep** behind `senseVisionSync` / `tokenSizeSync` settings, not persisted; our
  `tokenDefaults` (`sight.*`, ring off, randomImg off) still apply and are simply overridden at
  runtime where senses exist. No change.
- Compendium reads via `pack.getDocument()` return migrated documents (prepared shims apply).

## Status (2026-09-15, same day) — fixed AND smoked on the sandbox; shipped as v1.5.2

> Correction (2026-09-15, review): every live number in this document comes from the **sandbox**
> (14.367 / 6.0.1). Prod runs 14.364 / 5.3.3 until the owner upgrades it; the 2.x tools refuse to
> write there (`assertDnd5e` version guard, v2.1.3).

Offline gate `biome · tsc · 1533 tests · build · knip` green. Live on the sandbox (Foundry 14.367 +
dnd5e 6.0.1, `FOUNDRY_PROFILE=local`): `verify-actor-tooling` 29/29 · `verify-item-tooling` 11/11 ·
`verify-faceted-lookup` 36/36 · `verify-dnd5e-writes` 16/16 · `verify-npc-spellcasting` 32/32 ·
`verify-pc-build` 63/63 · `verify-cast-activity` 25/25 · `verify-free-cast` 28/28 ·
`verify-weapon-mastery` 14/14 · `verify-content-audit` 8/8 · `verify-group-tooling` 26/26 ·
`verify-macro-tooling` 26/26 · `verify-region-tooling` 22/22 · `verify-actor-read-fixes` 18/18 ·
`verify-scale-report` 10/10 · `verify-prefab-bridge` 8/8 · live integration suite
(`RUN_LIVE=1 npm run test:integration`) 83 passed / 3 skipped. A chat probe confirmed the 6.0
attack card shape (typed `attack`, no `content`, `system.item/targets/origin`), the rendered body
in `list-chat-messages`, and the d20 record in `get-combat-stats`.

Two more findings the smoke surfaced (fixed in the same release):
- dnd5e 6.0 dropped the `_` alias of `Filter`'s exact-match operator → creature CR / spell level
  exact facets threw ("Comparison function \"_\" could not be found"). Now `exact` (valid in 5.x too).
- Cast activity `spell.challenge.{save,attack}` are FormulaFields (strings): the writer now emits
  `"15"` / `""`, not `15` / `null`.
- `post-item-card` reported `posted: true` even when a `dnd5e.preUseActivity` hook vetoed the use
  (e.g. a require-target rule on an untargeted attack) — pre-existing honesty gap; it now returns
  `posted: false` + `reason`.

Tooling: `scripts/lib/bridge-config.mjs` — every verify/spike script and the integration harness
take `FOUNDRY_PROFILE=local` to run against the sandbox (prod remains the default).

| # | Change | Where |
|---|---|---|
| 1 | `apply-condition`: `Object.values(CONFIG.statusEffects)`; exhaustion via `system.attributes.exhaustion` (+ direct `system.level` on an existing effect), no toggle for leveled statuses | `src/page/dnd5e/conditions.ts` (+ new `conditions.test.ts`) |
| 2 | AC: pure `buildAcUpdate` translator (6.0 fields `override / natural / calcs / formulas`, 5.x `calc / flat / formula` kept as deprecated aliases); `ARMOR_CALC` = 6.0 keys; `wireAc` → `calcs` reset + `override:null`; `author-npc` flat → `override`; `get-actor` `derived.ac` reports `calcs / flat / override / formulas / calc / label` | `actor-fields.ts`, `actors.ts`, `items.ts`, `npc.ts`, `update-actor.ts`, `actor-creation.ts`, 2 skill docs |
| 3 | `get-combat-stats`: pure readers `messageRollType / messageItemUuid / messageOrigin / messageTargets` over typed messages + `message.system.*`, flags as fallback; wire shape to the fold unchanged (`targets[].uuid` = actor uuid) | `src/page/combat-stats.ts` (+ new `combat-stats.test.ts`) |
| 4 | Rarity dual-key: `rarityFilter` (`OR` of `rarities hasany` / `rarity in`), both index fields, `readRarity` projection, fallback matcher handles `OR`; `isMagicItemDoc` accepts `rarities`; compendium summaries read either | `compendium-facets.ts`, `items.ts`, `tools/compendium.ts` |
| 5 | Chat: `list/export-chat-log` render `message.system` when a card has no `content`; carry core `title` into records + transcripts | `chat.ts`, `chat-helpers.ts` |
| 6 | Effects: write/read `system.changes`; `normalizeDuration` (`{value,units,expiry}` + 5.x aliases), `normalizePatch`; `duration` on the tool schema; `get-actor` effects report v14 duration + `img` | `effects.ts`, `effect-changes.ts`, `manage-effect.ts`, `actors.ts` |
| 7 | Movement: write `movement.speeds.*` (+ `jump`); read `speeds ?? legacy` | `actors.ts`, `npc.ts`, `tools/compendium.ts`, `update-actor.ts` |
| 8 | Advancement `adv.name ?? adv.title` | `advancement.ts`, mock |
| K | `source` stamp: `system.source.*`, NPC-only gated; the PC stamp in create-pc removed (characters have no `source` field in 5.3.3 or 6.0.1 — it was always pruned) | `actors.ts`, `advancement.ts`, `npc.ts` |
| — | Verify scripts: `FOUNDRY_PROFILE=local` targets the sandbox; exhaustion asserts `system.level` (+ a remove case); AC asserts via `derived.ac`; rarity via `rarities` | `scripts/verify-actor-tooling.mjs`, `scripts/verify-item-tooling.mjs` |

Cross-repo: `fvtt-mod-battleflow` (v1.41.0 on disk) reads `flags.dnd5e.roll.type / targets[].uuid /
originatingMessage / item` throughout (`scripts/auto-damage.js`, `chip-spend.js`, `command.js`,
`cast.js`, `d20-folds.js`, …) — its stamps are on the same 6.0 cliff; its own 2026-09-15 handoff
already reports "the MCP is broken". `get-combat-stats` will read whatever it stamps, but the module
needs its own 6.0 pass. Not touched here.

## Sandbox smoke plan (blocked until the all-clear)

Run against `foundry-local5e` only; DESKTOP-NY; check no other session is driving it first.

1. `node scripts/prove-bridge.mjs`-style sanity (bridge joins 14.367, world reads).
2. `FOUNDRY_PROFILE=local node scripts/verify-actor-tooling.mjs` then
   `FOUNDRY_PROFILE=local node scripts/verify-item-tooling.mjs` (both now profile-aware; build
   first — they drive `dist/`). Every case should pass on the fixed tree; a failure is a real 6.0
   finding, not a script artifact.
3. Targeted probes (page-side `Foundry.evaluate`, one arg):
   - `update-actor ac:{calc:'natural',flat:15}` → read `_source.attributes.ac` (expect
     `calcs:['natural'], flat:15`) and derived `ac.value`.
   - `add-item wireAc` on a natural-armor NPC → expect no change (confirms C), then the native write.
   - exhaustion: `actor.update({'system.attributes.exhaustion':3})` → effect `system.level===3`;
     set 0 → effect deleted.
   - manage-effect create → `effect._source.system.changes` populated, `effect.changes` getter.
   - post-item-card `use` on an attack → inspect `message.type`, `message.system.targets`,
     `message.content` (expect empty), `await message.system.render({})`.
   - search-compendium-items rarity facet against the PHB pack (still 5.x index) → passes today;
     note the `rarities` result once a migrated pack exists.
   - create-pc L1 (fighter) → `npm run` spike or the `create-pc` tool; watch the console for the
     `title`/`icon` deprecation warnings and #7372 (Cast activities during advancement).
4. Clean up `ZZ-MCP-AT` docs (the script's `finally` does it).

## Proposed change list (ordered; maintenance-mode sized)

1. **conditions.ts** — `Object.values(CONFIG.statusEffects ?? {})`; exhaustion via
   `actor.update({'system.attributes.exhaustion': lvl})` (0 = remove), drop the flag/retry loop;
   never call `toggleStatusEffect` for leveled statuses. Update `conditions.test.ts`, the
   verify-script exhaustion assertion (`system.level`), `fvtt-mcp-actor-tooling-plan` memory note.
2. **AC** — page-side translator `acUpdateFor6(params)` (pure, unit-tested; mirrors
   `_migrateArmorClass`), new schema fields (`override`, `natural`, `calcs`, `formulas`) with the
   old three kept as deprecated aliases; `ARMOR_CALC` = 6.0.1 `armorClasses` keys; `wireAc` writes
   `calcs + override:null`; `author-npc` `acBlock` emits `override` / defaults natively; `get-actor`
   reports the new fields. Tests: `npc.test.ts`, `update-actor.test.ts`, `actors.test.ts`.
3. **combat-stats.ts** — read `m.type` / `m.system.{item,activity,targets,origin}`; map
   `check`→skill/tool/ability, `save`+`system.type`→death/concentration; targets by `token ?? actor`
   uuid; flag reads kept as fallback. Tests: `combat-stats.test.ts` fixtures → typed messages.
4. **compendium-facets.ts + items.ts** — dual-key rarity (index fields, `OR` predicate,
   projection), `isMagicItem` accepts `rarities`. Tests: `compendium-facets.test.ts`, `items.test.ts`.
5. **chat.ts** — render `m.system` when `content` is empty; include `title`.
6. **effects.ts / effect-changes.ts / manage-effect.ts / actors.ts** — native `system.changes`,
   `duration.{value,units}`; fix the header comments. Tests: `effect-changes.test.ts`,
   `manage-effect.test.ts`.
7. **movement** — write `speeds.*`; read `speeds.* ?? *`; verify-script assertions.
8. **advancement.ts** — `adv.name ?? adv.title`.
9. Docs: `docs/RELEASE.md` note, the two skill docs, `LOCAL.md` if it pins versions; dev-state
   memory (exhaustion lever, AC model, "6.0 smoke done" once it is).

Not proposed: chasing 6.0's new features (rules-type changes, effect conditions, teleport
activity, region-attached effects, calendar) — maintenance mode; add only if a skill needs them.
