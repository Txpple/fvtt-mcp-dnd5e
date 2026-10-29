---
name: clue-builder
description: >-
  Make Clue Board clues (the `fvtt-mod-clueboard.clue` item type) and collect them on the party's
  Mysteries. Use when the DM wants to "add a clue", "make these clues", "put X on the clue board",
  "add clue items", or turn a found document, object, statement, body, vision or rumour into a Clue,
  including clues added after the fact (a PC's starting heirloom, something found sessions ago).
---

# Clue builder

A **Clue** is the Clue Board module's own item type (`fvtt-mod-clueboard.clue`, system fields `kind`,
`text`, `foundAt`), never gear: it sits in the world's Items directory as the DM's master, and
*collecting* it puts a copy on the party's record (flags on the Group actor), where players read it in
Mysteries. The module's own notes are `fvtt-mod-clueboard/CLAUDE.md` and `README.md`.

## The MCP cannot make one

`manage-items` / `fvtt.createWorldItems` validate against dnd5e's own item types and refuse
`fvtt-mod-clueboard.clue`, and `run-script` cannot reach `game` or the module's API. Use the module's
tool instead, which drives the GM page and calls the module's own `collect`:

```bash
cd <suite>/fvtt-mod-clueboard
FOUNDRY_HOST=local node tools/add-clues.mjs <clues.json> [--party <name>] [--no-stamp] [--dry-run]
FOUNDRY_HOST=molten FVTT_MCP_ENV=<suite>/fvtt-mcp-dnd5e/.env.halruaa node tools/add-clues.mjs <clues.json> ...
```

`clues.json` is an array of `{ name, kind, img, text, foundAt }` (write it in the scratchpad). Each
Clue lands in the world's **Clues** folder, in the subfolder flagged with its kind (Documents, Objects,
Statements, Bodies, Visions, Rumours); a same-named world Clue is reused, one already on the party is
skipped. Always `--dry-run` first. The run's JSON shows the ids, folders and the party's entry count;
read one back with `run-script` `fvtt.getWorldItem` (reading works). Prod only on the DM's
"put on prod"; otherwise the sandbox.

`--no-stamp` clears the scene from the collect stamp: use it for anything not found at the table
tonight (the Found at line says where). Every earlier Clue on Echoes of Halruaa was collected that way.

## Writing the clue

- **kind**: `document`, `object`, `statement`, `location`, `body`, `rumour` or `vision`.
- **text**: the player handout, written as a Call of Cthulhu prop (the campaign's rule): what the eye
  sees and what the paper says, no Keeper notes, no names the players haven't met. For an item a PC
  already carries, copy its description from the sheet (`fvtt.searchCharacterItems`, then
  `fvtt.getCharacterEntity` with the actor's **id**: a first name is not found), which for a starting
  heirloom is the Player's Guide wording. Turn second person into the PC's name, and end with who
  carries it ("Tychon carries the chip.").
- **foundAt**: one line, the place first ("Found under the double bed in …"); for an heirloom,
  "Cecil's heirloom, carried out of the Hearth when the Door opened."
- **img**: the carried item's own icon when there is one, else a core `icons/…` path.
- **name**: the item's own name when a PC carries it, so the sheet and the clue match.

The meaning of a clue (which Piece it serves, what a roll adds) goes in the session plan or
`plot/plot.md` §4, never on the Clue.
