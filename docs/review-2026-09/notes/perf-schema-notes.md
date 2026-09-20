# perf-schema — what a client LOADS (tools/list), and whether fewer tools means fewer bytes

Review dimension notes, 2026-09-20. All numbers are `JSON.stringify(...).length` chars over the exact
object `index.ts` serves for `tools/list` (built offline from `dist/` via `buildToolRegistry` over a
generic host + fake bridge — `scratch/perf-schema-lib.mjs`). Tokens ≈ chars / 3.6 (the brief's
convention; not `count_tokens`). Nothing here touched Foundry.

Scripts (all under `scratch/`, run from the repo root; the ones marked † need the loader shim:
`node --import ./scratch/perf-schema-hook-register.mjs scratch/<script>`):

| script | what |
|---|---|
| `perf-schema-baseline.mjs` | reproduces 151 tools / 283,948 chars |
| `perf-schema-decompose.mjs` (+ `.json`) | task 1: per-tool description vs schema; leaf prose / enum / structural |
| `perf-schema-dupes.mjs` (+ `.json`) | task 2: identical subtrees across tools (sha1 of canonical JSON) |
| `perf-schema-nearDupes.mjs` | task 2b: structurally identical shapes with different prose; per-field repeats |
| `perf-schema-hook-register.mjs`, `perf-schema-hook.mjs`, `perf-schema-schema-shim.mjs`, `perf-schema-zodmap.mjs` | the loader shim: swaps `dist/utils/schema.js` for a recorder so every tool's zod instance is captured by identity (151/151 mapped) |
| `perf-schema-zodprobe.mjs` | task 3: which zod wrapper trips `reused:'ref'` |
| `perf-schema-reused.mjs` † | task 3: `reused:'ref'` as zod 4.4.3 emits it, per tool + whole list |
| `perf-schema-reused-fixed.mjs` † | task 3: the same with single-reference `$defs` re-inlined (genuine reuse only) |
| `perf-schema-reused-diff.mjs` † | proof that ref-resolved == advertised (add-feature) |
| `perf-schema-famtypes.mjs` † | task 4 inventory: the three families, zod node types, bytes today |
| `perf-schema-shapes.mjs` † (+ `-shapes.json`, `-shapes-<fam>-{a,b2,cGen2}.json`) | task 4: the consolidation experiment, with a lossless guard |
| `perf-schema-shapes-verify.mjs` †, `perf-schema-inliner-debug.mjs` † | the bug hunt on the re-inliner (fixed; guard now asserts deep-equality) |
| `perf-schema-descriptions.mjs` (+ `.json`) | task 5: boilerplate vs field-level detail in descriptions; leaf-prose repeats |
| `perf-schema-toolsets.mjs` | task 6: bytes per toolset; the tool-NAME cost in Claude Code |
| `perf-schema-crud-all.mjs` | all 82 `list/create/update/delete-*` tools by family |

## 0. Baseline (reproduced)

`perf-schema-baseline.mjs`: 151 tools, **283,948 chars** (≈ 78.9k tokens). Per-tool keys are exactly
`name`, `description`, `inputSchema`. Split: descriptions 68,957 (with quotes) / inputSchema 206,472 /
names 2,478 / JSON envelope ≈ 6,041 (≈ 40 chars per tool).

## 1. Decomposition — the list is two-thirds English

`perf-schema-decompose.mjs`:

| bucket | chars | % of list |
|---|---|---|
| leaf `"description"` strings inside inputSchema (the zod `.describe()` prose) | 122,631 (1,209 fields; 102,287 raw text + key/quote overhead) | **43.2%** |
| tool `description` | 68,655 | **24.2%** |
| structural (`type`/`properties`/`required`/`additionalProperties`/`items`/`anyOf`…) | 73,193 | 25.8% |
| `enum` lists | 8,159 (155 enums / 826 values) | 2.9% |
| `default` / `const` / `examples` | 2,179 / 310 / 0 | 0.9% |
| envelope + names | 8,821 | 3.1% |

**67.4% of what an eager client loads is prose.** Structure — the thing consolidation, `$ref`, or
"fewer tools" can touch — is 25.8%. Distribution: median tool 1,009 chars, mean 1,880, p90 3,543.

Top 15 (41.6% of the list): manage-activity 17,514 (75 leaf descriptions = 10,451 chars; 28 enums / 195
values), update-actor 16,403, add-feature 13,906, add-item 11,464, create-scene 9,735, manage-effect
8,155, add-region-behavior 5,807, update-token 5,288, configure-soundscape 5,090, update-scene 4,632,
configure-dnd5e-settings 4,570, author-npc 4,335, update-rolltable 4,150, create-actor-from-compendium
3,621, create-quest-journal 3,583. Cheapest: list-cards 171, list-rolltables 184, list-playlists 200.

