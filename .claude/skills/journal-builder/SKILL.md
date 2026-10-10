---
name: journal-builder
description: >-
  Author D&D 5e journal entries in Foundry — quest logs, player handouts, lore/gazetteer entries,
  read-aloud (boxed) text, GM notes, session recaps / campaign logs. Use when the user wants to
  "write a quest", "make a handout", "create a journal", "write up the lore / a gazetteer", "boxed /
  read-aloud text", "GM notes", "a session recap", "campaign log", "link this quest to the NPC", or
  pastes adventure text to turn into a journal.
---

# Journal builder

The judgment + prose layer for the **written** side of an adventure (design.md §5): handouts, lore,
read-aloud (boxed) text, quest logs, GM notes — and **session recaps / campaign logs** (where
`fvtt-mcp-sessionscribe`'s `session-scribe` files its session diary). This is the deliberate inverse of the old behaviour, where the *tool* fabricated quest prose
(read-aloud, NPC dialogue, hooks). Now **you write the words; the tools only structure + style them.**

## The line that matters — yours vs the tool's

- **You (this skill) write every WORD** — the read-aloud boxed text, the lore, the quest hook, the GM
  guidance, the handout copy. Authoring that narrative prose IS the job.
- **The tool only STRUCTURES** — it renders your typed blocks into dnd5e's own journal block kit (the
  sourcebook look the system's stylesheet already draws), sets per-page visibility (player vs GM), and
  inserts real document links. It never writes a word.

## Authoring policy — what compendium-first means HERE

Read [`_shared/authoring-policy.md`](../_shared/authoring-policy.md) (2024 · compendium-first · never
SRD · ask-don't-invent). One journal-specific clarification:

- **Compendium-first / ask-don't-invent govern the game CONTENT a journal REFERENCES** — the monster in
  the ambush, the magic item in the reward, the spell on the trap. Point at the **real** compendium /
  world documents (mix-and-match) and **@UUID-link** them; never invent their stats.
- They do **NOT** constrain the **GM's narrative prose** — the story, the boxed text, the lore — which
  is yours to author. That's the whole point of this skill.
- Still **don't fabricate canon you weren't given** — a new region, a named NPC, a plot turn the user
  didn't ask for. Offer it as a suggestion or **STOP and ASK**; don't silently invent setting facts.

## Tools

- **`create-quest-journal`** — the STRUCTURING creator (your main tool). Takes `pages: [{ name,
  playerVisible?, blocks[] }]` → renders each page's blocks into dnd5e's block kit. Despite the name it
  builds ANY structured journal (handout, lore, notes), not just quests.
- **`update-quest-journal`** — append a new styled section (from `blocks`) to a page, or start a new
  page (`newPageName`). The progress-log / session-recap path.
- **`link-quest-to-npc`** — insert a real `@UUID[Actor.id]{Name}` link to a world NPC, labelled by
  `relationship` (questGiver / target / ally / enemy / contact). Refuses an unknown NPC (no dead links).
- **`manage-journals`** `create` / `update` — generic pages: raw HTML content (+ per-page
  `playerVisible`). Use when you already have HTML. A `create` page can also be an **image** page —
  `{name, kind:"image", src, caption?}` — so a mixed text+image or image-only journal (e.g. a map-key
  pack) builds in one call (set `sort` to order), or one of **dnd5e's own page types** (below).
- **`add-journal-image`** — append an image page (a map, a handout picture) to an EXISTING journal,
  with an optional `caption` and `playerVisible` (expose it as a handout; default GM-only).
- **`manage-journals`** `list` → `get` / **`search-journals`** — find/read existing journals + their page ids (needed to
  target `pageId` for updates/links).

## The block vocabulary (what you pass to the structuring tools)

Each page's `blocks` is an ordered list. Every `text`/`html`/`items` value is **your words**:

| Block | Use it for | Shape | Renders as |
|---|---|---|---|
| `heading` | A section title | `{type:"heading", text, level?:2\|3}` | `<h2>` / `<h3>` |
| `lead` | A one-line summary / intro | `{type:"lead", html}` | a plain `<p>` |
| `paragraph` | Body prose | `{type:"paragraph", html}` | `<p>` |
| `readaloud` | **Boxed read-aloud text**, scene-setting | `{type:"readaloud", html}` | `<div class="fvtt narrative">` |
| `gmnote` | **GM secret** (Foundry's secret block) | `{type:"gmnote", html}` (pass `<p>…</p>`) | `<section class="secret">` |
| `list` | Bulleted items (objectives, clues) | `{type:"list", items:[…]}` | `<ul>` |
| `grid` | Headed lists (a details box) | `{type:"grid", columns:[{heading?, items:[…]}, …]}` | one `notable` per column, stacked |
| `notable` | A callout: a rule or fact the table must remember | `{type:"notable", title?, html}` | `<aside class="notable">` |
| `advice` | GM advice, a card with an optional round icon | `{type:"advice", title?, html, img?}` | `<div class="fvtt advice">` |
| `quest` | An objective card, same shape | `{type:"quest", title?, html, img?}` | `<div class="fvtt quest">` |
| `quote` | A pull quote, floated right | `{type:"quote", html, author?}` | `<aside class="quote-lg float-right">` |
| `html` | Escape hatch — a table, anything custom | `{type:"html", html}` | verbatim |

These are dnd5e's documented classes (the System-HTML page of the dnd5e wiki); the system's stylesheet
draws them in its journal sheet, so a page needs no stylesheet of ours. Bare text in a box block
(`readaloud`, `notable`, `advice`, `quest`) is wrapped in one `<p>`; pass several `<p>…</p>` for
more paragraphs. A `lead` is a summary line: anything scene-setting is a `readaloud`. An `advice` or
`quest` card without `img` keeps an empty inset on its left where the icon would sit; give it an icon
(a Data-relative path, e.g. `icons/svg/book.svg`) or use a `notable`. Pages written before 4.2 carry
a `<section class="mcp-journal">` wrapper with classes nothing styles; appending to one with
`update-quest-journal` works (the new section goes after the old one), the old part stays plain.

`readaloud` is a visual box, not access control. `gmnote` is a core Foundry secret: players who can
observe the page never see it, even when the page is shared; the GM sees it and gets a **Reveal**
button on the sheet. To hide a whole page from players, use `playerVisible` (below).

## dnd5e enrichers — write rolls and rules the system way

Write checks, saves, damage and rule references as **dnd5e enrichers** in any block's `html`/`items`
(and in `manage-journals` HTML). The tools store them as written; Foundry turns them into roll
buttons and tooltips when the page renders. Prefer them to plain prose ("DC 15 Dexterity save"). The
forms (dnd5e wiki, Enrichers, current as of 6.0):

| Want | Write |
|---|---|
| Ability check / skill / tool | `[[/check dex 15]]`, `[[/skill perception 15]]`, `[[/check acr ath 15]]`, `[[/tool ability=dex tool=thief dc=15]]` |
| Passive check | `[[/skill perception 15 passive]]` |
| Saving throw | `[[/save dex 15]]`, `[[/save ability=str/dex dc=20]]`, `[[/concentration 12]]` |
| Damage / healing | `[[/damage 2d6 fire]]`, `[[/damage 2d6 fire average]]` (shows "7 (2d6)"), `[[/damage 1d6 bludgeoning & 1d4 fire]]`, `[[/heal 2d4 + 2]]`, `[[/heal 10 temp]]` |
| Attack roll | `[[/attack +5]]` |
| Condition / rule tooltip | `&Reference[prone]`, `&Reference[Difficult Terrain]` |
| A language | `[[language gnomish]]` |
| A linked document | `@UUID[Compendium.….Item.<id>]{Label}` (from `search-compendium`) |

`format=long` spells out "Dexterity check" / "saving throw"; `request` (check / save) posts a roll
request to the players instead of rolling. A DC may be a formula (`dc=@abilities.cha.dc`, quoted when
it has spaces) but never dice. Don't invent an enricher form that is not in this table or the wiki;
anything else stays plain prose.

## dnd5e page types (`manage-journals` create)

Besides `text` and `image`, a `create` page may be one of dnd5e's own page types — `kind` plus its
`system` data:

- **Map Location** — `{name, kind:"map", content, system:{code:"A1"}}`: the code replaces the
  number on the map marker and in the journal's contents. Placing the marker is a map note on the
  scene (`manage-placeables` kind `notes`, its `page` = this page).
- **Rule** — `{name, kind:"rule", content, system:{tooltip?, type?:"rule"}}`: what
  `&Reference[Name]` shows; the tooltip (HTML) overrides the body there.
- **Spell List** — `{name, kind:"spells", system:{type:"class", identifier:"wizard", spells:[<uuids>],
  grouping?:"level"}}`.
- **Class / Subclass summary** — `{name, kind:"class"|"subclass", system:{item:"<class item uuid>",
  description:{value}}}`: the page builds itself from the item's advancement.

The system validates `system` on create; a field it does not know is dropped. These pages take no
typed blocks — write their HTML (`content`) by hand, enrichers welcome.

## Page kinds — pick the blocks + the visibility

- **Player handout** — `playerVisible: true`. Clean prose + `readaloud` for the in-world text; no
  `gmnote` (it would stay hidden, but a handout is only the in-world text — keep the GM's notes on a
  separate GM page).
- **Lore / gazetteer** — `heading` + `paragraph` (+ `readaloud` for an in-world excerpt). GM-only unless
  it's meant as player reading.
- **Read-aloud / boxed text** — a `readaloud` block (optionally `playerVisible` as a handout).
- **GM notes** — `gmnote` + `list`; GM-only (omit `playerVisible`).
- **Quest log** — the template below; GM-only, often paired with a separate player-handout page.
- **Session recap / campaign log** — see the section below.

## The quest page-template (you fill every blank with prose)

A quest journal is just a recommended block layout — the "quest" is a template you fill, not something
the tool generates. A solid default GM-only "Quest Log" page:

1. `lead` — one-line summary of the quest.
2. `grid` — `[{heading:"Quest Details", items:["Type: …","Difficulty: …","Location: …","Quest Giver: …"]},
   {heading:"Rewards & Status", items:["Reward: …","Status: Active"]}]` (the facts the user gave you;
   each column becomes a `notable` callout).
3. `heading "Adventure Hook"` + `readaloud` — **the boxed hook you write** (how the party hears of it).
4. `heading "Objectives"` + `list` — the steps, in your words (or one `quest` card per objective).
5. `heading "GM Notes"` + `gmnote` — pacing, secrets, scaling guidance you write (an `advice` card for
   guidance that may stay visible to whoever owns the page).

Then **`link-quest-to-npc`** for any real NPC the quest involves (the giver, the villain), and a
separate **`playerVisible` "Player Handout"** page if the players get a letter/poster (its prose is the
in-world text only — no GM notes). Track progress with `update-quest-journal` (a `heading "Session N"` +
`paragraph` recap appended to the log).

## Visibility — player-facing vs GM-only (per page)

- `playerVisible: true` → players can **observe** that page (a handout). Omit → **GM-only** (default).
- A `gmnote` on a player-visible page stays hidden from the players until the GM reveals it — use that
  for a clue the GM means to reveal in play. GM material as such still goes on a GM page.

## Player handouts vs GM keys — separate entries, separate folders

A player handout and a GM key are **two different journal entries**, never two pages of one. This is the
house convention — keep it consistent so the sidebar stays trustworthy at a glance:

- **Player handouts** live in a **`Player Handouts`** folder and hold **only** player-facing pages —
  never a GM-only page, never a `gmnote` block. A `gmnote` is hidden from players, but anyone who owns
  the entry sees it, and one Reveal shows it to the table; if a journal contains anything the players
  shouldn't read, it does not belong in Player Handouts. A handout is only what you'd physically hand the
  table.
- **GM material** lives in a **`GM Notes`** folder and each entry is named **`<Name> — GM Key`** (e.g.
  `Daggerford — GM Key`, `Wisp Caves — GM Key`, `Trade Way Ambush — GM Key`). Read-aloud / boxed text the
  GM reads *aloud* is the GM's script — it belongs in the GM key, not in a handout.
- **When one subject needs both,** build two entries: `<Name>` (Player Handouts, player-visible) and
  `<Name> — GM Key` (GM Notes, GM-only). Don't smuggle GM notes into a handout as a "GM-only page."
- **Staging a handout hidden** (revealed later in session): create it with its pages GM-only (omit
  `playerVisible`) so the whole entry is invisible to players; in session, flip the **entry's** default
  ownership to Observer once and every inheriting page reveals at once. Per-page `playerVisible: true`
  makes a page visible **now** — use that only when the players should see it immediately.

## Linking — mix-and-match by reference (never restate stats)

- A world **NPC** the quest involves → `link-quest-to-npc` (a clickable `@UUID[Actor.id]` in a GM note).
  The actor must exist first (build it with `stat-block-builder`); the tool refuses a dead name.
- A **compendium/world item, spell, or monster** the journal references → write a Foundry
  `@UUID[…]{Label}` link in a `paragraph`/`html` block (get the uuid from `search-compendium`). Link
  the real document; don't transcribe its stats into the prose.

## Session recaps & logs

Session output is **authored as journals**, and this skill's structures are where it lands. The
sibling `fvtt-mcp-sessionscribe` (its `session-scribe` skill: chat plus the Craig transcript →
recaps) writes the session diary through `manage-journals`. The same shapes, by hand:

- A **"Campaign Log"** journal; each session is a `update-quest-journal` append (`heading "Session N —
  <date>"` + `paragraph` recap) onto one log page, OR a new page per session (`newPageName`).
- Keep recaps GM-only by default; a player-facing **"Previously, on…"** is a separate `playerVisible`
  page (or handout) with just the spoiler-free summary.
