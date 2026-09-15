---
name: stat-block-builder
description: >-
  Build a COMPLETE D&D 5e NPC in Foundry from a pasted/described stat block — not just the mechanics,
  the whole creature: all stats, special traits, actions/attacks, spells, effects, AND its inventory
  (the magic weapon it fights with, worn armor, carried gear, consumables, loot, coins), biography, and
  a finishing pass (art, ownership, folder). Use when the user wants to "build this monster", "make an
  NPC from this stat block", "stat out <creature>", "create a creature from this text", "build the boss
  with its gear and loot", or pastes a Monster-Manual-style block. Composes the actor-authoring tools
  (create-actor-from-compendium, author-npc, update-actor, add-feature, manage-activity, manage-effect, apply-condition, add-item,
  set-actor-art, set-actor-ownership, move-documents) into one coherent build with dnd5e judgment. The
  tools own correctness (field paths, activity/effect/item shapes, name→id, soft validation); this skill
  owns the parse, the orchestration, and the house rules.
---

# Complete-NPC builder

A judgment layer over the actor-authoring tools. It turns a stat block (pasted text, a Monster Manual
entry, or a freeform description) into a **fully-built, ready-to-play Foundry NPC** — base stats,
defenses, senses, special traits, actions, spellcasting, effects, **its full inventory and loot**,
biography, and a finishing pass — by sequencing the right tool calls. It adds NO new mechanics; every
tool it calls holds its own correctness.

Tools used: `create-actor-from-compendium` (prefab copy · prefab-as-base via `modifications`), `author-npc` (authored from scratch), `update-actor`, `add-feature` (features /
compendium-features / spells), **`import-item`** (COPY gear from a compendium — the default for
inventory), `add-item` (author homebrew gear — last resort), `manage-activity`, `manage-effect`,
`apply-condition`, `set-actor-art`, `set-actor-ownership`, `move-documents`, `update-actor-item`
(per-item corrections), the faceted discovery tools `search-compendium-creatures` /
`search-compendium-spells` / `search-compendium-items` (find things to copy by **type + facet** —
each searches the premium books only and never the SRD, so you don't reason about pack ids),
`search-compendium` (broad **name** lookup) / `get-compendium-entry` (full entry), plus `get-actor` /
`get-actor-entity` to read back. Defer item judgment to the [[physical-item-builder]] skill.

> **Faceted discovery returns minimal hits.** `search-compendium-creatures` / `-spells` / `-items`
> each return `results: [{ id, name, type, uuid, pack, packLabel, img, facets }]`, premium-first
> ranked. Pick a hit by name, then feed its **`pack` + `id`** straight into
> `create-actor-from-compendium`, `import-item`, or `get-compendium-entry` — no pack-id guesswork.

> **`add-feature` invocation shape.** It takes a top-level `mode` — only `feature`,
> `compendium-features`, or `items` — plus nested params. Authoring any single
> feature/attack/save/aura/spellcasting/spells/homebrew-spell is `mode: "feature"` with
> `feature.featureType` set to that value (e.g. `mode:"feature"`, `feature.featureType:"save"`);
> importing named features is `mode: "compendium-features"` with `compendiumFeatures.featureNames`.
> Below, shorthand like "`add-feature` `save`" always means that `mode:"feature"` +
> `feature.featureType` form — `featureType` is NOT a top-level mode.

## Authoring policy — READ FIRST

**Follow the shared project authoring policy:** read
[`_shared/authoring-policy.md`](../_shared/authoring-policy.md) (`.claude/skills/_shared/authoring-policy.md`)
— 2024 by default · compendium-FIRST (the premium books are the library; copy, don't author) · **never
the SRD** · custom = copy a base → modify → rename · can't find a 2024 match → **STOP and ASK** (never
fall back to 2014/SRD, never invent a value) · authoring, not play. Everything below applies those rules
with the actor-authoring tools.

- **⚠️ @scale gotcha when copying PC features onto an NPC.** 2024 class features (from the classes pack)
  and racial features (from the origins pack) are authored for PCs: their damage/uses often use a
  `@scale.*` formula whose value comes from the PC's class/species ADVANCEMENT — which an NPC doesn't
  have, so it resolves to nothing (0 damage). **The copy tools now REPORT this for you as a fact** — a
  feature imported with an unresolved token comes back with `unresolvedScale: [{path, formula}]` (and
  the message flags it), so you don't have to hunt for it. **You** then set an explicit die sized to the
  creature's CR/level: `update-actor-item` with a `patch` that sets that `path` to a literal die (e.g. a
  CR-5 dragonborn's breath weapon → `2d6`). The token typically sits at
  `system.activities.<id>.damage.parts.0.custom.formula` (a 2024 Breath Weapon has TWO activities — a
  cone and a line — patch both). `@prof` resolves fine on NPCs; only advancement-fed `@scale.*` dangles.
  The tool reports the token; **the die is your judgment, never the tool's** (design.md §2.1). (The full
  advancement-driven experience belongs to the future PC-actor builder — see project notes.)