Four tools carry **no** leaf prose at all (author-npc 3,089-char schema, create-pc, create-pc-from-prefab,
level-up-pc — `src/tools/dnd5e/npc.ts` has 0 `.describe(` calls); their 1.0–1.7k descriptions do the
job the schema should.

## 2. Repeated sub-shapes — small, and not expressible in MCP

`perf-schema-dupes.mjs`: 1,308 distinct schema subtrees; 205 appear ≥ 2 times. Counting only the
maximal (non-nested) duplicates, emitting each once would save **28,936 chars (10.2%)**; after
`{"$ref":"#/$defs/x"}` overhead ≈ 12,286 (4.3%). The big ones are pairs, not shapes shared by many
tools: quest-journal `blocks` 2,076 × 2 (create-/update-quest-journal), rolltable `results.items`
1,103 × 2 (create-/update-rolltable), `sceneIdentifier` 94 × 24, `{"minLength":1,"type":"string"}`
31 × 63, `{"type":"string"}` 17 × 109, `abilities` 381 × 3 (author-npc, create-pc, create-pc-from-prefab),
`environment` 549 × 2 (create-/update-scene).

But `tools/list` has no shared `$defs` across tools — each `inputSchema` is self-contained — so
cross-tool dedup is **0 achievable** through `$ref` in the protocol as it stands.

The hypothesis that "the activity shape / the effect shape" repeats across tools is **false**
(`perf-schema-nearDupes.mjs`): manage-activity and add-feature share only `damageParts.items` (342/349)
and `healAmount` (301/323) structurally; the rest differs. `sourceRules` appears 4 times (502 chars,
3 distinct texts). What does repeat is the *concept* with different prose: `actorIdentifier` — 16
occurrences, 14 tools, **16 distinct descriptions** (3,122 chars; "partial name match supported" in
some, "exact name or ID" in others, "also accepts a placed TOKEN id" in 11); `sceneIdentifier` — 43
occurrences, 15 distinct texts (4,180 chars). That is a contract-consistency problem more than a byte one.

## 3. zod 4.4.3 `toJSONSchema` — `reused:'ref'` makes the list BIGGER

Options in the installed version (`node_modules/zod/v4/core/to-json-schema.d.ts:9-39`): `metadata`
(registry; any schema with an `id` meta becomes a `$def`), `target` (`draft-2020-12` default,
`draft-07`, `draft-04`, `openapi-3.0`), `unrepresentable` (`throw`|`any`), `override(ctx)`, `io`
(`input`|`output`), `cycles` (`ref` default | `throw`), `reused` (`ref` | `inline` default —
`to-json-schema.js:26-27`), `external` (registry + uri + defs; `ToJSONSchemaParams` omits it,
`:45`). `$defs` is used for 2020-12, `definitions` otherwise (`:122`). A schema is extracted to `$defs`
when it is the root, has an `id` meta, closes a cycle, or `seen.count > 1 && reused === 'ref'`
(`:177-211`); `count` is per zod **instance** per `toJSONSchema` call (`:33-37`). No cycles exist in
any tool (`cycles:'throw'` throws for 0 of 151).

Measured (`perf-schema-reused.mjs`):

| | inline (today) | `reused:'ref'` raw | genuine reuse only |
|---|---|---|---|
| manage-activity | 16,358 | 19,118 (+16.9%, 66 `$defs`) | 16,341 (−17) |
| add-feature | 13,098 | 15,132 (+15.5%, 55) | 12,828 (−270) |
| manage-effect | 6,912 | 7,881 (+14.0%, 27) | 6,781 (−131) |
| update-actor | 14,621 | 17,512 (+19.8%, 69) | 14,608 (−13) |
| **whole list** | **283,948** | **337,198 (+18.75%)**; 121/151 tools gain `$defs`, 1,275 entries | **282,982 (−0.34%)**; 9 tools, 11 defs |

Why raw grows: `.describe()` **clones** the schema (`node_modules/zod/v4/classic/schemas.js:166-170`)
and `process()` re-processes a clone's `parent` (`to-json-schema.js:68-74`). With the codebase idiom
`z.string().optional().describe('…')` (237 sites in `src`; the reverse order 0 sites) the ZodOptional is
cloned, both the clone and its parent run `optionalProcessor` (`json-schema-processors.js:509-513`),
so the inner `z.string()` instance is counted twice and hoisted as `{"$ref":"#/$defs/__schema0"}`
even though it is used once (`perf-schema-zodprobe.mjs`: `string.optional().describe()` → `$defs`;
`string.describe().optional()` → inline). Every hoist costs ~28 chars of `$ref` plus the key.

