# The campaign repo — one convention for the skills that read or write a campaign

Four skills work against a **campaign**, not just a world: `session-scribe` (writes the session
record), `session-audit` and `plot-drift-check` (read the plot and the record), `bestiary-builder`
(reads the record for what the party fought). None of them carries campaign facts — names, the
party, house style, where the files go. Those live in a **campaign repo**: a private git repo (or
plain folder) per campaign, beside the world, that the DM owns. This file is the contract between
the skills and that repo.

## Finding it

The user names the path once ("the campaign repo is `../my-campaign`"); remember it (a Claude Code
memory or a line in the project's `CLAUDE.md`), and ask only when no path is known. Never guess a
sibling directory, and never treat the MCP repo itself as a campaign repo. When the repo is shared
across machines, **pull before reading and push after writing** — the skills append to it.

## Layout (what the skills read and write)

```
<campaign-repo>/
  campaign.json          the facts the skills need — see below (session-scribe, bestiary-builder,
                         session-audit)
  STYLE.md               the house style session-scribe applies (optional — its defaults otherwise)
  plot/<doc>.md          THE plot document, canon (plot-drift-check, session-audit); the newest file
                         when there are several
  plans/                 run-of-show for an upcoming session, one file each (session-audit)
  sessions/YYYY-MM-DD/   the session record: transcript, recap, GM notes … (session-scribe writes;
                         session-audit and bestiary-builder read the recaps)
  party-snapshots/       the per-session PC sheet snapshots (session-scribe writes, session-audit reads)
  world-state.md         a hand-kept manifest of what exists in the world (optional)
```

Only `campaign.json` is required by name; a skill that needs a file that is absent says so and
asks, it does not invent one.

## `campaign.json`

```json
{
  "name": "The Lost Mine of Phandelver",
  "worldId": "lost-mine",
  "party": ["Aldric Stone", "Brenna Quickfoot", "Corvin Ashe", "Dara of the Vale"],
  "excludedActors": ["Test PC"],
  "journals": {
    "sessionDiary": { "name": "Session Diary", "folder": "Adventure Log" },
    "bestiary": { "name": "Bestiary", "folder": "Adventure Log" }
  },
  "sessions": {
    "dir": "sessions",
    "outputs": ["recap", "combat-log", "gm-notes-story", "gm-notes-mechanics"],
    "pdf": true,
    "skewSeconds": 0
  },
  "snapshots": { "dir": "party-snapshots" }
}
```

| Key | Read by | Meaning |
| --- | --- | --- |
| `name` | session-scribe | the campaign title on every artifact |
| `worldId` | all | the Foundry world these files describe — refuse to write when `get-world-info` reports another |
| `party` | session-scribe, session-audit | the PCs by actor name — the snapshot roster and the audit's sheet reads; **nothing else is a PC** |
| `excludedActors` | session-scribe, session-audit | actors of type `character` that are NOT party members (a DM's test PC) — never snapshot or audit them |
| `journals.sessionDiary` | session-scribe | the one journal that gets a page per session (`name`, `folder`) |
| `journals.bestiary` | bestiary-builder | the one journal that gets a page per creature (`--journal` / `--folder`) |
| `sessions.dir`, `snapshots.dir` | session-scribe, session-audit, bestiary-builder | where the record lives, relative to the repo |
| `sessions.outputs` | session-scribe | which documents a session produces (any of `recap`, `combat-log`, `gm-notes`, `gm-notes-story`, `gm-notes-mechanics`) |
| `sessions.pdf` | session-scribe | also render each HTML output to PDF |
| `sessions.skewSeconds` | session-scribe | the measured Craig ↔ Foundry clock skew (`--skew-seconds`), 0 until measured |

## `STYLE.md`

Free prose, read in full by session-scribe before it writes a word: the voice of the player recap,
what the combat report must open with, how the session-diary page is formatted, the endmatter, the
things a past draft got sent back for. It is the DM's taste, so it is the DM's file; the skill's own
defaults apply to whatever it does not cover. A rule that is really a *fact* (a journal name, the
roster) belongs in `campaign.json`, not here.

## What never goes in the MCP repo

Campaign names, PC and player names, plot, house-style rulings with dates, machine names, the
paths on one DM's desk. A skill that needs one of these reads it from the campaign repo; a skill
that wants to *record* one writes it there.
