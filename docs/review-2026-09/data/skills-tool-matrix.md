# Skill × tool matrix — 2026-09-20 (skills dimension)

Source: `scratch/skills-matrix.mjs` over `.claude/skills/*/**` (SKILL.md + bundled scripts) and `dist/toolsets.js` (151 tools). A tool counts when its exact hyphenated name appears as a word.

## Summary

- Registered tools: 151
- Distinct tools named by at least one skill (SKILL.md or bundled script): 100
- Distinct tools named in SKILL.md text only: 100
- Tools no skill names: 51

## Skill → tools

| skill | distinct tools | tools |
|---|---|---|
| bestiary-builder | 5 | create-journal, list-journals, set-journal-page-visibility, update-journal, upload-asset |
| cards-builder | 5 | create-cards, delete-cards, import-cards, list-cards, upload-asset |
| chat-and-narration | 6 | delete-chat-messages, export-chat-log, list-chat-messages, post-item-card, request-roll, send-chat-message |
| journal-builder | 8 | add-journal-image, create-journal, create-quest-journal, link-quest-to-npc, list-journals, search-journals, update-journal, update-quest-journal |
| pc-builder | 17 | add-feature, add-free-cast, create-pc, create-pc-from-prefab, get-actor, get-actor-entity, get-compendium-entry, import-item, inspect-pc-advancement, level-up-pc, move-documents, search-compendium, search-compendium-spells, set-actor-art, set-actor-ownership, update-actor, update-actor-item |
| physical-item-builder | 16 | add-feature, add-item, content-audit, create-item, get-actor, get-actor-entity, get-compendium-entry, import-item, manage-activity, manage-effect, search-compendium, search-compendium-items, search-compendium-spells, update-actor, update-actor-item, update-item |
| playlist-builder | 8 | create-playlist, create-sounds, delete-playlist, list-assets, list-playlists, update-playlist, update-scene, upload-asset |
| plot-drift-check | 22 | create-journal, get-actor, get-item, get-rolltable, list-actors, list-folders, list-items, list-journals, list-notes, list-playlists, list-rolltables, list-scenes, list-tokens, search-actor-contents, search-journals, set-journal-page-visibility, update-actor, update-actor-item, update-item, update-journal, update-rolltable, update-token |
| scene-builder | 20 | add-region-behavior, create-region, create-scene, create-teleporter, delete-region, get-scene-dimensions, list-assets, list-journals, list-lights, list-playlists, list-regions, list-scenes, list-tiles, list-walls, manage-effect, remap-teleporters, search-journals, update-region, update-scene, upload-asset |
| session-audit | 13 | configure-dnd5e-settings, create-journal, get-actor, get-actor-entity, get-compendium-entry, get-group, get-world-info, list-journals, list-scenes, list-tokens, manage-calendar, screenshot-scene, update-token |
| session-scribe | 6 | export-actor, export-chat-log, get-actor, get-combat-stats, level-up-pc, update-journal |
| soundscape-builder | 8 | configure-soundscape, create-sounds, get-current-scene, list-assets, list-scenes, list-tokens, screenshot-scene, upload-asset |
| start-session | 3 | configure-dnd5e-settings, get-world-info, manage-calendar |
| stat-block-builder | 22 | add-feature, add-item, apply-condition, author-npc, content-audit, create-actor-from-compendium, get-actor, get-actor-entity, get-compendium-entry, import-item, manage-activity, manage-effect, move-documents, remove-from-actor, search-compendium, search-compendium-creatures, search-compendium-items, search-compendium-spells, set-actor-art, set-actor-ownership, update-actor, update-actor-item |
| table-builder | 12 | create-rolltable, delete-rolltable, get-compendium-entry, get-rolltable, import-item, import-rolltable, list-compendium-packs, list-rolltables, roll-on-table, search-compendium-creatures, search-compendium-items, update-rolltable |
| token-cutout | 9 | export-actor, get-actor, get-world-info, list-actors, list-tokens, set-actor-art, update-actor, update-token, upload-asset |
| tom-cartos-import | 16 | add-journal-image, create-folder, create-journal, create-scene, create-scene-notes, delete-note, get-scene-dimensions, list-journals, list-scenes, move-documents, read-pack, remap-teleporters, screenshot-scene, update-note, upload-asset, upload-asset-tree |

### Shorthand forms found in SKILL.md (not counted above)

