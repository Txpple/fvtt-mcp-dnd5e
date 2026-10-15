/**
 * Registration ↔ dispatch integrity.
 *
 * The tool surface is built by buildToolRegistry (src/registry.ts): the `handlers` map is the
 * single source of truth and the advertised `tools` list is DERIVED from it, so a tool can no
 * longer be advertised-but-not-dispatched. This test imports the real builder (no source scraping)
 * and asserts the surface is complete, consistent, and the documented size. buildToolRegistry
 * itself throws at build time if a handler has no advertised definition, so a successful build is
 * already part of the guarantee.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReceiptOp } from '../page/_receipts.js';
import { NOTHING_PUT_BACK, noteOps, receiptLineOf } from '../receipts.js';
import { buildToolRegistry } from '../registry.js';
import { clearSystemCache } from '../utils/system-detection.js';
import { makeFoundry, makeLogger } from './test-helpers.js';
import { TOOLSETS, TOOLSET_NAMES, parseToolsetsEnv } from '../toolsets.js';
import { NO_RECEIPT, TOOL_KINDS, type ToolKind, toolKind } from '../tool-kinds.js';
import { opKind } from '../page/_ops.js';
import { createHost, resolveHostConfig } from '../hosts/index.js';

/** A generic host (no wake, no file plane) — enough for the registry to wire every tool. */
const host = createHost(resolveHostConfig({}, 'generic'), makeLogger());

function build() {
  const { foundry } = makeFoundry();
  return buildToolRegistry({ foundry, logger: makeLogger(), host });
}

// Recursively flag the JSON-Schema constructs that are valid in draft-7 but invalid under draft
// 2020-12 — the dialect the Anthropic API enforces on tool input_schema. zod's generator can only
// realistically emit these via `z.tuple(...)`: the draft-7 tuple uses an `items` ARRAY plus
// `additionalItems`, whereas 2020-12 uses `prefixItems` (and folds `additionalItems` into `items`).
// Returns a list of `path: reason` strings; empty means the schema is 2020-12-clean.
function draft2020Violations(node: unknown, path: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => draft2020Violations(child, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const here: string[] = [];
    if (Array.isArray(obj.items)) {
      here.push(`${path}.items: array (draft-7 tuple form; 2020-12 uses prefixItems)`);
    }
    if ('additionalItems' in obj) {
      here.push(`${path}.additionalItems: present (removed in 2020-12)`);
    }
    return here.concat(
      Object.entries(obj).flatMap(([k, v]) => draft2020Violations(v, `${path}.${k}`))
    );
  }
  return [];
}

