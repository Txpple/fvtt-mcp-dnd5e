---
name: bestiary-builder
description: >-
  Add a monster the party FOUGHT to the world's player-facing Bestiary journal — a brief page: the
  campaign's own illustration, a short Monster Manual narrative (never the stat block) and a
  callout of the party's own encounter, filed alphabetically. session-scribe runs it at every wrap. Use when the user says
  "add it to the bestiary", "the party killed a <monster> — log it", "bestiary entry for <monster>",
  "add the monsters we fought", "what did we fight? put them in the bestiary", or wraps a session
  and wants the kills recorded.
---

# Bestiary builder

The **Bestiary** is one journal — `journals.bestiary` in the campaign repo's `campaign.json`
([`_shared/campaign-repo.md`](../_shared/campaign-repo.md)); the defaults are `Bestiary` in an
**Adventure Log** folder — with **one page per creature, alphabetical**. Players can open it; it is how they learn what they just fought.

The deterministic half is the bundled script `bestiary-entry.mjs` (next to this file). There is **no
MCP tool for this**: reading a compendium journal page and setting *entry-level* journal ownership
both sit outside the tool surface, so the script drives the live session directly through
`dist/foundry.js`. Everything else — `upload-asset`, `manage-journals`,
`set-journal-page-visibility` — is normal tooling.

## Step 0 — Has it been earned?

The house rule: **a page goes in after the party has fought the thing**, not when the DM statted it.
The bestiary is the players' trophy shelf and their reference; it must never front-run an encounter.

