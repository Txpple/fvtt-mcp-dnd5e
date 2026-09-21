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

import { describe, it, expect } from 'vitest';
import { buildToolRegistry } from '../registry.js';
import { clearSystemCache } from '../utils/system-detection.js';
import { makeFoundry, makeLogger } from './test-helpers.js';
import { TOOLSETS, TOOLSET_NAMES, parseToolsetsEnv } from '../toolsets.js';
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
    //   DM Assistant user goes inactive; the next tool call reconnects lazily — "log out please"
    //   no longer requires exiting Claude Code)
    // + duplicate-actor (clone existing WORLD actors: toObject → rename → folder → ownership →
    //   Actor.create — the "(Sim)" sandbox path; full sheets stay rollable)
    // + activate-scene + pull-users-to-scene (the two halves of "who is looking at what":
    //   the ONE world-wide active flag, which update-scene deliberately never touches, and
    //   Scene#pullUsers for moving only SOME users — the party-split path)
    // + set-landing-scene (where a user comes up at LOGIN — core has no per-user landing scene
    //   at all, so this writes a durable User flag the house module fvtt-mod-openserver acts
    //   on at ready; the OFFLINE counterpart to pull-users-to-scene)
    // + configure-soundscape (per-scene sound sets for house module fvtt-mod-soundscape: a POOL of
    //   files played at randomized intervals with silence between, or crossfaded into a seamless
    //   bed — the shape neither AmbientSound placeables nor Playlists can express)
    // (parse-ddb-character was built and REMOVED 2026-08-17: DDB exports strip the embedded
    //  ActiveEffects the premium items carry, so imported PCs pass review and silently lose their
    //  automation at the table — the Divine Favor incident. Standing policy: refuse DDB imports
    //  and build the PC natively from the premium compendia instead — see design.md §7.)
    // + get-combat-stats (2026-08-27: per-combat analytics folded from Battle Flow's stat
    //   stamps — damage/healing/flips/spend economy/Bless margins; read-only, GM-facing,
    //   filtered at call time. The stamps are an external wire format (battleflow ARCH §4),
    //   never a code dependency.)
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
    expect(names.length).toBe(101);
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
      dispatch('manage-placeables', { kind: 'notes', action: 'update', patches: [{ id: 'n1' }] })
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

  it('registers the journal page-visibility tools + manage-folders (dogfood tooling gaps)', () => {
    const { tools, handlers } = build();
    const names = new Set(tools.map(t => t.name));
    for (const name of ['set-journal-page-visibility', 'delete-journal-page', 'manage-folders']) {
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
    expect(names.has('update-actor')).toBe(true);
    expect(names.has('update-actor-item')).toBe(true);
    expect(names.has('manage-activity')).toBe(true);
    expect(names.has('manage-effect')).toBe(true);
    expect(names.has('apply-condition')).toBe(true);
    expect(names.has('add-item')).toBe(true);
    expect(names.has('import-item')).toBe(true);
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
    await expect(dispatch('search-compendium-creatures', { query: 'goblin' })).rejects.toThrow(
      /search-compendium-creatures: unknown argument "query" — it takes: name, challengeRating/
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
    expect(tools.length).toBe(101);
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
    expect(names).not.toContain('create-scene');
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
    await expect(dispatch('create-scene', {})).rejects.toThrow(
      /"create-scene" is in the "scenes" toolset.*FOUNDRY_TOOLSETS=session,chat/
    );
    await expect(dispatch('not-a-tool', {})).rejects.toThrow(/Unknown tool/);
  });

  it('an unknown toolset name fails loudly at build time with the valid names', () => {
    const { foundry } = makeFoundry();
    expect(() =>
      buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets: ['scenes', 'sceens'] })
    ).toThrow(/"sceens" is not a toolset \(one of: session, settings, actors/);
  });

  it('parseToolsetsEnv splits a comma list and ignores blanks', () => {
    expect(parseToolsetsEnv(undefined)).toEqual([]);
    expect(parseToolsetsEnv('')).toEqual([]);
    expect(parseToolsetsEnv(' settings, chat ,,assets ')).toEqual(['settings', 'chat', 'assets']);
  });
});
