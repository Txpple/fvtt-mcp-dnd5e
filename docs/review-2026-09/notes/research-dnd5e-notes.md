# Research stream — dnd5e 6.0.2 / 6.0.3, Foundry 14.368, zod 4 toJSONSchema, MCP SDK 1.29.0

Written 2026-09-20 by the research agent of the architecture/perf review. Read-only: no Foundry
connection, no verify/measure/spike scripts run. Sources are the GitHub API (release bodies AND the
`compare` diffs between tags, saved to `scratch/research-dnd5e-6.0.{2,3}.diff`), foundryvtt.com,
zod.dev, and the installed `node_modules`. Scratch scripts: `scratch/research-*.mjs`, outputs
`scratch/research-*.out`.

---

## 1. dnd5e 6.0.2 and 6.0.3 — what changed, what it touches here

Release bodies (GitHub API, `releases/tags/release-6.0.x`):

- **6.0.2** — published 2026-09-15T18:27Z. Compendium: #7452. Bug fixes: #7442 #7450 #7455 #7459
  #7462 #7463 #7466. Improvement: #7443.
- **6.0.3** — published 2026-09-17T14:14Z. Bug fixes: #7474 #7475 #7480 #7482/#7484. Nothing else.
- Newest release is 6.0.3 (`releases?per_page=8`: 6.0.3, 6.0.2, 6.0.1, 6.0.0, 5.3.3 …).
- `system.json` `compatibility.minimum` is **14.367** in both (unchanged context in the diff, so it
  has been 14.367 since at least 6.0.1). Prod (Foundry 14.364) cannot take dnd5e 6.x until Foundry
  is upgraded to ≥ 14.367.

**The release notes under-report.** The tag-to-tag compare shows 15 commits / 19 files for 6.0.2
and 7 commits / 9 files for 6.0.3; six commits carry no issue number and are absent from the notes
(dependent-effect cleanup, ActorDelta adventure-import workaround, request-roll message ids,
malformed-status-effect guard, the falling-loop fix #7470, ActorDelta migration inheritance, the
Welcome-dialog product list). The table below is built from the diffs, not the bullet text.

Files touched (from `scratch/research-dnd5e-compare.txt`):

- 6.0.2: dnd5e.mjs, less/v2/chat.less, less/v3/chat.less, applications/actor/api/base-actor-sheet.mjs,
  data/actor/group.mjs, data/actor/npc.mjs, data/chat-message/request-message-data.mjs,
  dice/basic-roll.mjs, documents/active-effect.mjs (+40/-10), documents/actor/actor.mjs,
  documents/applied-rules.mjs, documents/item.mjs, documents/token.mjs, enrichers.mjs, utils.mjs,
  packs/_source/classes24/druid/class-features/primal-order-magician.yml, system.json,
  templates/chat/request-card.hbs, templates/chat/roll-breakdown.hbs.
- 6.0.3: json/official-content.json, applications/item/container-sheet.mjs,
  data/shared/d20-roll-modification-field.mjs, documents/active-effect.mjs, migration.mjs, utils.mjs,
  system.json, two product webp images.

### Targeted-verify table (release item → our module → verify script or NONE)

Category key: **AE** ActiveEffect · **Adv** advancement · **Item** Item/Activity data · **Chat**
ChatMessage · **Tok** Scene placeables (Token) · **Mig** migration · **Pack** compendium content ·
**Actor** actor data model · **UI** sheet/render only.