Validity: `$defs` + `$ref` (with sibling keywords such as `description`) is valid draft 2020-12, the
dialect `toInputSchema` targets (`src/utils/schema.ts:38`). The bundled claude-api reference lists
`$ref`/`$def` among supported keywords for tool schemas (claude-api skill, `shared/tool-use-concepts.md:539`).
Whether every MCP client resolves `$ref` in `inputSchema` is not verifiable offline.

Conclusion: **do not flip `reused:'ref'`**. The genuine intra-tool reuse is 966 chars over the whole
surface because the tools re-declare rather than share zod instances. If 3.0 wants `$ref` for
readability, the precondition is (i) `.describe()` before `.optional()`/`.default()` everywhere and
(ii) deliberately shared instances (`sceneTarget` in `src/tools/placeables/_module.ts:23` is the one
existing example).

## 4. THE 3.0 SHAPE EXPERIMENT (`perf-schema-shapes.mjs`)

Same zod instances, three consolidations, lossless-guarded (every (c) variant, `$ref`-resolved,
deep-equals the plain union).

| family | tools today | bytes today (desc / schema) | (a) kind+op+loose `data`+`describe` | (b1) union, per-tool descriptions dropped | (b2) union, descriptions kept as member descriptions | (c) b1 + `reused:'ref'` raw / genuine | (c) b2 raw / genuine | names removed |
|---|---|---|---|---|---|---|---|---|
| placeables (8 kinds; 32 CRUD + teleporter/behavior/remap) | 35 | 62,270 (14,108 / 46,153) | **1,345 (2.2%)** | 49,900 (80.1%) | **64,619 (103.8%)** | 57,604 / 46,711 (75.0%) | 79,437 / 61,442 (98.7%) | 34 |
| items (create/list/get/update/delete/import) | 6 | 7,332 (2,381 / 4,612) | 1,076 (14.7%) | 5,408 (73.8%) | 7,903 (107.8%) | 6,344 / 5,408 | 10,172 / 7,903 | 5 |
| rolltables (create/import/list/update/roll/get/delete) | 7 | 8,970 (2,463 / 6,093) | 1,100 (12.3%) | 7,026 (78.3%) | 9,608 (107.1%) | 7,661 / 6,002 | 11,749 / 8,587 | 6 |
| **total** | **48 → 3** | **78,572** | **3,521 (4.5%)** | 62,334 (79.3%) | **82,130 (104.5%)** | — / 58,121 (74.0%) | — / 77,932 (99.2%) | 45 |

Whole list if applied to these three families: (a) 208,897 (73.6%, ≈ 58.0k tokens); (b1) 267,710
(94.3%); (b2) 287,506 (**101.3%**); (c2 genuine) 283,308 (99.8%).

What (a) defers behind `describe` (returned as a tool RESULT, once per kind per session): placeables
tiles 7,938 / lights 6,538 / sounds 6,289 / drawings 7,402 / walls 6,891 / tokens 8,519 / notes 4,188 /
regions 14,212 (61,977 total); items 7,289; rolltables 8,886.

**Plain answer: fewer tools does not mean fewer bytes.**
- A tool's envelope (name + three JSON keys) is ~56 chars; the union adds `kind`/`op` literals and an
  `anyOf` wrapper per member (~65–110 chars). Merging with nothing dropped costs **+4.5%** (b2).
- (b1)'s −20.7% is entirely the 18,952 chars of per-tool descriptions it throws away; its schema part
  *grew* ≈ 8%.
- Genuine `$ref` on the placeable union recovers 3.2k (b1) / 3.2k (b2) because the placeable modules
  share zod instances between create/update (and `sceneTarget` across all 35); items share nothing.
- (a) is the only shape that shrinks the eager `tools/list` (−95.5% for the family, −26.4% of the
  whole list) and it does so by **deferring** the same prose, not removing it: in Claude Code, where
  schemas are already deferred and results are what cost, (a) is neutral-to-worse per kind unless
  `describe` takes `op` as well (tiles/create alone would return ~3.5k instead of 7.9k).
- The CRUD-named surface is 49.3% of the list (82 tools, 140,037 chars, `perf-schema-crud-all.mjs`);
  the other 69 tools are 50.7%, led by manage-activity 17,514 / add-feature 13,906 / add-item 11,464 /
  manage-effect 8,155 / add-region-behavior 5,807 (56.8k, 20% of the list) — untouched by any CRUD
  consolidation.

## 5. Descriptions (68,428 chars) — boilerplate 1.7%, field-level detail 49.2%

