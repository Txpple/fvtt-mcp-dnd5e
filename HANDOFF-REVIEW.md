# HANDOFF — review the 2.1 line (written 2026-09-15, owner-requested)

> For a reviewing agent in a fresh window. Read this, then `design.md` (binding scope) and
> `docs/plan-2.1-dnd5e-6-features.md` (the tracker — every row carries its live proof numbers).
> **Delete this file when the review is done** — the plan doc is the durable record.

## What you are reviewing

One session (2026-09-15) built the whole "tools for what dnd5e 6.0 introduced" program on top of
v2.0.0 and shipped it as three tags: **v2.1.0** (effects & areas), **v2.1.1** (teleport, transform,
settings, calendar, ModifyItem, the last pass-through shapes), **v2.1.2** (2.1.1 + one read-back fix).
Range: `640cc3d..2232b9c` — 12 commits, 59 files, +7375/−252. `main` = `2232b9c`, tree clean, CI green
on every push, GitHub releases published for all three tags.

```
b26d210 docs: the owner's decisions recorded (design.md §2.3 amendment; plan; HANDOFF)
8142ecc feat(effects): conditions, rules-type changes, replacement, expiry events
209a4ac feat(areas): region + activity behaviors — effects by name, difficult terrain, templates
382cdf5 feat(items): rarity lists → system.rarities
34e51d7 v2.1.0
d78280d feat(activities): teleport + transform builders; ModifyItem proven
0eec1c4 feat(settings): configure-dnd5e-settings + manage-calendar (two NEW tools → 151)
fb5aa60 feat(areas,activities): rotateArea regions + custom transform settings
03af381 fix(placeables): create results in INPUT order; Drawing Color serialization (14.367)
27ec12e v2.1.1
e60055d fix(effects): duration-less expiry read-back
2232b9c v2.1.2
```

## Decisions that are settled — do not relitigate, but do check they were honoured