| Rel | Item (system files) | Cat | Our module(s) | Verify script(s) | Note |
|---|---|---|---|---|---|
| 6.0.2 | #7442 `Item5e#createAdvancement`: `"system.==advancement"` → `_replace(...)` (documents/item.mjs:1023) | Adv | We never call `createAdvancement`; the only advancement write is `raw.adv.apply(level, data[, {initial}])` — `src/page/dnd5e/advancement.ts:526,529` (no `==advancement` / `_needsAdvancementMigration` anywhere in src) | `verify-pc-build.mjs` (createPcActor ×8, levelUpPc ×3), `verify-scale-report.mjs` | regression only |
| 6.0.2 | #7450 Rule-type AE conditions: `getReplacementData()` now returns `item`, `scaling`, **`sourceItem`**, **`sourceScaling`**; new `getRuleConditionData()`; `RulesIterator.filterWith` uses it (applied-rules.mjs:126); `getHumanReadableAttributeLabel` maps `sourceItem.` (utils.mjs:1375) | AE | Filter vocabulary + scope validation: `src/page/effect-changes.ts:84-156` (roll.* only in change scope), `:400-450` (`normalizeChange`), `:215` (`describeFilter`); tool text with `item.properties` / `roll.*` examples: `src/tools/dnd5e/manage-effect.ts:37-38, 85-89, 141-142, 237-238` | `verify-effects-6.mjs` (rules-type changes + conditions), `verify-actor-tooling.mjs` | **Semantics shift**: in a rules-change condition `item.*` is now the item being ROLLED; the effect's own item is `sourceItem.*`. Our docs/examples do not distinguish and `describeFilter` has no `sourceItem` vocabulary. Targeted: a rules change with `{k:"item.type.value", …}` on a feature-carried effect, rolled from a weapon — assert which item `item.*` sees. |
| 6.0.2 | #7452 Druid *Primal Order: Magician* AE key `system.scale.druid.cantrips-known` → `.value` (packs/_source/classes24 = the 2024 **SRD** pack) | Pack | Not a source for us (design §2.3, `src/utils/compendium-sources.ts:20,51`); whether the premium PHB module carries the same fix is a separate module release — NOT in this diff | NONE (`verify-pc-build.mjs` has no Druid case) | if a Druid PC is built, `cantrips-known` on the sheet is the tell |
| 6.0.2 | #7455 sheet drop of a compendium spell onto Inventory → `Item5e.createScrollFromCompendiumSpell(uuid)` (base-actor-sheet.mjs:1770-1885); scroll Cast activity now gets `duration.concentration` (documents/item.mjs:1429) | Item | Not our path — we never create scrolls from spells (`createScrollFrom*` absent from src); `add-item` authors `consumable/scroll` from scratch (`src/tools/dnd5e/add-item.ts:242`) | NONE (`verify-item-tooling.mjs` covers add-item's scroll subtype) | `createScrollFromCompendiumSpell` is a candidate compendium-first path for physical-item-builder scrolls |
| 6.0.2 | #7459 + 7b0b142 `Actor5e#concentration` getter cached in `_lazy` (documents/actor/actor.mjs:245-251) | Actor | no read of `actor.concentration` in src (combat-stats reads message *flags*, `src/tools/combat-stats.ts:343-403`) | NONE | — |
| 6.0.2 | #7462 roll breakdown: `BasicRoll#getTooltip` → `collectConstants(ast)`; template renders `constant-term` sections with flavor (dice/basic-roll.mjs:290-365, templates/chat/roll-breakdown.hbs) | Chat (render) | `list-chat-messages` / `export-chat-log` render typed cards via `renderSystemContent` and strip to text (`src/page/chat.ts:50-53, 71, 101, 181-191, 267-278`) — breakdown text now lists constants separately with flavor | `tests/integration/chat.int.test.ts` (RUN_LIVE) — no verify script → NONE | text-mode exports change shape slightly; not a schema change |
| 6.0.2 | #7463 enricher `handlePostRequest(dataset, target)` cross-realm guard (enrichers.mjs:1774) | Chat (UI) | `request-roll` posts a `[[/save dex dc=15]]`-style enricher message (`src/page/chat.ts:386-403`, `src/page/chat-helpers.ts:201-214`); the fix is the click handler, message shape unchanged | `chat.int.test.ts:89` → NONE verify | — |
| 6.0.2 | #7466 NPC embed i18n keys `DND5E.TRAIT.Damage.Immunity.title` / `Condition.Immunity.title` (data/actor/npc.mjs:865-867) | UI (Embeds) | we do not render NPC `@Embed` stat blocks (bestiary-builder uses lore pages) | NONE | — |
| 6.0.2 | #7443 `GroupData#rollSavingThrow(config={}, dialog={}, message={})` / `rollSkill(...)` signature + `message.data?.flavor` (data/actor/group.mjs:283-326) | Actor (group) | `src/page/dnd5e/group.ts` uses only `system.addMember/removeMember` + the `primaryParty` setting (`group.ts:8-14, 235`); no roll calls | `verify-group-tooling.mjs` (regression) | — |
| 6.0.2 | 51f6e8f dependent effects: out-of-combat expiry no longer deletes an effect whose `flags.dnd5e.dependentOn` is set (documents/active-effect.mjs:802) | AE | no `dependentOn` handling in `src/page/effects.ts` / `manage-effect.ts`; effects our tools create never set it, enchant/summon-created ones do | `verify-effects-6.mjs` §5b (value-less expiry fires; lines 591-600) — regression | — |
| 6.0.2 | b642ce0 `preImportAdventure` hook wraps `token.delta.effects[].system` in `_replace` for `condition` effects (dnd5e.mjs:731-741) | Mig (Adventure import) | tom-cartos-import never uses `Adventure#import`: `src/tools/pack-reader.ts:206-224` harvests, then `create-scene` recreates | NONE | — |
| 6.0.2 | 3a922ac request-card render context adds `messageId` (data/chat-message/request-message-data.mjs:105; templates/chat/request-card.hbs:12) — data model unchanged | Chat | `src/page/combat-stats.ts:46` reads `system.targets[]` of TYPED roll messages, not request messages | NONE (`get-combat-stats` has no verify script) | — |
| 6.0.2 | 8c10c1a `"system.type": data.statuses?.[0]` guard for malformed status effects (documents/active-effect.mjs:305) | AE | `apply-condition` → `actor.toggleStatusEffect(id,{active})` (`src/page/dnd5e/conditions.ts:167-197`); `manage-effect` create passes `statuses` (`src/page/effects.ts:131,157`) | `verify-actor-tooling.mjs` (apply-condition), `verify-effects-6.mjs` | — |
| 6.0.2 | cac30cc #7470 falling loops: `updateFalling(movement)` batched across linked tokens; **`_onRelatedUpdate`: `concrete` no longer requires `parent.isView`, and the designated user no longer requires `u.viewedScene === scene`** (documents/token.mjs:409-425, 560-566, 597-602) | Tok (behaviour) | A headless GM client is `active` and `canUserModify` → the bridge can now be the designated user that toggles `falling` (and `postFallDamage`) for tokens on scenes it is NOT viewing. Writers of `elevation`: `update-token` (`src/page/placeables/token.ts:238, 346`), `place-tokens` (`token.ts:75`), region `changeLevel` / teleport; the `disableFalling` switch is read into get-world-info (`src/page/world.ts:56-63`) | `verify-token-tooling.mjs` (update-token; **no elevation case**), `verify-placeables-tooling.mjs`, `verify-teleporter-scene-fields.mjs`, `verify-region-tooling.mjs`, `verify-settings-calendar.mjs:124` (flips `disableFalling`) | **Targeted: NONE covers an elevation write with `disableFalling=false` on a Levels scene while the bridge views another scene** — add one (expect `falling` status toggled by our client; restore elevation and setting in `finally`) |
| 6.0.2 | (context) `system.json` `compatibility.minimum: "14.367"` | — | README pins (`README.md:30, 68, 237`), `LOCAL.md`, plan Progress list | — | prod 14.364 cannot run 6.x |
| 6.0.3 | #7474 `simplifyBonus` catch-block typo `console.error(err)` (utils.mjs:569) | — | no `simplifyBonus` use in src | NONE | — |
| 6.0.3 | #7475 `D20RollModificationField.initialize(value ?? {})` so effects on `system.rolls.attack.*` apply when the field is absent (data/shared/d20-roll-modification-field.mjs:43-45) | Actor | No `system.rolls` anywhere in src; our rules-type changes use `dnd5e.advantage/bonus/minimum/maximum` on roll CATEGORIES (`src/page/effect-changes.ts:264-350`), not `system.rolls.attack.*` key paths; not on the `update-actor` allow-list either (`src/page/dnd5e/actor-fields.ts`) | `verify-effects-6.mjs` (rules on `attack`) — regression | a core-type change with key `system.rolls.attack.bonus` is now a viable authoring path; today `normalizeChange` would accept it as a data-path write |
| 6.0.3 | #7480 `ContainerSheet#_filterChildren` falls through to super (applications/item/container-sheet.mjs:355) | UI | — | NONE | — |
| 6.0.3 | #7482/#7484 `_preCreate`: `duration.expiry = "turnStart"` is stamped in combat **only when `Number.isFinite(duration.value)`** (documents/active-effect.mjs:754-763) | AE | duration/expiry normalisation `src/page/effect-changes.ts:471-560` (value-less expiry, `DURATIONLESS_EXPIRIES`), read-back summary `:539-558`; tool text `src/tools/dnd5e/manage-effect.ts:170-200, 240` | `verify-effects-6.mjs` lines 488-509 (bare `{expiry:'turnEnd'}` persists value-less), §5b (in-combat firing) | **Targeted**: create an effect with NO duration on a combatant → `duration.expiry` must now stay null (6.0.1/6.0.2 stamped `turnStart`); our read-back returns `null` for "permanent" — assert that |
| 6.0.3 | 0fd354f `migrateWorld`: unlinked-token ActorDeltas persist only the embedded collections they `manages()`; migrated base-actor children are inherited (migration.mjs:163-196) | Mig | one-shot on the first GM load after the version bump (the sandbox is already on 6.0.3 — done). Reads of ActorDelta-backed token actors: `src/page/actors.ts:392, 506`, `src/page/placeables/token.ts:268` | `verify-token-item-editing.mjs`, `verify-token-reskin.mjs` (ActorDelta reads/writes) — regression | note for the pin: let a real GM login finish the migration before the bridge's first connect on any OTHER world you upgrade |
| 6.0.3 | 160e7ff `json/official-content.json` adds `dnd-arcana-unleashed` ("Arcana Unleashed") and `dnd-deadfall` ("Arcana Unleashed: Deadfall") | Pack (catalogue) | the ONE premium definition is `src/utils/compendium-sources.ts:40 PREMIUM_BOOK_PREFIXES` (MM, PHB, DMG, heroes-faerun, ravenloft-horrors-within); the two new ids are candidates to add IF the owner installs them (design §2.3 extensibility) | NONE | — |