describe('tool registry', () => {
  it('advertises 117 uniquely-named tools (matches the documented surface)', () => {
    const { tools } = build();
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); // no duplicate names
    // 115 as of the tiles/lights focus set, + the placeable-library completion (14):
    // + create/list/update/delete-sounds (AmbientSound CRUD)
    // + create/list/update/delete-drawings (Drawing CRUD)
    // + create/list/update/delete-walls (Wall CRUD — doors/sight edit loop)
    // + place-tokens + delete-tokens (placed-token lifecycle; update-token stays bespoke)
    // + list-folders (the folder-tree read/inspect step the write tools were missing; since M8
    //   the folders are the actions of ONE tool, manage-folders)
    // + list-users + update-user (user-account admin: roster read + role/name/color/character)
    // + add-free-cast (feature-granted free cast → cast activity ON the feature + repertoire copy;
    //   projects the native "Additional Spells" spellbook entry)
    // (update-world was built and DROPPED 2026-07-06: /setup editWorld needs a role-4 bridge
    //  user and Claude deliberately stays ASSISTANT — see src/page/world.ts header.)
    // + create-macro / list-macros / delete-macro (world Macro documents + user hotbar pins —
    //   hand a player a one-click button, e.g. a weapon-mastery Graze roll; since M8 the three
    //   are the actions of ONE tool, manage-macros)
    // + configure-combat-tracker (core.combatTrackerConfig: custom turn marker / resource /
    //   skip-defeated — the first game-SETTING writer, deliberately one typed tool per setting;
    //   settings are NOT the dropped update-world metadata)
    // + add-region-behavior (wire a behavior onto an EXISTING region — the create-region/
    //   update-region gap; teleportTo resolves the destination UUID and warns on off-grid landing
    //   pads, the silent teleport no-op found live 2026-07-08)
    // + create-group / manage-group-members / get-group / set-primary-party (dnd5e group
    //   actors — the shared party stash; membership via system.addMember/removeMember, the
    //   group-shaped read, and the dnd5e primaryParty world setting, one typed tool per setting)
    // + disconnect-bridge (bridge-lifecycle courtesy logout: dispose the Playwright session so the
    //   bridge user goes inactive; the next tool call reconnects lazily — "log out please"
    //   no longer requires exiting Claude Code)
    // + duplicate-actor (clone existing WORLD actors: toObject → rename → folder → ownership →
    //   Actor.create — the "(Sim)" sandbox path; full sheets stay rollable)
    // + activate-scene + pull-users-to-scene (the two halves of "who is looking at what":
    //   the ONE world-wide active flag, which update-scene deliberately never touches, and
    //   Scene#pullUsers for moving only SOME users — the party-split path)
    // + set-landing-scene (where a user comes up at LOGIN — core has no per-user landing scene
    //   at all, so this writes a durable User flag the house module fvtt-mod-openserver acts
    //   on at ready; the OFFLINE counterpart to pull-users-to-scene)
    // + configure-area-sounds (per-scene sound sets for house module fvtt-mod-areasounds: a POOL of
    //   files played at randomized intervals with silence between, or crossfaded into a seamless
    //   bed — the shape neither AmbientSound placeables nor Playlists can express)
    // (parse-ddb-character was built and REMOVED 2026-08-17: DDB exports strip the embedded
    //  ActiveEffects the premium items carry, so imported PCs pass review and silently lose their
    //  automation at the table — the Divine Favor incident. Standing policy: refuse DDB imports
    //  and build the PC natively from the premium compendia instead — see design.md §7.)
    // + get-combat-stats (2026-08-27: per-combat analytics folded from Battle Flow's stat
    //   stamps — damage/healing/flips/spend economy/Bless margins; read-only, GM-facing,
    //   filtered at call time. The stamps are an external wire format (By the Books, Battle
    //   Flow until 3.0.0: its ARCH §4),
    //   never a code dependency.) − 1 (4.0.0, 2026-09-23): moved to fvtt-mcp-sessionscribe as
    //   analyze-combat, at parity on the sandbox first (owner's ruling; design.md §4).
    // + configure-dnd5e-settings (dnd5e 6.0 automation switches — allow-listed read + set, the
    //   owner's 2026-09-15 decision) + manage-calendar (read / advance / set the in-world date)
    // − 15 (M8, 2026-09-21): the tiles / lights / walls / drawings CRUD (16 tools) became the
    //   kind × action members of ONE tool, manage-placeables (src/tools/_union.ts); the other
    //   placeable kinds joined it in their own family commits — sounds (−4), notes (−4),
    //   tokens (−4), regions (−7 incl. the teleporter / behavior / remap specials): 35 → 1.
    // − 2 (M8): create-macro / list-macros / delete-macro → manage-macros (action).
    // − 3 (M8): list / create / update / delete-folder → manage-folders (action).
    // − 3 (M8): create / list / update / delete-playlist → manage-playlists (action).
    // − 3 (M8): create / import / list / delete-cards → manage-cards (action).
    // − 5 (M8): create / import / list / get / update / delete-rolltable → manage-rolltables
    //   (action); roll-on-table stays (a play op, not CRUD).
    // − 5 (M8): create / list / get / update / delete-item + import-item → manage-items (action);
    //   remove-from-actor stays (an actor-side op).
    // − 4 (M8): create / update / list / delete-journal + delete-journal-page → manage-journals
    //   (action; list-journals' journalId / pageId modes are its `get`).
    // − 3 (M8): create / list / update / delete-scene → manage-scenes (action).
    // − 3 (M8): list / get / update / delete-actor → manage-actors (action).
    // − 3 (M8): search-compendium-creatures / -spells / -items → search-compendium (type).
    // − 2 (M8): get-actor-entity / export-actor → manage-actors get-entity / export.
    expect(names.length).toBe(81);
  });

  it('registers configure-dnd5e-settings (the allow-listed dnd5e 6.0 automation switches)', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name)).toContain('configure-dnd5e-settings');
    expect(typeof handlers['configure-dnd5e-settings']).toBe('function');
  });

  it('registers manage-calendar (the in-world date/time over v14 game.time)', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name)).toContain('manage-calendar');
    expect(typeof handlers['manage-calendar']).toBe('function');
  });

  it('registers read-pack (the Node-only scene-pack module reader, tom-cartos-import M1)', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name)).toContain('read-pack');
    expect(typeof handlers['read-pack']).toBe('function');
  });

  it('registers the legend→pins pipeline (get-scene-dimensions + the notes kind of manage-placeables, tom-cartos-import M4 / M6)', async () => {
    const { tools, handlers, dispatch } = build();
    const names = new Set(tools.map(t => t.name));
    expect(names.has('get-scene-dimensions')).toBe(true);
    expect(typeof handlers['get-scene-dimensions']).toBe('function');
    // the pins ride the union: create / list / update / delete of kind "notes"
    const union = tools.find(t => t.name === 'manage-placeables')!.inputSchema;
    expect(union.properties.kind.enum).toContain('notes');
    await expect(
      dispatch('manage-placeables', {
        kind: 'notes',
        action: 'update',
        notePatches: [{ id: 'n1' }],
      })
    ).rejects.toThrow('Provide at least one field to change besides id');
  });

  it('registers disconnect-bridge and dispatches it to the seam lifecycle, not foundry.call', async () => {
    const { foundry, calls } = makeFoundry();
    const { tools, handlers, dispatch } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
    });
    expect(tools.map(t => t.name)).toContain('disconnect-bridge');
    expect(typeof handlers['disconnect-bridge']).toBe('function');

    const result = await dispatch('disconnect-bridge', {});
    expect(foundry.dispose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]); // a page call would reconnect the session being closed
    expect(result).toContain('Disconnected');
  });

  it('registers screenshot-scene (headless canvas capture for visual QA)', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name)).toContain('screenshot-scene');
    expect(typeof handlers['screenshot-scene']).toBe('function');
  });

  it('registers the region authoring + the teleporter specials as the regions kind of manage-placeables (tom-cartos-import M3)', async () => {
    const { tools, dispatch } = build();
    const union = tools.find(t => t.name === 'manage-placeables')!.inputSchema;
    const regionActions = union.anyOf
      .filter((m: any) => m.properties.kind.const === 'regions')
      .map((m: any) => m.properties.action.const);
    expect(regionActions).toEqual([
      'create',
      'list',
      'update',
      'delete',
      'create-teleporter',
      'add-behavior',
      'remap-teleporters',
    ]);
    // a special carries its own target: remap takes sourceModule and nothing else
    await expect(
      dispatch('manage-placeables', {
        kind: 'regions',
        action: 'remap-teleporters',
        sceneIdentifier: 'x',
      })
    ).rejects.toThrow(
      'manage-placeables (kind "regions", action "remap-teleporters"): unknown argument "sceneIdentifier" — it takes: kind, action, sourceModule.'
    );
  });

  it('registers the placeable tools over the kernel: manage-placeables (kind × action) + the pre-M8 kinds', () => {
    const { tools, handlers } = build();
    const names = new Set(tools.map(t => t.name));
    for (const name of ['manage-placeables']) {
      expect(names.has(name)).toBe(true);
      expect(typeof handlers[name]).toBe('function');
    }
    // the consolidated kinds no longer advertise a per-op tool
    for (const kind of [
      'tiles',
      'lights',
      'walls',
      'drawings',
      'sounds',
      'notes',
      'tokens',
      'regions',
    ]) {
      for (const verb of ['create', 'list', 'update', 'delete']) {
        expect(names.has(`${verb}-${kind}`), `${verb}-${kind}`).toBe(false);
      }
    }
    const union = tools.find(t => t.name === 'manage-placeables')!.inputSchema;
    expect(union.type).toBe('object');
    expect(union.properties.kind.enum).toEqual([
      'tiles',
      'lights',
      'walls',
      'drawings',
      'sounds',
      'notes',
      'tokens',
      'regions',
    ]);
    expect(union.properties.action.enum).toEqual([
      'create',
      'list',
      'update',
      'delete',
      'create-teleporter',
      'add-behavior',
      'remap-teleporters',
    ]);
    expect(union.anyOf).toHaveLength(35);
  });

  it('registers the journal page-visibility tool + manage-journals + manage-folders (dogfood tooling gaps)', () => {
    const { tools, handlers } = build();
    const names = new Set(tools.map(t => t.name));
    for (const name of ['set-journal-page-visibility', 'manage-journals', 'manage-folders']) {
      expect(names.has(name)).toBe(true);
      expect(typeof handlers[name]).toBe('function');
    }
  });

  it('advertises the actor-creation split and fully retires the create-actor alias', () => {
    const { tools } = build();
    const names = new Set(tools.map(t => t.name));
    expect(names.has('create-actor-from-compendium')).toBe(true);
    expect(names.has('author-npc')).toBe(true);
    expect(names.has('create-actor')).toBe(false); // deprecated alias removed
  });

  it('advertises the PC-authoring tools (siblings to author-npc, design.md §7)', () => {
    const { tools } = build();
    const names = new Set(tools.map(t => t.name));
    expect(names.has('create-pc')).toBe(true);
    expect(names.has('inspect-pc-advancement')).toBe(true);
    expect(names.has('level-up-pc')).toBe(true);
    expect(names.has('create-pc-from-prefab')).toBe(true);
    // create-pc's `choices` map is a nested z.record (level → adv-id → data), NOT a zod tuple —
    // the 2020-12-validity sweep above guards it, but pin the advertised shape too.
    const createPc = tools.find(t => t.name === 'create-pc') as any;
    expect(createPc.inputSchema.type).toBe('object');
    expect(createPc.inputSchema.required).toEqual(['name', 'className']);
    expect(Object.keys(createPc.inputSchema.properties)).toContain('choices');
  });

  it('registers duplicate-actor and dispatches it to the duplicateActor page op', async () => {
    const { foundry, calls } = makeFoundry({
      success: true,
      totalCreated: 1,
      totalRequested: 1,
      actors: [{ id: 'c1', name: 'Gren (Sim)', sourceId: 'a1', sourceName: 'Gren' }],
    });
    const { tools, handlers, dispatch } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
    });
    expect(tools.map(t => t.name)).toContain('duplicate-actor');
    expect(typeof handlers['duplicate-actor']).toBe('function');

    await dispatch('duplicate-actor', { actorIdentifiers: ['Gren'], suffix: ' (Sim)' });
    expect(calls.some(([op]) => op === 'duplicateActor')).toBe(true);
  });

  it('advertises the actor-editing tools by name', () => {
    const { tools } = build();
    const names = new Set(tools.map(t => t.name));
    expect(names.has('manage-actors')).toBe(true);
    expect(names.has('update-actor-item')).toBe(true);
    expect(names.has('manage-activity')).toBe(true);
    expect(names.has('manage-effect')).toBe(true);
    expect(names.has('apply-condition')).toBe(true);
    expect(names.has('add-item')).toBe(true);
    expect(names.has('manage-items')).toBe(true);
  });

  it('advertises the unified actor-authoring tool as add-feature (renamed from grant-to-actor)', () => {
    const { tools } = build();
    const names = new Set(tools.map(t => t.name));
    expect(names.has('add-feature')).toBe(true);
    expect(names.has('grant-to-actor')).toBe(false); // old name fully retired
  });

  it("generates add-feature's schema from zod with the mode enum + the dispatch properties", () => {
    // The schema is now generated from one zod wrapper (no hand-written JSON). The registry handler
    // dispatches on these exact properties, so lock them in.
    const { tools } = build();
    const af = tools.find(t => t.name === 'add-feature') as any;
    expect(af.inputSchema.type).toBe('object');
    expect(af.inputSchema.required).toEqual(['actorIdentifier', 'mode']);
    expect(Object.keys(af.inputSchema.properties).sort()).toEqual([
      'actorIdentifier',
      'compendiumFeatures',
      'feature',
      'items',
      'mode',
    ]);
    expect(af.inputSchema.properties.mode.enum).toEqual([
      'compendium-features',
      'feature',
      'items',
    ]);
    // items[] composes the canonical ItemTools zod (item shape with name+type required).
    expect(af.inputSchema.properties.items.type).toBe('array');
    expect(af.inputSchema.properties.items.items.required).toEqual(['name', 'type']);
  });

  it('advertises the six chat-log tools by name', () => {
    const { tools } = build();
    const names = new Set(tools.map(t => t.name));
    for (const name of [
      'send-chat-message',
      'list-chat-messages',
      'delete-chat-messages',
      'export-chat-log',
      'post-item-card',
      'request-roll',
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('every advertised tool has a handler, and every handler is advertised', () => {
    const { tools, handlers } = build();
    const advertised = new Set(tools.map(t => t.name));
    const handlerNames = new Set(Object.keys(handlers));

    const advertisedWithoutHandler = [...advertised].filter(n => !handlerNames.has(n));
    const handlerWithoutDefinition = [...handlerNames].filter(n => !advertised.has(n));
    expect(advertisedWithoutHandler).toEqual([]);
    expect(handlerWithoutDefinition).toEqual([]);
  });

  it('every advertised schema closes its top level, and dispatch refuses an unknown argument by name', async () => {
    const { tools, dispatch } = build();
    for (const tool of tools) {
      if (Array.isArray(tool.inputSchema.anyOf)) {
        // a union tool (src/tools/_union.ts): the root stays open (a closed root would refuse every
        // member key); every member is closed, and the tool refuses per member below
        expect(tool.inputSchema.additionalProperties, tool.name).toBeUndefined();
        for (const m of tool.inputSchema.anyOf)
          expect(m.additionalProperties, tool.name).toBe(false);
      } else {
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      }
    }
    // The F6 case: a facet the tool does not have must not be stripped into an unfiltered survey.
    await expect(
      dispatch('search-compendium', { type: 'creatures', query: 'goblin' })
    ).rejects.toThrow(
      /search-compendium \(type "creatures"\): unknown argument "query" — it takes: type, name, challengeRating/
    );
    await expect(dispatch('get-world-info', { verbose: true, x: 1 })).rejects.toThrow(
      /unknown arguments "verbose", "x" — it takes: no arguments/
    );
    // A union tool refuses against the SELECTED member — a key no member takes and a key another
    // member takes get the same by-name refusal, naming what this kind × action takes.
    await expect(
      dispatch('manage-placeables', { kind: 'tiles', action: 'list', query: 'x' })
    ).rejects.toThrow(
      'manage-placeables (kind "tiles", action "list"): unknown argument "query" — it takes: kind, action, sceneIdentifier.'
    );
    await expect(
      dispatch('manage-placeables', { kind: 'tiles', action: 'list', ids: ['a'] })
    ).rejects.toThrow(
      'manage-placeables (kind "tiles", action "list"): unknown argument "ids" — it takes: kind, action, sceneIdentifier.'
    );
    await expect(dispatch('manage-placeables', { kind: 'roofs', action: 'list' })).rejects.toThrow(
      'manage-placeables: kind must be one of "tiles", "lights", "walls", "drawings", "sounds", "notes", "tokens", "regions" (got "roofs").'
    );
    await expect(dispatch('manage-placeables', { kind: 'walls' })).rejects.toThrow(
      'manage-placeables: action must be one of "create", "list", "update", "delete" for kind "walls" (got nothing).'
    );
  });

  it('every advertised tool carries a name + inputSchema', () => {
    const { tools } = build();
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it('every advertised tool input schema is valid JSON Schema 2020-12 (no draft-7-only constructs)', () => {
    // The Anthropic API validates each tool input_schema as JSON Schema draft 2020-12 and 400s the
    // ENTIRE request — not just the call — if any one is invalid, silently bricking the session the
    // moment that tool enters the tool list (this actually happened: create-rolltable's `range` —
    // today manage-rolltables' create member —
    // tuple emitted the draft-7 `items: [..]` shape and bricked a live session). Sweep every
    // advertised schema for the 2020-12-incompatible constructs zod's generator can emit so a bad
    // dialect can never silently ship again.
    const { tools } = build();
    const offenders = tools.flatMap(t => draft2020Violations(t.inputSchema, t.name));
    expect(offenders).toEqual([]);
  });

  it('dispatch routes a known tool to the bridge and rejects an unknown one', async () => {
    const { foundry, calls } = makeFoundry({ system: 'dnd5e' });
    const { dispatch } = buildToolRegistry({ foundry, logger: makeLogger(), host });

    await dispatch('get-world-info', {});
    expect(calls.some(([op]) => op === 'getWorldInfo')).toBe(true);

    await expect(dispatch('no-such-tool', {})).rejects.toThrow(/Unknown tool/);
  });

  it('dispatches the actor-creation split to the right page ops; the retired alias is unknown', async () => {
    // The sharpest trap is the arg asymmetry: author-npc takes a FLAT stat block (the removed
    // create-actor alias used to unwrap args.statBlock). Exercise both routes, assert which page op
    // each reaches, and confirm the retired alias no longer dispatches.
    clearSystemCache(); // author-npc → assertDnd5e probes getWorldInfo (cached module-globally)
    const { foundry, calls } = makeFoundry((name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'createActorFromCompendium')
        return { success: true, totalCreated: 1, totalRequested: 1, actors: [{ name: 'X' }] };
      if (name === 'createNpcActor') return { actor: { id: 'a1', name: 'Goblin' } };
      return {};
    });
    const { dispatch } = buildToolRegistry({ foundry, logger: makeLogger(), host });

    const compendiumArgs = {
      packId: 'dnd-monster-manual.actors',
      itemId: 'owlbear',
      names: ['Hoot'],
    };
    const statBlock = {
      name: 'Goblin',
      creatureType: 'humanoid',
      size: 'small',
      cr: '1/4',
      hpAverage: 7,
      hpFormula: '2d6',
      acMode: 'default',
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    };

    await dispatch('create-actor-from-compendium', compendiumArgs);
    await dispatch('author-npc', statBlock); // FLAT
    await expect(
      dispatch('create-actor', { source: 'compendium', ...compendiumArgs })
    ).rejects.toThrow(/Unknown tool/);

    const ops = calls.map(([op]) => op);
    expect(ops.filter(op => op === 'createActorFromCompendium').length).toBe(1);
    expect(ops.filter(op => op === 'createNpcActor').length).toBe(1);
  });

  it('dispatches the PC tools to their page ops (createPcActor / inspectAdvancementChoices)', async () => {
    clearSystemCache(); // assertDnd5e probes getWorldInfo (cached module-globally)
    const { foundry, calls } = makeFoundry((name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'createPcActor')
        return {
          success: true,
          actor: { id: 'p1', name: 'Aria', className: 'Wizard', level: 1, hp: 8 },
        };
      if (name === 'inspectAdvancementChoices')
        return { class: { name: 'Wizard' }, level: 1, choices: [], spellcasting: 'full' };
      if (name === 'levelUpPc')
        return {
          success: true,
          actor: {
            id: 'p1',
            name: 'Aria',
            className: 'Wizard',
            level: 2,
            classLevel: 2,
            hp: 14,
            classes: [{ name: 'Wizard', levels: 2 }],
          },
        };
      if (name === 'createPcFromPrefab')
        return {
          success: true,
          from: 'Fighter',
          actor: { id: 'p2', name: 'Borin', className: 'Fighter', level: 1, hp: 12 },
        };
      return {};
    });
    const { dispatch } = buildToolRegistry({ foundry, logger: makeLogger(), host });

    await dispatch('create-pc', { name: 'Aria', className: 'Wizard' });
    await dispatch('inspect-pc-advancement', { className: 'Wizard' });
    await dispatch('level-up-pc', { actorIdentifier: 'Aria', className: 'Wizard' });
    await dispatch('create-pc-from-prefab', { name: 'Borin', prefab: 'Fighter' });

    const ops = calls.map(([op]) => op);
    expect(ops.filter(op => op === 'createPcActor').length).toBe(1);
    expect(ops.filter(op => op === 'inspectAdvancementChoices').length).toBe(1);
    expect(ops.filter(op => op === 'levelUpPc').length).toBe(1);
    expect(ops.filter(op => op === 'createPcFromPrefab').length).toBe(1);
  });
});

describe('toolsets (src/toolsets.ts) — a registration advertises a subset', () => {
  it('every dispatchable tool is in exactly one toolset, and every listed tool dispatches', () => {
    const { handlers } = build();
    const seen = new Map<string, string>();
    for (const set of TOOLSET_NAMES) {
      for (const name of TOOLSETS[set]) {
        expect(seen.has(name), `"${name}" listed in both ${seen.get(name)} and ${set}`).toBe(false);
        seen.set(name, set);
        expect(handlers[name], `toolset "${set}" lists "${name}" which has no handler`).toBeTypeOf(
          'function'
        );
      }
    }
    const unlisted = Object.keys(handlers).filter(n => !seen.has(n));
    expect(unlisted, 'handlers in no toolset').toEqual([]);
    expect(seen.size).toBe(Object.keys(handlers).length);
  });

  it('unset = the whole surface, in every toolset', () => {
    const { tools, enabledToolsets } = build();
    expect([...enabledToolsets].sort()).toEqual([...TOOLSET_NAMES].sort());
    expect(tools.length).toBe(81);
  });

  it('a selection advertises only those toolsets — plus session, always', () => {
    const { foundry } = makeFoundry();
    const { tools, enabledToolsets } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      toolsets: ['chat', ' combat '],
    });
    expect([...enabledToolsets].sort()).toEqual(['chat', 'combat', 'session']);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([...TOOLSETS.session, ...TOOLSETS.chat, ...TOOLSETS.combat].sort());
    expect(names).not.toContain('manage-scenes');
    expect(names).toContain('get-world-info');
    // the world-level writes are opt-in like any other family (M7)
    expect(names).not.toContain('configure-dnd5e-settings');
  });

  it('a call outside the enabled toolsets is refused by name, not as an unknown tool', async () => {
    const { foundry } = makeFoundry();
    const { dispatch } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      toolsets: ['chat'],
    });
    await expect(dispatch('manage-scenes', {})).rejects.toThrow(
      /"manage-scenes" is in the "scenes" toolset.*FOUNDRY_TOOLSETS=session,chat/
    );
    await expect(dispatch('not-a-tool', {})).rejects.toThrow(/Unknown tool/);
  });

  it('an unknown toolset name fails loudly at build time with the valid names', () => {
    const { foundry } = makeFoundry();
    expect(() =>
      buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets: ['scenes', 'sceens'] })
    ).toThrow(/"sceens" is not a toolset \(one of: session, settings, actors/);
  });

  it("get-world-info's bridge block reports the registration and the server's version (issue #9)", async () => {
    const report = async (deps: Record<string, unknown>) => {
      const { foundry } = makeFoundry({ id: 'w', title: 'T', system: 'dnd5e', users: [] });
      const registry = buildToolRegistry({ foundry, logger: makeLogger(), host, ...deps });
      return (await registry.dispatch('get-world-info', {})).bridge;
    };
    expect(await report({})).toMatchObject({ toolsets: 'all', version: '?' });
    expect((await report({ serverVersion: '4.4.0' })).version).toBe('4.4.0');
    expect((await report({ toolsets: ['chat', ' combat '] })).toolsets).toBe('chat,combat');
    expect((await report({ toolsets: ['session'] })).toolsets).toBe('session');
    expect((await report({ toolsets: TOOLSET_NAMES })).toolsets).toBe('all');
    expect((await report({ toolsets: ['readonly'] })).toolsets).toBe('readonly');
    expect((await report({ readOnly: true })).toolsets).toBe('readonly');
  });

  it('parseToolsetsEnv splits a comma list and ignores blanks', () => {
    expect(parseToolsetsEnv(undefined)).toEqual([]);
    expect(parseToolsetsEnv('')).toEqual([]);
    expect(parseToolsetsEnv(' settings, chat ,,assets ')).toEqual(['settings', 'chat', 'assets']);
  });
});

