---
name: start-session
description: >-
  Boot the Foundry world and report its state; read-only, safe when it is already up. Use when the
  user wants to start, wake, launch, or "spin up" the Foundry instance or world, or kick off a
  session — "start the world", "boot Foundry", "open the table", "fire up the server", "wake the
  box", "get the world up", "let's start a session".
---

# Start a work session

Bring the Foundry world up and report its state. This is a thin orchestration skill: the mechanics
(waking a sleeping instance, launching the world) are baked into the bridge — **do not re-implement
them here.** Any tool call triggers the bridge's cold-start path automatically.

## How the cold start works (context, not steps)

The headless bridge handles the cold states on its own, driven by the registration's env
(`FOUNDRY_URL`, `FOUNDRY_ADMIN_KEY`, `FOUNDRY_WORLD_ID` when there are several worlds, and — on a
host that sleeps — `FOUNDRY_WAKE_URL`):

1. **Instance asleep** → the bridge GETs the wake URL, if the host has one. A host without a wake
   step (a local install, a box that is always on) is simply expected to be up.
2. **Instance up, no world active** → with the admin key the bridge logs into `/setup` and launches
   the configured — or the only — world.
3. **World booting** → it waits for the world to become joinable (~25 s for a heavy dnd5e world,
   plus the wake time on a fully cold box).

So you don't drive any of this manually: one tool call, and the bridge does the rest.

## Which Foundry?

Every tool call goes to one registered MCP server, and each registration is one Foundry instance
(`FOUNDRY_HOST` = `generic` / `molten` / `local`). Name the tools bare — `get-world-info`, never a
`mcp__<registration>__` literal. When more than one Foundry is registered, use the one the user
named; if they named none, the one that is *not* the local sandbox is the default — and say which
one you used. The result's `host` block confirms it (`host.kind`, `host.label`).

## Steps

1. **Set expectations, then trigger the boot.** Tell the user a cold box can take ~30–60 s (wake +
   ~25 s world boot; a local install that is not running fails fast instead — see below), then call
   `get-world-info`. This single call wakes + launches as needed and returns once the world is live
   (already up = returns immediately).

2. **Report the state.** Summarize the result clearly:
   - world title / id, system + version, Foundry version;
   - `host` — where it runs (`kind`, `label`) and `files` (which file plane the asset tools have
     here: `local filesystem` / `WebDAV` / `bridge (FilePicker)`);
   - `bridgeUser` — the user the bridge joined as and its `role`; confirm it is present in
     `activeUsers` (that doubles as a bridge-health check) and that the role is GAMEMASTER or
     ASSISTANT (a lower role means every write will fail — say so now, not on the first edit);
   - `library` — the premium books: MM / PHB / DMG `present` is what the authoring skills need;
     name anything `missing`;
   - the other `activeUsers` (players already at the table);
   - `automation` (dnd5e 6.x) — mention only what matters for the night: the in-world date/time
     (`calendarNow`, when `calendarEnabled`), and any switch that is OFF its default (falling or
     exhaustion automation disabled, auto-Downed on, players allowed the damage / effects trays,
     bastions on). Change a switch only when asked — `configure-dnd5e-settings` (it echoes previous
     → new; a few need a client reload). Advance or set the date with `manage-calendar` ("advance 8
     hours", "it's the 3rd of Mirtul, dawn") — advancing time is what triggers dawn / dusk / day
     recovery and bastion turns.

3. **Light orientation (optional).** If it helps what the user is about to do, also call
   `get-current-scene` and mention the active scene. Keep it brief — don't enumerate the whole
   world unprompted.

4. **Hand off.** End by asking what they want to work on, or proceed directly if the user already
   stated the next task in the same message.

## If it fails

`get-world-info` failing almost always means the bridge couldn't reach or boot the instance — it is
**not** a reason to start clicking around. The error names the variable or the step that failed;
diagnose in this order:

- **Timeout / no response on a cold box** — the instance may still be waking. Wait and retry the
  same call once before concluding anything.
- **Unreachable, local install** — the error says so and names the launcher
  (`node scripts/local-foundry.mjs start`). A local Foundry does not wake itself.
- **Unreachable, no wake URL** — a host that sleeps needs `FOUNDRY_WAKE_URL` in the registration's
  env (check names only, never echo secret values). Without it, the manual fallback is: wake the
  instance the way the hosting panel does, then retry.
- **Up but no world, and no admin key** — the bridge cannot launch a world without
  `FOUNDRY_ADMIN_KEY`; tell the user to launch it from Foundry's `/setup` page (or set the key).
- **Persistent 502 / world won't boot** — the Foundry process or world may be broken. Report it
  plainly with the error; don't keep retrying in a loop.

## Boundaries

- Stay read-only. This skill only *observes* state — never create, edit, or delete world content
  as part of "starting a session."
- Don't duplicate launch logic in prose or scripts; the bridge owns it.
- This skill is just the kickoff. Once the world is up, hand off to whatever the user actually
  wants to do (or the relevant content skill).

## ⚠️ LIVE GAME sessions: assist-only

If the user says this is a **live session** (players at the table, game night), the mode for the
ENTIRE session is **help and assist with tasks** — nothing else. Do NOT start redoing, recoding, or
fixing tools / skills mid-game, no matter what friction surfaces. A tool gap found live gets
**marked down** (the session's GM notes / a fix list) and fixed later in a dev session; use a manual
workaround in the moment and keep the game moving. The table's time is the scarcest resource in the
room — a mid-game rebuild risks restarts, broken state, and lost minutes. (Dev / authoring sessions
are the opposite: there, dogfood friction means fix the tool in-session.)