**Net targeted-verify list for the pin step** (beyond the standard release set):

1. `verify-effects-6.mjs` — extend or run a one-off: (a) effect with no duration created on a
   combatant → `expiry` stays null (#7482); (b) a rules change whose condition keys off `item.*`
   while rolling a DIFFERENT item → confirm `item` = rolled item, `sourceItem` = the effect's item
   (#7450). Both are `ZZ-*` docs, torn down in `finally`.
2. A token-elevation write with `disableFalling=false` on a scene the bridge does not view
   (#7470) — none of `verify-token-tooling` / `verify-placeables-tooling` /
   `verify-teleporter-scene-fields` writes `elevation` today (`rg elevation scripts/verify-*.mjs`
   → only `verify-reskin-visibility.mjs`). Restore the setting and elevation in `finally`.
3. Then the release set exactly as CLAUDE.md lists it and `RUN_LIVE=1 npm run test:integration`
   (chat.int.test.ts is the only live coverage of `request-roll` / message rendering, #7462/#7463).
4. Pins: README lines 30, 68, 237 say 6.0.1; `LOCAL.md`; the 2.1 plan's Progress list. Record in
   the commit: 6.0.2 = AE rule-condition data (`sourceItem`), falling designated-user change,
   dependent-effect expiry, group roll signatures; 6.0.3 = duration-less effects no longer get
   `turnStart`, `system.rolls.*` initialisation, ActorDelta migration inheritance.

---

## 2. Foundry — latest stable is still 14.368

`curl https://foundryvtt.com/releases/` grepped for `Release 1[45].xxx` + channel: the newest
entries are 14.368 (Stable), 14.367 (Stable), 14.366 … 14.359 (Stable), 14.356-358 (Testing),
14.354-355 (Development), 14.349-353 (Prototype). No `Release 15.*` and nothing above 14.368 on the
page (WebFetch of the same page: 14.368 dated 2026-09-16, "no releases exceeding 14.368").
Nothing to list for HTTP routes / auth / CSRF / join / setup / schemas / uuids.

---

## 3. zod 4.4.3 `toJSONSchema` — the options and what the repo uses

Installed: `node_modules/zod/package.json` → 4.4.3. Implementation:
`node_modules/zod/v4/core/to-json-schema.js` (context, process, extractDefs, finalize),
`json-schema-processors.js` (per-type processors, `toJSONSchema()` entry at :563),
`registries.js` (`$ZodRegistry`, `globalRegistry`), `classic/schemas.js:166-181` (`describe`/`meta`).

| Option | Values (4.4.3 types, `to-json-schema.d.ts:7-41`) | Default (`initializeContext`, `.js:10-30`) | Behaviour |
|---|---|---|---|
| `target` | `"draft-04" \| "draft-07" \| "draft-2020-12" \| "openapi-3.0"` (old `draft-4`/`draft-7` normalised, `.js:13-16`) | `draft-2020-12` | picks `$schema` (`.js:299-313`), `$defs` vs `definitions` (`.js:122, 343-348`), and whether `$ref` may carry siblings — older drafts wrap in `allOf` (`.js:234-241`) |
| `io` | `"input" \| "output"` | `output` | input side of pipes/transforms/coercion (`processors.js:491`); `default` and `examples` deleted on transforming schemas (`.js:83-87`); `_prefault` → `default` (`.js:89-91`); object `required` excludes keys with `optout` (defaults are optional on input) (`processors.js:287-299`); `additionalProperties:false` only emitted on output for plain objects (`processors.js:304-309`) |
| `unrepresentable` | `"throw" \| "any"` | `throw` | `any` → `{}` (`processors.js:91-256` — every branch checks `=== "throw"` only). The zod.dev page also describes a function form; on 4.4.3 a function is not `"throw"` so it silently yields `{}` (`scratch/research-zod-describe-clone.mjs`: `unrepresentable fn: {}`). |
| `cycles` | `"ref" \| "throw"` | `ref` | a schema on its own `schemaPath` gets `seen.cycle` (`.js:39-42`); `throw` errors with the path (`.js:167-176`); `ref` extracts it to `$defs/__schemaN` or `#` for the root (`.js:135-143, 199-204`) |
| `reused` | `"ref" \| "inline"` | `inline` | **by object identity**: any schema instance with `seen.count > 1` is extracted to `$defs/__schemaN` (`.js:205-212`, naming `.js:141`) |
| `metadata` | a `$ZodRegistry` | `globalRegistry` | after processing, `Object.assign(result.schema, meta)` — every metadata field lands in the JSON (`.js:79-82`); a schema whose meta has `id` is ALWAYS extracted to `$defs/<id>` regardless of `reused` (`.js:193-198`), and `id` is stripped from the def body and the root (`.js:325-327, 332-334`); duplicate ids across different schemas throw (`.js:103-114`) |
| `override` | `(ctx: {zodSchema, jsonSchema, path}) => void` | no-op | runs in `finalize` for every seen schema, in reverse order, AFTER ref flattening — mutate `ctx.jsonSchema` in place (`.js:288-297`) |
| registry form | `z.toJSONSchema(registry, {uri?})` | — | processes every `id`-registered schema, emits `{schemas: {<id>: …, __shared: {$defs}}}` with `$ref`s through `uri(id)` (`processors.js:563-595`; internal `external` option) |

**How `.describe()` / `.meta()` surface.** Both CLONE the schema and register the clone in
`globalRegistry` (`classic/schemas.js:166-181`); the clone's `_zod.parent` is the original, and
`registry.get()` inherits the parent's metadata minus `id` (`registries.js:30-41`). The processor
also processes the parent (`to-json-schema.js:70-77`), so a shared const used at N sites through
`.describe()` is *seen* N times even though each site is a distinct object. In `finalize`, a child
inherits the parent's JSON and keeps its own keys ("child wins", `.js:229-254`), and if the parent
was extracted the child becomes `{ $ref, description }` (`.js:266-286`).

**What `src/utils/schema.ts` uses today** (`:31-45`): `io: 'input'`, `target: 'draft-2020-12'`,
`unrepresentable: 'any'`; then deletes `$schema`, strips the `.int()` safe-integer sentinels,
normalises `required`/`properties`. Not used: `reused`, `cycles` (default `ref`), `metadata`,
`override`, `.meta({id})`, the registry form. Descriptions reach the output through
`.describe()` → globalRegistry → `Object.assign` (that is the 68k chars of description text in
the brief).

**Measured on the real registry** (`scratch/research-zod-reuse{,2,3}.mjs`, loader hook
`research-zod-hooks.mjs` redirects `dist/utils/schema.js` to a capturing shim; 151 tools, all
matched; full `tools/list` = **283,948 chars**, identical to the brief):

- `reused: 'ref'` across the board is a **net loss: 206,472 → 259,722 chars (+25.8%)**. It extracts
  1,275 defs; 838 are ≤ 60 chars (`{"type":"string"}` leaves shared through `.describe()` clones —
  see the demo in `research-zod-describe-clone.mjs`: 418 → 451 chars). 121 of 151 tools get `$defs`.
  Worst: `update-actor` +2,891, `manage-activity` +2,760, `create-scene` +2,269, `add-item` +2,046,
  `add-feature` +2,034.
- Genuinely shared, large, *intra-tool* sub-shapes are rare: of 105 extracted defs ≥ 200 chars only
  **3** are referenced twice (`manage-effect` 621 chars ×2, `add-feature` 349 ×2, `add-item`
  279 ×2); the sum of net savings if only those were `$ref`-ed is **1,081 chars (0.5%)**.
- Cross-tool duplication exists but MCP has no cross-tool `$defs`: 92 distinct property
  descriptions > 40 chars repeat across tools, 8,367 redundant chars (4% of schema chars) — e.g.
  "Scene id or exact name holding the placeables." ×24.
- Selective extraction works with the default `reused:'inline'`: `.meta({ id: 'Rect' })` on a
  shared shape → `$defs: { Rect }` and `{ "$ref": "#/$defs/Rect", "description": "as used here" }`
  at each site (2020-12 allows siblings on `$ref`; draft-07 would wrap in `allOf`). That is the
  only sane way to factor repeated sub-shapes: tag the few big ones by `id`, never flip `reused`.

Conclusion for 3.0: `$defs/$ref` is not a token lever on this surface (< 1%). The measured weight
is breadth (206k of schema over 151 tools) and description prose (68k); the levers are the CRUD
consolidation, toolsets, and shorter `.describe()` strings.

---

## 4. `@modelcontextprotocol/sdk` 1.29.0 — `$defs` / `$ref` in `inputSchema`

Installed 1.29.0 (`node_modules/@modelcontextprotocol/sdk/package.json`); peer `zod ^3.25 || ^4.0`,
dep `zod-to-json-schema ^3.25.1` (lines 118-123).

The repo uses the **low-level `Server`** (`src/index.ts:14-16, 75-82`):
`mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))`.

- `Server.setRequestHandler` (`dist/esm/server/index.js:95-150`) only wraps `tools/call` (validates
  the request with `CallToolRequestSchema` :119 and the RESULT with `CallToolResultSchema` :138);
  every other method — including `tools/list` — falls to the base
  `Protocol.setRequestHandler` (`dist/esm/shared/protocol.js:886-893`), which parses the REQUEST
  (`parseWithCompat(requestSchema, request)` :890) and returns the handler's result as-is.
- `Protocol._onrequest` (`protocol.js:284, 367-388`) puts that result straight into
  `{ result, jsonrpc: '2.0', id }` and `transport.send(response)` (:387). **No validation, no
  transformation of `inputSchema` on the server side. `$defs`/`$ref` pass untouched.**
- There is no registration-time schema validation on this path at all (`tools` is a plain array
  built by `src/registry.ts`).
- Even where the SDK does validate a `Tool` (a TS-SDK **client** parses `tools/list` with
  `ListToolsResultSchema` — `client/index.js:565-566` → `protocol.js:696`), `ToolSchema.inputSchema`
  is `z.object({ type: literal('object'), properties: record(AssertObjectSchema).optional(),
  required: array(string).optional() }).catchall(z.unknown())` (`dist/esm/types.js:1240-1246`;
  `AssertObjectSchema` = "non-null object" `types.js:13`), so `$defs` survives the catchall and a
  `{ $ref }` property passes. Empirically (`scratch/research-sdk-defs-passthrough.mjs`): parse ok,
  output byte-identical to input.
- The **`McpServer`** high-level path is different and worth knowing before any refactor toward
  `registerTool`: its `tools/list` handler converts each zod schema itself via `toJsonSchemaCompat`
  (`server/mcp.js:67-83`) → for zod 4 `z4mini.toJSONSchema(schema, { target: mapMiniTarget(undefined)
  = 'draft-7', io: 'input' })` (`server/zod-json-schema-compat.js:9-25`). That is **draft-07 output
  with `$schema` and `definitions`**, with no `reused`/`override` control — exactly the dialect the
  repo's `schema.ts` comment says bricked a live session via the tuple `items` shape under the
  Anthropic API's 2020-12 validation. The low-level `Server` + own `toInputSchema` is load-bearing.

Not verified here: whether the Anthropic API / Claude Code's client accept `$ref`/`$defs` inside
`input_schema` at runtime (2020-12 permits them; nothing in this repo or the SDK forbids them; no
live API call was made).
