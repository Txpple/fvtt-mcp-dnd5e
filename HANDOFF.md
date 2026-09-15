# HANDOFF — start the 2.x work (written 2026-09-15, owner-requested)

> Read this, then [`design.md`](design.md) (binding scope), then
> [`docs/plan-2.1-dnd5e-6-features.md`](docs/plan-2.1-dnd5e-6-features.md) (the tracker you are
> executing). Retire this file when 2.1.0 ships — the plan's checkboxes are the durable state.

## Where things stand

- **`main` = v2.0.0** (`c8b7ee2`, tagged, GitHub release published, CI green) — the **dnd5e 6.x line**
  (verified on dnd5e 6.0.1 / Foundry 14.367). 1.x is the 5.3.x line; never backport 6.x shapes to it.
- 2.0 made every existing tool speak 6.x natively. The audit and the tool-by-tool verdicts are in
  [`docs/dnd5e-6.0-compat-review.md`](docs/dnd5e-6.0-compat-review.md); read its **Status** table
  and the two "general facts" at the top (core v14 migrates our partial writes through the system's
  shims; read-side shims exist only on prepared data) — they explain why a legacy write can *appear*
  to work while being on borrowed time.
- Offline gate is green (biome · tsc · **1533** tests · build · knip). Live proof on the sandbox:
  16 verify scripts green, live integration 83/86 (3 skipped by design), headline tools proven over
  MCP after a CC restart. Nothing is pending on the 2.0 side.
- **Machines:** DESKTOP-NY runs the 6.x build. **LAPTOP-16 still needs:** `git fetch && git reset
  --hard origin/main` (NOT pull) → `npm install` → wipe `dist/` → `npm run build` → CC restart.
  A new or changed TOOL schema ⇒ CC restart on every box.
- **Battle Flow (`fvtt-mod-battleflow`) is another agent's job.** `get-combat-stats` is 6.0-ready on
  our side; it reads whatever that module stamps. Do not touch that repo.

## The 2.x program — what to build, in order

The plan is the contract; this is the summary. Every row = tool change + pure validator with unit
tests + a section in the owning skill + a verify-script case.

1. **2.1.0 — effects & areas** (~6.5 h): effect conditions (`system.conditions` Filter JSON),
   per-change `conditions` + `replacement`, rules-type changes (`dnd5e.advantage | dnd5e.bonus |
   dnd5e.minimum | dnd5e.maximum` on `attack | check | d20 | save` / `damage | healing` bonus-only),
   expiry events (core `combatStart roundStart turnStart combatEnd roundEnd turnEnd` + dnd5e
   `shortRest longRest` + pseudo `sourceStart sourceEnd targetStart targetEnd`), region behavior
   `dnd5e.applyActiveEffect` (effect resolution by name), activity `behaviors[]`, multi-rarity
   (`rarities`), and `get-actor` reading all of it back.
2. **2.1.1** (~3.5 h): teleport activity builder, `configure-dnd5e-settings` (allow-listed 6.0
   automation switches), ModifyItem advancement in the PC leveling engine.
3. **2.2 / Phase 2**: Transform "Select Form", calendar time tools — only when a skill or the
   session phase needs them.

### Open decisions — ask the owner FIRST; defaults if you must proceed