- journal-builder: search-compendium-*
- pc-builder: search-compendium-*
- plot-drift-check: list-scenes/-folders/-notes/-items · list/get-rolltable
- session-audit: list-scenes/-tokens

## Tool → skills

| tool | toolset | #skills | skills |
|---|---|---|---|
| get-world-info | world | 3 | session-audit, start-session, token-cutout |
| get-current-scene | world | 1 | soundscape-builder |
| disconnect-bridge | world | 0 |  |
| list-users | world | 0 |  |
| update-user | world | 0 |  |
| set-user-avatar | world | 0 |  |
| configure-dnd5e-settings | world | 2 | session-audit, start-session |
| manage-calendar | world | 2 | session-audit, start-session |
| get-actor | actors | 7 | pc-builder, physical-item-builder, plot-drift-check, session-audit, session-scribe, stat-block-builder, token-cutout |
| export-actor | actors | 2 | session-scribe, token-cutout |
| list-actors | actors | 2 | plot-drift-check, token-cutout |
| get-actor-entity | actors | 4 | pc-builder, physical-item-builder, session-audit, stat-block-builder |
| search-actor-contents | actors | 1 | plot-drift-check |
| create-actor-from-compendium | actors | 1 | stat-block-builder |
| author-npc | actors | 1 | stat-block-builder |
| create-pc | actors | 1 | pc-builder |
| inspect-pc-advancement | actors | 1 | pc-builder |
| level-up-pc | actors | 2 | pc-builder, session-scribe |
| create-pc-from-prefab | actors | 1 | pc-builder |
| duplicate-actor | actors | 0 |  |
| delete-actor | actors | 0 |  |
| update-actor | actors | 5 | pc-builder, physical-item-builder, plot-drift-check, stat-block-builder, token-cutout |
| update-actor-item | actors | 4 | pc-builder, physical-item-builder, plot-drift-check, stat-block-builder |
| manage-activity | actors | 2 | physical-item-builder, stat-block-builder |
| add-free-cast | actors | 1 | pc-builder |
| manage-effect | actors | 3 | physical-item-builder, scene-builder, stat-block-builder |
| apply-condition | actors | 1 | stat-block-builder |
| add-item | actors | 2 | physical-item-builder, stat-block-builder |
| import-item | actors | 4 | pc-builder, physical-item-builder, stat-block-builder, table-builder |
| content-audit | actors | 2 | physical-item-builder, stat-block-builder |
| add-feature | actors | 3 | pc-builder, physical-item-builder, stat-block-builder |
| remove-from-actor | actors | 1 | stat-block-builder |
| create-group | actors | 0 |  |
| manage-group-members | actors | 0 |  |
| get-group | actors | 1 | session-audit |
| set-primary-party | actors | 0 |  |
| set-actor-ownership | actors | 2 | pc-builder, stat-block-builder |
| list-actor-ownership | actors | 0 |  |
| set-actor-art | actors | 3 | pc-builder, stat-block-builder, token-cutout |
| create-item | items | 1 | physical-item-builder |
| list-items | items | 1 | plot-drift-check |
| get-item | items | 1 | plot-drift-check |
| update-item | items | 2 | physical-item-builder, plot-drift-check |
| delete-item | items | 0 |  |
| search-compendium | compendium | 3 | pc-builder, physical-item-builder, stat-block-builder |
| get-compendium-entry | compendium | 5 | pc-builder, physical-item-builder, session-audit, stat-block-builder, table-builder |
| search-compendium-creatures | compendium | 2 | stat-block-builder, table-builder |
| search-compendium-spells | compendium | 3 | pc-builder, physical-item-builder, stat-block-builder |
| search-compendium-items | compendium | 3 | physical-item-builder, stat-block-builder, table-builder |
| list-compendium-packs | compendium | 1 | table-builder |
| read-pack | compendium | 1 | tom-cartos-import |
| create-scene | scenes | 2 | scene-builder, tom-cartos-import |
| list-scenes | scenes | 5 | plot-drift-check, scene-builder, session-audit, soundscape-builder, tom-cartos-import |
| update-scene | scenes | 2 | playlist-builder, scene-builder |
| activate-scene | scenes | 0 |  |
| pull-users-to-scene | scenes | 0 |  |
| set-landing-scene | scenes | 0 |  |
| delete-scene | scenes | 0 |  |
| get-scene-dimensions | scenes | 2 | scene-builder, tom-cartos-import |
| screenshot-scene | scenes | 3 | session-audit, soundscape-builder, tom-cartos-import |
| create-tiles | scenes | 0 |  |
| list-tiles | scenes | 1 | scene-builder |
| update-tiles | scenes | 0 |  |
| delete-tiles | scenes | 0 |  |
| create-lights | scenes | 0 |  |
| list-lights | scenes | 1 | scene-builder |
| update-lights | scenes | 0 |  |
| delete-lights | scenes | 0 |  |
| create-sounds | scenes | 2 | playlist-builder, soundscape-builder |
| list-sounds | scenes | 0 |  |
| update-sounds | scenes | 0 |  |
| delete-sounds | scenes | 0 |  |
| create-drawings | scenes | 0 |  |
| list-drawings | scenes | 0 |  |
| update-drawings | scenes | 0 |  |
| delete-drawings | scenes | 0 |  |
| create-walls | scenes | 0 |  |
| list-walls | scenes | 1 | scene-builder |
| update-walls | scenes | 0 |  |
| delete-walls | scenes | 0 |  |
| list-tokens | scenes | 4 | plot-drift-check, session-audit, soundscape-builder, token-cutout |
| place-tokens | scenes | 0 |  |
| update-token | scenes | 3 | plot-drift-check, session-audit, token-cutout |
| delete-tokens | scenes | 0 |  |
| create-scene-notes | scenes | 1 | tom-cartos-import |
| list-notes | scenes | 1 | plot-drift-check |
| update-note | scenes | 1 | tom-cartos-import |
| delete-note | scenes | 1 | tom-cartos-import |
| create-region | scenes | 1 | scene-builder |
| list-regions | scenes | 1 | scene-builder |
| update-region | scenes | 1 | scene-builder |
| delete-region | scenes | 1 | scene-builder |
| create-teleporter | scenes | 1 | scene-builder |
| add-region-behavior | scenes | 1 | scene-builder |
| remap-teleporters | scenes | 2 | scene-builder, tom-cartos-import |
| create-quest-journal | journals | 1 | journal-builder |
| link-quest-to-npc | journals | 1 | journal-builder |
| update-quest-journal | journals | 1 | journal-builder |
| list-journals | journals | 6 | bestiary-builder, journal-builder, plot-drift-check, scene-builder, session-audit, tom-cartos-import |
| search-journals | journals | 3 | journal-builder, plot-drift-check, scene-builder |
| create-journal | journals | 5 | bestiary-builder, journal-builder, plot-drift-check, session-audit, tom-cartos-import |
| update-journal | journals | 4 | bestiary-builder, journal-builder, plot-drift-check, session-scribe |
| set-journal-page-visibility | journals | 2 | bestiary-builder, plot-drift-check |
| delete-journal-page | journals | 0 |  |
| delete-journal | journals | 0 |  |
| add-journal-image | journals | 2 | journal-builder, tom-cartos-import |
| create-rolltable | tables | 1 | table-builder |
| import-rolltable | tables | 1 | table-builder |
| list-rolltables | tables | 2 | plot-drift-check, table-builder |
| update-rolltable | tables | 2 | plot-drift-check, table-builder |
| roll-on-table | tables | 1 | table-builder |
| get-rolltable | tables | 2 | plot-drift-check, table-builder |
| delete-rolltable | tables | 1 | table-builder |
| create-cards | cards | 1 | cards-builder |
| import-cards | cards | 1 | cards-builder |
| list-cards | cards | 1 | cards-builder |
| delete-cards | cards | 1 | cards-builder |
| create-playlist | audio | 1 | playlist-builder |
| list-playlists | audio | 3 | playlist-builder, plot-drift-check, scene-builder |
| update-playlist | audio | 1 | playlist-builder |
| delete-playlist | audio | 1 | playlist-builder |
| configure-soundscape | audio | 1 | soundscape-builder |
| send-chat-message | chat | 1 | chat-and-narration |
| list-chat-messages | chat | 1 | chat-and-narration |
| delete-chat-messages | chat | 1 | chat-and-narration |
| export-chat-log | chat | 2 | chat-and-narration, session-scribe |
| post-item-card | chat | 1 | chat-and-narration |
| request-roll | chat | 1 | chat-and-narration |
| configure-combat-tracker | combat | 0 |  |
| get-combat-stats | combat | 1 | session-scribe |
| list-assets | assets | 3 | playlist-builder, scene-builder, soundscape-builder |
| asset-info | assets | 0 |  |
| download-asset | assets | 0 |  |
| upload-asset | assets | 7 | bestiary-builder, cards-builder, playlist-builder, scene-builder, soundscape-builder, token-cutout, tom-cartos-import |
| upload-asset-tree | assets | 1 | tom-cartos-import |
| create-asset-folder | assets | 0 |  |
| delete-asset | assets | 0 |  |
| move-asset | assets | 0 |  |
| copy-asset | assets | 0 |  |
| asset-url | assets | 0 |  |
| find-asset-references | assets | 0 |  |
| relink-asset | assets | 0 |  |
| list-folders | organization | 1 | plot-drift-check |
| create-folder | organization | 1 | tom-cartos-import |
| update-folder | organization | 0 |  |
| delete-folder | organization | 0 |  |
| move-documents | organization | 3 | pc-builder, stat-block-builder, tom-cartos-import |
| bulk-delete | organization | 0 |  |
| create-macro | organization | 0 |  |
| list-macros | organization | 0 |  |
| delete-macro | organization | 0 |  |

