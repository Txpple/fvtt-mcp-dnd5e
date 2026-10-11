---
name: run-script
description: >-
  One short program for the `run-script` tool instead of a column of tool calls. Use when a job
  repeats a tool over a list ("place six goblins", "give every PC a potion"), chains reads into
  writes, or asks for a "dry run" or "undo that run".
---

# run-script — one program, one round trip

**The tool runs JavaScript you write inside the GM's Foundry page**, against `fvtt.*`: the same
page functions every other tool calls, with the same argument shapes. The script's `return` value
and a receipt come back; nothing else enters the conversation. The reference of every function —
155 of them, with their arguments one level deep and their return types — is
[`docs/run-script-api.md`](../../../docs/run-script-api.md), generated from the code. Read the entry
for each function you call; the shapes are the tools' own.

## When a script, when a tool

- **A tool** for one thing: one NPC, one scene, one message. The composites (`author-npc`,
  `create-pc-from-prefab`, `manage-placeables`) stay the way for the common jobs.
- **A script** for a loop or a chain: N of something, a read that feeds a write, a sequence that
  would otherwise be ten calls and ten approvals with the intermediate JSON in between.

## How the program is shaped

The body of an async function. `fvtt.<name>(args)` for every call, `log(...)` for lines you want
printed with the result, `return` the value you need (JSON-able, small). Nothing else is reachable:
`game`, `canvas`, `window`, `document`, `fromUuid`, the document classes, `fetch`, `import`,
`eval` are all out, by design — the facade is the whole surface.

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
  `timeoutSeconds` only when the job's size is known and the user has seen it.
- **Batch**: one `createActorFromCompendium` with `quantity: 6` beats six calls; one
  `addActorItems` with the whole list beats one per item. The write count is calls, not documents.
- **The receipt**: every run returns `receipt rcpt_…: N created, N updated, N deleted`. Undo it with
  `{ "undo": "rcpt_…" }` — deletes what the run created, restores what it changed or deleted,
  newest write first. Receipts live in the bridge's page (the last 50); a `disconnect-bridge` or a
  reload loses them, so undo promptly or not at all. A key an update *added* has no prior value and
  is not restored; a document a run deleted comes back with its id.
- **A failed run keeps its receipt** (the writes done before the throw are in it); undo it if the
  half-done state is worse than none.

## What stays the same

The world is written through the same page functions, so everything the tools promise (compendium
copies carry their items and effects, folders are created by name, player ownership is set the
same way) holds in a script. The authoring policy
([`_shared/authoring-policy.md`](../_shared/authoring-policy.md)) applies: 2024 content, compendium
first, never invent a stat block in a loop.