| # | Decision | Default until answered |
|---|---|---|
| 1 | `dnd5e.effects` (6.0's stock Active Effect pack) as an allowed **mechanical** source for behavior effect uuids — design.md §2.3 bars `dnd5e.*` *content* packs | Build effect resolution so it accepts (a) an effect on a world item authored with `manage-effect`, (b) an effect carried by a premium-pack spell/item, (c) `dnd5e.effects` **behind a flag defaulting to off** — flip the default only with the owner's yes + a one-line design.md amendment |
| 2 | `configure-dnd5e-settings`: read + set (allow-list) vs read-only | Read + set with the allow-list in the plan; GM-only; every set reports old → new |
| 3 | Calendar tools now or Phase 2 | Phase 2 |
| 4 | Transform "Select Form" in 2.1.1 or 2.2 | 2.2 |

## First session — exact steps

1. Cold start: `design.md`, this file, the plan. Do **not** rebuild the compat review — it is done.
2. Sandbox check before any live call (DESKTOP-NY only; LAPTOP-16 has no sandbox):
   ```bash
   node scripts/local-foundry.mjs status
   ```
   Then confirm nobody else is driving it (users connected = 0 or only you). Canary:
   ```bash
   npm run build && FOUNDRY_PROFILE=local node scripts/verify-actor-tooling.mjs
   ```
   29/29 expected. If the bridge hangs after a Foundry core upgrade, `scripts/prove-bridge.mjs` first.
3. Re-extract the **6.0.1 source tree** (the previous extraction lived in a session scratchpad and is
   gone). The system's sourcemap carries all 405 files:
   ```bash
   node -e "const fs=require('fs'),p=require('path');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const out=process.argv[2];m.sources.forEach((s,i)=>{const f=p.join(out,s);fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,m.sourcesContent[i]);});console.log(m.sources.length)" "C:/Users/sippelmc/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e-compiled.mjs.map" ./scratch/dnd5e-6.0.1
   ```
   (`scratch/` is gitignored territory — keep it out of commits.) The wiki pages the plan cites:
   `git clone --depth 1 https://github.com/foundryvtt/dnd5e.wiki.git` → `Filters.md`,
   `Active-Effect-Rules.md`, `Activity-Behaviors.md`, `Activity-Type-Teleport.md`,
   `Activity-Type-Transform.md`, `Calendar.md`.
4. Start with **effects** (plan rows 1–4). File map:
   - `src/page/effect-changes.ts` — the PURE layer (normalizeChange / normalizeDuration /
     normalizePatch live here; add `normalizeConditions`, the rules key×type validator, the expiry
     enum). Unit tests in `effect-changes.test.ts` are the contract — write them first.
   - `src/page/effects.ts` — the live orchestrator (create/edit/list). Writes `system.changes`,
     v14 `duration`; add `system.conditions`, per-change `conditions` / `replacement`.
   - `src/tools/dnd5e/manage-effect.ts` — the schema (zod, hoisted → `toInputSchema`; never
     hand-write JSON schema). Add `conditions`, the rules change types, `duration.expiry` enum.
   - `src/page/actors.ts` `extractDerived` / effects projection — the read-back.
   - Skill sections: `.claude/skills/stat-block-builder/SKILL.md`,
     `.claude/skills/physical-item-builder/SKILL.md` — the wiki's worked examples are the recipes.
   - New `scripts/verify-effects-6.mjs`: round-trip every shape, then **prove a rule fires** — a
     `dnd5e.bonus` `+1d4` on `attack` shows up as a term in a real `rollAttack`, and a
     `dnd5e.advantage` `+1` flips the mode. The script must clean up (`ZZ-*` tags, `finally`).
5. Then areas (rows 5–6): `src/tools/placeables/region.ts` + `src/page/placeables/region.ts`
   (`add-region-behavior` already passes any registered type through — verify
   `dnd5e.applyActiveEffect` live before adding anything), `src/page/dnd5e/activities.ts` +
   `src/page/dnd5e/manage-activity.ts` for `behaviors[]`.
6. One commit per feature (conventional prefix, `Co-Authored-By` line), gate green each time, push,
   glance at `gh run list`. Tag `v2.1.0` only after the live proof; CC restart both boxes after.

## Gotchas that cost time (all verified against the 6.0.1 source)

- Filter JSON is persisted as a **string** (`FiltersField extends JSONField`, initial `"{}"`) —
  `JSON.stringify` on write, `JSON.parse` on read; validate operators before writing.
- Rules changes have `skipConditions: true` — their `conditions` run at **roll time**
  (`ActiveEffect5e._applyChangeRule`); `roll.*` keys are valid only there, never on the effect.
- A rules change's `key` is a *category* (`attack`, `d20`, …), not a data path. A core-type `add`
  on `key: "attack"` is a pruned write to nowhere — the validator must reject that combination.
- `system.changes[].value` is stored as a string; `normalizeChange` already stringifies.
- Region `applyActiveEffect.effects` = uuids of **compendium/world** effects; the behavior creates
  fresh copies on entry and deletes them on exit. Never point it at an effect on the entering actor.
- `activity.behaviors[].config` is a `TypeDataField5e` keyed by the sibling `type` — write both in
  the same update or the clean step drops the config.
- `teleport.value` / Cast `challenge.*` are deterministic FormulaFields — **strings** (`"30"`).
- Core v14 prunes `persisted: false` keys silently and runs the system's `migrateData` on partial
  updates — a write can "succeed" and change nothing. Read back through `_source` in the verify
  script, not just through the prepared document.
- `CONFIG.statusEffects` is an object in 6.0 (`Object.values`, never `.map`).
- Premium books on disk are still 5.x builds: pack **indexes** carry 5.x keys (`rarity`,
  `movement.walk`); documents are migrated on load. Read both shapes at the index level.
- Verify scripts and the integration harness take `FOUNDRY_PROFILE=local`
  (`scripts/lib/bridge-config.mjs`); prod is the default — always set the profile.
- Sandbox etiquette: check for other drivers first, tag every temp doc `ZZ-*`, delete in `finally`,
  never `Stop-Process` the local Foundry (graceful `scripts/local-foundry.mjs stop`).

## Definition of done — 2.1.0

- Plan rows 1–6, 8, 9 checked; each with unit tests, a skill section, and a verify-script case.
- `verify-effects-6.mjs` proves a rule fires in a real roll on the sandbox; `verify-region-effects.mjs`
  proves apply-on-enter / remove-on-exit; existing verify scripts still green.
- README "2.1" paragraph; plan checkboxes ticked; `v2.1.0` tagged + GitHub release; CC restarted
  on both boxes; the `fvtt-mcp-dev-state` memory updated; this file retired.