## Tools no skill names (51)

- **world** (4): disconnect-bridge, list-users, update-user, set-user-avatar
- **actors** (6): duplicate-actor, delete-actor, create-group, manage-group-members, set-primary-party, list-actor-ownership
- **items** (1): delete-item
- **scenes** (22): activate-scene, pull-users-to-scene, set-landing-scene, delete-scene, create-tiles, update-tiles, delete-tiles, create-lights, update-lights, delete-lights, list-sounds, update-sounds, delete-sounds, create-drawings, list-drawings, update-drawings, delete-drawings, create-walls, update-walls, delete-walls, place-tokens, delete-tokens
- **journals** (2): delete-journal-page, delete-journal
- **combat** (1): configure-combat-tracker
- **assets** (9): asset-info, download-asset, create-asset-folder, delete-asset, move-asset, copy-asset, asset-url, find-asset-references, relink-asset
- **organization** (6): update-folder, delete-folder, bulk-delete, create-macro, list-macros, delete-macro

## 3.0 re-point checklist — the 17 CRUD families

| family | tool | skills naming it |
|---|---|---|
| tiles | create-tiles | — |
| tiles | list-tiles | scene-builder |
| tiles | update-tiles | — |
| tiles | delete-tiles | — |
| lights | create-lights | — |
| lights | list-lights | scene-builder |
| lights | update-lights | — |
| lights | delete-lights | — |
| sounds | create-sounds | playlist-builder, soundscape-builder |
| sounds | list-sounds | — |
| sounds | update-sounds | — |
| sounds | delete-sounds | — |
| drawings | create-drawings | — |
| drawings | list-drawings | — |
| drawings | update-drawings | — |
| drawings | delete-drawings | — |
| walls | create-walls | — |
| walls | list-walls | scene-builder |
| walls | update-walls | — |
| walls | delete-walls | — |
| tokens | list-tokens | plot-drift-check, session-audit, soundscape-builder, token-cutout |
| tokens | place-tokens | — |
| tokens | update-token | plot-drift-check, session-audit, token-cutout |
| tokens | delete-tokens | — |
| notes | create-scene-notes | tom-cartos-import |
| notes | list-notes | plot-drift-check |
| notes | update-note | tom-cartos-import |
| notes | delete-note | tom-cartos-import |
| regions | create-region | scene-builder |
| regions | list-regions | scene-builder |
| regions | update-region | scene-builder |
| regions | delete-region | scene-builder |
| regions | create-teleporter | scene-builder |
| regions | add-region-behavior | scene-builder |
| regions | remap-teleporters | scene-builder, tom-cartos-import |
| items | create-item | physical-item-builder |
| items | list-items | plot-drift-check |
| items | get-item | plot-drift-check |
| items | update-item | physical-item-builder, plot-drift-check |
| items | delete-item | — |
| items | import-item | pc-builder, physical-item-builder, stat-block-builder, table-builder |
| tables | create-rolltable | table-builder |
| tables | import-rolltable | table-builder |
| tables | list-rolltables | plot-drift-check, table-builder |
| tables | update-rolltable | plot-drift-check, table-builder |
| tables | get-rolltable | plot-drift-check, table-builder |
| tables | delete-rolltable | table-builder |
| journals | create-journal | bestiary-builder, journal-builder, plot-drift-check, session-audit, tom-cartos-import |
| journals | update-journal | bestiary-builder, journal-builder, plot-drift-check, session-scribe |
| journals | list-journals | bestiary-builder, journal-builder, plot-drift-check, scene-builder, session-audit, tom-cartos-import |
| journals | delete-journal | — |
| journals | delete-journal-page | — |
| actors | list-actors | plot-drift-check, token-cutout |
| actors | get-actor | pc-builder, physical-item-builder, plot-drift-check, session-audit, session-scribe, stat-block-builder, token-cutout |
| actors | update-actor | pc-builder, physical-item-builder, plot-drift-check, stat-block-builder, token-cutout |
| actors | delete-actor | — |
| folders | list-folders | plot-drift-check |
| folders | create-folder | tom-cartos-import |
| folders | update-folder | — |
| folders | delete-folder | — |
| scenes | create-scene | scene-builder, tom-cartos-import |
| scenes | list-scenes | plot-drift-check, scene-builder, session-audit, soundscape-builder, tom-cartos-import |
| scenes | update-scene | playlist-builder, scene-builder |
| scenes | delete-scene | — |
| playlists | create-playlist | playlist-builder |
| playlists | list-playlists | playlist-builder, plot-drift-check, scene-builder |
| playlists | update-playlist | playlist-builder |
| playlists | delete-playlist | playlist-builder |
| cards | create-cards | cards-builder |
| cards | import-cards | cards-builder |
| cards | list-cards | cards-builder |
| cards | delete-cards | cards-builder |
| macros | create-macro | — |
| macros | list-macros | — |
| macros | delete-macro | — |

