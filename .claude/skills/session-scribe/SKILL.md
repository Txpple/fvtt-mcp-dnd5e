---
name: session-scribe
description: >-
  Turn a Craig (Discord) session recording into a speaker-labeled transcript aligned with the
  Foundry chat log, then write the session artifacts (player recap, combat stats, GM notes) into the
  campaign repo. Use when the user pastes a Craig download link (craig.chat/rec/... or craig.horse),
  or wants to "process the session", "process last night's recording", "transcribe the session",
  "write the session recap", "make the session log", or "run session scribe".
---

# Session scribe

Craig records the table (one audio track per speaker); Foundry's chat log records the mechanics
(every roll, whisper, and card, each with an epoch-ms timestamp). Craig's recording metadata
carries its own `startTime` — so the two timelines align by pure wall-clock arithmetic. No sync
ritual, no markers, no Discord integration. The user pastes one link; everything else is yours.

**The user's contract:** `/join` Craig at session start → play → `/stop` → paste Claude the link.
That is ALL. Do not ask them to mark, note, export, or download anything. If they said "mark that"
aloud during play, it is IN the transcript — grep for it.

## The campaign repo (read this first)

Every campaign fact this skill needs comes from the campaign repo
([`_shared/campaign-repo.md`](../_shared/campaign-repo.md)) — locate it, **pull it**, and read:

- `campaign.json` — `name`, `worldId` (refuse to write when `get-world-info` reports another
  world), `party` (the snapshot roster — nothing else is a PC; `excludedActors` never), `journals.sessionDiary`, `sessions.dir` / `outputs` / `pdf` / `skewSeconds`, `snapshots.dir`.
- `STYLE.md` — the house style, in full, before writing a word. What it does not cover falls to
  the defaults under "Judgment notes" below.

A campaign with no `campaign.json` gets one before the first run (ask for the roster and the
journal name; the defaults are in the convention file).

## Machine prerequisites (once per machine) — Windows

The bundled toolchain is **Windows-only** as shipped: `scripts/setup.ps1` (idempotent — installs
ffmpeg + uv via winget, builds the `~\.session-scribe\venv` with faster-whisper + CUDA wheels,
smoke-tests the GPU stack), and the PDF step renders with a headless browser found at a Windows
path. The Python script itself (`scripts/session_scribe.py`) is portable — on another OS build the
venv by hand (ffmpeg, Python ≥ 3.12, `faster-whisper`) and render PDFs with any headless browser.

```powershell
powershell -ExecutionPolicy Bypass -File .claude\skills\session-scribe\scripts\setup.ps1 -PrefetchModel
```

`SMOKE TEST OK` = CUDA works. `OK (CPU ONLY)` = transcription still works, just slower — on a new
GPU generation this usually means ctranslate2 needs a version bump for the new compute capability
(`uv pip install --python ~\.session-scribe\venv\Scripts\python.exe -U ctranslate2`), then re-run
the smoke test.

**Known failure — Windows Application Control blocks the uv-managed Python:** `ImportError: DLL
load failed while importing _ctypes: An Application Control policy has blocked this file.` The
uv / python-build-standalone interpreter's DLLs trip the policy; a venv on a SIGNED python.org
install passes. Fix: `winget install Python.Python.3.13` → delete `~\.session-scribe\venv` →
re-run setup.ps1 (it prefers the newest signed 3.12+ install when one exists, and its ctypes probe
fails fast with these instructions BEFORE the ~1.3 GB wheel download). faster-whisper + CUDA wheels
work fine on 3.13. Never work around this by touching the App Control policy itself. If a broken
venv was renamed aside as `~\.session-scribe\venv-blocked-*` (~1.3 GB each), delete those backups
once the rebuilt venv passes the smoke test — setup.ps1 lists any it finds.

## The pipeline (per session)

