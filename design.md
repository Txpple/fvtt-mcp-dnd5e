# design.md — the north star

> The single source of truth for **what this project is for** and **how it is allowed to grow**.
> Every skill, tool, and refactor must trace back to something on this page. When a decision is
> ambiguous, this document wins; if this document is wrong or silent, fix *this document first*,
> then build. We always design for the long-term architecture — never a quick fix.

---

## 1. Mission

**`fvtt-mcp-dnd5e` is a Dungeon Master's content assistant for Foundry VTT (D&D 5e, 2024 rules).**
It builds and maintains the content of a campaign in a live Foundry world, driven through Claude —
scenes, NPCs and PCs, items, journals, tables, cards, playlists — table-ready, edition-correct and
art-bearing, sourced from the premium books; and it records what happened at the table afterwards
(chat export, combat analytics, session recaps written into the journal). It is a Foundry MCP
**first**: it drives any live Foundry world — on Molten Hosting, on this machine, at a URL — and
*where* that world runs is a **host**, an option chosen per registration (§2.6), never the product.
It is user-facing: anyone can clone it and point it at their own world.

**It does not run the game.** There is no live in-session assistant in this project — no event
feed, no interjecting during play — by decision (owner, 2026-09-20). **3.0 is the last feature
line** (`docs/plan-3.0-consolidation.md`); after it the project is in maintenance: Foundry / dnd5e
compatibility events, bug fixes, premium books brought into scope. There is no roadmap beyond it.

**Where it stands today.** The content-creation building blocks are built — and, crucially, they
*compose*. The same skills that make one scene or one NPC now assemble a **complete, table-ready
adventure end to end**, scaled to however much the DM brings:

- **As little as a map.** Hand Claude only a battlemap image and it reads the map, invents a fitting
  plot, and builds the scene, the monsters and NPCs, a pregen PC (or a whole party), the treasure, the
  linked journals (plot, GM notes, read-aloud boxed text, handouts), and the roll tables to match.
- **As much as a finished module.** Hand Claude your own adventure and it faithfully recreates it in
  the VTT — every stat block, magic item, handout, and map placed as written, sourced from the books.
- **Anywhere in between** is the normal case — and a player's own character is rebuilt natively from
  the books (there is deliberately no D&D Beyond import — §7).

---

## 2. Guiding principles (binding)

These are not aspirations; they are the rules we hold each other to.

1. **Skills decide, tools do.**
   - **Tools** (the MCP server, `src/**`) have **deterministic outcomes**. A tool owns *correctness* —
     field paths, schema shapes, name→id resolution, validation, idempotency. Given the same input it
     does the same thing. A tool never guesses what the DM "probably meant."
   - **Skills** (`.claude/skills/**`) have **discretion**. A skill owns *judgment and composition* —
     reading intent, parsing a stat block, choosing which compendium to copy from, applying house
     rules, sequencing tool calls. A skill is where D&D wisdom lives.
   - When something goes wrong, first ask **"is this a correctness bug (fix the tool) or a judgment
     gap (fix the skill)?"** Put the fix on the right side of the line. Never paper over a tool
     correctness bug inside a skill, and never hard-code a judgment call into a tool.

2. **Long-term architecture over quick fixes.** We optimize for the shape we'll want in a year, not
   the patch that closes today's ticket. Best practice is the default, not the upsell. If the clean
   path costs more now, we pay it now.