## Step 0 — Walk the §6 ladder (prefab first, author last)

Decide HOW to create before building anything. Try the rungs **in order** — this is the spine, not a
preference:

1. **Prefab — the default.** Search the Monster Manual with `search-compendium-creatures`. If a
   suitable actor exists and the user just wants it in the world, `create-actor-from-compendium`
   (feeding the hit's `pack` + `id`) and you're done — jump to the finishing pass (Step 10). Real stats
   *and* art, zero authoring.
2. **Prefab-as-base — custom from a copy.** No exact match but a close one exists? Copy that MM
   creature and pass **`modifications`** (update-actor-shaped stat edits — cr/hp/ac/abilities/skills/
   defenses/biography/currency) in the SAME `create-actor-from-compendium` call to layer your changes onto the world
   copy; then add the distinguishing features/gear in the steps below. The edits land on the copy — the
   compendium entry is never touched. **This is the normal way to build a custom NPC:** start from real
   stats + art, then diverge. Parse the block (Step 1) to know what to change.
   > **⚠ Finish the divergence — don't leave the base's off-theme abilities behind.** `modifications`
   > only changes STATS (cr/hp/ac/abilities). If your creature's THEME differs from the base — you copied
   > a *radiant* Priest to make a *necrotic* Shar priestess — its inherited attacks and cantrips are now
   > off-theme. **`create-actor-from-compendium` reports the copied creature's `damageTypes`** (e.g.
   > `radiant, slashing`) in its result — read it and reconcile every off-theme type. `remove-from-actor`
   > the mismatched abilities and `add-feature` **real** replacements from the compendium (a necrotic
   > attack from `dnd-monster-manual.features` like *Withering Touch*, a necrotic cantrip like *Toll the
   > Dead* from the PHB). Reflavoring them with a *"treat its radiant as necrotic"* GM note is a
   > **forbidden cop-out** (shared-policy rule 7) — the NPC must really be what it claims. If the books
   > have nothing thematically fitting, STOP and ASK.
3. **Authored — last resort.** Only when nothing in the premium MM/PHB/DMG books is a workable base do
   you author from scratch (Step 2, `author-npc`). Per the [shared authoring policy](../_shared/authoring-policy.md),
   if there's no 2024 match, **STOP and ASK** before inventing content.

## Step 1 — Parse the stat block into sections