Let `PY = %USERPROFILE%\.session-scribe\venv\Scripts\python.exe`,
`SCRIBE = .claude\skills\session-scribe\scripts\session_scribe.py`, and
`SDIR = <campaign-repo>\<sessions.dir>\YYYY-MM-DD` (the session's real date).

1. **Fetch** — `& $PY $SCRIBE fetch "<craig-link>" --session-dir $SDIR`
   Downloads the multitrack FLAC zip via Craig's API (cook → poll → `/dl/`), extracts to
   `audio/tracks/`, writes sanitized `craig-info.json` (startTime, duration, per-track speaker
   names, any Craig `/note` markers — the download key is never persisted). Craig links expire
   after 7 days — if fetch 404/410s, tell the user immediately.
2. **Transcribe** — `& $PY $SCRIBE transcribe --session-dir $SDIR`
   Per-track faster-whisper (default `large-v3-turbo`, VAD on). Long: minutes on a big GPU,
   ~real-time÷8 on CPU — run it detached (a shell background task's timeout can kill a long run,
   and the script writes its output at the END) and keep working.
3. **Export the chat log** — call the `export-chat-log` MCP tool:
   `format: "json"`, `localPath: <SDIR>\chatlog.json`, and `sinceTimestamp` = Craig's
   `startTime` (from craig-info.json) minus ~10 min, to keep the export lean.
4. **Align** — `& $PY $SCRIBE align --session-dir $SDIR [--skew-seconds <sessions.skewSeconds>]`
   Interleaves speech paragraphs with 🎲 rolls / 💬 chat / 🤫 whispers into `transcript.md`,
   sliced to the recording window. **First run on a new Craig + Foundry pairing:** verify skew —
   find a moment where the DM says a roll aloud ("make a dex save") and compare its speech
   timestamp to the roll's; if they differ by more than ~5 s, re-run with `--skew-seconds` and
   record the value in `campaign.json`.
5. **Write the artifacts** (your judgment — read transcript.md fully first). The set is
   `sessions.outputs`; each is a `.md` and, where a template exists, an `.html` (+ `.pdf` when
   `sessions.pdf`):
   - `recap.md` — the canonical session record: what happened, in order, with names. GM voice,
     complete, spoiler-tolerant; exact numbers welcome.
   - `recap.html` — from `templates/recap.html`, filling every placeholder. **Player-safe by
     construction**: written ONLY from what the players saw at the table; nothing that appears
     solely in the GM notes or GM whispers may appear here. The user pastes this into an email —
     it must render in Gmail / Outlook (keep the inline-style table structure intact).
   - `combat-stats.md` + `combat-log.html` — the combat report, from the `get-combat-stats` MCP
     tool (a world running the companion battleflow module; otherwise say so and skip it);
     template `templates/combat-log.html`. GM-facing: exact numerals wanted.
   - `gm-notes.md` + `.html`, or the split pair `gm-notes-story` (plot: what changed in the world,
     what is now canon, promises and their status, open threads, loot with story weight, quotes)
     and `gm-notes-mechanics` (bookkeeping checklist to apply to the live world — levels, items,
     coin, renames; automation that cost time; rulings to keep consistent; table observations).
     Both from `templates/gm-notes.html`.
   - PDFs: render each HTML with a headless browser honouring the templates' print CSS (Edge on
     Windows: `msedge.exe --headless=new --disable-gpu --no-pdf-header-footer
     --print-to-pdf=<out> file:///<html>`); a ~1 KB PDF means the page didn't load.