3. **Compendium-first — the books are the library; never the SRD.** Our **entire** authoring library
   is the **premium 2024 published books**: the **Monster Manual**, **Player's Handbook**, and
   **Dungeon Master's Guide** (the `dnd-monster-manual.*`, `dnd-players-handbook.*`,
   `dnd-dungeon-masters-guide.*` packs), assumed always installed — required for authoring; two
   further premium books are already in scope as optional extensions (`dnd-heroes-faerun.*`,
   `dnd-ravenloft-horrors-within.*`) and the non-authoring tools work with none of them.
   **The SRD packs — both the 2024 SRD (`dnd5e.*24`, e.g. `dnd5e.spells24`, `dnd5e.monsterfeatures24`,
   `dnd5e.classes24`) and the older `dnd5e.*` SRD — are NEVER a source. The MM/PHB/DMG supersede them
   in ALL cases.** (The books are supersets of the SRD, so this loses nothing.) **This premium-book set is
   extensible:** today it is the MM/PHB/DMG, but a future premium book release can be *brought into
   scope* by adding it to the **one** definition that names the library — the set lives in a single
   place, never as scattered hard-coded pack ids. **Extensibility applies to premium books ONLY — the
   SRD packs are never brought into scope, no matter what ships.** We build new content by
   **copying and recombining existing book entries** (correct stats *and* art) — mixing and matching is
   the *normal* way we create. We do **not** create net-new items by default. Going ad hoc — authoring
   from scratch, **or editing an original entry in place** — is a **last resort**, permitted only when
   **either** (a) we asked and the user granted permission, **or** (b) the user explicitly asked for
   something custom; even then, prefer **copy → modify → rename** (leave the original intact). If
   something genuinely isn't in the books, **STOP and ASK (§2.4) — never fall back to the SRD.** Default
   `sourceRules: "2024"` everywhere.
   **Amendment (owner, 2026-09-15):** the `dnd5e.effects` **ActiveEffect** compendium — the system's
   own stock effects (the conditions and common buffs that dnd5e 6.0's region and activity behaviors
   are built to reference) — is a permitted **mechanical** source for effect uuids. It holds
   automation, not book content; the SRD *content* packs (`dnd5e.*24`, older `dnd5e.*`) stay barred.

4. **Ask, don't invent.** If we can't find it in the **MM/PHB/DMG books**, we **stop and ask the
   user** — we do **not** silently fall back to the SRD or to 2014, and we do not fabricate values.

5. **NPCs and PCs are different products.** They are authored by **separate skill + tool
   architectures** because they are genuinely different problems (see §6 and §7). We never force one
   to masquerade as the other.