Read the block and pull out, in this order:
- **Header:** name, size, creature type (+ subtype), alignment.
- **Core:** AC (+ how it's derived), HP (average + formula), speeds (walk/fly/swim/climb/burrow, hover).
- **Abilities:** STR/DEX/CON/INT/WIS/CHA. **Saving throws**. **Skills** (proficient vs expertise).
- **Defenses:** damage immunities / resistances / vulnerabilities, condition immunities.
- **Senses:** darkvision/blindsight/tremorsense/truesight + passive Perception; **Languages** (+ telepathy). **CR**.
- **Traits** (passive, no roll): Magic Resistance, Pack Tactics, Regeneration, etc.
- **Actions / Bonus Actions / Reactions:** Multiattack, melee/ranged attacks, save-based abilities, heals.
- **Legendary actions / resistances / lair actions.**
- **Spellcasting** (innate or class-based).
- **Equipment / Gear / Treasure:** the weapon(s) it wields, worn armor/shield, carried items, consumables,
  loot, and coins. (Often only implied — a knight has plate + a sword; infer reasonably or ask.)

If a section is missing or unreadable, ask before guessing.

## Step 2 — Create the base actor

If you took rung 1 (prefab) or rung 2 (prefab-as-base) in Step 0, the actor already exists — skip
ahead to layer on its distinguishing parts (Step 4+). This step is **rung 3 only** (authored from
scratch, after the books had no workable base):

`author-npc` with the flat stat-block fields (name, creatureType, size, cr, abilities, hpAverage,
hpFormula, acMode, … — the NPC builder sets abilities, saves, HP, AC, movement, senses, CR, type,
size, skills, languages, defenses in one call).

## Step 3 — Actor-level edits (`update-actor`)

For a **prefab-as-base** build (rung 2), the bulk of your stat changes already went in the
`modifications` at create time — use this step only for what's left. Otherwise `update-actor` for
anything the base builder doesn't cover or that you want to set precisely:
`telepathy`, `legendaryActions`, `legendaryResistances`, `lair`, 2024 `habitat` / `treasure`,
`biography`, `source`, and **`currency`** (the creature's coin purse — `{mode:"set", gp, sp, …}`). Use
`update-actor` for ALL later actor-level corrections too (Set fields take `mode: replace|add|remove`).

## Step 4 — Special traits, class features & racial abilities (prefer compendium import)

For official, named traits/features **prefer importing** them so the real text/mechanics + art come in,
via `add-feature` mode `compendium-features` (pass `featureNames`; first-match-wins). The tool
**defaults its `compendiumPacks` to the premium feature packs** (Monster-Manual features + PHB classes)
and refuses any `dnd5e.*` SRD pack (design.md §2.3) — so for the two common cases you **name no packs at
all**, just the feature names:
- **Monster traits** (Pack Tactics, Nimble Escape, Magic Resistance, Multiattack) — covered by the
  default MM-features pack.
- **Class features** (Lay on Hands, Channel Divinity, Fighting Style, …) — covered by the default PHB
  classes pack: each 2024 class feature is its own importable `feat` (the pattern the official sample
  PCs use).
- **Racial abilities** (a dragonborn's Breath Weapon, etc.) live in the **origins** pack, which is *not*
  a default — so this is the one case you override `compendiumPacks: ["dnd-players-handbook.origins"]`.
  E.g. in the 2024 PHB it is a single feat named **`Breath Weapon`** (the damage type follows the
  dragonborn's Draconic Ancestry; set it to match) — import it by that name (it carries the real cone +
  line save activities, type, uses), then **set its dangling `@scale` die** to an explicit value for the
  creature's CR. The import REPORTS the token for you (`unresolvedScale` on the result, at
  `system.activities.<id>.damage.parts.0.custom.formula = @scale.breath-weapon.die` on BOTH activities)
  — patch each with `update-actor-item` (see the @scale gotcha above). Don't author racial abilities by hand.

Only author from scratch with `add-feature` mode `feature` / `featureType: "passive"` (`featType:
"monster"`, prerequisite in `requirements`) for genuinely homebrew traits with no compendium source.
> **⚠ An authored feature ships with a BLANK star icon — set its art.** `add-feature` takes no `img`, so
> after authoring ANY `passive` / `attack` / `save` / Multiattack feature, set its icon with
> `update-actor-item img`, grabbing it from the compendium feature you're emulating (a real MM feature's
> `img`, e.g. `icons/skills/melee/strike-weapons-orange.webp` for a Multiattack). Every row on the sheet
> must carry real art — a blank star is unfinished (shared-policy rule 8).

## Step 5 — Actions, attacks, and abilities

Map each action to the right tool:
- **The weapon it fights with** → COPY the real weapon from a compendium with `import-item` (it arrives
  with its attack activity + artwork), `equipped: true`. For a magic/custom weapon, copy the closest base
  then modify+rename (see [[physical-item-builder]]). Author a `weapon` with `add-item` only for true
  homebrew with no base. Either way it must be a real weapon item with an attack so to-hit/damage derive
  from it — not a generic natural strike.
- **Natural attacks** (claws/bite/etc.) → `add-feature` `attack` (`weaponClass: "natural"`).
- **Attack that also forces a save** (e.g. Stinger: pierce + CON save) → `add-feature` `attack-with-save`.
- **Save-or-suffer ability** (frightful presence, a homebrew breath) → `add-feature` `save` (+ `areaType`).
  But a **racial breath weapon** (dragonborn) should be COPIED from the origins pack (Step 4) — copy the
  `<Element> Breath Weapon` feat, then fix its `@scale.*` damage die — not authored.
- **Automatic-damage aura** → `add-feature` `aura`.
- **Multiattack** → import it (Step 4) or author a `passive` named "Multiattack" with the text;
  optionally give it a clickable action via `manage-activity` (`utility`).
- For an action that needs a rollable button or a second activity on an existing item → `manage-activity`
  (`add`/`edit`/`remove`/`list`).

## Step 6 — Spells

Class-based → `add-feature` `spellcasting` (sets slots) then `spells` (import the real spells by name).
Innate / homebrew → `add-feature` `homebrew-spell` (`spellMethod: "innate"`, components, optional
`spellActivity`).

When the block names its spells you can import them straight by name. When you need to *find* spells —
verify an exact name, or pick by criteria (e.g. "a CR-appropriate fire evocation") — use
`search-compendium-spells` (facets: `spellLevel`, `spellSchool`, `damageType`, `name`); it searches the
premium books only, so no pack-id reasoning. Then import the confirmed names via `add-feature` `spells`.

## Step 7 — Effects and starting conditions

For ongoing derived modifiers that aren't a base-stat value (a permanent +1 AC aura, granted resistance)
→ `manage-effect` (`create`, `changes: [{key, value, type}]`). Prefer putting *static* defenses (fixed
resistances, a fixed AC) on the actor via `update-actor`; reserve effects for toggleable/derived bonuses.
Conditions the creature *starts* with (rare) → `apply-condition`.

### dnd5e 6.0 effects — when a trait is really a rule, a condition, or a timer

A copied MM creature already carries its 6.0 effects. These recipes are for the AUTHORED path — a
custom trait the books don't have. The tool validates every shape (it refuses a bad key × type, an
unknown Filter operator, a `roll.*` key in the wrong place); you choose the model.

