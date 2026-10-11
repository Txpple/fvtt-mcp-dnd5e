---
name: run-script
description: >-
  One short program for the `run-script` tool instead of a column of tool calls. Use when a job
  repeats a tool over a list ("place six goblins", "give every PC a potion"), chains reads into
  writes, or asks for a "dry run" or "undo that run".
---

# run-script — one program, one round trip

**The tool runs JavaScript you write inside the GM's Foundry page**, against `fvtt.*`: the same
page functions every other tool calls, with the same argument shapes, and with the rights of the
user the bridge joined as. The script's `return` value and a receipt come back; nothing else
enters the conversation. The reference of every function — 155 of them, with their arguments one
level deep and their return types — is [`docs/run-script-api.md`](../../../docs/run-script-api.md),
generated from the code. Read the entry for each function you call; the shapes are the tools' own.

## When a script, when a tool

- **A tool** for one thing: one NPC, one scene, one message. The composites (`author-npc`,
  `create-pc-from-prefab`, `manage-placeables`) stay the way for the common jobs.
- **A script** for a loop or a chain: N of something, a read that feeds a write, a sequence that
  would otherwise be ten calls and ten approvals with the intermediate JSON in between.

## How the program is shaped

The body of an async function. `fvtt.<name>(args)` for every call, `log(...)` for lines you want
printed with the result, `return` the value you need (JSON-able, small). The facade is the
surface: what goes around it skips the caps, the receipt and the dry run. To catch that by habit,
`game`, `canvas`, `window`, `document`, `fromUuid`, the document classes and `fetch` are shadowed
(they read `undefined`), and `import`, `eval`, `constructor`, `Reflect`, `__proto__` and their kin
are refused as code before the script travels (in strings and comments they are only words).
Neither is a security boundary: the bridge user's role is, so a write the role allows, a script
can make. Decided in issue #15: no Worker-based runner, and the `scripting` toolset stays
advertised by default, because undo lives on this tool.

```js
const camp = { x: 2400, y: 1800 };
const found = await fvtt.searchCompendium({ query: "Goblin", type: "npc", limit: 5 });
const goblin = found.results.find(r => r.name === "Goblin");
const placed = [];
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const r = await fvtt.createActorFromCompendium({
    packId: goblin.packId, itemId: goblin.id, customNames: [`Goblin ${i + 1}`],
    folder: "Encounters/Ambush", addToScene: true,
    placement: { type: "coordinates", coordinates: [{ x: camp.x + Math.cos(angle) * 300, y: camp.y + Math.sin(angle) * 300 }] },
  });
  placed.push(...r.actors.map(a => a.id));
}
log("placed", placed.length);
return { placed };
```

## The guard rails, and how to use them

- **Dry run first for anything that writes more than a few documents**: `dryRun: true` runs the
  reads, stubs every write (each returns `{ dryRun: true }`) and lists the writes it reached. Show
  the user that list; then run for real.
- **Caps**: 150 writes and 30 deletes per run, 60 s. Raise `maxWrites` / `maxDeletes` /
  `timeoutSeconds` only when the job's size is known and the user has seen it. A run past its
  timeout is abandoned and can write no more (every `fvtt.*` call after it is refused). A script
  that never yields (a synchronous loop) cannot be timed out from inside: the bridge cuts it about
  35 s past its timeout and closes the page, the run's receipt is lost with it, and the outcome is
  unknown. Read the world before running it again.
- **Batch**: one `createActorFromCompendium` with `quantity: 6` beats six calls; one
  `addActorItems` with the whole list beats one per item. The write count is calls, not documents.
- **The receipt**: every write tool answers with one receipt line, and a run with one for the whole
  run: `receipt rcpt_…: 1 created, 1 updated, 0 deleted (Actor "Goblin 3": system.attributes.hp.value)
  · undo: run-script { "undo": "rcpt_…" }`. The undo is the same `{ "undo": "rcpt_…" }` for a tool's
  receipt and a run's: it deletes what the call created, puts back the paths it changed (removing
  the ones it added), and re-creates what it deleted with its id, newest write first. Receipts are
  kept on the bridge's machine for a day (the newest 50 per world), so they survive a
  `disconnect-bridge` and a restart; a receipt belongs to the world it was written in. An undo
  answers with a receipt of its own (`reverses rcpt_…`): undo that to redo. A receipt is undone
  once; a second undo of it is refused, naming the receipt that reversed it.
- **What cannot be undone**: a write whose pre-image was over the cap (2 MB per document, 8 MB per
  call; the line counts them as not undoable), the file plane (uploads, copies, moves and deletes of
  files), chat players have already seen (the message can be deleted, not unseen), and a pulled view.
- **A failed run keeps its receipt** (the writes done before the throw are in it), and so does a
  tool that fails after it wrote; undo it if the half-done state is worse than none.

## What stays the same

The world is written through the same page functions, so everything the tools promise (compendium
copies carry their items and effects, folders are created by name, player ownership is set the
same way) holds in a script. The authoring policy
([`_shared/authoring-policy.md`](../_shared/authoring-policy.md)) applies: 2024 content, compendium
first, never invent a stat block in a loop.
