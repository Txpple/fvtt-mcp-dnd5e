---
name: physical-item-builder
description: >-
  Author D&D 5e physical items — weapons, armor, shields, wondrous items, potions/scrolls,
  ammunition, tools, gems/loot, containers — as Foundry items, compendium-first (copy the real
  PHB/DMG item, modify + rename for custom, author from scratch last). Use when the user wants to
  "make a magic sword", "create a +1 longsword", "add a healing potion", "give this NPC some loot /
  treasure / gear", "stat out this magic item", "build a flame tongue", "fill this chest with loot",
  or pastes a DMG-style item entry.
---

# Physical-item builder

A judgment layer for putting D&D 5e gear into Foundry. It turns an item description — a DMG entry, a
stat-block "Equipment" line, or "give the boss a flaming greatsword" — into correctly-shaped, **art-
bearing, edition-correct** Foundry items. It adds NO new mechanics; the tools hold the field shapes.

## Authoring policy — READ FIRST

**Follow the shared project authoring policy:** read
[`_shared/authoring-policy.md`](../_shared/authoring-policy.md) (`.claude/skills/_shared/authoring-policy.md`)
— 2024 by default · compendium-FIRST (copy the real PHB/DMG item with `manage-items` `import`, even for plain gear;
don't author) · **never the SRD** · custom = copy a base → modify → rename · can't find a 2024 match →
**STOP and ASK** (never fall back to 2014/SRD, never invent a rarity/price/damage die) · authoring, not
play. The **item-specific** shaping rules are in "House rules for shaping items" below.

Tools: **`manage-items { action: "import" }`** (copy from a compendium — the default path), **`search-compendium-items`**
(faceted discovery by rarity / subtype / magical — the default way to *find* gear), **`search-compendium`**
(broad name lookup) / **`get-compendium-entry`** (confirm the entry; you copy by the hit's `pack` + `id`),
**`add-item`** (author from scratch — homebrew last resort only), **`manage-actors` `update`** (actor
`currency`/coins), **`update-actor-item`** / **`manage-activity`** / **`manage-effect`** (modify a copied
base into a custom item), **`manage-actors` `get` / `get-actor-entity`** (read back).

## Target: actor inventory vs world library

- Pass **`actorIdentifier`** to put the item on an NPC/PC (its inventory).
- Omit it (optionally pass **`folder`**) to create a reusable world Item in the sidebar — for a shared
  treasure library or loot handed out later.

## Step 0 — Find it in the compendium (the default path)

Discover the item with **`search-compendium-items`** — faceted by `documentType`
(gear|weapon|armor|consumable), `rarity`, `itemType` (subtype: wondrous / potion / ring / wand / …),
`magical`, and `name`. It searches the **premium books ONLY** (never the `dnd5e.*` SRD, design.md §2.3)
and ranks them first, so you don't reason about pack ids. (For a quick exact-name lookup,
`search-compendium` by name also works.) Confirm a hit with `get-compendium-entry` if you need the full
entry, then copy it with **`manage-items` `import`** (`packId` = the hit's `pack`, `itemId` = its `id`, plus
`actorIdentifier` or `folder`). On-copy you can `name`-rename, set `quantity`, `equipped`, `identified`,
or nest in a `container`. Done — it has the right stats and art.

## Step 1 — Custom or magic variant (copy a base, then modify, then rename)

If the exact item isn't in a compendium but a close base IS (the common case for homebrew magic items):

1. **Copy the closest base** with `manage-items` `import` — e.g. a `Shield` or `+1 Shield` from the DMG, a plain
   `Mace`, a `Longsword`.
2. **Modify it** to match the concept:
   - `update-actor-item` (dot-path patch) — bump `system.armor.magicalBonus`/weapon `magicalBonus`,
     add `system.uses` (charges, e.g. 1/day at dawn), edit the description, set rarity/price.
   - `manage-activity` — add/edit a rollable activity (an extra damage rider, a utility action).
     **dnd5e 6.0:** an item that lays down a ZONE (a Bead of Force sphere, a Dust of Dryness pool, a
     net that webs an area) is an activity with `template: {type, size}` + `behaviors` —
     `[{type: "applyActiveEffect", effects: ["Restrained"]}, {type: "difficultTerrain",
     terrainTypes: ["web"]}]` — effect names from the stock `dnd5e.effects` pack or an effect you
     authored on the item (`"<item name>#<effect>"`). Recipes: [[stat-block-builder]] Step 7.
   - `manage-effect` — model a passive bonus a wondrous item grants (a Cloak of Protection's +1 AC/saves
     has no numeric field; it MUST be an ActiveEffect). **dnd5e 6.0:** a bonus that only exists when a
     die is rolled is a RULES change — `{key:"attack"|"check"|"d20"|"save"|"damage"|"healing",
     type:"dnd5e.bonus"|"dnd5e.advantage"|"dnd5e.minimum"|"dnd5e.maximum", value}` — narrowed by a
     change `conditions` Filter on the `roll.*` keys: a Bracer of Archery-style "+2 damage with bows" is
     `{key:"damage", type:"dnd5e.bonus", value:"2", conditions:{k:"roll.attack.type", v:"ranged"}}`; a
     Stone of Good Luck-style "+1 to checks and saves" is two changes, `{key:"check",
     type:"dnd5e.bonus", value:"1"}` + `{key:"save", type:"dnd5e.bonus", value:"1"}` (a plain
     "advantage on saving throws" property would be `{key:"save", type:"dnd5e.advantage", value:"+1"}`); a
     Flame Tongue-style "+2d6 fire" is `{key:"damage", type:"dnd5e.bonus", value:"2d6[fire]",
     conditions:{k:"roll.item.name", v:"Flame Tongue"}}` — a transferred item effect's rule applies to
     ALL the wearer's rolls in that category, so gate "with this weapon only" on `roll.item.name` (the
     item making the roll; the top-level `item.*` is the item that carries the effect). An enchantment
     that fits only some weapons uses the
     effect-level `conditions` over `item.*` (`{o:"OR", v:[{k:"item.type.value", o:"in",
     v:["simpleR","martialR"]}, {k:"item.properties", o:"has", v:"thr"}]}`). Set `magical: true` on a
     magic item's effect. Full recipes + the Filter grammar: [[stat-block-builder]] Step 7.