- **Roll-time modifiers = RULES changes, never a data path.** "Advantage on saving throws", "+1d4 to
  attack rolls", "attacks can't roll below 10" have NO field on the sheet — they are `changes[]` with a
  rules `type` and a roll CATEGORY as the `key`: `key` ∈ `attack | check | d20 | save` (all four types)
  or `damage | healing` (`dnd5e.bonus` only). Evaluated when the die is rolled, on that roll only.
  - `dnd5e.advantage` — `value` `+1` (add advantage) / `-1` (add disadvantage) / `=+1` `=-1` (force) /
    `>=0` (ignore disadvantage) / `<=0` (ignore advantage).
  - `dnd5e.bonus` — `"1d4"`, `"2"`, `"@prof"`; on `damage` a type tag changes the damage type:
    `"1d4[fire]"`.
  - `dnd5e.minimum` / `dnd5e.maximum` — a deterministic d20 floor / ceiling (`"10"`, `"@prof"`).
- **Narrow a rule with a CHANGE condition** (`changes[].conditions`, a Filter) — the only place the
  `roll.*` keys exist: `roll.ability` (`str` …), `roll.skill` (`his`, `med` …), `roll.type` (`attack`,
  `skill`, `save` …), `roll.attack.type` (`melee` | `ranged`), `roll.attack.mode` (`thrown`,
  `offhand` …), `roll.attack.classification` (`weapon` | `spell` | `unarmed`), `roll.damage.type`,
  `roll.proficient`, `roll.tool`. The worked recipes:
  - ranged attacks never roll below 10 → `{key:"attack", type:"dnd5e.minimum", value:"10",
    conditions:{k:"roll.attack.type", v:"ranged"}}`
  - +1d4 damage with thrown weapons → `{key:"damage", type:"dnd5e.bonus", value:"1d4",
    conditions:{k:"roll.attack.mode", o:"startswith", v:"thrown"}}`
  - +proficiency to all fire damage → `{key:"damage", type:"dnd5e.bonus", value:"@prof",
    conditions:{k:"roll.damage.type", v:"fire"}}`
  - disadvantage on Strength-based d20 tests → `{key:"d20", type:"dnd5e.advantage", value:"-1",
    conditions:{k:"roll.ability", v:"str"}}`
  - +1d4 on History and Medicine checks → `{key:"check", type:"dnd5e.bonus", value:"1d4",
    conditions:{o:"OR", v:[{o:"AND", v:[{k:"roll.ability", v:"int"}, {k:"roll.skill", v:"his"}]},
    {o:"AND", v:[{k:"roll.ability", v:"wis"}, {k:"roll.skill", v:"med"}]}]}}`
  - +1d4 on Charisma (Deception / Intimidation / Persuasion) → `conditions: [{k:"roll.skill", o:"in",
    v:["dec","itm","per"]}, {k:"roll.ability", v:"cha"}]` (a bare array = AND)