- **Killed it** → add it, player-visible.
- **Fought it and it got away** (the will-o'-wisp) → still add it; they met it and paid for the
  knowledge.
- **Only glimpsed / heard rumored** → ask the DM before adding.
- **Prepped for a future session** (the displacer beasts) → add it with **`--gm-only`** if the DM
  wants it staged, and reveal it later with `set-journal-page-visibility`.

If a session recap is the source, work from the campaign repo's `<sessions.dir>/<date>/recap.md` —
it names every creature that took a turn.

## Step 1 — Resolve the real creature

Compendium-first, premium books only (design.md §2.3 — never the SRD). Name it as the **Monster
Manual** names it:

- **Shared lore is normal.** The MM writes one narrative for a family: Hobgoblin Warrior, Captain and
  Warlord all point at **Hobgoblins**; Twig/Vine/Needle/Tree Blight all point at **Blights**. Pass
  any variant and the script lands on the shared page — so a party that fought both twig *and* vine
  blights gets **one** "Blights" page, not two. Re-running for the second variant just refreshes it.
- **Use `--page` when the family name should win.** `--monster "Hobgoblin Warrior" --page
  "Hobgoblins"` titles the page for the family rather than the one variant they killed.
- **Reskins and masked identities.** A world NPC may be a reskin of an MM creature (or wear a
  `trueName` mask). Resolve to the *true* MM creature for the lore, but **do not title the page with
  a name the players haven't earned** — if they only know it as "the thing in the webs", ask the DM
  what to call it.
- **Not in the Monster Manual** (homebrew, a Ravenloft/adventure-pack creature, a custom NPC): the
  script exits with `not in the Monster Manual` or `no lore embed in its biography`. **Stop and ask
  the DM for the narrative** — never invent monster lore, and never paste a stat block. Then build
  the page by hand with `manage-journals` `create`/`update` in the same house shape, or run with
  `--no-art` and edit the text in after.

## Step 2 — Art: the campaign's own illustration

**Use the campaign's own art, not the Monster Manual's** (DM, Echoes of Halruaa, 2026-10-19). The
creature the party fought already has a portrait in the world: the actor's `img` (`exportActorData`
on the placed token's actor, e.g. `worlds/<world>/assets/portraits/grimlock-cudgel.png`). Pass it:

```
--art "worlds/<world>/assets/portraits/<slug>.png::<a short caption tied to where they met it>"
```

One image per page, even when the party fought several variants (they share one illustration;
pick the one they saw most). No portrait in the world → ask the DM (the `illustration-builder`
skill makes one) rather than falling back to the MM plate. The script's no-`--art` default (the
MM's own journal art) is for a campaign without its own illustrations. `--no-art` for text only.

## Step 2½ — Keep it brief, and weave in the campaign's story

**Players read little.** A page is the art, the MM epithet and pull quote, **at most two** MM
narrative paragraphs (the script's default `--paras 2`; `--paras 1` when they are long), then
**one short callout of the party's own encounter**: two or three sentences, only what the players
saw or learned in play (from `<sessions.dir>/<date>/recap.md`; never a GM secret, never the next
twist). Write it in dnd5e's block kit (the `journal-builder` skill's `notable`) as an HTML file and
pass `--story <file>`:

```html
<aside class="notable"><h4>At the Hearth</h4><p>Five grimlocks came up through the Breach…
<strong>Something below knows where the Hearth is.</strong></p></aside>
```

The `<h4>` names where they met it. When they meet the creature again, rewrite the callout (still
short) and re-run.

## Step 3 — Run it

```
node .claude/skills/bestiary-builder/bestiary-entry.mjs --monster "<MM name>" [options]
```

Run it from this repo's root. `FOUNDRY_HOST` picks the host exactly as it does for the server, and
`FVTT_MCP_ENV` the env file: prod is `FOUNDRY_HOST=molten FVTT_MCP_ENV=.env.halruaa`, the sandbox
`FOUNDRY_HOST=local` (the repo's `.env`). Prod writes only on the DM's word.

| option | effect |
| --- | --- |
| `--monster <name>` | required; MM creature name (any variant of a shared-lore family) |
| `--page <name>` | page title override (default: the MM lore page name) |
| `--art <src[::caption]>` | Data-relative image instead of the MM art (the campaign's portrait); repeatable |
| `--paras <n>` | keep the first n MM narrative paragraphs (default 2) |
| `--story <file>` | HTML fragment (a dnd5e `notable` callout) appended after the MM text |
| `--no-art` | text only |
| `--gm-only` | page stays GM-only (unrevealed monster) |
| `--journal` / `--folder` | `campaign.json` → `journals.bestiary.name` / `.folder`; defaults `Bestiary` / `Adventure Log` |
| `--dry-run` | print the resolved HTML, write nothing |

**`--dry-run` first** on anything unfamiliar — it shows exactly which art and which paragraphs
survived the strip, before a word reaches the world.

What the script guarantees, so you don't have to check it by hand:

- narrative only — it drops the **habitat/treasure** line, nested art embeds, and any **rollable
  table** the MM hangs off the entry (plus its "Roll on or choose a result…" lead-in and footnote);
- the MM's pull-quotes become dnd5e's own pull quote (`aside.quote-lg`, drawn by the system's
  stylesheet), the italic epithet stays a plain italic paragraph, book-only CSS classes are stripped,
  and the page has no wrapper;
- the page is **upserted by name** (safe to re-run) and **every page is re-sorted alphabetically**;
- **ownership**: the journal entry is set to players-OBSERVE, and each page gets an *explicit*
  ownership default. That explicitness matters — a page created without one **inherits** the open
  entry and would leak a GM-only monster. This is also why the create action's `playerVisible` is not
  enough on its own here: it sets the page but leaves the *entry* GM-only, so players never see the
  journal at all.

**The stat block, when the table wants it.** The page is the lore, and nothing pastes a stat block
into it. When the DM wants the block beside the lore (the players see what they fought), embed
dnd5e's own after the run: `update-quest-journal` with the Bestiary's `journalId`, the page's `pageId`
and `blocks: [{ type: "html", html: "@Embed[<the MM uuid> statblock]" }]`, the uuid from
`search-compendium { type: "creatures", name }` (`Compendium.dnd-monster-manual.actors.Actor.<id>`;
the options are in `journal-builder`). Add `label="<the page's name>"` when the players know the
creature by another name: the block shows the actor's. NPC only (a `character` embeds its
description), and the page's visibility is the only gate (a `--gm-only` page hides its block too). A
re-run of the script rewrites the page: embed the block again after it.

## Step 4 — Verify and report

`manage-journals { action: "get" }` with the Bestiary's `journalId`: confirm the new page is present, the order is
alphabetical, and anything staged reads GM-only. Tell the DM which page was created vs refreshed, and
name any page still hidden from players.
