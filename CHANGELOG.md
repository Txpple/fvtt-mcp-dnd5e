# Changelog

What changed for a user of the tools and skills, release by release. The measured numbers
(`npm test` budgets, `npm run measure`) ride each entry from 3.0 on. Dates are tag dates.

## Unreleased

- **Lights read and write whole.** `manage-placeables` `kind: "lights"` `list` returned only the
  centre, radii, colour, angle and the animation's type, so a light someone tuned by hand could
  not be read or copied, and several of its settings could not be written at all. Every field of
  the v14 AmbientLight now reads back under the name its input takes, so a read row passes
  straight back as a patch: `alpha`, `luminosity`, `attenuation`, `coloration`, `saturation`,
  `contrast`, `shadows`, `negative`, `priority`, `animationSpeed`, `animationIntensity`,
  `animationReverse`, `darknessMin` / `darknessMax`, `elevation`, `locked`. The ones that had no
  input (`coloration`, `saturation`, `contrast`, `shadows`, `negative`, `priority`,
  `animationReverse`, `locked`) are now settable on create and update.
- **`animationType: ""` (or `"none"`) clears an animation.** It was documented as "none" but
  silently ignored, so a light's animation could never be removed.
- **`screenshot-scene` can see through a token.** `asToken` (a token id or name on the scene)
  captures the player's view (that token's vision, fog and lighting), so a light's edge can be
  judged the way the table sees it; the GM's all-seeing view hid the hard ring at a light's dim
  radius. Every shot now releases controlled tokens first, so it never leaves one selected.
- The light field descriptions are shorter, to pay for the new fields inside the tools/list ceiling.
- Budgets: tools/list 204,651 → 204,987 chars (81 tools); always-on 1,778, skill descriptions
  7,773 unchanged.

## 4.5.0 — 2026-10-11 — Battle Flow is By the Books

- **The bridge reports By the Books.** Battle Flow became Open Roll 5e: By the Books
  (`fvtt-mod-bythebooks`) at its 3.0.0. `get-world-info`'s `bridge.modules` names it under
  `bythebooks` (was `battleflow`): its version when active, else `not active`, and the warning
  reads `By the Books is not active in this world: the combat report needs it`. `npm run doctor`
  and `npm run smoke:bridge` print `By the Books <version>`.
- **A world still on Battle Flow 2.x reads as something true.** When By the Books is not active and
  Battle Flow is, `bythebooks` is `Battle Flow 2.17.0 (legacy)` (the page fact carries
  `legacy: true`), the doctor's line says `Battle Flow 2.17.0 (legacy, now By the Books)` with a !,
  and the warning is `Only the legacy Battle Flow 2.17.0 is active in this world: it is now By the
  Books; install fvtt-mod-bythebooks and disable Battle Flow`. Nothing here reads the module's
  chat-card stat stamps (the scribe does): new cards carry `flags["fvtt-mod-bythebooks"]`, older
  ones keep `flags["fvtt-mod-battleflow"]`; `docs/contracts.md` names both.
- Docs that state current facts follow the rename (the contracts row, the sandbox deploy example,
  the start-session and scene-builder skills); dated history stays as written.
- **The sandbox server starts in its data folder.** `node scripts/local-foundry.mjs start` spawned the
  headless server in the caller's folder, and a process pins its working folder for its whole life:
  one started inside a module's clone blocked renaming that clone (the Battle Flow rename,
  2026-10-11). It now starts in the Foundry data folder, wherever it is launched from.
- Budgets unchanged: tools/list 204,651 chars (81 tools), always-on 1,778, skill descriptions 7,773.

## 4.4.1 — 2026-10-11 — the PC builder's own switch leaves the receipt

- **`create-pc` and `level-up-pc` no longer report their advancement switch in the receipt.** The
  builder turns `dnd5e.disableAdvancements` on for the build and restores it in `finally`; that
  toggle rode into the call's receipt as `1 updated (Setting "dnd5e.disableAdvancements": value)`,
  also on a refused build that persisted nothing, and an undo had nothing to put back. The switch
  is now written as the bridge's own bookkeeping (the same `UNRECORDED` option the seat marker
  uses), so a PC build's receipt names the actor and nothing else. `verify-receipts` holds it
  (27/27); `verify-pc-build` 70/70.
- Budgets unchanged: tools/list 204,651 chars (81 tools), always-on 1,778, skill descriptions 7,773.

## 4.4.0 — 2026-10-11 — the last pass before sharing: receipts on every write, readonly, init, the bridge in get-world-info