### Family → skills (union)

| family | skills that name any tool in the family | tools in family unnamed by any skill |
|---|---|---|
| tiles | scene-builder | create-tiles, update-tiles, delete-tiles |
| lights | scene-builder | create-lights, update-lights, delete-lights |
| sounds | playlist-builder, soundscape-builder | list-sounds, update-sounds, delete-sounds |
| drawings | — | create-drawings, list-drawings, update-drawings, delete-drawings |
| walls | scene-builder | create-walls, update-walls, delete-walls |
| tokens | plot-drift-check, session-audit, soundscape-builder, token-cutout | place-tokens, delete-tokens |
| notes | tom-cartos-import, plot-drift-check | — |
| regions | scene-builder, tom-cartos-import | — |
| items | physical-item-builder, plot-drift-check, pc-builder, stat-block-builder, table-builder | delete-item |
| tables | table-builder, plot-drift-check | — |
| journals | bestiary-builder, journal-builder, plot-drift-check, session-audit, tom-cartos-import, session-scribe, scene-builder | delete-journal, delete-journal-page |
| actors | plot-drift-check, token-cutout, pc-builder, physical-item-builder, session-audit, session-scribe, stat-block-builder | delete-actor |
| folders | plot-drift-check, tom-cartos-import | update-folder, delete-folder |
| scenes | scene-builder, tom-cartos-import, plot-drift-check, session-audit, soundscape-builder, playlist-builder | delete-scene |
| playlists | playlist-builder, plot-drift-check, scene-builder | — |
| cards | cards-builder | — |
| macros | — | create-macro, list-macros, delete-macro |

## Front-matter description sizes (chars, folded)

| skill | description chars | body chars |
|---|---|---|
| pc-builder | 1317 | 23244 |
| session-audit | 1153 | 13915 |
| tom-cartos-import | 1057 | 20722 |
| physical-item-builder | 1036 | 16094 |
| playlist-builder | 1011 | 6076 |
| stat-block-builder | 992 | 28330 |
| soundscape-builder | 960 | 22052 |
| session-scribe | 957 | 19917 |
| journal-builder | 886 | 8922 |
| table-builder | 885 | 8834 |
| plot-drift-check | 882 | 5807 |
| bestiary-builder | 837 | 5456 |
| cards-builder | 780 | 4654 |
| scene-builder | 759 | 16019 |
| chat-and-narration | 716 | 5054 |
| start-session | 579 | 4580 |
| token-cutout | 575 | 3270 |
| **total** | **15382** | **212946** |