`perf-schema-descriptions.mjs`: 151 descriptions, mean 453, max 1,972 (add-item). Exact sentences
present in ≥ 3 descriptions: **6 sentences, 1,131 chars (1.7%)** ("STRICT resolution — no
fuzzy/substring matching." ×6, "Missing ids are reported, never fatal." ×7, "Plane B (file channel,
write)." ×6 …); 29 eight-word phrases shared by ≥ 3. Boilerplate is not a lever.

Sentences that name one of the tool's own parameters or talk about params/fields/pass/omit: **214 of
552 sentences, 33,661 chars (49.2%)**. Fifteen tools are ≥ 70% field-level (add-item 1,583/1,972,
update-actor 1,574/1,710, read-pack 1,323/1,738, update-token 1,180/1,388, create-pc 1,168/1,652,
manage-effect 998/1,141, manage-activity 897/1,080, create-scene 855/958, add-feature 703/750,
update-rolltable, manage-calendar, search-compendium-items 100%, list-folders 98%, create-teleporter,
search-compendium-spells 100%). 33 descriptions embed examples.

Leaf prose (102,287 raw chars, 1,209 strings, 1,031 distinct): identical strings used ≥ 3 times save
only 2,700 if emitted once ("Scene id or exact name holding the placeables." ×24). 38 leaf descriptions
are ≥ 300 chars (14,719 chars, 14.4%); 94 are ≥ 200 (28,188 chars). Longest: add-feature 709
(`compendiumFeatures.packs` default list), create-actor-from-compendium 531, manage-effect 501 & 477,
add-region-behavior 501, create-scene 459.

## 6. Toolsets (`perf-schema-toolsets.mjs`)

| toolset | tools incl. `world` | chars | ~tokens | % of full | own tools | own chars |
|---|---|---|---|---|---|---|
| world (always on) | 8 | 10,645 | 2,957 | 3.7% | 8 | 10,645 (configure-dnd5e-settings 4,570 + manage-calendar ≈ 1,970 = 61% of it) |
| actors | 39 | 120,724 | 33,534 | **42.5%** | 31 | 110,079 (mean 3,551/tool) |
| scenes | 52 | 93,690 | 26,025 | **33.0%** | 44 | 83,045 |
| journals | 19 | 25,520 | 7,089 | 9.0% | 11 | 14,875 |
| compendium | 15 | 22,554 | 6,265 | 7.9% | 7 | 11,909 |
| assets | 20 | 20,180 | 5,606 | 7.1% | 12 | 9,535 |
| tables | 15 | 19,614 | 5,448 | 6.9% | 7 | 8,969 |
| chat | 14 | 19,331 | 5,370 | 6.8% | 6 | 8,686 |
| organization | 17 | 19,207 | 5,335 | 6.8% | 9 | 8,562 |
| audio | 13 | 17,993 | 4,998 | 6.3% | 5 | 7,348 |
| items | 13 | 14,929 | 4,147 | 5.3% | 5 | 4,284 |
| combat | 10 | 13,973 | 3,881 | 4.9% | 2 | 3,328 |
| cards | 12 | 13,328 | 3,702 | 4.7% | 4 | 2,683 |

Combos a skill actually needs: `actors,compendium` (stat-block-builder) 132,633 (46.7%);
`actors,compendium,items` 136,917 (48.2%); `scenes,assets,audio` (scene-builder) 110,573 (38.9%);
`journals,tables,cards` 37,172 (13.1%); `chat,combat` 22,659 (8.0%, matches the brief). Toolsets pay off
for narrators and file-managers; the two authoring skills still load 39–48% of the surface.

**Names (Claude Code, deferred schemas):** one registration = 151 names, 5,498 chars prefixed
(`mcp__foundry-local5e__<name>`) ≈ 1.5k tokens; two registrations = 302 names, 11,749 chars ≈ 3.3k
tokens in every prompt. `list/create/update/delete-*` names are 82 of 151 and **53.1%** of the name
list (3,082 of 5,798 chars). This — not schema bytes — is where CRUD consolidation pays in Claude Code
(and per-toolset registrations pay the same way: `scenes` is 1,641 name-chars, `actors` 1,196).

## 7. Molten residue seen in passing

- `dist/tools/molten/{dav-access,index,webdav}.js` (2026-09-19) still exist; `src/tools/molten/` is gone
  and `tsc` does not clean `dist/` (`package.json` build = `tsc && node esbuild.page.mjs`). Nothing
  references it (`grep -rn "tools/molten" src scripts tests` → one comment).
- `src/tools/asset-bridge.ts:8`: "Unlike the WebDAV file tools in tools/molten…" — stale comment.

## Could not verify

- That every MCP client (Claude Desktop, claude.ai, Claude Code's tool loader, third-party clients)
  resolves `$ref`/`$defs` inside `inputSchema`.
- End-to-end acceptance of `$defs`/`$ref` by the Anthropic API in a non-strict tool `input_schema`
  (the bundled reference says supported; not exercised live).
- Token figures are chars/3.6, not `count_tokens`.
- The exact per-prompt string Claude Code emits for deferred MCP names (measured as the
  `mcp__<registration>__<name>` form this session's deferred list shows).
- The brief's "70 tools / 17 families" taxonomy vs the regex-based 82 / 31 grouping here.
