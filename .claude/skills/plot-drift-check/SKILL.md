---
name: plot-drift-check
description: >-
  Audit the live Foundry world against the campaign's plot document and report DRIFT — stale names
  after a rename, contradictions, dropped plot elements still referenced, GM-only canon on
  player-visible pages; READ-ONLY unless told to fix. Use when the user wants to "check for plot
  drift", "audit the world against the plot doc", "did the rename propagate", "find stale references
  to <name>", "consistency-check the campaign", "sync the world with the plot", or after any
  plot-doc revision.
---

# Plot-drift check

A campaign's plot doc and its Foundry world drift apart: a renamed NPC survives in a roll-table
entry, an old description lingers in a journal, a dropped subplot still has a quest giver. This
skill diffs the two and reports every mismatch. The tools own the reads and the surgical writes;
this skill owns what counts as canon, what counts as drift, and what is deliberate.

**Report first, fix second.** The default deliverable is a drift report. Never edit anything until
the user approves findings — then fix each with the narrowest tool available.

## Step 1 — establish canon

1. **Get the current plot document.** Look in the campaign's notes repo first: if the user keeps a
   per-campaign repo (a campaign pointer memory names it), its `plot/` directory holds the
   authoritative doc — the newest draft there is canon. Only ask the user for a path if no campaign
   repo or pointer exists. Read the file itself — never work from a memory summary or condensed
   plot reference; the whole point is that summaries and worlds go stale.
2. **Extract the canon terms**, in four buckets:
   - **Named entities** — NPCs, factions, places, artifacts/relics, deities, quest names.
   - **Renames** — anything the doc marks as renamed/superseded, PLUS ask the user:
     *"any renames or retcons since the last pass?"* A rename's OLD name is the highest-value
     search term in the whole audit.
   - **Checkable facts** — who gives which quest, where an item is, physical descriptions,
     counts ("four ruins"), relationships. Only facts the world could plausibly contradict.
   - **Secrets** — canon the players must not see yet (twists, true identities, endings).
3. For each term, derive the **search stem**: the shortest distinctive form ("Sleeper" catches
   "Sleeper's" and "the Sleeper"; avoid stems that collide with common words).

## Step 2 — sweep the world

Sweep broadest-text-first; every hit gets recorded with its document type, name, id, and the
offending snippet.

| Surface | Tools | What to check |
|---|---|---|
| Journals (the big one) | `search-journals` per stem; `manage-journals` `list` → `get` | old names in content, contradicted facts, page names |
| Roll tables | `manage-rolltables` `list` → `get` on plot-adjacent tables | entry text (the classic straggler — a rename misses table entries) |
| Actors | `manage-actors` `list` for names; `manage-actors` `get` on plot-relevant NPCs/PCs | actor names, token names, biographies |
| Items | `search-actor-contents` / `manage-items` `list` → `get` for plot items | descriptions, unidentified vs true names |
| Scenes & pins | `manage-scenes { action: "list" }`, `manage-placeables { kind: "notes", action: "list" }` | scene names, map-pin labels |
| Folders & playlists | `manage-folders` / `manage-playlists` `{ action: "list" }` | organizational names that carry old terms |
| Visibility | journal page ownership from the journal reads | any **secret** term readable on a player-visible page |

Scope judgment: sweep **every** journal and roll table (text is where drift lives), but only the
plot-relevant actors/items/scenes — auditing forty townsfolk bios for a villain rename is noise.

## Step 3 — classify, don't just grep

Each hit becomes one of:

- **Stale name** — the old term where the new one belongs. *Caveat:* an old name can be
  legitimate **in-fiction history** ("the fey once called the Sleeper…"). If the surrounding text
  reads as deliberate lore, file it under *deliberate? confirm* instead of *stale*.
- **Contradiction** — world text asserts what the doc denies (wrong hair color, wrong quest
  giver, wrong count). Quote both sides.
- **Orphan** — the world references a plot element the doc no longer contains. The fix may be
  deletion, rewrite, or updating the DOC — if the world looks *more* current than the doc, say so:
  the doc may be the stale side (fix the source of truth first, then the world).
- **Leak** — a secret readable by players (page ownership/visibility). Always top severity.
- **Gap** *(reported separately, not drift)* — doc canon with no world presence at all. Useful
  prep signal, but absence isn't an error.

## Step 4 — the drift report

Deliver one report, ordered **Leaks → Contradictions → Stale names → Orphans → Deliberate? →
Gaps**. Each finding: the document (type, name, id, page), the snippet, what canon says, and the
proposed fix + tool. End with the summary counts and the explicit ask: *"say which to fix."*
Offer to also write the report as a GM-only journal (`manage-journals` `create`, GM visibility, the DM-tools
folder) if the user wants it in-world.

## Step 5 — fixes (only on go-ahead)

Narrowest write wins; never rebuild a document to change a phrase:

- Journal page text → `manage-journals { action: "update" }` (the affected page only).
- Roll-table entry → `manage-rolltables { action: "update" }` with `editResults` (surgical per-entry; siblings untouched).
- Actor name/token name/bio → `manage-actors` `update` (`name`, `tokenName`, `biography`).
- Item description/name → `update-actor-item` / `manage-items` `update` (mind the unidentified true-name
  masking — verify the echo).
- Leaks → `set-journal-page-visibility` (or move the text to a GM page).

After fixing, re-run the affected stems (Step 2, targeted) and report the re-check clean — a fix
pass that ends "0 hits remain" is the exit criterion.

## Boundaries

- **Never edit compendium sources** — world documents only.
- **Placed NPC tokens are snapshots**: a base-actor fix does NOT reach tokens already on scenes.
  If a renamed NPC has placed tokens, check them (`manage-placeables { kind: "tokens", action: "list" }`)
  and fix per-instance (token id as `actorIdentifier`, or `manage-placeables { kind: "tokens",
  action: "update", ids, name }` for the nameplate).
- Don't touch player-authored text (PC bios the player wrote) without flagging it explicitly.
- Don't "fix" the *deliberate? confirm* bucket without an answer.
- If the doc and the user disagree mid-run, stop — the doc is the north star only after the user
  confirms it's current.