describe('FOUNDRY_TOOLSETS=readonly — the reads only, every other call refused (src/tool-kinds.ts)', () => {
  const READ_ONLY_REFUSAL =
    'this registration is read-only (FOUNDRY_TOOLSETS=readonly); use a registration without it.';
  const kinds = TOOL_KINDS as Record<string, ToolKind>;

  function buildReadOnly(response: any = {}) {
    const { foundry, calls } = makeFoundry(response);
    const registry = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      toolsets: ['readonly'],
    });
    return { ...registry, calls };
  }

  /** The `action` values a tool advertises: its union members' consts, or its `action` enum. */
  function actionsOf(tool: any): string[] {
    const s = tool.inputSchema;
    if (Array.isArray(s.anyOf)) return s.anyOf.map((m: any) => m.properties.action?.const);
    return s.properties?.action?.enum ?? [];
  }

  it('every dispatchable tool is tagged read or write, and every tag names a tool', () => {
    const { handlers } = build();
    expect(
      Object.keys(handlers).filter(n => !Object.hasOwn(kinds, n)),
      'handlers with no tag'
    ).toEqual([]);
    expect(
      Object.keys(kinds).filter(n => !handlers[n]),
      'tags with no handler'
    ).toEqual([]);
  });

  it('every read action is one the tool advertises, every readIfAbsent key an argument it takes', () => {
    const byName = new Map(build().tools.map(t => [t.name, t]));
    // A tool that reads without its write fields: what else it takes is reviewed here, so a new
    // argument is a decision — a write field joins readIfAbsent, a read-safe one joins this list.
    const READ_SAFE: Record<string, string[]> = {
      'configure-dnd5e-settings': [],
      'configure-combat-tracker': [],
      'set-primary-party': [],
      'export-chat-log': ['format', 'localPath', 'limit', 'sinceTimestamp', 'overwrite'],
      // with no action the calendar reads, whatever else the call names
      'manage-calendar': [
        'rounds',
        'minutes',
        'hours',
        'days',
        'seconds',
        'year',
        'month',
        'day',
        'hour',
        'minute',
      ],
    };
    for (const [name, kind] of Object.entries(kinds)) {
      if (typeof kind === 'string') continue;
      const tool = byName.get(name)!;
      for (const action of kind.readActions ?? []) {
        expect(actionsOf(tool), `${name} reads with action "${action}"`).toContain(action);
      }
      if (!kind.readIfAbsent) continue;
      const takes = Object.keys(tool.inputSchema.properties);
      for (const key of kind.readIfAbsent) expect(takes, `${name}.${key}`).toContain(key);
      const rest = takes.filter(k => !kind.readIfAbsent!.includes(k) && k !== 'action');
      expect(rest.sort(), `${name}: arguments neither in readIfAbsent nor reviewed`).toEqual(
        [...(READ_SAFE[name] ?? ['(unreviewed)'])].sort()
      );
    }
  });

  it('advertises no write tool and no write member or action, in valid closed schemas', () => {
    const { tools, readOnly, enabledToolsets } = buildReadOnly();
    expect(readOnly).toBe(true);
    expect([...enabledToolsets].sort()).toEqual([...TOOLSET_NAMES].sort());
    const names = tools.map(t => t.name);
    expect(names).not.toContain('run-script');
    expect(names).not.toContain('author-npc');
    for (const name of TOOLSETS.session) expect(names, `session: ${name}`).toContain(name);
    for (const tool of tools) {
      const kind = kinds[tool.name];
      expect(kind, `${tool.name} is a write`).not.toBe('write');
      const reads = typeof kind === 'object' ? kind.readActions : undefined;
      if (reads) {
        const advertised = actionsOf(tool);
        expect(
          advertised.every(a => reads.includes(a)),
          `${tool.name}: ${advertised}`
        ).toBe(true);
        expect([...tool.inputSchema.properties.action.enum].sort(), tool.name).toEqual(
          [...new Set(advertised)].sort()
        );
      }
      // every leaf at the root of a narrowed union is still taken by a member it kept
      for (const m of tool.inputSchema.anyOf ?? []) expect(m.additionalProperties).toBe(false);
      if (Array.isArray(tool.inputSchema.anyOf)) {
        const taken = new Set(
          tool.inputSchema.anyOf.flatMap((m: any) => Object.keys(m.properties))
        );
        for (const key of Object.keys(tool.inputSchema.properties))
          expect(taken.has(key), `${tool.name}.${key}`).toBe(true);
      }
    }
    // every tool tagged read is there, whole
    const full = new Map(build().tools.map(t => [t.name, t]));
    for (const [name, kind] of Object.entries(kinds)) {
      if (kind === 'read')
        expect(
          tools.find(t => t.name === name),
          name
        ).toEqual(full.get(name));
    }
    expect(tools.flatMap(t => draft2020Violations(t.inputSchema, t.name))).toEqual([]);
  });

  it('advertises the family tools narrowed to their read actions', () => {
    const { tools } = buildReadOnly();
    const tool = (name: string) => tools.find(t => t.name === name)!.inputSchema;
    const actors = tool('manage-actors');
    expect(actors.properties.action.enum).toEqual(['list', 'get', 'get-entity', 'export']);
    expect(actors.anyOf.map((m: any) => m.properties.action.const)).toEqual([
      'list',
      'get',
      'get-entity',
      'export',
    ]);
    // kind × action keeps every kind, with its list member only
    const placeables = tool('manage-placeables');
    expect(placeables.properties.kind.enum).toHaveLength(8);
    expect(placeables.properties.action.enum).toEqual(['list']);
    expect(placeables.anyOf).toHaveLength(8);
    // a leaf only the write members took is gone from the root (manage-cards' folderName)
    expect(Object.keys(tool('manage-cards').properties)).toEqual(['action']);
    expect(tool('manage-effect').properties.action.enum).toEqual(['list']);
    expect(tool('manage-calendar').properties.action).toMatchObject({
      enum: ['read'],
      default: 'read',
    });
    expect(tool('configure-area-sounds').properties.action.enum).toEqual(['list', 'library']);
  });

  it('refuses a write by name before its handler runs, and lets a read through to the bridge', async () => {
    const { dispatch, calls } = buildReadOnly({ system: 'dnd5e' });
    await expect(
      dispatch('manage-actors', { action: 'delete', identifiers: ['Gren'] })
    ).rejects.toThrow(
      `manage-actors action "delete" is not a read: ${READ_ONLY_REFUSAL} It reads with action "list", "get", "get-entity", "export".`
    );
    await expect(dispatch('manage-actors', {})).rejects.toThrow(
      `manage-actors with no action is not a read: ${READ_ONLY_REFUSAL}`
    );
    // not advertised, in an enabled toolset: the read-only refusal, not "unknown tool"
    await expect(dispatch('author-npc', { name: 'Goblin' })).rejects.toThrow(
      `author-npc is not a read: ${READ_ONLY_REFUSAL}`
    );
    await expect(dispatch('run-script', { script: 'return 1' })).rejects.toThrow(READ_ONLY_REFUSAL);
    await expect(
      dispatch('manage-placeables', { kind: 'walls', action: 'create', walls: [] })
    ).rejects.toThrow(
      `manage-placeables action "create" is not a read: ${READ_ONLY_REFUSAL} It reads with action "list".`
    );
    expect(calls).toEqual([]);

    await dispatch('manage-actors', { action: 'list' });
    await dispatch('get-world-info', {});
    expect(calls.map(([op]) => op)).toEqual(['listActors', 'getWorldInfo']);
    await expect(dispatch('no-such-tool', {})).rejects.toThrow(/Unknown tool/);
  });

  it('refuses a configure call that names a field, and reads the one that names none', async () => {
    clearSystemCache(); // configure-dnd5e-settings → assertDnd5e probes getWorldInfo (cached)
    const { dispatch, calls } = buildReadOnly((name: string) =>
      name === 'getWorldInfo' ? { system: 'dnd5e' } : { settings: {}, changed: [] }
    );
    await expect(dispatch('configure-dnd5e-settings', { disableFalling: true })).rejects.toThrow(
      `configure-dnd5e-settings with "disableFalling" is not a read: ${READ_ONLY_REFUSAL} It reads without "disableFalling".`
    );
    await expect(
      dispatch('export-chat-log', { localPath: '/tmp/x.md', remotePath: 'exports/x.md' })
    ).rejects.toThrow(
      `export-chat-log with "remotePath" is not a read: ${READ_ONLY_REFUSAL} It reads without "remotePath".`
    );
    await expect(dispatch('manage-calendar', { action: 'advance', days: 1 })).rejects.toThrow(
      `manage-calendar action "advance" is not a read: ${READ_ONLY_REFUSAL}`
    );
    await expect(dispatch('set-primary-party', { clear: true })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(calls).toEqual([]);

    await dispatch('configure-dnd5e-settings', {});
    expect(calls.map(([op]) => op)).toEqual(['getWorldInfo', 'configureDnd5eSettings']);
    expect(calls[1]![1]).toEqual({});
  });

  it('every read form it advertises reaches only page ops tagged read (src/page/_ops.ts)', async () => {
    // The two tag layers agree: each advertised form (a union member, an action value, a plain
    // tool) is called with its required arguments made up from its schema, and every page op the
    // handler reaches must be a read by the page's own table.
    const fill = (leaf: any): unknown => {
      if (leaf.const !== undefined) return leaf.const;
      if (Array.isArray(leaf.enum)) return leaf.enum[0];
      if (leaf.type === 'array') return [fill(leaf.items ?? {})];
      if (leaf.type === 'number' || leaf.type === 'integer') return 1;
      if (leaf.type === 'boolean') return true;
      if (leaf.type === 'object') return {};
      return 'ZZ-x';
    };
    const formArgs = (schema: any, extra: Record<string, unknown> = {}) => {
      const args: Record<string, unknown> = { ...extra };
      for (const key of schema.required ?? []) args[key] ??= fill(schema.properties[key]);
      return args;
    };
    // writes a file on this machine (an absolute localPath), or never reaches the page
    const SKIP = new Set([
      'download-asset',
      'export-chat-log',
      'read-pack',
      'manage-actors export',
    ]);
    const NO_PAGE_OP = new Set(['disconnect-bridge', 'asset-url']);
    // a refinement the advertised schema cannot say (one of className / classUuid, ...)
    const EXTRA: Record<string, Record<string, unknown>> = {
      'inspect-pc-advancement': { className: 'Wizard' },
      'manage-effect': { actorIdentifier: 'ZZ-x' },
    };
    clearSystemCache();
    const { tools, dispatch, calls } = buildReadOnly((name: string) =>
      name === 'getWorldInfo' ? { system: 'dnd5e' } : {}
    );
    const reached: string[] = [];
    const problems: string[] = [];
    for (const tool of tools) {
      const s = tool.inputSchema;
      const extra = EXTRA[tool.name] ?? {};
      const forms: Array<[string, Record<string, unknown>]> = Array.isArray(s.anyOf)
        ? s.anyOf.map((m: any) => [
            `${tool.name} ${m.properties.action?.const ?? m.properties.type?.const}`,
            formArgs(m, extra),
          ])
        : (s.properties?.action?.enum ?? [undefined]).map((action: string | undefined) => [
            `${tool.name}${action ? ` ${action}` : ''}`,
            formArgs(s, action ? { ...extra, action } : extra),
          ]);
      for (const [label, args] of forms) {
        if (SKIP.has(label) || SKIP.has(tool.name)) continue;
        calls.length = 0;
        let error = '';
        // a fake answer may trip a formatter after the call; what matters is what was called
        await dispatch(tool.name, args).catch(e => {
          error = String(e?.message ?? e).slice(0, 120);
        });
        const ops = calls.map(([op, a]) => [op, opKind(op, a)] as const);
        if (!NO_PAGE_OP.has(tool.name) && ops.length === 0) {
          problems.push(`${label} ${JSON.stringify(args)}: no page op (${error})`);
        }
        for (const [op, kind] of ops) {
          if (kind !== 'read') problems.push(`${label} → ${op} is a ${kind}`);
        }
        reached.push(label);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(reached.length).toBeGreaterThan(50);
  });

  it('a call is a read by its tag: the action, or the write fields it leaves out', () => {
    expect(toolKind('get-world-info', {})).toBe('read');
    expect(toolKind('author-npc', {})).toBe('write');
    expect(toolKind('not-a-tool', {})).toBe('write');
    expect(toolKind('manage-items', { action: 'get' })).toBe('read');
    expect(toolKind('manage-items', { action: 'import' })).toBe('write');
    expect(toolKind('manage-calendar', {})).toBe('read');
    expect(toolKind('manage-calendar', { action: 'read' })).toBe('read');
    expect(toolKind('manage-calendar', { action: 'set', day: 3 })).toBe('write');
    expect(toolKind('configure-combat-tracker', {})).toBe('read');
    expect(toolKind('configure-combat-tracker', { turnMarker: {} })).toBe('write');
    expect(toolKind('export-chat-log', { localPath: '/tmp/x.md' })).toBe('read');
    expect(toolKind('export-chat-log', { remotePath: 'x.md' })).toBe('write');
    expect(toolKind('set-primary-party', undefined)).toBe('read');
    expect(toolKind('set-primary-party', { groupIdentifier: 'Party' })).toBe('write');
  });

  it('readonly stands alone: beside a toolset it fails at build, naming the rule', () => {
    const { foundry } = makeFoundry();
    const rule = /FOUNDRY_TOOLSETS: "readonly" stands alone \(got "readonly,chat"\)/;
    expect(() =>
      buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets: ['readonly', 'chat'] })
    ).toThrow(rule);
    expect(() =>
      buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets: ['chat'], readOnly: true })
    ).toThrow(/"readonly" stands alone \(got "chat,readonly"\)/);
    // the flag and the name are the same registration
    const byFlag = buildToolRegistry({ foundry, logger: makeLogger(), host, readOnly: true });
    expect(byFlag.readOnly).toBe(true);
    expect(byFlag.tools).toEqual(buildReadOnly().tools);
    expect(build().readOnly).toBe(false);
    // an unknown name says readonly exists
    expect(() =>
      buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets: ['read-only'] })
    ).toThrow(/"read-only" is not a toolset \(one of: .*scripting; or "readonly" alone\)/);
  });
});