6. **Snapshot the party** — two artifacts per session date, both committed, for the `party` in
   `campaign.json` and no one else:
   - **Full JSON backup (the durable record):** for EACH PC, `manage-actors` `export` →
     `<campaign-repo>\<snapshots.dir>\YYYY-MM-DD\<PC>.json` (`overwrite: true` when re-running
     the same date). This is the complete native Foundry export — every item's
     `system.uses.value` (wand charges, potion counts), effects, attunement, ownership — and it
     restores via the actor sheet's **Import Data** button. The `.md` digest cannot answer "how
     many charges were left"; the JSON can.
   - **Human digest (the story):** `<snapshots.dir>\YYYY-MM-DD.md` from the LIVE sheets
     (`manage-actors` `get`). Per PC: class / subclass + LEVEL, HP max, AC, the six ability scores,
     feats / ASIs taken, weapon masteries, spell slots, attuned + equipped magic items, and notable
     consumables **with their remaining charges / doses / counts**. One file per session date,
     diffable against the last — this answers "what did <PC> have before?" after level-ups,
     deaths, or loot disputes.
7. **The session-diary page** — when `journals.sessionDiary` is set: append ONE player-visible
   text page to that journal (`manage-journals` `update` with `newPageName` + `playerVisible:
   true`), named `Session N — <title>`, the date in the body; the same player-safe boundary and
   register as recap.html. Never a journal per session.
8. **Commit** — in the campaign repo: `git add <sessions.dir>/<date> <snapshots.dir>` → commit
   (`session: <date> — <short title>`) → push. `audio/` is gitignored (bulky; the transcript is the
   durable artifact); tell the user audio stays local and can be deleted once they're happy with
   the transcript.

## Judgment notes (the defaults — `STYLE.md` overrides)

- **Recap voice:** in-world chronicle, not minutes. Third person about the party, never addressed
  to them ("you" only inside quoted dialogue). Lead with the arc, keep table-talk out, name PCs
  and NPCs. The TL;DR paragraph is one breath; section headings are story beats.
- **Dice as narrative in the player recap.** Weave the checks, crits, failed saves and big hits
  into the prose at full detail, but the words carry the magnitude, not the numbers. **Name the
  mechanics** — the spell, feature, feat or mastery by its game name, italic Title Case when
  invoked — rather than narrating around them.
- **Never surface the DM's narration prompts** ("how would you like to kill him?"): the output of
  that exchange is the fiction; the ask is table process.
- **Register:** narrative, not purple — plain direct sentences, one flourish per paragraph.
  Combat is punchy: short sentences, hard verbs, one beat per sentence. Who killed what is
  factual, not style-flexible.
- **No meta, no player names, no technical-issues talk in the player recap** — UI / audio /
  browser troubles belong in the mechanics notes.
- **Quote found-item text verbatim when it matters** (a plot-loaded item's description), then note
  who read it aloud, before any paraphrase.
- **The combat report opens on the one headline fact, in numbers**, and has a "what the buffs and
  features actually bought" section (damage added / prevented, misses converted, saves flipped —
  the duds named as plainly as the winners). When the party gets wrecked, work the probability
  back off the sheets before calling it a balance problem. Charts: single-series bars, one hue,
  direct-labeled; render the page and look at it before shipping.
- **Monsters the party fought go in the Bestiary** — after the recap, hand off to the
  `bestiary-builder` skill for anything newly killed.
- **Attribution is per-speaker-track and trustworthy** — quote players verbatim when it's good
  ("quotes of the night" in the story notes). Whisper text is GM-only by definition: usable in
  recap.md and the GM notes, NEVER in recap.html.
- **Bookkeeping handoff:** loot awarded and levels gained belong in the mechanics notes as a
  checklist; offer to apply them to the live world (physical-item-builder / level-up-pc) as a
  follow-up.
- **Craig facts:** recordings expire in 7 days; `/recordings` in Discord re-fetches a lost link;
  `craig-info.json.craigNotes` carries any `/note` markers; the API is mapped in the script
  header. If the API shape ever drifts (Craig is open source: CraigChat/craig), the manual
  fallback is: the user downloads the flac zip from the Craig page themselves → unzip into
  `SDIR\audio\tracks\` → hand-write `craig-info.json` from the zip's `info.txt` (map speakers by
  Discord id, not track number; use CHARACTER names — they become the transcript labels) →
  continue from step 2.