3. **Rename** to the custom name (the import's `name` on copy, or `update-actor-item`).

> **If the import reports an unresolved `@scale` token** (rare — a magic-item feature rider whose damage/uses
> use an advancement-fed `@scale.*` formula), it's flagging a dangling token as a fact, just like the
> NPC case. Set an explicit value at the reported `path` with `update-actor-item`; the tool reports the
> token, you choose the die (design.md §2.1).

## Items that cast a spell → a `cast` activity that LINKS the real spell (NOT a hand-rolled one)

A wand/weapon/wondrous item that casts a spell (a Wand of Fireballs, a sword that casts *fireball*, a
shield that casts *shield*) must model the spell as a **`cast` activity that links the REAL book spell** —
**never** a hand-rolled `save`/`damage`/`utility` activity that re-implements it. The cast activity makes
Foundry cast the genuine spell, so its **measured template (sphere/line/cube), save/attack, scaling and
effects all come from the spell for free**. A hand-rolled stand-in has none of that — it shows in the use
menu but does **NOT** actually cast (no template pops). This is the #1 magic-item mistake; don't make it.

- **The spell is compendium-first too.** It MUST be a real 2024 book spell. If a named spell isn't in the
  books (e.g. *Snilloc's Snowball Swarm*), **STOP and ASK** — substitute a real spell, drop it, or get
  explicit homebrew permission. NEVER fabricate a fake activity to stand in for an off-book spell (same
  rule as a monster's off-book feature — see `_shared/authoring-policy.md`, design.md §2.3).
- **Build it with `manage-activity` `action:"add", type:"cast"` — ONE validated call** (mirrors the DMG
  Wand of Fireballs `dmgWandOfFirebal`). Get the spell uuid from `search-compendium-spells` (it's
  `Compendium.<pack>.Item.<id>`); pass it as `spellUuid`. The tool **resolves the spell for you** — it
  pulls the spell's level + V/S/M components + name, and **refuses an off-book or SRD uuid** (the
  STOP-and-ASK above is enforced at the tool boundary, not just by you). Params:
  ```
  manage-activity {
    action:"add", type:"cast",
    itemIdentifier:"<item id/name>",            // + actorIdentifier:"<actor>" if the item is on an actor
    spellUuid:"Compendium.dnd-players-handbook.spells.Item.<spellId>",
    charges:<n>,            // item uses spent per cast; OMIT for an at-will cast (e.g. a cantrip)
    saveDC:<n>,            // pins a FIXED save DC … OR …
    attackBonus:<+N>,      // pins a FIXED spell-attack … OMIT BOTH to defer DC/attack to the caster
    castLevel:<lvl>,       // optional — defaults to the spell's base level (set higher to upcast)
    activationType:"action"|"bonus"|"reaction",   // optional, default "action"
    name:"Cast <Spell>"    // optional — defaults to "Cast <spell name>"
  }
  ```
  `add` **deep-merges**, so a weapon's base Attack activity is preserved (the cast is added alongside).
  Charges live on the ITEM (`manage-items` `update` `system.uses.max` + `recovery:[{period:"dawn",
  type:"recoverAll"|"formula",formula}]`); the cast's charge consumption is wired by `charges`. The fixed
  `saveDC` is stored but **sanitized from read-back** (data is correct; `attackBonus` shows). To swap a
  wrong activity for a cast: `manage-activity remove` the old, then `manage-activity add` the cast.
- **⚠️ Placed copies do NOT auto-update.** Dragging an item onto an actor makes an independent COPY;
  editing the world item afterward does not touch copies already on actors — they go stale. After any
  fix, **re-drag** the item (or edit the on-actor copy directly). Tell-tale that you're looking at a
  stale copy: the on-sheet activity shows an OLD name/behaviour. Always test on a freshly-placed copy.

## Step 2 — True homebrew with no compendium base (last resort — ASK first)

Only when nothing in any compendium fits, author from scratch with **`add-item`** (pick `itemType`,
supply the fields). Because this skips the compendium (GM-judged stats, and a generic placeholder icon), **tell the user
you're authoring from scratch and confirm the key values** (rarity, price, damage) rather than inventing
them — and **pull an approximating icon from the compendium** (see House rules) so it never ships blank.

### itemType reference (for the add-item author path)

| The item is… | `itemType` | Key params |
|---|---|---|
| A weapon (sword, bow, claws) | `weapon` | `damage`, `weaponClass`, `attackType`, `reachFt`/`rangeFt` |
| Body armor | `armor` | `armorType` (light/medium/heavy), `armorValue`, `dex`, `strength` |
| A shield | `shield` | `armorValue` (default +2) |
| A ring / cloak / wondrous item | `wondrous` | `equipmentType`, `magical`, `attunement` |
| Potion / scroll / wand / poison | `consumable` | `consumableType`, `uses` |
| Arrows / bolts / bullets | `consumable` | `consumableType: "ammo"`, `subtype`, `quantity`, `damage` |
| Artisan tools / instrument / kit | `tool` | `toolType`, `ability`, `proficient` |
| Gem / art object / trade good / junk | `loot` | `lootType`, `price` |
| Bag / chest / pouch | `container` | `capacity`, `currency` |

## House rules for shaping items (apply to copied OR authored items)

- **Never ship a blank or generic icon.** `add-item` now AUTO-FILLS a real icon when you give no `img`:
  it tries a live same-kind compendium match by name/baseItem (so a "Mace of the Long Dark" → a real
  mace icon), falling back to a verified core floor — a blank is impossible. So the floor is handled for
  you, but for a *specific* look still prefer passing `img` (or fixing it after with `manage-items` `update` /
  `update-actor-item`): `search-compendium-items` for the closest thematic item (a *Mace of Terror* icon
  for a dark mace, *Robe of Stars* for a night-veil, a *Dark Shard Amulet* for an unholy focus) and copy
  its `img`. `manage-items` `import` copies already carry real art.
- **A custom item's MECHANICS must be real — never a "treat its X as Y" note.** If the item deals
  necrotic, SET its `damage` type to necrotic — do **not** leave a bludgeoning base and write *"deals
  necrotic in place of bludgeoning."* If it's +1, set `magicalBonus`. The description says what the item
  **is**; it never asks the GM to fudge the sheet (shared-policy rule 7).
- **A magic item you place on an NPC is ALSO loot — now AUTOMATIC.** When you `manage-items` `import` / `add-item`
  a magic item onto an actor, the tool also mints a matching loose **world Item** (same stats + real
  icon) in a loot folder by default, so the party can loot it (shared-policy rule 9). Control it with
  `lootCopyFolder` (default `"Loot"`); `lootCopy: false` suppresses it, `lootCopy: true` forces a copy of
  mundane gear. **Don't also hand-create the world Item — that double-mints it.**
- **Magic items need only `magicalBonus` and/or `magical: true`** — the `mgc` property is added for you.
  The numeric `+N` is stored only where dnd5e has a field: **weapons, body armor, magic ammunition**. A
  **wondrous item or potion has no `+N` field** — flag it `magical` and model the bonus as an
  ActiveEffect (`manage-effect`).
- **Attunement defaults:** most `+N` gear and wondrous items are `attunement: "required"`; potions,
  scrolls, ammo, mundane gear are `""`. Set `attuned: true` only if the owner is actively attuned
  (≤ 3-item limit).
- **Rarity ↔ price sanity** (rough DMG guide): common ~50–100 gp, uncommon ~101–500, rare ~501–5,000,
  very rare ~5,001–50,000, legendary 50,000+. Mundane gear uses its PHB price and `rarity: ""`. A
  "Rarity Varies" item (a Potion of Healing line, an Ioun Stone family) takes a LIST —
  `rarity: ["common", "uncommon"]` — written natively to dnd5e 6.0's `system.rarities`; the same
  list works as a `system.rarity` / `system.rarities` patch on `update-actor-item`.
- **Equipped vs carried:** the weapon/armor an NPC uses → `equipped: true`; spare loot → `equipped: false`.
- **Identified vs mystery loot:** treasure discovered unidentified → `identified: false`.
- **The weapon a creature fights with must be a real `weapon` item with an attack** so to-hit/damage
  derive from it — a copied PHB weapon already has its attack activity; an authored one needs `withAttack`
  (the default when `damage` is given).
- **Worn armor and AC:** adding body armor does not change an actor's AC while a fixed AC override is
  set (how stat-block NPCs are authored). When authoring body armor with `add-item`, pass
  `wireAc: true` to put the actor back on armor-based AC. (A copied armor item is just an item —
  clear the override with `manage-actors` `update` `ac: {override: null}` if needed; a shield's +2 applies
  under every calculation except an override.)
- **The description is PLAYER-VISIBLE and NOT audited — keep it innocuous (shared-policy rule 12).** A
  player can read an item's `system.description` the instant they see it, and `content-audit` doesn't
  scan description prose, so nothing catches a leak for you. **Never** bake a GM note, spoiler, or
  `GM: …` meta-aside into the description — write in-world flavor only, written as if a player reads it
  first. If the item is a hook (a letter, a mysterious note, a treasure map), keep its own text
  innocuous and put the GM's intent — the name to fill in, the secret, the payoff — in a **GM-only
  journal** and link it. Don't write the DM's plan into the loot.

## Coins and containers

- **Coins are actor-level, not an item.** Set a purse with `manage-actors` `update`
  `currency: { mode: "set"|"add", pp, gp, ep, sp, cp }`. A container can hold its own coins via the
  `currency` param.
- **Nesting:** create/copy the `container` first, then place items with `container: "<name or id>"`.

## Read back and confirm

`manage-actors` `get` for the inventory summary (equipped/attunement/quantity) and `get-actor-entity` to
spot-check one item's full system data (and that copied art/activities came across). Report what was
built — each item, where it was copied from (or that it was authored), its rarity/bonus/attunement, and
any coins — and flag anything you had to ask about or approximate.

**Before declaring done, run `content-audit`** over what you built (`worldItemIds` / `itemFolders` for
world items, `actorIdentifiers` for an NPC you geared up). It flags any placeholder icon (rule 8),
GM-fudge language (rule 7), or magic item on an NPC with no loot twin (rule 9). Fix each and re-run.

## Notes

- **A new tool/param needs a Claude Code restart** to load into the running MCP server; the live
  acceptance script (`scripts/verify-item-tooling.mjs`) bypasses this via `dist/`.
- Authoring only — this does not equip-in-combat, roll attacks, or spend charges/uses.
- `manage-items` `create` / `add-feature` (mode `items`) remain the raw `system`-data passthrough for edge cases;
  `update-actor-item` patches any field by dot-path after the fact.