describe('receipts on every write (issue #6): one line per call, appended centrally', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fvtt-registry-receipts-'));
    clearSystemCache(); // set-primary-party → assertDnd5e probes getWorldInfo (cached)
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const SETTING: ReceiptOp = {
    kind: 'update',
    documentName: 'Setting',
    uuid: 'Setting.s1',
    label: 'dnd5e.primaryParty',
    pre: { value: '{"actor":null}' },
  };
  const PARTY = { success: true, changed: true, previous: null, current: { id: 'G1', name: 'P' } };

  /** A registry whose fake bridge notes `ops` from configurePrimaryParty, as the page reports them. */
  function registry(onWrite: () => unknown = () => PARTY, toolsets?: string[]) {
    const { foundry, calls } = makeFoundry(async (name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'configurePrimaryParty') return onWrite();
      return {};
    });
    const reg = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
      ...(toolsets ? { toolsets } : {}),
    });
    return { ...reg, calls };
  }
  const stored = () => readdirSync(dir).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));

  it('a call whose page ops wrote answers one receipt line, and the receipt is kept', async () => {
    const { dispatchWithReceipt } = registry(() => {
      noteOps([SETTING]);
      return PARTY;
    });
    const { result, receiptLine } = await dispatchWithReceipt('set-primary-party', {
      groupIdentifier: 'P',
    });
    expect(result).toBe('✅ Primary party: (none) → **P** (`G1`)');
    const id = /^receipt (rcpt_[0-9a-z]{6}): /.exec(receiptLine ?? '')?.[1];
    expect(receiptLine).toBe(
      `receipt ${id}: 0 created, 1 updated, 0 deleted (Setting "dnd5e.primaryParty": value) · ` +
        `undo: run-script { "undo": "${id}" }`
    );
    expect(stored()).toEqual([
      expect.objectContaining({
        id,
        tool: 'set-primary-party',
        worldId: 'w',
        serverUrl: 'http://localhost:30000',
        ops: [SETTING],
      }),
    ]);
  });

  it('a read answers no line and keeps nothing; plain dispatch keeps the receipt, returns the result', async () => {
    const { dispatchWithReceipt, dispatch } = registry(() => {
      noteOps([SETTING]);
      return PARTY;
    });
    expect(await dispatchWithReceipt('get-world-info', {})).toEqual({ result: expect.anything() });
    expect(readdirSync(dir)).toEqual([]);
    expect(await dispatch('set-primary-party', { groupIdentifier: 'P' })).toContain(
      'Primary party'
    );
    expect(stored()).toHaveLength(1);
  });

  it('a registration without run-script says where the undo is', async () => {
    const { dispatchWithReceipt } = registry(() => {
      noteOps([SETTING]);
      return PARTY;
    }, ['actors']);
    const { receiptLine } = await dispatchWithReceipt('set-primary-party', {
      groupIdentifier: 'P',
    });
    expect(receiptLine).toMatch(/ · undo needs the scripting toolset \(FOUNDRY_TOOLSETS\)$/);
  });

  it('an undo answers its own receipt, which names the one it reverses; that one cannot be undone twice', async () => {
    const reverse: ReceiptOp = { ...SETTING, pre: { value: '{"actor":"G1"}' } };
    const { foundry, calls } = makeFoundry(async (name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'configurePrimaryParty') {
        noteOps([SETTING]);
        return PARTY;
      }
      if (name === 'undoOps') {
        noteOps([reverse]);
        return { undone: 1, failed: [] };
      }
      return {};
    });
    const { dispatchWithReceipt } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
    });
    const first = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' });
    const id = /receipt (rcpt_\w+)/.exec(first.receiptLine ?? '')?.[1] ?? '';
    const undo = await dispatchWithReceipt('run-script', { undo: id });
    expect(undo.result).toBe(`↩️ Receipt ${id}: 1 write(s) reversed.`);
    const undoId = /receipt (rcpt_\w+)/.exec(undo.receiptLine ?? '')?.[1] ?? '';
    expect(undo.receiptLine).toBe(
      `receipt ${undoId} (reverses ${id}): 0 created, 1 updated, 0 deleted ` +
        `(Setting "dnd5e.primaryParty": value) · undo: run-script { "undo": "${undoId}" }`
    );
    expect(calls.find(([n]) => n === 'undoOps')?.[1]).toEqual({ ops: [SETTING] });
    const byId = new Map(stored().map(r => [r.id, r]));
    expect(byId.get(id)?.undoneBy).toBe(undoId);
    expect(byId.get(undoId)?.reverses).toBe(id);
    await expect(dispatchWithReceipt('run-script', { undo: id })).rejects.toThrow(
      `receipt ${id} was already undone by ${undoId}`
    );
  });

  it('an undo that could not reverse every write leaves the receipt undoable; undone again, it is undone', async () => {
    const reverse: ReceiptOp = { ...SETTING, pre: { value: '{"actor":"G1"}' } };
    const failed = [
      { op: 'delete Item', uuid: 'Actor.x.Item.i', error: 'its parent Actor.x is gone' },
    ];
    let failing = true;
    const { foundry, calls } = makeFoundry(async (name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'configurePrimaryParty') {
        noteOps([SETTING]);
        return PARTY;
      }
      if (name === 'undoOps') {
        noteOps([reverse]);
        return failing ? { undone: 1, failed } : { undone: 2, failed: [] };
      }
      return {};
    });
    const { dispatchWithReceipt } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
    });
    const first = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' });
    const id = /receipt (rcpt_\w+)/.exec(first.receiptLine ?? '')?.[1] ?? '';
    const part = await dispatchWithReceipt('run-script', { undo: id });
    expect(part.result).toContain(`↩️ Receipt ${id}: 1 write(s) reversed.`);
    expect(part.result).toContain(`1 could not be reversed; receipt ${id} stays undoable:`);
    expect(part.result).toContain('delete Item Actor.x.Item.i: its parent Actor.x is gone');
    const partId = /receipt (rcpt_\w+)/.exec(part.receiptLine ?? '')?.[1] ?? '';
    expect(part.receiptLine?.startsWith(`receipt ${partId} (partly reverses ${id}): `)).toBe(true);
    let byId = new Map(stored().map(r => [r.id, r]));
    expect(byId.get(id)?.undoneBy).toBeUndefined();
    expect(byId.get(id)?.partialUndoBy).toEqual([partId]);
    expect(byId.get(partId)).toMatchObject({ reverses: id, partial: true });
    // undone again (what is already back is left alone): every write reversed, so it is undone
    failing = false;
    const again = await dispatchWithReceipt('run-script', { undo: id });
    const againId = /receipt (rcpt_\w+)/.exec(again.receiptLine ?? '')?.[1] ?? '';
    expect(again.receiptLine?.startsWith(`receipt ${againId} (reverses ${id}): `)).toBe(true);
    byId = new Map(stored().map(r => [r.id, r]));
    expect(byId.get(id)?.undoneBy).toBe(againId);
    expect(calls.filter(([n]) => n === 'undoOps')).toHaveLength(2);
    await expect(dispatchWithReceipt('run-script', { undo: id })).rejects.toThrow(
      `receipt ${id} was already undone by ${againId}`
    );
  });

  it('an undo that changed nothing (the world already matched) marks the receipt undone, with no receipt of its own', async () => {
    // the value was put back by hand: the undo's update changes nothing, so the page records no op
    let failed: Array<{ op: string; uuid: string; error: string }> = [];
    const { foundry, calls } = makeFoundry(async (name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'configurePrimaryParty') {
        noteOps([SETTING]);
        return PARTY;
      }
      if (name === 'undoOps') return { undone: failed.length ? 0 : 1, failed };
      return {};
    });
    const { dispatchWithReceipt } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
    });
    const first = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' });
    const id = /receipt (rcpt_\w+)/.exec(first.receiptLine ?? '')?.[1] ?? '';
    // one that could not reverse its write and wrote nothing: no line, the receipt stays undoable
    failed = [{ op: 'update Setting', uuid: 'Setting.s1', error: 'refused' }];
    const part = await dispatchWithReceipt('run-script', { undo: id });
    expect(part.result).toContain(`receipt ${id} stays undoable`);
    expect(part.receiptLine).toBeUndefined();
    expect(stored()).toEqual([expect.not.objectContaining({ undoneBy: expect.anything() })]);
    // a clean one: the receipt is undone, the line says there was nothing to put back
    failed = [];
    const undo = await dispatchWithReceipt('run-script', { undo: id });
    expect(undo.result).toBe(`↩️ Receipt ${id}: 1 write(s) reversed.`);
    expect(undo.receiptLine).toBe(
      `reverses ${id}: nothing to put back (the world already matched)`
    );
    expect(stored()).toEqual([expect.objectContaining({ id, undoneBy: NOTHING_PUT_BACK })]);
    await expect(dispatchWithReceipt('run-script', { undo: id })).rejects.toThrow(
      `run-script: receipt ${id} was already undone: the world already matched it.`
    );
    expect(calls.filter(([n]) => n === 'undoOps')).toHaveLength(2);
  });

  it('files the receipt under the world of the last connect, without connecting', async () => {
    const { foundry } = makeFoundry(async (name: string) => {
      if (name === 'getWorldInfo') return { system: 'dnd5e' };
      if (name === 'configurePrimaryParty') {
        noteOps([SETTING]);
        throw new Error('the page went away under it');
      }
      return {};
    });
    // a connect now would fail: filing the receipt must not need one
    foundry.worldId = vi.fn(async () => {
      throw new Error('the reconnect failed');
    });
    const { dispatchWithReceipt } = buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
    });
    const err = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' }).catch(
      e => e
    );
    expect(err.message).toContain('the page went away under it');
    expect(receiptLineOf(err)).toMatch(
      /^receipt rcpt_\w{6}: 0 created, 1 updated, .* · undo: run-script/
    );
    expect(foundry.worldId).not.toHaveBeenCalled();
    expect(stored()).toEqual([expect.objectContaining({ worldId: 'w', ops: [SETTING] })]);
    // no world read yet (a guard: nothing writes without one): kept under none, no undo offered
    foundry.lastWorldId = vi.fn(() => undefined);
    const orphan = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' }).catch(
      e => e
    );
    expect(receiptLineOf(orphan)).toMatch(
      / · kept under no world id \(none was read\), so no undo finds it$/
    );
    expect(
      stored()
        .map(r => r.worldId)
        .sort()
    ).toEqual(['', 'w']);
  });

  it("one receipt's byte cap holds across every page op of the call", async () => {
    const big = (n: number): ReceiptOp => ({
      kind: 'delete',
      documentName: 'Scene',
      uuid: `Scene.s${n}`,
      label: `Big ${n}`,
      parentUuid: null,
      pre: { _id: `s${n}`, blob: 'x'.repeat(4_500_000) },
    });
    // two page ops, each within its own recorder's 8 MB, 9 MB in all
    const { dispatchWithReceipt } = registry(() => {
      noteOps([big(1)]);
      noteOps([big(2)]);
      return PARTY;
    });
    const { receiptLine } = await dispatchWithReceipt('set-primary-party', {
      groupIdentifier: 'P',
    });
    expect(receiptLine).toContain(' · 1 not undoable (pre-image over the cap) · ');
    const [kept] = stored();
    expect(kept.ops.map((o: ReceiptOp) => [o.uuid, !!o.pre, !!o.tooLarge])).toEqual([
      ['Scene.s1', true, false],
      ['Scene.s2', false, true],
    ]);
  });

  it('a call that fails after it wrote still carries its receipt line', async () => {
    const { dispatchWithReceipt } = registry(() => {
      noteOps([SETTING]);
      throw new Error('the second half failed');
    });
    const err = await dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' }).catch(
      e => e
    );
    expect(err.message).toContain('the second half failed');
    expect(receiptLineOf(err)).toMatch(/^receipt rcpt_\w{6}: 0 created, 1 updated, 0 deleted/);
    expect(stored()).toHaveLength(1);
  });

  it('two calls in flight at once get a receipt each, each with only its own writes', async () => {
    let n = 0;
    const { dispatchWithReceipt } = registry(async () => {
      const mine = ++n;
      await new Promise(res => setTimeout(res, mine === 1 ? 30 : 5));
      noteOps([{ ...SETTING, uuid: `Setting.s${mine}`, label: `call ${mine}` }]);
      return PARTY;
    });
    const [a, b] = await Promise.all([
      dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' }),
      dispatchWithReceipt('set-primary-party', { groupIdentifier: 'P' }),
    ]);
    expect(a.receiptLine).toContain('(Setting "call 1": value)');
    expect(b.receiptLine).toContain('(Setting "call 2": value)');
    expect(a.receiptLine).not.toBe(b.receiptLine);
    expect(stored().map(r => r.ops.length)).toEqual([1, 1]);
  });
});