6. **A host-agnostic core; hosts are options.** The bridge is Foundry's own client, so the whole
   tool surface works against *any* Foundry instance. Everything that depends on **where** the
   instance runs — how a sleeping box is woken, how a file reaches its `Data/` directory — lives
   behind one seam, `src/hosts/**`, and is configured by **one variable set on every host**,
   `FOUNDRY_*` (`FOUNDRY_URL`, `_USER`, `_PASSWORD`, `_ADMIN_KEY`, `_WORLD_ID`, `_WAKE_URL`, and
   the plane extras `_DATA_DIR` / `_WEBDAV_*`). A **host** is a *preset* over those facts, chosen
   per registration by `FOUNDRY_HOST`: `generic` (the default — any Foundry at a URL; reads every
   variable), `molten` (Molten Hosting: the WebDAV plane derived from the URL, never a filesystem
   plane), `local` (an install on this machine: no wake, never WebDAV, the launcher's hints).
   `local` means *on this machine*, never "not Molten". Legacy names (`MOLTEN_*`, `LOCAL_*`) are
   read only in `src/hosts/env.ts`, as aliases under their own host. No file outside
   `src/hosts/**` may name a host, and a tool never changes behaviour by host except through the
   plane the host provides. **Every host has a file plane:** Foundry's own `FilePicker`, driven
   through the joined page (browse / stat / read / upload / mkdir), is the bridge plane and needs
   nothing configured; a direct plane (WebDAV, or the `Data/` directory of an install on this
   machine) is the fast path when one is configured, and the only way to delete or move. A plane
   that lacks an operation refuses it by name. The tool names are the same on every host, so
   skills never know which one they are on.

---

## 3. The skills ↔ tools contract

This is the architectural backbone that makes principle #1 real.

```
   DM (via Claude)
        │  natural-language intent
        ▼
   ┌─────────────┐   judgment, parsing, house rules, composition
   │   SKILLS    │   .claude/skills/**   (ship in-repo, tracked)
   └─────────────┘
        │  precise, deterministic calls
        ▼
   ┌─────────────┐   correctness: schemas, field paths, validation, name→id
   │    TOOLS    │   src/tools/**  →  src/page/**  (headless Foundry bridge)
   └─────────────┘
        │  foundry.call() over a real browser session
        ▼
     Foundry VTT  (Playwright-driven headless Chromium)
```

- **A tool is a contract.** Its input schema is generated from one zod definition; its output is
  predictable; its behavior is unit-tested. If a skill cannot express something the DM needs, the
  answer is usually a *new or extended tool*, not a skill workaround.
- **A skill is a playbook.** It encodes "how a good DM would do this," not "which property to set." If
  a skill keeps re-deriving the same correctness detail, that detail belongs *down* in a tool.
- **A result has a shape by kind, and it is a diet.** A tool returns what a skill decides on — ids,
  names, the documented fields — never what is merely available (art paths, echoes of the
  arguments, doctrine prose, counts a client can take from an array). **List / search** results are
  one line per record in a fixed, documented field order under a header `<N> <noun>(s)` (`of M`
  when cut); a search body always says `totalFound`, the full match count. **Single reads**
  (`get-*`) are JSON with a `compact` / `fields` selector. **Mutations** are a one-line
  confirmation plus warnings. **A miss is an error** (`isError`), never a prose "not found" inside
  a success-shaped result. An unknown argument is refused by name, never stripped. A result over
  the response cap is cut at record boundaries with a `truncation` stamp, never mid-record.
  (Decision #10 of the 3.0 plan; the line format lands per family as each is consolidated.)
- **The boundary is the test.** Before adding code, decide which side it's on. Mixed-concern code is
  the thing this contract exists to prevent.

---

## 4. Scope & roadmap

| Area | Sub-area | Status |
| --- | --- | --- |
| **Content creation** | Scenes | ✅ done (`scene-builder`) |
| | Actors → **NPCs** | ✅ done (§6 ladder; `stat-block-builder`) |
| | Actors → **PCs** | ✅ done (`pc-builder`; `create-pc` / `level-up-pc` / `create-pc-from-prefab`, advancement-native `@scale`) |
| | Actors → PCs → ~~D&D Beyond import~~ | ❌ **removed 2026-08-17** (§7 — DDB exports strip embedded effects; refuse + build natively) |
| | **Adventures** (end-to-end assembly) | ✅ emergent — the blocks compose (§1, §5) |
| | Journals (handouts, lore, quests, notes) | ✅ done (`journal-builder`; prose de-leaked) |
| | Tables (roll tables) | ✅ done (`table-builder`; v14 results + `@UUID` loot + import) |
| | Playable cards | ✅ done (`cards-builder`; face text + preset import) |
| | Playlists | ✅ done (`playlist-builder`; scene-builder delegates) |
| | **dnd5e 6.0 features** — conditional / rules-type effects, expiry events, region + activity behaviors, teleport / transform activities, rarities | ✅ done 2.1.0–2.1.1 (`manage-effect`, `manage-activity`, `add-region-behavior`; `docs/history/plan-2.1-dnd5e-6-features.md`) |
| | **System automation settings + calendar** | ✅ done 2.1.1 (`configure-dnd5e-settings` read + allow-listed set; `manage-calendar` read / advance / set) |
| **Session record** | Chat: post, list, export (`send-chat-message`, `export-chat-log` …) | ✅ done (`chat-and-narration`) |
| | Combat analytics (`get-combat-stats`) | ✅ done (reads the house module's stamps) |
| | Audio → text → recap (`session-scribe`: per-track Whisper, chat-aligned, recaps filed as journals) | ✅ done |
| **Platform** | **Hosts** — one seam for where Foundry runs (`molten` / `local` / `generic`), the file plane per host | ✅ done 2.2 (§2.6; `docs/history/plan-2.2-hosts.md`) |
| | **Toolsets** — a registration advertises a subset of the surface (`FOUNDRY_TOOLSETS`) | ✅ done 2.2 |
| | **Rename** → `fvtt-mcp-dnd5e` (the host left the name; the system stayed) | ✅ done 2.2 |
| | **Official dnd5e 6.x** — the 6.0.3 compatibility pin | ✅ done 2026-09-20 (`docs/plan-3.0-consolidation.md` M1) |
| | **3.0 — the token fix and the dnd5e-not-Molten refactor**: results diet, schema prose diet, the `FOUNDRY_*` config contract with `generic` as the default host, the bridge file plane on every host, the package / sibling contract, the CRUD consolidation (17 `list/create/update/delete-X` families → family tools with `op`, every skill re-pointed in the same commit), owner content out, the user-facing docs | 🔨 active (`docs/plan-3.0-consolidation.md`; measured in `docs/architecture-review-2026-09.md`) |

Legend: ✅ done · 🔨 active (the 3.0 line — the last one).

Every content building block is built, and they compose into **end-to-end adventures** (§1, §5) —
from "here's a map, make me a module" to "here's my module, put it in the VTT." What remains is
3.0: make it cheap in context, make it the dnd5e MCP for anyone, and stop. After 3.0 the §4 table
only ever gains compatibility notes and premium books.

---

## 5. Content creation — the building blocks

The DM's adventure is assembled from these building blocks. Each gets its own skill(s) for judgment
and its own deterministic tools for correctness — and the blocks **compose end to end**: a single
request can assemble all of them into a finished, table-ready adventure, with the DM supplying as much
or as little as they like (§1).

- **Scenes** *(working)* — turn a map image into a ready-to-play scene: auto-size to the image, set
  mood/lighting/weather/fog, attach playlists and journals.
- **Actors** — the creatures and characters. Split hard into **NPCs** (§6) and **PCs** (§7) — both
  built. This split is the most important structural decision in the content surface.
- **Journals** — the written layer of an adventure: handouts, lore/gazetteer entries, read-aloud
  (boxed) text, quest logs, and the GM's own notes. Includes quest journals and linking quests to the
  NPCs that give them. This is also where session recaps are filed (`session-scribe`).
- **Tables** — roll tables for loot, encounters, rumors, wild magic, etc.
- **Playable cards** — Foundry card decks/hands/piles for in-play use.
- **Playlists** — audio ambiences and tracks, attachable to scenes.

Supporting plumbing that serves the above (organization/folders, ownership, asset management) exists to
make the building blocks usable; it is not itself a headline scope item.

---

## 6. NPC authoring doctrine *(follow this exactly)*

NPCs are **`type: npc`** actors. The skill's job is to produce a complete, table-ready creature using
the **premium 2024 MM/PHB/DMG books** as its library — **never the SRD** (§2.3). There is a strict
decision ladder.

### Step 1 — Prefer a prefabricated Monster Manual actor

**Always first try to pull a ready-made MM actor.** The entire 2024 Monster Manual is available as
prefab actors. Search it before building anything. Creature types to draw from:

> Aberration · Beast · Celestial · Construct · Dragon · Elemental · Fey · Fiend · Giant · Humanoid ·
> Monstrosity · Ooze · Plant · Summon · Swarm · Undead

If a suitable MM actor exists, copy it. Done.

### Step 2 — Build a custom NPC (only if no suitable prefab, or the user wants custom)

When we must build custom, we **mix and match compendium parts** — we never invent item components on
the fly. Net-new authoring, or editing an original compendium entry, is the last-resort path from
§2.3: it requires the user's permission (we ask first) or an explicit request for something custom.

1. **Art first.** Find the best-matching MM creature and use **its graphic** for the custom NPC.
2. **Stat-block base (optional).** Optionally copy a close-matching MM creature as a **base template**
   for the stat block, then modify it — or build the stat block as needed. Tools exist for both.
3. **Abilities — copy, don't fabricate.** Every action, attack, trait, feat, spell, and piece of gear
   is **copied out of a compendium**, by category:

   | Need | Pull from | Categories |
   | --- | --- | --- |
   | Actions, attacks, legendary actions, traits | **Monster Manual** | monster features |
   | Feats, spells | **Player's Handbook** | feats · spells |
   | Mundane gear | **Player's Handbook** | adventuring gear · armor · tools · weapons |
   | Magic & special gear | **Dungeon Master's Guide** | Armor · Blessings · Charms · Consumables · Containers · Equipment · Instruments · Supplemental · Treasure · Weapons |

   *"Pull from" means the **premium book packs** — `dnd-monster-manual.*`, `dnd-players-handbook.*`,
   `dnd-dungeon-masters-guide.*` — **never** the `dnd5e.*24` or older `dnd5e.*` SRD packs.*

   For a **custom ability** with no exact match: copy the closest compendium entry, modify it, and
   rename it — never hand-build from nothing. If nothing reasonable exists, **stop and ask.**

### NPCs with a PC race/species attached

Some NPCs are members of a playable race (a dragonborn captain, an elf archmage). Give them their
**racial abilities** the same way — copy the traits out of the species/origins compendium — then
**patch the scaling by hand**, exactly as we do for copied class features:

- Copy the racial trait (e.g. a dragonborn's **Breath Weapon**) from the origins/species compendium.
- Because an NPC has no species **advancement**, any `@scale.*` damage/uses dangle to 0. Read the
  feature back and set an explicit die/value (sized to the NPC's level or CR), the same `@scale` fix
  used for class features below.
- This is the accepted **NPC-side workaround**. A true PC (§7) resolves the same `@scale.*` natively
  through advancement — which is precisely why the two are separate products.

### NPC authoring — known hard facts

These are correctness truths the tools must honor (carried from prior dogfooding):

- Copied 2024 class/racial features carry `@scale.*` values fed by PC **advancement**; dropped on an
  NPC they dangle to 0 and need an explicit die set. (This is a major reason NPCs and PCs are
  separate — PCs resolve `@scale` natively; NPCs must be patched.)
- Authored NPC skills must carry a per-skill `ability` or the modifier collapses to proficiency-only.
- A magic item needs both the `mgc` property and a numeric magical bonus in the right field; copied
  armor does not auto-wire AC. Attunement is a string plus a separate `attuned` flag.

---

## 7. PC authoring *(built)*

PCs are a **different product** with their **own skill + tool architecture** — the `pc-builder` skill
over `create-pc` / `inspect-pc-advancement` / `level-up-pc` / `create-pc-from-prefab`. They are
**built**; nothing in the NPC path may regress them.

- PCs are **`type: character`**, not `npc`. They are assembled from embedded **class, subclass,
  species, and background** items, plus **advancement**.
- **Advancement is the architectural crux.** With proper advancement attached, 2024 class/racial
  features resolve `@scale.*` damage/uses **natively** — no manual die-patching like NPCs need. A real
  PC builder must attach advancement, not just copy feature items.
- Practical consequence: a PC builder is a *leveling pipeline* (choose class → apply advancement →
  pick options at each level), not a flat stat-block transcription. Keep this in mind so the NPC tools
  and the actor-authoring surface don't bake in npc-only assumptions.

### D&D Beyond import *(removed 2026-08-17 — refuse, and build natively instead)*

There is deliberately **no** DDB import path. One existed (a `parse-ddb-character` tool + `ddb-import`
skill) and was removed: DDB's character export does not carry the **embedded ActiveEffects** the
premium compendium items ship, so an imported PC *looks* complete while its automation is hollow — a
spell casts, consumes its slot, posts its card, and silently does nothing. That class of hole is
invisible until a table moment needs the automation, which is exactly when it bites (the **Divine
Favor incident**, 2026-08-16: the imported spell kept its PHB activity, still referencing an effect id
whose effect document had been stripped). The export format is lossy where it matters most; importing
can't be made safe by parsing harder.

**Standing policy — any "import my character from D&D Beyond" request gets a refusal:** it's not
possible (DDB exports lose embedded effects/automation), and the better path is offered instead —
build the PC **natively from the premium compendia** via the `pc-builder` skill (`create-pc` /
`level-up-pc` / `create-pc-from-prefab`), reading the DDB sheet only as a *reference* for the
player's choices, never as a data source.

---

## 8. Implementation snapshot (where the architecture stands)

This is *how* the contract in §3 is realized today. (Mechanism, not mission — update as it evolves.)

- **Headless bridge.** Playwright drives a real headless-Chromium Foundry session. `src/foundry.ts` is
  the `foundry.call()` seam; `src/index.ts` is the stdio MCP entry; page-side logic lives in
  `src/page/**` and is bundled into the browser context.
- **Hosts.** `src/hosts/**` is the one place that knows where Foundry runs (§2.6). A `Host` gives
  the bridge its optional `wake` and the tools their optional direct `FilePlane`, composed with
  the bridge plane (`filePlaneFor`; `src/hosts/bridge-files.ts` over `src/page/files.ts`);
  `resolveHostConfig`
  (`hosts/env.ts`) is the single env selector (the `FOUNDRY_*` set; `FOUNDRY_HOST` picks the
  preset, default `generic`; the 2.x `MOLTEN_*` / `LOCAL_*` names as aliases) shared by the
  server, the verify scripts and the integration suite, and a placeholder `FOUNDRY_URL` is refused
  at startup. An unset `FOUNDRY_WORLD_ID` is discovered on `/setup`. The asset file tools
  (`src/tools/assets/**`) are written against the plane, never a host.
- **One registry.** `src/registry.ts` is the single source of truth wiring tool name → handler; the
  advertised tool list is derived from it so the two can't drift.
- **Generated schemas.** Every tool's input schema is generated from one hoisted zod (`io: 'input'`)
  via `src/utils/schema.ts` — never hand-written JSON schema.
- **Skills ship in-repo.** `.claude/skills/**` is a tracked deliverable, committed alongside the
  tools. Current skills: `start-session`, `scene-builder`, `stat-block-builder`,
  `physical-item-builder`, `pc-builder`, `journal-builder`, `table-builder`, `cards-builder`,
  `playlist-builder`, `soundscape-builder`, `chat-and-narration`, `session-scribe`,
  `session-audit`, `bestiary-builder`, `tom-cartos-import`, `token-cutout`, `plot-drift-check`.
- **Target stack.** Foundry v14 (14.368 verified), dnd5e 6.x (6.0.3 verified; the 2.x/3.x line —
  1.x = dnd5e 5.3.x), on any host (§2.6). D&D-5e-only by design.
- **Quality gate.** biome · `tsc --noEmit` · vitest · build · knip, all green before any commit. No
  pre-commit hook — run `biome check --write .` manually.

---

## 9. How we use this document

- **Before building**, locate the work on this page. If it isn't here, decide whether it's in scope —
  and if so, add it here first. After 3.0 the answer is almost always "no": maintenance changes
  what exists, it does not add. (The 2.1 line added three capability areas this way after the fact:
  system automation settings + calendar (`configure-dnd5e-settings`, `manage-calendar`) and areas
  with dnd5e behaviors (`add-region-behavior`, activity `behaviors`) — now rows in the §4 table.)
- **When a skill and a tool seem to overlap**, re-read §2.1 and §3 and put each concern on the correct
  side.
- **When tempted by a shortcut**, re-read §2.2.
- **When this document and the code disagree**, that's a bug in one of them — surface it, don't
  silently diverge.
