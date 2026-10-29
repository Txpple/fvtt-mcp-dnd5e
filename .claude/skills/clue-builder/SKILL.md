---
name: clue-builder
description: >-
  Make Clue Board clues and collect them on the party: "add a clue", "put X on the clue board",
  "make these clue items".
---

# Clue builder

A **Clue** is house module fvtt-mod-clueboard's own Item type, `fvtt-mod-clueboard.clue`, never gear:
it sits in the world's Items directory as the DM's master, and *collecting* it puts a copy on a
party's record (the Group actor), where players read it in the module's Mysteries window. The module's
notes are `fvtt-mod-clueboard/README.md`. Two tools, in this order:

1. **Make it:** `manage-items` `create`, `type: "fvtt-mod-clueboard.clue"`, `system: { kind, text,
   foundAt }`, and `folder` the kind's subfolder when the world keeps one (list the Clues first:
   `manage-items` `list` with that `type` shows each one's folder). A Clue of that name already in the
   world is reused, never made twice.
2. **Collect it:** `manage-clues` `collect` with `clues` (exact ids or names) and, for anything not
   found at the table this moment, `stamp: false` (no scene or date in the stamp; the Found at line
   says where; Clue Board 1.2+). One already on the record is reported and skipped. `list` shows the
   record and the world Clues not yet collected; `uncollect` takes one off (its readers and note go
   with it; the Clue stays in the world).

`manage-clues` refuses a world without the module active. Build on the sandbox; a live world only
when the DM says so.

## Writing the clue

- **kind**: `document`, `object`, `statement`, `location`, `body`, `rumour` or `vision`.
- **text** (HTML): the player's handout and nothing else. What the eye sees and what the paper says;
  no DM notes on the item, not even a secret block, and no names the players have not met. What the
  clue means goes in the DM's prep, never on the Clue. Follow the campaign's own handout style where
  it has one.
- **An item a PC already carries** (a starting heirloom, a found document): copy its description from
  the sheet (`search-actor-contents`, then `manage-actors` `get-entity` with the actor's **id**), its
  name and its icon, so the sheet and the clue match. Turn second person into the PC's name and end
  with who carries it ("Tychon carries the chip.").
- **foundAt**: one line, the place first ("Found under the double bed in …"); for something a PC
  brought, whose it is and since when.
- **img**: the carried item's own icon when there is one, else a core `icons/…` path.