describe('the writes no receipt records (NO_RECEIPT): a "not undoable" line ends the answer', () => {
  // Every tool that can write sits in exactly one of these two lists, by name. A write whose change
  // can be outside the world's documents (a file in Data/, a player's view) is NO_RECEIPT; every
  // other write is recorded (its receipt holds all it changed). A new write tool fails here until
  // it is placed: read its handler, then add it to one list.
  const NO_RECEIPT_WRITES = [
    'copy-asset',
    'create-asset-folder',
    'delete-asset',
    'export-chat-log',
    'move-asset',
    'pull-users-to-scene',
    'run-script',
    'send-chat-message',
    'upload-asset',
    'upload-asset-tree',
  ];
  const RECORDED_WRITES = [
    'activate-scene',
    'add-feature',
    'add-free-cast',
    'add-item',
    'add-journal-image',
    'apply-condition',
    'author-npc',
    'bulk-delete',
    'configure-area-sounds',
    'configure-combat-tracker',
    'configure-dnd5e-settings',
    'create-actor-from-compendium',
    'create-group',
    'create-pc',
    'create-pc-from-prefab',
    'create-quest-journal',
    'delete-chat-messages',
    'duplicate-actor',
    'level-up-pc',
    'link-quest-to-npc',
    'manage-activity',
    'manage-actors',
    'manage-calendar',
    'manage-cards',
    'manage-effect',
    'manage-folders',
    'manage-group-members',
    'manage-items',
    'manage-journals',
    'manage-macros',
    'manage-placeables',
    'manage-playlists',
    'manage-rolltables',
    'manage-scenes',
    'move-documents',
    'post-item-card',
    'relink-asset',
    'remove-from-actor',
    'request-roll',
    'set-actor-art',
    'set-actor-ownership',
    'set-journal-page-visibility',
    'set-landing-scene',
    'set-primary-party',
    'set-user-avatar',
    'update-actor-item',
    'update-quest-journal',
    'update-user',
  ];

  it('sorts every write tool into the tagged or the recorded list, by name', () => {
    const writes = Object.entries(TOOL_KINDS as Record<string, ToolKind>)
      .filter(([, kind]) => kind !== 'read')
      .map(([name]) => name)
      .sort();
    expect(Object.keys(NO_RECEIPT).sort()).toEqual(NO_RECEIPT_WRITES);
    expect([...NO_RECEIPT_WRITES, ...RECORDED_WRITES].sort()).toEqual(writes);
    expect(NO_RECEIPT_WRITES.filter(n => RECORDED_WRITES.includes(n))).toEqual([]);
  });

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fvtt-registry-noreceipt-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  /** A registry over the bridge file plane (the generic host has no direct plane). */
  function registry(onCall: (name: string, args: any) => unknown) {
    const { foundry } = makeFoundry(async (name: string, args: any) => onCall(name, args));
    return buildToolRegistry({
      foundry,
      logger: makeLogger(),
      host,
      serverUrl: 'http://localhost:30000',
      receiptsDir: dir,
    });
  }
  const line = (what: string) =>
    `not undoable: ${what} (a receipt holds the world's documents only)`;

  it('a Data/ change answers the line in its tag words, and no receipt', async () => {
    const { dispatchWithReceipt } = registry(name => {
      if (name === 'statFile') return null;
      if (name === 'createDirectory') return { ok: true };
      return {};
    });
    const out = await dispatchWithReceipt('create-asset-folder', { remotePath: 'assets/new' });
    expect(out.result).toBe('Created folder Data/assets/new.');
    expect(out.receiptLine).toBeUndefined();
    expect(out.notUndoable).toBe(line('the folder it made in Data/'));
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a call that changed nothing past the documents answers no line', async () => {
    // an existing folder: nothing made
    const { dispatchWithReceipt } = registry(name =>
      name === 'statFile' ? { isDirectory: true } : {}
    );
    const out = await dispatchWithReceipt('create-asset-folder', { remotePath: 'assets/old' });
    expect(out.result).toBe('Already exists: folder Data/assets/old.');
    expect(out.notUndoable).toBeUndefined();
    // a chat message with no image uploads nothing: its receipt holds the message
    const chat = registry(name =>
      name === 'postChatMessage'
        ? { id: 'c1', alias: 'GM', visibility: 'public', whisperCount: 0 }
        : {}
    );
    const said = await chat.dispatchWithReceipt('send-chat-message', { content: '<p>hi</p>' });
    expect(said.notUndoable).toBeUndefined();
  });

  it('a refused call is an error carrying no line', async () => {
    const { dispatchWithReceipt } = registry(name =>
      name === 'statFile' ? { isDirectory: false, size: 3 } : {}
    );
    const err = await dispatchWithReceipt('create-asset-folder', { remotePath: 'a.txt' }).catch(
      e => e
    );
    expect(err).toMatchObject({ code: 'invalid' });
    expect(receiptLineOf(err)).toBeUndefined();
  });

  it('a pull answers the line only when it moved a view', async () => {
    const pulled = registry(() => ({
      scene: { id: 's1', name: 'Crypt' },
      pulled: [{ id: 'u1', name: 'Ann' }],
      offline: [],
      selfSkipped: [],
      notFound: [],
    }));
    const out = await pulled.dispatchWithReceipt('pull-users-to-scene', {
      sceneIdentifier: 'Crypt',
      userIdentifiers: ['Ann'],
    });
    expect(out.notUndoable).toBe(line("the players' views it moved"));
    const nobody = registry(() => ({
      scene: { id: 's1', name: 'Crypt' },
      pulled: [],
      offline: [{ id: 'u2', name: 'Bo' }],
      selfSkipped: [],
      notFound: [],
    }));
    const none = await nobody.dispatchWithReceipt('pull-users-to-scene', {
      sceneIdentifier: 'Crypt',
      userIdentifiers: ['Bo'],
    });
    expect(none.notUndoable).toBeUndefined();
    // a scene that does not resolve moved nobody: a not-found error, no line
    const nowhere = registry(() => ({
      success: false,
      sceneNotFound: 'Nowhere',
      pulled: [],
      offline: [],
      selfSkipped: [],
      notFound: [],
    }));
    const err = await nowhere
      .dispatchWithReceipt('pull-users-to-scene', {
        sceneIdentifier: 'Nowhere',
        userIdentifiers: ['Ann'],
      })
      .catch(e => e);
    expect(err).toMatchObject({ code: 'not-found' });
    expect(receiptLineOf(err)).toBeUndefined();
  });

  it('a run that called a file-plane op names it; its document writes keep their receipt', async () => {
    const SCENE: ReceiptOp = {
      kind: 'update',
      documentName: 'Scene',
      uuid: 'Scene.s1',
      label: 'Crypt',
      pre: { name: 'Old' },
    };
    const { dispatchWithReceipt } = registry(name => {
      if (name !== 'runScript') return {};
      noteOps([SCENE]);
      return {
        ok: true,
        result: null,
        log: [],
        timedOut: false,
        receipt: {
          created: 0,
          updated: 1,
          deleted: 0,
          calls: 2,
          writes: 2,
          unrecorded: ['uploadFile'],
        },
      };
    });
    const out = await dispatchWithReceipt('run-script', { script: 'return 1;' });
    expect(out.receiptLine).toMatch(/^receipt rcpt_\w+: 0 created, 1 updated, 0 deleted/);
    expect(out.notUndoable).toBe(line('what fvtt.uploadFile changed'));
  });

  it('a failed call that changed a Data/ file first carries the line on its error', async () => {
    // a remote export whose copy landed, then a page write failed after it is not this tool's
    // shape; the chat image upload is: the image goes up, then the post is refused
    const { dispatchWithReceipt } = registry(name => {
      if (name === 'statFile') return null;
      if (name === 'createDirectory') return { ok: true };
      if (name === 'uploadFile') return { ok: true };
      if (name === 'postChatMessage') throw new Error('the post was refused');
      return {};
    });
    const err = await dispatchWithReceipt('send-chat-message', {
      content: '<p>look</p>',
      images: [{ path: __filename }],
    }).catch(e => e);
    expect(err?.message).toMatch(/the post was refused/);
    expect(receiptLineOf(err)).toBe(line('the image it uploaded to Data/'));
  });
});