All by the owner, 2026-09-15 (recorded in the plan's *Decisions* section):

1. `dnd5e.effects` (the system's stock ActiveEffect pack) is an allowed **mechanical** source, **by
   default**. design.md §2.3 carries the amendment; `src/utils/compendium-sources.ts` encodes it
   (`EFFECTS_PACK`, `isMechanicalPack`, `isSrdPack` exempts it). Every other `dnd5e.*` pack stays refused.
2. `configure-dnd5e-settings` = **read + set**, allow-listed (`src/utils/dnd5e-settings.ts` IS the
   allow-list), GM-only, every write echoes old → new.
3. Calendar tools **in this run** (`manage-calendar`) — not deferred to Phase 2.
4. Transform "Select Form" **in 2.1.1**, and later "wrap up the shapes" → `dnd5e.rotateArea` and
   custom transform settings were typed rather than left as `system` pass-throughs.
5. "Encounter Builder" removed from all docs/memory (it was a stray, never designed).
6. **Maintenance mode resumes after 2.1.x** — the review should produce fixes, not features.

## Where the code is (per feature)

| Feature | Pure layer (unit-tested) | Live orchestrator | Tool | Verify script |
|---|---|---|---|---|
| Effect conditions / rules / replacement / expiry | `src/page/effect-changes.ts` (+ `.test.ts`, 44 cases); vocab in `src/utils/dnd5e-canonical.ts` | `src/page/effects.ts` | `src/tools/dnd5e/manage-effect.ts` | `scripts/verify-effects-6.mjs` (47) |
| Read-back + audit | `describeRule` / `ruleChangeProblem` in effect-changes | `src/page/actors.ts` (getCharacterInfo effects), `src/page/dnd5e/content-audit.ts` (rule 0) | `src/tools/actor.ts` formatEffects, `src/tools/dnd5e/content-audit.ts` | same |
| Activity duration / template / affects / behaviors / teleport / transform | `src/page/dnd5e/activities.ts` (+ `.test.ts`) | `src/page/dnd5e/manage-activity.ts` (resolves effect refs, MM actors, form effects) | `src/tools/dnd5e/manage-activity.ts` | `verify-region-effects.mjs` (30, behaviors), `verify-activities-6.mjs` (27) |
| Effect reference resolution (names / uuids / `Item#Effect`) | `parseEffectRef` in `src/page/dnd5e/effect-refs.ts` (+ `.test.ts`) | `resolveEffectRefs` (same file) | — | region-effects |
| Region behaviors (applyActiveEffect / difficultTerrain / rotateArea) | `dnd5eBehaviorSystem`, `rotateAreaSystem` in `src/page/placeables/region.ts` (+ `.test.ts`) | `addRegionBehavior` (same file) | `src/tools/placeables/region.ts` | region-effects |
| Rarities | `normalizeRarities` in `src/page/dnd5e/items.ts` | `updateActorItem` (`src/page/actors.ts`) | `src/tools/dnd5e/add-item.ts` | `verify-item-tooling.mjs` (13) |
| Settings | `src/utils/dnd5e-settings.ts` (+ `.test.ts`) | `src/page/dnd5e/settings.ts` | `src/tools/dnd5e/settings.ts` | `verify-settings-calendar.mjs` (35) |
| Calendar | — | `src/page/dnd5e/calendar.ts` | `src/tools/dnd5e/calendar.ts` | same |
| World-info automation block | — | `src/page/world.ts` | `src/tools/scene.ts` formatWorldResponse | same |
| ModifyItem advancement | `planAdvancementApply` (unchanged; `advancement.test.ts` locks it) | — | — | `verify-pc-build.mjs` Test L (66) |
| Placeable kernel order fix | — | `src/page/_placeables.ts` crudCreate (pre-assigned ids, keepId, re-order) | — | region-tooling ×3, placeables ×2 |
| Skills | `.claude/skills/{stat-block-builder,physical-item-builder,scene-builder,start-session,session-audit}/SKILL.md` | | | |

Registry: `src/registry.ts` (+2 tools), `src/tools/registry.test.ts` locks **151**.

## How to verify (the same way it was proven)

Offline gate (must be green before you touch anything else):

```bash
npm run check && npm run typecheck && npm test && npm run build && npm run knip
```

Live proof is **sandbox only** (DESKTOP-NY — LAPTOP-16 has no sandbox). Etiquette: check for other
drivers first, tag temp docs `ZZ-*`, clean up in `finally`, never `Stop-Process` the local Foundry
(graceful `scripts/local-foundry.mjs stop`). Prod was never touched during this work — keep it so.

```bash
node scripts/local-foundry.mjs status          # expect: up, world ACTIVE, users 0
npm run build
FOUNDRY_PROFILE=local node scripts/verify-effects-6.mjs           # 47/47 — rules fire in real rolls
FOUNDRY_PROFILE=local node scripts/verify-region-effects.mjs      # 30/30 — enter/exit, rotateArea turns a tile
FOUNDRY_PROFILE=local node scripts/verify-activities-6.mjs        # 27/27 — teleport / transform (cr, direct, form, custom)
FOUNDRY_PROFILE=local node scripts/verify-settings-calendar.mjs   # 35/35 — restores every switch + worldTime
FOUNDRY_PROFILE=local node scripts/verify-pc-build.mjs            # 66/66 — Test L = ModifyItem fixture
FOUNDRY_PROFILE=local node scripts/verify-item-tooling.mjs        # 13/13 — rarity list + rarity patch
FOUNDRY_PROFILE=local RUN_LIVE=1 npm run test:integration         # 84 passed / 2 skipped (86)
```

The 2.0-era scripts were all re-run green on the final build (numbers in the plan's release-proof
sections). RELEASE.md step 3 (a smoke over MCP after a Claude Code restart) was done on the sandbox.

## What a second pair of eyes should look at (my own judgement calls)

- **`isSrdPack` now exempts `dnd5e.effects`.** Consequence: `excludeSrdPacks` no longer hides it, so
  `list-compendium-packs` / faceted searches can see an ActiveEffect-type pack. Intended (owner
  decision 1), but confirm nothing downstream assumed "every `dnd5e.*` pack is hidden".
- **Validation got stricter.** `normalizeChange` throws on a core-type change whose key is a roll
  category (`attack`, `d20` …) and on a rules type whose key is a data path; `normalizeDuration`
  throws on an unknown `expiry` and on a core combat expiry without a finite value (core only
  expires when the duration is also reached — verified in `client/documents/active-effect.mjs`).
  Both were silent no-ops before. Check no skill prose or script still writes the old way.
- **Duplicate names in the stock pack** (it ships two "Silenced"): `resolveEffectRefs` takes the
  first and adds a warning listing the rest. Alternative would be to refuse; I chose warn.
- **Transform direct-mode name resolution** searches every premium Actor pack and prefers the
  Monster Manual on a tie (the DMG ships copies of Wolf / Brown Bear). `transform.mode` for direct
  link is `''` (transform-sheet.mjs line 77) — confirm if you doubt it.
- **`crudCreate` keepId change** (`03af381`) touches EVERY placeable create: ids are pre-assigned
  (an input `_id` is honoured) and results re-ordered by them. Rationale: 14.367 returned the batch
  id-sorted roughly half the time, which is what made `verify-region-tooling` / `verify-placeables-
  tooling` "flaky" (two 20/22 and 31/34 runs before the fix; 5/5 clean after). Sampled, not proven
  exhaustively — if you can show the order guarantee another way, simplify.
- **`getWorldInfo` now reads settings + calendar** on every call (try/catch, dnd5e only).
  `assertDnd5e` probes `getWorldInfo` (module-cached), so the extra cost is one-time per process.
- **ModifyItem** is proven with a hand-built fixture calling `advancement.apply(1, {}, {initial:true})`
  — the exact call the engine makes — because no premium book on disk carries a ModifyItem (the books
  are still 5.x builds). The engine path itself is only unit-tested for this type.
- **Behavior ids** (`behaviorId(activityId, i)`) are deterministic per activity; an edit that
  replaces `behaviors[]` reuses them. Fine for the system (ids only need to be unique in the array).
- **`chatCardSummary`** is client-scoped, so the settings tool reports it and refuses to write it.
  `bastionTurns` (an internal timestamp array the plan listed) was replaced by the real switches
  (`bastionConfiguration.enabled` / `.duration`).
- **Calendar `set`** goes through dnd5e's own `calendar.jumpToDate` for the date and
  `game.time.set(components)` for the time of day; month names are localized (core's stock calendars
  carry i18n keys).

## Known limits (not defects)

- The premium MM/PHB/DMG on disk are **5.x builds**: copied spells carry no 6.0 effects / behaviors
  yet (`Web` on disk has none). When the 6.0 rebuilds ship, re-check `docs/dnd5e-6.0-compat-review.md`.
- `verify-placeables-tooling` / `verify-region-tooling` were timing-sensitive **before** `03af381`;
  if you see a flake now, that is new information — report it.
- Phase 2 (design.md §8) is untouched and stays shelved.

## Machines / restart state

DESKTOP-NY: Claude Code restarted on 2.1.1; the 2.1.2 page-bundle fix is cosmetic and is picked up on
the next bridge connect (already happened). **LAPTOP-16 still needs**: `git fetch && git reset --hard
origin/main` (NOT pull) → `npm install` → wipe `dist/` → `npm run build` → CC restart.
