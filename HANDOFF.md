# HANDOFF.md — the next MCP batch (written 2026-10-11, after the overnight run)

> **What this is:** the pick-up point for a session that starts cold and is told "do the handoff".
> It is retired (deleted) when the batch is done. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first:
> the gates, the sandbox rules, one feature = one commit with the numbers. `design.md` is binding.

## Where things stand

- **Unreleased on `main`** (CHANGELOG *Unreleased*; `package.json` still 4.3.0 — the maintainer cuts
  releases, do not bump or tag): the seat records and idle logout (#12, 8bebc98) and `run-script`
  (#4, 7f2e08b). Both proven live on the sandbox; the registered servers were restarted on
  2026-10-11 and run this code.
- **Budgets are near their ceilings.** `npm test` prints them: tools/list 204,734 of 205,000 chars
  (81 tools), skill descriptions 7,773 of 8,000, always-on (`session`) 1,778 of 2,100. A new tool
  costs ~1,000–1,300 chars of tools/list; a new always-on tool counts twice. Raising a ceiling is a
  decision to write into `src/measure.test.ts`'s comment with the reason, never a silent edit —
  and the first move is to fold, not add (`run-script { undo }` already exists; see #6 below).
- **The sandbox** (`FOUNDRY_HOST=local`, the dnd5e world on the local headless Foundry): one world
  driver at a time; the Battle Flow suites join as their own user and refuse while the bridge holds
  a GM seat — `disconnect-bridge { all: true }` from any session ends every holder. Never
  `npm run build` while a Battle Flow battery runs: `prebuild` deletes `dist`, which every suite
  imports at start. Save a live script's output to a file before grepping it; a one-off look at the
  world goes through `run-script` or Battle Flow's `tools/job.mjs`, never a throwaway script.
- **The Halruaa registration (prod) now sees `run-script`** once `scripting` is in its toolsets;
  it writes with GM rights. Dry run first there, always.
- **Linux is coming** (suite issue #5). Anything that touches processes or paths keeps its Linux
  branch (`src/holders.ts` has the pattern: `win32` → PowerShell/taskkill, else pgrep/kill).

## The batch, in order

Each is one commit on `main` with the verify counts and the budgets before/after in the message,
the issue closed with a comment that quotes the proof. The order puts the small, independent ones
first and the one that composes the others last.

### 1. `bridge-status` (#9) — small, session toolset

One tool, always on, read-only, under two seconds: versions (Foundry, dnd5e, this server — the
tested range is in the README), the join (host kind, URL, user and role, up since, label, whether
the instance was woken), the family modules active against what the skills expect (Battle Flow,
Area Sounds for `configure-area-sounds`, Open Server for `set-landing-scene`), the browser
(renderer GPU or SwiftShader via `WEBGL_debug_renderer_info`'s `UNMASKED_RENDERER_WEBGL` on
`canvas.app.renderer.gl`, viewport, `canvas.ready`), the toolsets advertised and whether the
registration is read-only (#8).

- Node side needs facts the page cannot see: add `info()` to `FoundryBridge` (`src/foundry.ts`),
  next to `holders()`, returning `{ serverUrl, user, hostKind, label, since, woken }`; `since` is
  the seat record's `since`. The fake in `src/tools/test-helpers.ts` gets it too.
- Page side: one op `bridgeStatus` in a new `src/page/status.ts`, registered in `src/page/index.ts`.
- Budget: the always-on set is at 1,778 of 2,100 — the description must be short; measure first with
  `npm test`.
- Live proof: `scripts/verify-bridge-status.mjs` on the sandbox (the report against `get-world-info`
  and `/api/status`). The `start-session` skill calls it first and surfaces anything amber.

### 2. `readonly` preset, enforced at the bridge (#8) — medium

- Tag every tool read or write in `src/registry.ts` (a family tool with an `action` is write; the
  `get-*` / `list-*` / `search-*` / `read-pack` / `screenshot-scene` / `export-chat-log` tools are
  read). `src/tools/registry.test.ts` asserts every tool carries a tag.
- `FOUNDRY_TOOLSETS=readonly` in `src/toolsets.ts` → the read-tagged tools plus `session`
  (`disconnect-bridge` kept; `run-script` kept, see below).
- Enforcement in the page, not only the advertised list: the write classification already exists —
  `isWriteCall` / `isDeleteCall` in `src/page/run-script.ts`. Move them to `src/page/_writes.ts`,
  use them in the page dispatcher (`window.__fvtt[n](a)` in `src/page/index.ts`) to refuse a write
  op with a `permission` PageError when the page was injected read-only. The flag travels at
  inject: `injectBundle` sets `window.__fvttReadOnly` from config (`FOUNDRY_TOOLSETS` resolved to
  the preset). `run-script` under read-only refuses its writes through the same check, so a script
  can still read.
- `npm run measure` reports the preset's cost; README and `docs/hosts.md` recommend it as the first
  registration, paired with a Player or Trusted Player join user.

### 3. Receipts and undo on every write tool (#6) — the big one

The mechanism exists in `src/page/run-script.ts`: `record()` registers Foundry's own
`create* / preUpdate* / preDelete*` hooks for every CONFIG document class and fills a `Receipt`
(ops with pre-images), kept in `globalThis.__fvttReceipts` (last 50); `undoScript` reverses one
newest op first with created-then-deleted netting. Generalize, do not duplicate:

- Move the receipt machinery to `src/page/_receipts.ts`; `run-script` imports it.
- The choke point is the page dispatcher in `src/page/index.ts`: for a write op (the same
  classification as #8) wrap the call in `record()` and store the receipt. The seam's result shapes
  are typed per tool, so do not change them: the page keeps `lastReceipt`, and the Node tools append
  one line (`receipt rcpt_x: 2 created, 1 updated · undo with run-script { "undo": "rcpt_x" }`) by
  calling a new read op `lastReceipt` after a write — one helper in `src/tools/_receipt.ts` used by
  every write handler's formatter.
- **Undo stays on `run-script { undo }`** (no new tool: tools/list has ~270 chars of headroom). Its
  description already says "reverses a receipt"; widen the wording so a tool receipt is clearly
  the same thing.
- Changed-fields readback: for an update, the pre-image is in the receipt; the formatter prints the
  changed paths with before → after instead of the whole document. `foundry.utils.diffObject` on
  the page side, cut at a few hundred chars.
- Acceptance is the issue's: a create, an update and a delete on an actor, a scene placeable and a
  journal page, each undone, in a live `scripts/verify-receipts.mjs`; a script run and a tool call
  share one receipt shape.

### 4. `run-script` follow-up (#13) — after #6, since it shares the store

- Pre-images in the world: a hidden journal under a folder the tools own, one page per receipt,
  pruned by count and age, read back by id so undo survives a bridge restart and a second machine.
  Decide the folder and the page shape; write both through the page ops so they are receipted too
  (and excluded from their own receipt).
- The dry run as an approval: carry a hash of the script and the listed writes into the real run
  (`approved: "<hash>"`) and refuse a real run whose script hash differs. The listed writes are the
  ones *reached* (a script that reads a stubbed write's result stops there); say so in the result.

### 5. Journal statblocks (#11) — small, independent of the rest

A `statblock` block for `create-quest-journal` / `update-quest-journal`:
`{ kind: "statblock", actor: "<name or uuid>", inline?, label?, caption? }` emitting
`@Embed[<uuid> statblock …]`. Name → uuid: compendium first (premium packs), then world NPCs;
refuse a `character` (the embed falls back to the description). `verify-journal-tooling` holds a
statblock page against the rendered classes (the table in the issue is the assertion list).
`journal-builder` documents it; `bestiary-builder` uses it.

### 6. `init` (#7) — last, it composes 1 and 2

`npx fvtt-mcp-dnd5e init`: asks the five things (host kind, URL, bridge user and password, the
Molten wake URL and WebDAV password), checks the machine (Node 22+, Playwright, Chromium — offer
`npx playwright install chromium` — and the GPU), performs a real join and prints `bridge-status`,
writes the client config (Claude Code `.mcp.json` first; the other clients are the registration
half of #5 and can follow), offers the `readonly` preset for a first run. A non-interactive mode
takes the answers as flags. Acceptance: clone to "start the world" in one command under ten
minutes. `docs/hosts.md` and `docs/local-sandbox.md` shrink to what `init` cannot do.

## The gate, every commit

```sh
npm run check && npm run typecheck && npm test && npm run build && npm run knip
node scripts/measure/run-script-api.mjs --check     # when a page op is added or changed
node scripts/measure/skills-matrix.mjs              # 0 unresolved when a skill names a tool
```

plus the family's live verify script on the sandbox, one at a time. A verify leaves the world as
it found it: `ZZ-*` documents deleted in `finally`, settings restored.

## When the batch is done

Delete this file in the last commit, add each item to CHANGELOG *Unreleased*, and tell the
maintainer the release is theirs to cut (docs/RELEASE.md). Battle Flow's preflight and NOTES §5
name the seat records; if `bridge-status` or the read-only flag change what the preflight should
print, `fvtt-mod-battleflow/tools/target.mjs` is the other side.