- **Every write tool answers with a receipt** (issue #6). The bridge reaches every page op through
  one choke point: a write runs under the page's write lock, one at a time, while Foundry's own
  document hooks record each document it creates, updates or deletes, with the pre-image an undo
  needs (an update keeps the prior value of each path it changes, a delete the whole document). The
  server groups one call's writes into one receipt and appends one line to the answer, also when
  the call failed after it wrote:
  `receipt rcpt_ab12cd: 1 created, 1 updated, 0 deleted (Actor "Goblin 3": system.attributes.hp.value) · undo: run-script { "undo": "rcpt_ab12cd" }`.
  `run-script { "undo": … }` reverses any receipt, a tool call's or a run's, newest write first:
  it deletes what the call created, puts back the paths it changed (removing the ones it added)
  and re-creates what it deleted with its id. An undo answers with its own receipt
  (`reverses rcpt_…`), so it can be undone in turn (a redo); a receipt is undone once, and only
  when every write of it was reversed: an undo that cannot reverse them all names the ones it
  could not and says `receipt rcpt_… stays undoable` (its own receipt `partly reverses` it), and
  undoing it again leaves alone what is already back. An undo that finds every value already back
  (put back by hand) writes nothing, keeps no receipt of its own and says `nothing to put back`;
  the receipt counts as undone. Receipts are kept on the bridge's machine, not in the page
  (`fvtt-mcp-dnd5e/receipts/` under the OS temp dir, keyed by server URL and world id), the newest
  50 per world for a day and 64 MB at most, never the one just written, so they survive a
  `disconnect-bridge` and a restart and are never applied to another world. Not undoable: a
  pre-image over 2 MB (8 MB per call, across all of its page writes; the line counts them), the
  file plane, chat already seen, a pulled view. A registration without `scripting` gets the line
  with how to enable the undo. A sibling harness driving `fvtt-mcp-dnd5e/client` asks for no
  receipt and pays nothing. Two sessions on one seat keep separate receipts but still interleave
  their writes at the server, where no write lock reaches: an undo puts back a value the other
  session has changed since, as the seat warning at connect says. The delete tools
  (`manage-actors` `delete`, `bulk-delete`, `delete-chat-messages`) no longer say a delete cannot
  be undone. Measured in the page on the sandbox: the recorder's hooks cost 0.07 ms per write, a
  delete's pre-image 0.15 ms for a 26 kB actor, and a real update's time is unchanged within its
  noise (8–9 ms). `scripts/verify-receipts.mjs`: 25/25.
- **`FOUNDRY_TOOLSETS=readonly`: a registration that only reads** (issue #8). It advertises every
  toolset's reads: the read tools whole, and each family tool narrowed to its read actions
  (`manage-actors` `list` / `get` / `get-entity` / `export`, `manage-placeables` `list` for every
  kind), 41 tools, 56,627 chars ≈ 15,730 tokens (27.7% of the full list). Every other call,
  advertised or not, is refused by name before its handler runs (`manage-actors action "delete" is
  not a read: this registration is read-only (FOUNDRY_TOOLSETS=readonly); use a registration
  without it.`). A configure call that names a field and an `export-chat-log` copy into `Data/`
  (`remotePath`) are writes; `run-script` is never a read. `readonly` stands alone: beside a
  toolset it stops the server at startup. Pair it with a Player or Trusted Player join user,
  whose role is the boundary the server cannot cross: the bridge warns at connect, and
  `npm run doctor` on its login line, when a read-only registration joins as a Gamemaster or
  Assistant GM. The tags, per tool and per action, are `src/tool-kinds.ts`; `.mcp.json.example`
  carries a `foundry-readonly` entry.
- **`npm run init`: from a built clone to a checked registration in one command** (issue #7). It
  says first what it cannot do (the Foundry user the bridge joins as must exist in the world), then
  asks for the host (`local`, `molten`, `generic`), the URL, that user and its password, the admin
  password, the host's extras (Molten's wake URL and File Manager password; a local install's
  `Data` folder, offered at the platform's default), whether the first run is read-only, and where
  the registration goes: this clone's `.mcp.json`, another project's, or `~/.claude.json` (copied
  to `.bak-<time>` first; only its `mcpServers` entry changes). Every answer is also a flag; `--yes`
  asks nothing, and a missing required answer exits 2 naming its flag. Secrets go only to the
  `.env`: a new one gets the minimal block `.env.example` opens with, an existing one is copied to
  `.bak` and changed in place where an answer differs (on the 2.x alias's line when that is what
  the host reads, so the answer is not shadowed), every other line kept. The registration is the
  full Node path, `dist/index.js` and an env block that names the instance (`FOUNDRY_HOST`,
  `FOUNDRY_URL`, `FOUNDRY_TOOLSETS`, and `FVTT_MCP_ENV` for a `.env` that is not the repo's). Then
  it runs the doctor, whose lines are the join report, and prints the entry as an `mcpServers`
  block for any other MCP client; Claude Code's config is the only one it writes. `AGENTS.md`
  ships beside `CLAUDE.md`. The legacy names are one table in the host selector (`legacyNameOf`),
  and `runDoctor` takes the environment it reads as an argument.
- **`get-world-info` reports the bridge itself** (issue #9): a `bridge` block after `host` with
  this server's version, since when it holds the seat (the join user is `bridgeUser`'s), `woken`
  (this connect found the world asleep, not launched, or booting), Chromium's renderer
  (`GPU: <name>` or `software: <name>`, the canvas's unmasked WebGL renderer), `canvasReady`, the
  Open Roll 5e modules the skills lean on (Battle Flow, Area Sounds, Open Server: a version, or
  `not active`), the registration's `toolsets` (`all`, `readonly`, or the list), and `warnings` for
  whatever of it is amber: a software renderer, an inactive family module (naming what needs it),
  a read-only registration joined as a user that can write, Foundry below 14.368 or dnd5e below
  6.0.5 (the README's requirements line). It stands in for the proposed `bridge-status` tool: a
  tool would have pushed tools/list (204,714 of 205,000) and the always-on set (1,778 of 2,100)
  past their ceilings, where a block in a result costs neither. `npm run doctor` prints a
  `bridge:` line after the login (a ! for a software renderer or an inactive module),
  `npm run smoke:bridge`'s line gains the renderer and the modules, and the `start-session` skill
  reports the block and surfaces every warning. Library: `FoundryBridge.info()` (server URL, user,
  since, woken); the page's `getWorldInfo` result carries `bridge` (renderer, canvasReady,
  viewport, modules). `scripts/verify-bridge-status.mjs`: 13/13.
- **A journal page can carry an NPC's stat block** (issue #11): an `html` block holding
  `@Embed[<uuid> statblock]`, which dnd5e draws from the live actor when the page renders (its own
  stat-block template: title, tags, abilities, actions, in a figure captioned with the name;
  `inline`, `caption=false` and `label="…"` as the system reads them), so a later edit to the actor
  shows on the page. The quest tools already store enricher text as written (4.2.0), so no tool or
  schema changed (0 chars of tools/list): `journal-builder` documents the block, where its uuid
  comes from (`search-compendium` for a book creature, `manage-actors` `list` for a world NPC), that
  it is NPC only (a `character`'s embed is its description) and that the page's visibility is the
  only gate; `bestiary-builder` appends one beside a creature's lore when the table wants it.
  `scripts/verify-journal-tooling.mjs` holds the rendered classes, 54/54 (was 48), and now removes
  the `ZZ-JOURNAL-IT Journals` folder its first section used to leave behind.
- **What a run-script call does is declared per function** (issue #14): every `fvtt.*` function
  is tagged read, write or delete by what its handler does (`src/page/_ops.ts`), where a verb
  guessed from its name used to decide. A dry run had executed `remapSceneTeleporters` for real,
  uncounted; it is now listed and stubbed like every write. Reads a dry run now runs instead of
  stubbing: `configureAreaSounds` `list` / `library`, `rollOnTable` (it neither draws nor posts),
  `manageCalendar` without an action, a configure function called with no field
  (`configureDnd5eSettings`, `configureCombatTracker`, `configurePrimaryParty`), and a
  `bulkDelete` / `relinkAsset` preview (`dryRun: true`). `configureAreaSounds` `remove` counts
  against the delete cap. A page function added without a tag does not compile.
- **`run-script`** (issue #4, the `scripting` toolset): one tool whose argument is a short JavaScript
  program. It runs in the GM's page against `fvtt.*` — the page functions behind every tool, with
  the tools' own argument shapes — so a loop or a bulk job is one round trip and only the return
  value comes back. It runs with the bridge user's rights, and that user's role is the boundary:
  the shadowed globals (`game`, `canvas`, `window`, the document classes, `fromUuid`, `fetch`) and
  the words refused before the script travels (`import`, `eval`, …) guard against accidents and
  are not a sandbox (issue #15). Writes are counted and capped (150 writes, 30 deletes, 60 s;
  raisable), a run's writes land in one receipt with their pre-images (the one every write tool
  answers with, above), and `dryRun` stubs the writes and lists them. The `run-script` skill
  carries the rules; the facade's reference, `docs/run-script-api.md` (155 functions), is
  generated from the program by `scripts/measure/run-script-api.mjs`.
- **The seat has a record** (issue #12). While connected, the bridge leaves one file per process
  under the OS temp dir (`fvtt-mcp-dnd5e/holders/`, keyed by server URL and user) and the same
  facts on its User document (`flags.world.fvttMcpBridge`: pid, host, label, Claude Code session,
  since), cleared on disconnect. A second bridge joining the same seat on the same machine names
  the first in its log instead of joining silently; the Battle Flow suites' preflight prints
  *held by pid N — Claude Code session S — since T* instead of a bare user name. The label is
  `FOUNDRY_BRIDGE_LABEL`, default the Claude Code session that started the server.
- **`disconnect-bridge` names the other holders and takes `{ "all": true }`**, which ends every
  other session's browser on this seat on this machine (their servers keep running and reconnect
  on their next call) — the cure that used to run through the process table.
- **Idle logout.** A bridge that has served no call for `FOUNDRY_IDLE_LOGOUT_MIN` minutes
  (default 20; 0 disables) logs out on its own; the next call reconnects, exactly as after
  `disconnect-bridge`. A forgotten session's seat no longer blocks a battery an hour later.
- Library: `listHolders`, `describeHolder`, `seatKey` and the `Holder` type are exported from
  `fvtt-mcp-dnd5e/client`; `Foundry` takes `label` and `idleLogoutMs`.
- **run-script's word check reads code, not prose** (issue #15). Strings, template-literal text
  and comments are blanked before the check (a `${…}` expression stays code), so a content job
  with `'Go fetch the relic'` or `'<p>Trade goods import duties</p>'` in it is no longer refused.
  `constructor`, `Reflect`, `getPrototypeOf` and `__proto__` are refused as code and as a
  computed key (`x['constructor']`): the obvious way back to the page's real globals past the
  shadowing. The tool's description, the refusal and the skill no longer call the facade a
  boundary. Decided: no Worker-based runner, and `scripting` stays advertised by default,
  because undo lives on this tool.
- **A page op has a cap** (issue #16). A call that hangs in the page no longer holds the bridge's
  seat until `disconnect-bridge`: past its cap (10 min; `run-script`: its timeout + 30 s) the
  bridge asks the page whether it still answers. A page that answers is slow, not stuck, and the
  op keeps its time (asked again each interval, 30 min at most); a page that does not is closed,
  the call fails saying its outcome is unknown (a write may or may not have landed) and is never
  retried, and the next call reconnects. A script stuck in `while (true) {}` with a 5 s timeout
  now fails at about 40 s. The connect is never capped (a cold box keeps its wake and ready
  budgets). Library: `Foundry` takes `opCapMs`.
- **A write is never run twice after the page went away** (issue #16's review). A call whose page
  bridge vanished under it (a world reload, a page the op cap closed under another call) was
  recovered and run again; now only a read is. A write fails as a `connection` error saying its
  outcome is unknown, and the bridge reconnects for the next call.
- **A run abandoned at its timeout can write no more** (issue #16's review): every `fvtt.*` call
  after the timeout is refused, where the script's body used to keep writing, unrecorded.
- **`disconnect-bridge { "all": true }` ends only the recorded browser** (issue #17). A seat record
  names the bridge's browser by pid and executable path (the pid from a CDP `SystemInfo` call, the
  path from the operating system), and eviction ends that pid only while it still runs that
  executable: a record left by a hard-killed server whose pid was since reused is cleared and
  nothing is killed. The result says per holder which browser it ended, or why it ended none. No
  `pgrep`: Windows ends the browser's tree (`taskkill /T`), Linux its process group. An evicted
  bridge's next call re-joins with a new browser; it used to fail on the dead one (`Target page,
  context or browser has been closed`) until its server restarted. Library: `Holder` carries
  `browserPid` / `browserExe`, and `evictOtherHolders()` returns one entry per holder.
- **A seat record stays until its browser is known ended or gone** (issue #17's review).
  `disconnect-bridge { "all": true }` dropped every other holder's record, also when it ended
  nothing: a record from a server on an older build (no browser recorded), from a lookup that
  failed at its connect, or from macOS (where the lookup has no answer) went while its browser
  kept the seat, and the next preflight could no longer name the holder. Such a record now stays,
  nothing is killed, and the answer says `record kept` and why; a record goes when its browser was
  ended, its pid is dead, or its pid now runs another program. The browser's executable is read
  asynchronously (on Windows a PowerShell start, which held the server's event loop on every
  connect), and an eviction never ends the evicting bridge's own browser when another record
  names its pid. Library: `evictOtherHolders()` returns a promise, and each entry carries `kept`.
- **A receipt holds its own call's writes and no other's** (issue #6's review). A `run-script` run
  that ends, or is abandoned at its timeout, with a call still in flight waits for it (15 s at
  most) with its lock held, so those writes land in its own receipt and never in the next call's,
  and a call its script makes after the run ended is refused; a create made by another session
  joined as the same user no longer lands in this session's receipt, whose undo would delete it;
  two writes from one session wait for each other in the server, so a write's op cap no longer
  counts the time it queued, while writes issued together still share one connect (and fail
  together when it fails, instead of each paying the wake in turn), and a call that arrives during
  a connect joins it instead of failing it; a call that wrote and then lost its page answers with
  its receipt without reconnecting first; and a read that views a scene no longer puts the
  previous scene's fog into an open receipt.
- `set-primary-party` with no arguments sends an empty call, which the page's op table reads as
  the read it is (it sent `clear: false` and counted as a write).
- **Not planned here:** pre-images in a world journal and the dry run as an approval hash (issue
  #13: receipts are kept on the bridge's machine instead); the client-neutral set (issue #5:
  skills as MCP prompts, a neutral default user, a registration for every client; `npm run init`
  writes Claude Code's and prints the generic `mcpServers` block for the rest); the Linux GPU
  check (issue #10) is a row of the suite's Ubuntu issue (Txpple/fvtt-suite-openroll5e#5), and
  `GPU_ARGS` gets a Linux flag in a patch release only if its numbers say so.
- Budgets (`npm test`), 4.3.0 → now: tools/list 203,259 → 204,651 chars (80 → 81 tools:
  run-script; ≤ 205,000; the `undo` leaf is 5 chars shorter than it was, the delete tools 63),
  names ×2 6,078 → 6,143, skill descriptions 7,534 → 7,773 (16 → 17 skills; ≤ 8,000), always-on
  1,578 → 1,778 (≤ 2,100), readonly 56,627 (41 tools; reported, no ceiling). No ceiling was
  raised.
- Release set on the sandbox (Foundry 14.369, dnd5e 6.0.6), 14 / 14 scripts, 536 / 536:
  effects-6 51/51, region-effects 37/37, activities-6 37/37, settings-calendar 52/52, item-tooling
  24/24, actor-tooling 51/51, pc-build 70/70, teleporter-scene-fields 13/13, placeables-tooling
  87/87, scene-tools 23/23, cast-activity 25/25, region-tooling 22/22, receipts 25/25, toolsets
  19/19. Live integration: 7 suites, 78 passed, 8 skipped.

## 4.3.0 — 2026-10-10 — Soundscape is now Area Sounds

- **The companion module is renamed** `fvtt-mod-soundscape` → `fvtt-mod-areasounds` (Open Roll 5e:
  Area Sounds, 2.0.0), since another Foundry module already had the name. The tool follows it:
  **`configure-soundscape` is `configure-area-sounds`**, with no alias for the old name (an alias
  would cost every session a second tool description). The `audio` toolset lists the new name.
- **The skill is `area-sounds-builder`** (was `soundscape-builder`); `playlist-builder` points at it.
- **Sets are read from `flags["fvtt-mod-areasounds"].sets`**, and from the old
  `flags["fvtt-mod-soundscape"].sets` when a scene has no sets under the new scope (a world whose
  GM has not loaded Area Sounds 2.0.0 yet; `list` says so). Writes go only to the new scope, and a
  write to a scene read from the old one unsets the old scope in the same update, so the two never
  fork. File paths are copied unchanged: a `soundscape-sfx/…` path may be the user's own folder;
  the library repo's `remap-areasounds-scene-paths.mjs` repoints the house library's. Writes are a
  plain scene update now, not `setFlag`, which refuses a scope whose module is not active.
- **The template library is `areasounds-sfx/library.json`.** When it is missing the tool reads
  `soundscape-sfx/library.json` once (a box whose library has not been republished), uses its paths
  as they are, and says so in a warning.
- **A world still running the old module** gets a warning that names it, says it gets no more
  updates and does not read sets written under the new scope, and points at Area Sounds; `list`
  shows `only the OLD module (fvtt-mod-soundscape v…)` instead of `module NOT INSTALLED`.
- `scripts/verify-soundscape-tooling.mjs` is `scripts/verify-areasounds-tooling.mjs`; it snapshots
  and restores the old scope too, so an unmigrated scene is handed back unmigrated.
- `verify-areasounds-tooling`'s keep-and-warn probe adds a path no library ships instead of
  looking for a template whose audio the world lacks, so it no longer depends on how much of the
  library a sandbox carries: 32/32.
- Budgets (`npm test`): tools/list 203,262 → 203,259 chars ≈ 56,461 tokens (80 tools), names ×2
  6,076 → 6,078, skill descriptions 7,525 → 7,534 (16 skills), always-on 1,578.
- Release set on the sandbox (Foundry 14.369, dnd5e 6.0.6): effects-6 51/51, region-effects
  37/37, activities-6 37/37, settings-calendar 52/52, item-tooling 24/24, actor-tooling 51/51,
  pc-build 70/70, teleporter-scene-fields 13/13, placeables-tooling 87/87, scene-tools 23/23,
  cast-activity 25/25, region-tooling 22/22. Live integration: 7 suites, 78 passed, 8 skipped.
  Over MCP: a Fighter 2 / Wizard 1 built with zero unresolved `@scale`; a bad subclass uuid
  returned `success:false` with `errors[]` and created nothing. Prod runs Area Sounds 2.0.0 and
  `configure-area-sounds` reads its migrated scene and the 400-template library.

## 4.2.0 — 2026-10-10 — dnd5e's journal block kit; npm run doctor

- **`npm run doctor`** (`scripts/doctor.mjs`) checks a setup in order, one line each (✓, ✗
  with its fix, ! worth a look, - skipped), and exits non-zero on any ✗: Node against
  `engines`, `dist/` built and not older than `src/`, Playwright's Chromium, the `.env` read
  as the server reads it (`FVTT_MCP_ENV`, `FOUNDRY_HOST`, the process environment over the
  file; commented-out keys and legacy names flagged), the Foundry app (local host), Foundry
  answering `/api/status`, the admin key (tested against `/auth` only when no world is running),
  the world (dnd5e 6+), and a login as `FOUNDRY_USER` with its role, then a disconnect. It never
  launches or stops a world (the admin key is withheld from its login) and does not wake a
  sleeping box, so it is safe against prod.
- **No world and no admin key: the error leads with the cause and the fix.** `No world is
  running at <url> and FOUNDRY_ADMIN_KEY is not set, so the bridge cannot launch one`, then the
  host's fix: locally, set the key and run `node scripts/local-foundry.mjs start`, or click
  Launch World on `<url>/setup`. A connect failure that already names its fix (this one, a
  `FOUNDRY_USER` the world lacks, a rejected admin key, a world /setup does not list) no longer
  gets the generic `[connection]` hint appended; `BridgeError.explained` marks it.
- **The server refuses to start without Playwright's Chromium**, naming
  `npx playwright install chromium` (it checks for the headless shell a headless launch runs),
  instead of failing at the first tool call.
- **`connectFoundry` cleans up a refused connect**: it closes the browser and clears its
  watchdog before rethrowing. A missing bridge user used to leave a script (`smoke:bridge`,
  a sibling harness) sitting until the watchdog aborted it with exit 3.
- **`allowScripts`** in `package.json` approves the two dependencies with install scripts, so
  `npm ci` on npm 11 no longer lists them as unreviewed. `classic-level` (through
  `@foundryvtt/foundryvtt-cli`) is the LevelDB binding `read-pack` uses for v11+ compendium
  packs; its `node-gyp-build` step does nothing where a prebuilt binary ships (Windows, macOS,
  Linux x64/arm64) and compiles one elsewhere. `esbuild` (the page bundle's build, a dev
  dependency, also under Vitest's Vite) checks its platform binary in `postinstall`.
- `scripts/local-foundry.mjs` and the doctor share one Foundry app probe
  (`scripts/lib/foundry-app.mjs`).
- Issue #3, the rest: items 7, 9 and 10 and the doctor.

- **Typed-block journals use dnd5e's own block kit** (`create-quest-journal`,
  `update-quest-journal`, `link-quest-to-npc`). The `<section class="mcp-journal"><div
  class="wrap">` wrapper and its inline stylesheet are gone, and so are the classes nothing in a
  world styled (`lead`, `readaloud`, `grid-2`, `spaced`): pages written through these tools
  rendered as plain text. Now `readaloud` is `<div class="fvtt narrative">`, `lead` is a plain
  `<p>` (scene-setting text is a `readaloud`), `heading` is a bare `<h2>` / `<h3>`, and `grid`
  draws each headed list as an `<aside class="notable">` (dnd5e has no column layout and a page
  cannot carry a stylesheet). The markup is the dnd5e wiki's System-HTML page; the system's
  stylesheet draws it in its journal sheet. Issue #1.
- **New blocks:** `notable` (`<aside class="notable">`, optional `title`), `advice` and `quest`
  (`<div class="fvtt advice|quest">`, optional `title` and round icon `img`; without one the card
  keeps an empty inset where the icon would sit), and `quote` (`<aside class="quote-lg
  float-right">`, optional `author` as `<p class="quote-author">`). Bare text in a box block is
  wrapped in one `<p>`, since dnd5e draws a box's lower corners on its last child.
- **Appending to a page written before this release** puts the new section after the old
  `mcp-journal` section, never inside it; the old part keeps its (unstyled) markup.
- **`manage-journals` create makes dnd5e's page types:** `kind` `rule`, `map` (Map Location),
  `spells`, `class` or `subclass`, with that type's `system` data (e.g. `{code:"A1"}` for a map
  location); `system` on a text or image page is refused.
- **journal-builder skill:** the block table with what each renders as, dnd5e's enricher syntax
  (`[[/check …]]`, `[[/save …]]`, `[[/damage …]]`, `[[/heal …]]`, `[[/attack …]]`,
  `&Reference[…]`, `[[language …]]`), which the tools store as written, and the page types.
- **bestiary-builder:** a Bestiary page has no `mcp-journal` wrapper and no `lead` class (the
  epithet is a plain italic paragraph); the Monster Manual's pull quotes, in all their book
  variants (`quote`, `quote-left size-two`, …), become dnd5e's `<aside class="quote-lg
  float-right|float-left">` instead of a bare blockquote or aside. Sandbox dry runs: Aboleth
  (right) and Basilisk (left).
- Budgets: tools/list 200,756 → 203,262 chars (four blocks, carried by both block tools, and the
  page `system` leaf). Sandbox: `verify-journal-tooling` 48/48 (was 35), now holding every block
  class against the computed style dnd5e's stylesheet gives it, the enrichers enriched, a map and
  a rule page with their system data, and an append after the old wrapper.

## 4.1.0 — 2026-10-10 — GM notes are Foundry secrets; a missing bridge user fails at once

- **A `gmnote` block is a real Foundry secret** (`create-quest-journal`, `update-quest-journal`,
  and the note `link-quest-to-npc` appends). It renders as core Foundry's
  `<section class="secret" id="secret-<randomID>">`, the markup the editor's own Secret button
  writes: players who can observe the page never see it, even when the page is shared, and the
  GM's sheet shows it with a Reveal button. Before, it was a grey `<div class="gmnote">` that
  showed its text to anyone who could open the page. Each secret gets its own 16-character id;
  an update appends to the page as before, so secrets already on it keep theirs. Every other
  block and the `.mcp-journal` wrapper are unchanged. Issue #1 (the GM-note part).
- Budgets: tools/list 200,702 → 200,756 chars (the `gmnote` leaf). Sandbox:
  `verify-journal-tooling` 35/35, including the secret persisting with its id and
  `enrichHTML` dropping it for a non-owner.
- **A bridge user the world does not have is refused at once**, naming the world and its users:
  `user 'X' not found in world 'Y'; users: A, B, C — set FOUNDRY_USER to an existing
  Gamemaster/Assistant GM user or create 'X' in the world`. It reaches the tool call that asked
  (a `connection` error) in about two seconds; the next call checks again. The list and the
  world title are read off the /join form, held against the saved page of each Foundry build.
  (The 14.367 free-text field lists nobody; there a wrong name is still the server's answer.)
- **`.env` slips are named at startup** (server log, and stderr for scripts): a
  `# FOUNDRY_*=<value>` line with no active definition of that key (the value is never printed),
  and a license-key-shaped `FOUNDRY_ADMIN_KEY`.
- **`.env.example` opens with a minimal local and a minimal Molten block**, says that
  `FOUNDRY_ADMIN_KEY` is the Setup screen's Administrator Password and not the license key, and
  that `FOUNDRY_URL` stays unset for a local install.
- **Registration docs:** `.mcp.json.example`, the README and `docs/local-sandbox.md` give the full
  `node.exe` path and the `~/.claude.json` `mcpServers` route (a desktop-app install may not have
  `claude` on PATH); the sandbox registration is `foundry-local5e`, as across the family.
- **`scripts/local-foundry.mjs`** finds a per-user Windows install
  (`%LOCALAPPDATA%\Programs\Foundry Virtual Tabletop\`) as well as Program Files, and `start`
  exits non-zero unless it leaves a world active (or `--no-world`).
- Issue #3, the fail-fast part; the `doctor` script it suggests is not done.

## 4.0.2 — 2026-10-10 — the bridge draws on the GPU

- **The headless bridge renders Foundry's canvas on the GPU.** Chromium is launched with
  `--enable-gpu --ignore-gpu-blocklist` (and `--use-angle=d3d11` on Windows) instead of
  falling back to SwiftShader. `screenshot-scene` is about 2.8× faster and its PNGs no longer
  carry Foundry's "hardware acceleration not enabled" banner. Data-only tools are unchanged.
  No setting and no `.env` change: when the GPU process fails, Chromium falls back to software
  rendering by itself. Closes #2.
- Measured on the local sandbox (Foundry 14.369, dnd5e 6.0.6, Chromium 149, Windows, NVIDIA),
  over real MCP stdio, two runs each, five screenshots per run:

  | | WebGL renderer | Connect | Screenshot median | Foundry FPS |
  | --- | --- | --- | --- | --- |
  | 4.0.1 | SwiftShader | 6.2 s | 2.55 s | 4 |
  | 4.0.2 | D3D11 on the GPU | 5.2 s | 0.89 s | 48 |

- Offline gate green, budgets unmoved (tools/list 200,702 chars). Sandbox: `prove-bridge` OK,
  `verify-scene-tools` 23/23, `verify-scene-view-tooling` 4/4.

## 4.0.1 — 2026-10-09 — Foundry 14.369 compatibility

- **The bridge joins a 14.369 world again.** 14.369 renders the /join user list as
  `<select name="userId">` (14.368 and earlier: `userid`); the bridge matched only the old
  spelling, never saw the form, and spent its ten-minute boot budget "waiting" on a world that
  was already live. The user field is now matched case-insensitively, in the bridge and in
  `scripts/register-module.mjs` / `scripts/uninstall-modules.mjs`. No `.env` change.
- Verified on the local sandbox: Foundry 14.369, dnd5e 6.0.6. Older 14.x builds still join.

## 4.0.0 — 2026-09-23 — session summaries and analytics move to fvtt-app-sessionscribe

**Breaking:** one tool and one skill leave this MCP, by the owner's ruling of 2026-09-23. It
reverses 3.0 decisions #16 and #17 for them; see design.md §4.

- **`get-combat-stats` is removed** (81 → 80 tools). Its successor is `analyze-combat` in the
  sibling `fvtt-app-sessionscribe`, which reads Battle Flow's stat stamps from its own Foundry
  user. The `combat` toolset is now just `configure-combat-tracker`.
- **The `session-scribe` skill is removed**, along with its Python (`session_scribe.py`), setup
  script and templates. It now lives in `fvtt-app-sessionscribe`, rewritten to that repo's tools.
  The session diary is still written through `manage-journals`.
- **`export-chat-log` stays** as the general chat exporter.
- **The campaign-repo contract** (`.claude/skills/_shared/campaign-repo.md`) documents
  `sessions.speakers` (Discord id → transcript label) and the record's `transcript-public.md`
  (the spoiler-free transcript).
- **The docs follow:**
  - README: 80 tools; `chat,combat` is 11; two companion-module tools, not three.
  - `docs/contracts.md`: the stat-stamp row's reader is now the sibling. `get-combat-stats`
    never warned when Battle Flow was absent, so it is gone from the list of tools that do.
  - `docs/hosts.md`, `journal-builder`.

**Parity before removal** (fvtt-app-sessionscribe 3e2b493), on the sandbox (Foundry 14.368,
dnd5e 6.0.5, Battle Flow 2.0.5):
- `analyze-combat` vs `get-combat-stats`: 10/10 windows deep-equal, report text identical.
- `export-session-chat` vs `export-chat-log`: 10/10.
- `snapshot-party` vs `manage-actors export`: 4/4 PCs byte-identical.

**Verified** (2026-09-23):
- offline: biome · `tsc --noEmit` · vitest **96 files, 1,774 tests** (3 skipped; the four
  combat-stats test files' 30 went with them) · build (page bundle 524.0 kB, from 530.5) · knip;
- `node scripts/measure/skills-matrix.mjs`: 0 unresolved, 0 stale;
- `verify-toolsets` **10 / 10** (80 tools; `chat,combat` 11);
- the live integration suite on the sandbox: **7 suites ran, 80 passed / 6 skipped** (the same
  six) in 279 s;
- The release set was not re-run: no page write path changed since 3.0.1, which ran 12/12 on
  the same sandbox mirror that afternoon.

**Budgets** (`npm test`), 3.0.1 → 4.0.0:
- tools/list 201,726 → **200,702** chars (−1,024);
- names ×2 6,153 → **6,076**;
- skill descriptions 7,986 → **7,526** (17 → 16 skills);
- always-on 1,578 (unchanged).
- The ceilings stay where they are.

## 3.0.1 — 2026-09-23 — dnd5e 6.0.5, exhaustion on immune creatures, a narrator speaker

A maintenance release: one compatibility event (dnd5e 6.0.3 → 6.0.5) and two bug fixes.

- **`send-chat-message` never speaks as a selected token.** With no `speakerActor` the speaker
  was left to `ChatMessage.getSpeaker()`, which infers one from whatever token the bridge's
  headless page has controlled — the Session 8 hoard announcement (2026-09-22) posted under
  Gren's name. It now speaks as the bridge user, or as the new `speakerAlias` ("Narrator", "The
  Innkeeper"); with `speakerActor`, `speakerAlias` renames that character's line.
- **dnd5e 6.0.5 is the verified system** (Foundry 14.368). Update past 6.0.3: dnd5e 6.0.0–6.0.3
  delete every actor effect without an expiry on a short or long rest — `apply-condition`'s
  conditions and exhaustion, and `manage-effect` effects created without a duration. Skip 6.0.4:
  rolling an activity's check or save from its chat card can throw there.
- **`apply-condition` keeps exhaustion in step on an exhaustion-immune creature.** From dnd5e
  6.0.4 a level change on the suppressed effect left the actor's stored
  `attributes.exhaustion` at the old level; it now follows the effect (and still never adds a
  second level on 6.0.0–6.0.3).

**Verified** (2026-09-23, the local sandbox mirrored from prod that day: Foundry 14.368, dnd5e
6.0.5, one world-driver at a time — the gate is [`docs/RELEASE.md`](docs/RELEASE.md)):

- offline: biome · `tsc --noEmit` · vitest **98 files, 1,804 tests** (3 skipped) · build (page
  bundle 530.5 kB) · knip — green on `main`;
- the cold bring-up (`verify-wake`): the bridge relaunched the world and joined in 13 s;
- the release set, **12 / 12 scripts, 493 / 493** assertions (3.0.0: 490 — the three new
  immune-exhaustion checks), a `ZZ-*` sweep afterwards finding nothing: effects-6 51 ·
  region-effects 37 · activities-6 37 · settings-calendar 52 · item-tooling 24 · actor-tooling 51 ·
  pc-build 70 · teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 ·
  cast-activity 25 · region-tooling 22;
- the live integration suite, **7 suites ran, 80 passed / 6 skipped** (the same six) in 215 s;
- the MCP smoke after a restart: `get-world-info`; a Fighter 3 / Rogue 1 in one `create-pc` call
  (`success`, HP 35, 39 advancements, **0 unresolved `@scale`**); a bad subclass uuid answers
  `success:false` + `errors[1]` with **no actor persisted**; `apply-condition` exhaustion 3 → 5 on a
  Monster Manual Zombie (immune): stored 5, derived 5, the effect at 5 and suppressed;
- prod, read-only over its own registration: `get-world-info` reports Foundry 14.368 / dnd5e
  6.0.5 and the premium books; `search-compendium` answers;
- the numbers: `tools/list` **201,726** chars ≈ 56,035 tokens for 81 tools (leaf prose 77,106 ·
  descriptions 24,993 · structural 81,985; longest leaf 120; 0 over budget) — +164 over 3.0.0, the
  `speakerAlias` leaf; names ×2 **6,153** (3,117 + 3,036); skill descriptions **7,986** (17
  skills); always-on `session` **1,578**; the seam 156 handlers, 0 `any`; the 24-call live
  baseline **87,895** chars ≈ 24,415 tokens, 1 capped (the walls list), 0 errors — the growth is
  the world's, not the code's: the sandbox is today's prod, and 3.0.0's 73,492 was measured on
  the 2026-09-21 mirror.

## 3.0.0 — 2026-09-21 — the dnd5e MCP: cheaper in context, official 6.x, hosts as endpoints

Tracked in [`docs/history/plan-3.0-consolidation.md`](docs/history/plan-3.0-consolidation.md);
measured in [`docs/history/architecture-review-2026-09.md`](docs/history/architecture-review-2026-09.md).
The last feature line — after it the project is in maintenance (compatibility events, bug fixes,
premium books).

- **Context.** `tools/list` 283,948 → 201,562 chars; the two-registration name list 11,147 →
  6,153 chars (151 tools → 81); skill descriptions 15,382 → 7,986 chars; the 24-call result
  baseline 154,534 → 73,492 chars with 0 capped and 0 errors. Every tool's prose is contract-only
  (a leaf ≤ 120 chars, a description ≤ 400) and `npm test` ratchets the budgets.
- **The families.** The 17 `list/create/update/delete-X` families are one tool each, selected by
  `action` (and `kind` for `manage-placeables`): `manage-actors` (with `get-entity` / `export`),
  `manage-scenes`, `manage-placeables`, `manage-items`, `manage-journals`, `manage-rolltables`,
  `manage-cards`, `manage-playlists`, `manage-folders`, `manage-macros`; `search-compendium` takes a
  `type`. Every skill re-pointed in the same commit as its family.
- **Results.** One line per record with a header on every list; JSON with a `fields` selector on
  every `get`; a miss is `isError`; the raw Foundry message on every mapped error; a record-level
  cap with a `truncation` stamp; the placeable tools default to the active scene; one search-hit
  shape with a true `totalFound`; unknown arguments refused by name. `search-compendium`'s first
  call 7.8–13.2 s → 175 ms (the index warms at connect).
- **Official dnd5e 6.x.** Pinned to 6.0.3 on Foundry 14.368; the tools refuse a pre-6.0 world.
- **Config.** One variable set on every host, `FOUNDRY_*` (`_URL / _USER / _PASSWORD / _ADMIN_KEY /
  _WORLD_ID / _HOST / _WAKE_URL / _TOOLSETS`, plus `_DATA_DIR` / `_WEBDAV_*` for a direct file
  plane); the default host is `generic`; the 2.x `MOLTEN_*` / `LOCAL_*` names are aliases logged
  once; a placeholder URL is refused at startup; the world id is discovered on `/setup`. The asset
  file tools work on every host through Foundry's own FilePicker (a direct plane is the fast path
  and the only way delete / move work). `get-world-info` reports the host, the bridge user's role
  and which premium books are present.
- **The library.** `fvtt-mcp-dnd5e/client` (`connectFoundry`, `Foundry`, the host seam,
  `loadEnv`) is the declared surface the sister repos import; the scripts are classified (the
  sandbox toolkit stays, module harnesses moved to their repos, spikes archived).
- **Errors.** A coded `PageError` → `BridgeError` contract (`not-found` / `ambiguous` / `invalid`
  / `permission` / `unsupported` / `rolled-back` / `connection`) with one hint per code; the seam
  typed end to end (`foundry.call<N>`).
- **Skills.** Every skill on the trigger-phrase description rule; the campaign-facing skills read a
  campaign repo (`_shared/campaign-repo.md`: `campaign.json` + `STYLE.md`) instead of carrying one
  DM's names and rulings; `start-session` is host-neutral; `tom-cartos-import` imports a pack
  faithfully by default (maps-only and the born-explored stamp are options).
- **Docs.** README rewritten as a plain-English project page; `CONTRIBUTING.md` (the house rules,
  tracked); `docs/hosts.md`, `docs/contracts.md`; the done trackers under `docs/history/`.
- **Upgrading a world to this line.** Foundry to ≥ 14.367 **first** (dnd5e 6.x declares that
  minimum; 14.368 verified), then dnd5e to 6.x (6.0.3 verified) with its migration run to
  completion before the bridge joins; the order, the back-out and the mirrored-sandbox rehearsal
  are in [`docs/hosts.md`](docs/hosts.md#bringing-a-world-up-to-the-30-line). 1.5.2 remains the
  last release for dnd5e 5.3.x.

**Verified** (2026-09-21, the local sandbox: Foundry 14.368, dnd5e 6.0.3, one world-driver at a
time — the gate is [`docs/RELEASE.md`](docs/RELEASE.md)):

- offline: biome · `tsc --noEmit` · vitest **98 files, 1,799 tests** (3 skipped) · build (page
  bundle 530.1 kB) · knip — green on `main`;
- the release set, **12 / 12 scripts, 490 / 490** assertions, every one cleaning its `ZZ-*`
  documents and restoring `worldTime`: effects-6 51 · region-effects 37 · activities-6 37 ·
  settings-calendar 52 · item-tooling 24 · actor-tooling 48 · pc-build 70 ·
  teleporter-scene-fields 13 · placeables-tooling 87 · scene-tools 24 · cast-activity 25 ·
  region-tooling 22;
- the live integration suite, **7 suites ran, 80 passed / 6 skipped** (the same six conditional
  skips as every milestone since M4) in 154 s;
- the MCP smoke on the sandbox registration: `get-world-info` reports host / bridge role /
  library; a Fighter 3 / Rogue 1 built in one `create-pc` call (`success`, HP 35, 40
  advancements, **0 unresolved `@scale`**); a bad subclass uuid answers `success:false` +
  `errors[1]` with **no actor persisted**;
- the numbers (`npm test`, `npm run measure`, the live `tool-results`): `tools/list` **201,562**
  chars ≈ 55,989 tokens for 81 tools (leaf prose 76,976 · descriptions 24,993 · structural
  81,951; longest leaf 120; 0 over budget); names ×2 **6,153** ≈ 1,709 tokens (3,117 + 3,036 per
  registration); skill descriptions **7,986** (17 skills); always-on `session` **1,578**; the
  24-call live baseline **73,492** chars ≈ 20,414 tokens, 0 truncated, 0 errors;
  `search-compendium` 20 s after connect **353 ms**; the seam 156 handlers, 0 `any` / 0
  `unknown`; skills-matrix 0 unresolved / 0 stale.

## 2.2.0 — 2026-09-20 — a Foundry MCP first, hosts as options

No tool behaviour changed; what changed is what the project is. Renamed `fvtt-mcp-molten5e` →
`fvtt-mcp-dnd5e`: the host left the name and became a seam (`src/hosts/**`, design.md §2.6).

- `FOUNDRY_HOST` = `generic` (any Foundry at a URL) · `molten` (Molten Hosting: the WebDAV plane
  derived from the URL) · `local` (an install on this machine — no wake, the `Data/` directory as
  the file plane). One `.env`, one registration per instance; `FOUNDRY_PROFILE=local` kept as an
  alias. `get-world-info` reports the host.
- `FOUNDRY_TOOLSETS` — a registration advertises a subset of the surface (14 named toolsets,
  `session` always on); an out-of-set call is refused by name.

## 2.1.4 — 2026-09-19 — Foundry 14.368 compatibility

- Every POST to Foundry now carries the same-origin `Origin` header 14.368 requires (the launcher
  and the wake path had started getting 400).
- Teleport Token destinations are stored as relative uuids since 14.368; the teleporter read-back
  and `remap-teleporters` follow.
- `darknessLock` on the scene document.

## 2.1.3 — 2026-09-15 — the 2.1 review fixes

Second-call, edit and combination bugs from the 2.1 review; a dnd5e 6.0 version guard (the tools
refuse to author against a 5.x world); `appliesEffects` on activity read-back.

## 2.1.2 — 2026-09-15

2.1.1 plus a clean listing of a duration-less expiry.

## 2.1.1 — 2026-09-15 — the rest of the dnd5e 6.0 surface

- `manage-activity` — `type: "teleport"` and `type: "transform"` in all three 6.0 modes (by CR
  with profiles, direct link, Select Form), plus `transformSettings`.
- `add-region-behavior` — `dnd5e.rotateArea` with a typed `rotate`.
- `configure-dnd5e-settings` *(new)* — read or set the 6.0 automation switches through an
  allow-list; every change echoes previous → new.
- `manage-calendar` *(new)* — the in-world date and time on `game.time` with the dnd5e calendar:
  read, advance (what triggers dawn / dusk / day recovery and bastion turns), or set.
- The PC leveling engine applies 6.0's ModifyItem advancement as a forced step.

## 2.1.0 — 2026-09-15 — tools for what dnd5e 6.0 introduced

2.0 made the existing tools speak 6.x; 2.1 adds tools for the features 6.0 introduced, so an
authored monster trait, magic item or map area can express what a 2024 book entry can
(`docs/history/plan-2.1-dnd5e-6-features.md`).

- `manage-effect` — conditions (the system's Filter JSON, on the effect or on one change),
  rules-type changes applied at roll time (`dnd5e.advantage` / `bonus` / `minimum` / `maximum`
  on attack / check / d20 / save; bonus on damage / healing), per-change `replacement`, `magical`,
  the full expiry vocabulary. Read-back shows every rule as a sentence; `content-audit` flags a
  dead rules change.
- `manage-activity` — a `duration` override, an area `template` + `affects`, and `behaviors` the
  template carries (`applyActiveEffect`, `difficultTerrain`).
- `add-region-behavior` — `dnd5e.applyActiveEffect` / `dnd5e.difficultTerrain` with effects
  resolved by name, `dispositions`, `sizes`, `creatureTypes`, `terrainTypes`, `magical`.
- `add-item` / `update-actor-item` — `rarity` accepts a list, written natively to
  `system.rarities`.

## 2.0.0 — 2026-09-15 — the dnd5e 6.x line

Targets the D&D 5e system 6.x on Foundry VTT 14 (`docs/history/dnd5e-6.0-compat-review.md`). The
persisted data model moved with 6.0, so 2.0 reads and writes the 6.0 shapes:

- `update-actor` → `ac` speaks the 6.0 model (`override`, `natural`, `calcs`, `formulas`; the 5.x
  `calc` / `flat` / `formula` translated, deprecated).
- `manage-effect` writes `system.changes` and takes a v14 `duration` (`{ value, units, expiry }`).
- `apply-condition` sets exhaustion levels 1–6 through the system's own lever.
- `get-combat-stats`, `list-chat-messages`, `export-chat-log` read 6.0's typed chat messages.
- `post-item-card` reports honestly when a module hook vetoes a use.

## 1.5.2 — 2026-09-15

The last release for dnd5e 5.3.x on Foundry 14.