- **A trait that only applies in a state = an EFFECT condition** (top-level `conditions`, a Filter over
  the actor's roll data — `statuses.*`, `attributes.*`, `abilities.*`, `details.*`, `item.*` on an
  item effect). "+2 AC while Bloodied" → `conditions: {k:"statuses.bloodied", v:1}` with a normal
  `{key:"system.attributes.ac.bonus", value:"2", type:"add"}` change. (`roll.*` is NOT visible here —
  the effect is evaluated before any roll; put roll gates on the change.) Filter grammar: `{k, v, o?}`
  with `o` ∈ `exact` (default) `in has hasany hasall contains icontains startswith endswith empty gt gte
  lt lte subsetof`; combine with `{o:"AND"|"OR"|"NAND"|"NOR"|"XOR", v:[…]}` / `{o:"NOT", v:{…}}`.
- **Timers = `duration.expiry`.** "Until the end of the target's next turn" → `duration: {expiry:
  "targetEnd"}`; "until the start of its next turn" → `sourceStart`; "until it finishes a short/long
  rest" → `shortRest` / `longRest` — these need no value. A core combat event (`turnEnd`, `roundEnd`,
  `combatEnd` …) fires only once a duration has ALSO elapsed, so pair it: `{value: 1, units:
  "rounds", expiry: "turnEnd"}`. On an activity, `manage-activity` `duration: {…, expiry}` does the
  same and the effects it applies inherit it ("Frightful Presence: frightened until the end of the
  target's next turn").
- **`replacement: "origin"`** on a change freezes `@attribute` strings to the APPLYING actor's numbers
  (a curse that deals the caster's `@abilities.cha.mod`); `"target"` uses the receiver's.
- **`magical: true`** marks the effect as magical (dispellable / suppressed in an antimagic field).
- **Read it back.** `manage-effect` `list` and `get-actor` show each effect's `type`, `magical`,
  `conditions` (parsed) and every rules change as a sentence ("+1d4 to attack rolls when
  roll.attack.type = ranged"). `content-audit` flags a dead rule (a rules type on a data path, or a core
  type on a roll category) — a silent no-op in play.

### dnd5e 6.0 areas — a trait that lays down a zone (Web, Grease, Spike Growth, a cloud)

An authored area action is a `manage-activity` activity with a **`template`** (the measured
template the DM places — `{type: "cube"|"sphere"|"cone"|"line"|"cylinder"|"radius", size}` in feet)
and **`behaviors`** the template carries while it stands:
- `{type: "applyActiveEffect", effects: ["Restrained"]}` — every creature inside gets the effect,
  removed when it leaves. Effect names come from the stock `dnd5e.effects` pack (the conditions,
  resistances, advantages), a world item's effect (`"Item#Effect"` — author it with `manage-effect`
  on a world "Effects" item first), or a premium spell's effect (`"<Item uuid>#<effect>"`). Narrow
  with `sizes` / `creatureTypes`; `affects: {type: "enemy"}` on the activity makes it hostile-only.
- `{type: "difficultTerrain", terrainTypes: ["web"]}` — difficult terrain of that kind (spiders
  ignore web; `plants` for Spike Growth / Entangle, `ice`, `mud`, `liquid` …).
- Recipes: **Web** → `type: "save"`, `saveAbility: "dex"`, `template: {type: "cube", size: 20}`,
  `behaviors: [{type: "applyActiveEffect", effects: ["Restrained"]}, {type: "difficultTerrain",
  terrainTypes: ["web"]}]`, `duration: {value: 1, units: "hour"}`; **Grease** → `save` dex +
  `template: {type: "square", size: 10}` + `[{type: "applyActiveEffect", effects: ["Prone"]},
  {type: "difficultTerrain", terrainTypes: ["liquid"]}]`; **Stinking Cloud** → `template: {type:
  "sphere", size: 20}` + `effects: ["Poisoned"]`; **Spike Growth** → `difficultTerrain` `plants`
  (the 2d4 per 5 ft is the activity's own damage, not a behavior).
- Behaviors ride on the template: the tool refuses `behaviors` without one. Reading: `manage-activity
  list` shows each activity's `template` + `behaviors`. A copied PHB spell already carries its own
  behaviors when the book ships a 6.0 build — copy first, author only when the books don't have it.

### dnd5e 6.0 teleport — Misty Step-style traits

A trait that moves the creature is a `manage-activity` `type: "teleport"`: `teleportDistance: 30`
(feet; a formula like `"@prof * 10"` works; omit it for "any distance" — a plane shift), the action
economy on `activationType` (Misty Step / Blink Step = `"bonus"`), and who moves on `affects` —
the default is self; Dimension Door-style "you and one willing creature" = `affects: {type:
"willing", count: 1}`. In play the system prompts for the destination inside the distance and moves
the token(s). Pair with `duration` / effects as usual (a shadow that teleports and gains advantage
until its next turn = a teleport activity + a rules effect with `expiry: "sourceStart"`).

### dnd5e 6.0 transform — shapeshifters, Wild Shape, Polymorph

A creature that changes into something else is a `manage-activity` `type: "transform"`; pick the
mode by how the block reads:
- **A fixed list of forms that are OTHER creatures** ("can transform into a wolf, a bear, or its
  true form") → `transformMode: "direct"`, `profiles: [{actor: "Wolf"}, {actor: "Brown Bear"}]` —
  actor by exact Monster Manual name (the MM wins a tie with the DMG's copies) or uuid; the SRD is
  refused. `transformPreset: "wildshape"` keeps the mind (Int / Wis / Cha, class features merge),
  `"polymorph"` replaces everything, `"polymorphSelf"` changes only the appearance.
- **"Any beast of CR ½ or lower"** → `transformMode: "cr"`, `profiles: [{cr: 0.5, creatureTypes:
  ["beast"], restrictMovement: ["fly"]}]`; the player picks from the compendium browser at use time.
  Level-gate tiers with `level: {min, max}` (2024 Wild Shape: CR ¼ no fly/swim to L3, CR ½ no fly
  L4–7, CR 1 from L8) — the transform level is the creature's level, or the class identifier's.
- **A lycanthrope's Humanoid / Hybrid / Beast forms, or Disguise Self** — the forms are the ITEM's
  OWN effects, not other actors → author each form as an effect on the trait item first
  (`manage-effect` with `actorIdentifier` + `itemIdentifier`, `transfer: false`, its changes ARE
  the form: AC, speed, size, senses, a `dnd5e.bonus` damage rule for the beast's bite), then
  `transformMode: "form"`, `forms: ["Humanoid Form", "Hybrid Form", "Wolf Form"]`, `formless:
  true` when "no form" is a valid state. Bites and claws that only exist in a form stay as attack
  activities on the same item (gate them with an effect condition on `statuses`/the form if needed).
- Reading: `manage-activity list` names the profiles; the DM reverts a transformed actor from the
  sheet header. Copy the MM's shapeshifter first — author only when the block is custom.

## Step 8 — Inventory, gear & loot (compendium-first via `import-item`)

Build the rest of what the creature carries and drops — COPY from the 2024 PHB/DMG compendiums first;
defer item judgment to [[physical-item-builder]]:
- **Find then copy:** discover gear with `search-compendium-items` (facets: `documentType`
  gear|weapon|armor|consumable, `rarity`, `itemType`, `magical`, `name` — premium books only, never the
  `dnd5e.*` SRD, so no pack-id reasoning) → `import-item` the chosen hit (`packId` = its `pack`,
  `itemId` = its `id`, plus `actorIdentifier`). Copies bring correct stats AND art.
- **Worn armor / shield** → `import-item` the real armor/shield. A stat block's fixed AC is
  `ac: {override: N}` on `update-actor` (author-npc `acMode: "flat"` does the same); a creature whose
  AC should come from worn armor needs the override cleared (`ac: {override: null}` — the default
  calcs then use the armor) and natural armor is `ac: {natural: N}`. A shield's +2 applies under
  every calculation except an override. When you must AUTHOR body armor via `add-item`, pass
  `wireAc: true` to put the actor back on armor-based AC.
- **Carried gear, consumables, loot** → `import-item` potions/scrolls, magic trinkets, tools, gems. Use
  `equipped: false` for stowed items, `identified: false` for mystery loot.
- **Custom magic gear** → copy the closest base, then modify (`update-actor-item` / `manage-activity` /
  `manage-effect`) and rename. Author with `add-item` only as a last resort (and ASK first).
- **Containers** → copy/create a `container` first, then place items with `container: "<name>"`.
- **Coins** → already on the actor via `update-actor` `currency` (Step 3).
> **⚠ A magic item on the NPC is ALSO loot — now AUTOMATIC.** When you `import-item` / `add-item` a
> magic item onto the NPC, the tool also mints a matching loose **world Item** (same stats + real icon)
> in a loot folder so the party can loot it (shared-policy rule 9). Steer it with `lootCopyFolder`
> (default `"Loot"` — pass your treasure folder); `lootCopy: false` suppresses it, `lootCopy: true`
> forces a copy of mundane gear. **Don't hand-create the world Item too — that double-mints it.**

## Step 9 — Biography

If not set in Step 3, `update-actor` `biography` (HTML) — lore, tactics, appearance, roleplay notes.

## Step 10 — Finishing pass

- **Art** → `set-actor-art` (portrait + token texture from a Data-relative path; upload first if needed).
  A hand-authored NPC (`author-npc`) already gets a real creatureType portrait + token from the tool, so
  this is only to upgrade it to specific art.
- **Ownership** → `set-actor-ownership` (most NPCs stay GM-only; grant the party observer access to a
  visible ally if wanted).
- **Folder** → `move-documents` to file the finished NPC somewhere findable.
- **Audit (do this before declaring done)** → run `content-audit` (`actorIdentifiers: [<npc>]`, plus any
  loot `itemFolders`). It flags placeholder icons (rule 8), GM-fudge language (rule 7), and magic items
  with no loot twin (rule 9). Fix each finding (`update-actor-item img` / replace fudged mechanics /
  mint the missing copy) and re-run until clean.

## Step 11 — Read back and confirm

`get-actor` for the summary (HP/AC/abilities/skills/saves show real derived modifiers; inventory shows
equipped/attunement/quantity; coins show under currency) and `get-actor-entity` to spot-check a specific
item's activities. Report the full build — base stats, traits, each action/attack, spells, effects,
**inventory + loot + coins**, biography, art/ownership/folder — and flag anything you had to ask about
or approximate.

## Notes

- **A new tool/param needs a Claude Code restart** to load into the running MCP server; the live
  acceptance scripts bypass this via `dist/`.
- Names must be unique on the actor — `add-feature` and attacks reject a duplicate name; rename or remove
  first. (`add-item` allows duplicate stacks.)
- Keep `sourceRules` consistent across the whole build (**2024 by default** — see the shared authoring
  policy; pass `2014` only when the user explicitly wants legacy content).
- Per-item corrections after the fact → `update-actor-item` (dot-path patch); per-actor corrections →
  `update-actor`.
