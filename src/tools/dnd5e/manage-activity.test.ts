/**
 * Unit tests for manage-activity: validation + forwarding + response shaping. The bridge seam is
 * mocked; the live add/edit/remove/list against real items is covered by the acceptance script.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DnD5eManageActivityTool } from './manage-activity.js';
import { makeFoundry, makeLogger } from '../test-helpers.js';
import { clearSystemCache } from '../../utils/system-detection.js';

beforeEach(() => clearSystemCache());

function makeTool(response: any = {}) {
  const { foundry, calls } = makeFoundry((name: string) =>
    name === 'getWorldInfo' ? { system: 'dnd5e' } : response
  );
  const tool = new DnD5eManageActivityTool({ foundry, logger: makeLogger() });
  return { tool, calls };
}

describe('manage-activity tool', () => {
  it('advertises manage-activity with a generated inputSchema', () => {
    const { tool } = makeTool();
    const def = tool.getToolDefinitions()[0];
    expect(def.name).toBe('manage-activity');
    const req = (def.inputSchema as any).required;
    expect(req).toContain('action');
    expect(req).toContain('itemIdentifier');
  });

  it('add forwards the activity definition (heal maps to healing)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      type: 'heal',
      activityId: 'NEW',
      item: { id: 'i1', name: 'Lay on Hands', type: 'feat' },
    });
    const res = await tool.handleManageActivity({
      action: 'add',
      actorIdentifier: 'Paladin',
      itemIdentifier: 'Lay on Hands',
      type: 'heal',
      name: 'Heal',
      healAmount: { number: 2, denomination: 8, type: 'healing' },
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].action).toBe('add');
    expect(call?.[1].activity.type).toBe('heal');
    expect(call?.[1].activity.healing).toEqual({ number: 2, denomination: 8, type: 'healing' });
    expect(res.message).toContain('heal');
  });

  it('add a utility activity (Multiattack)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      type: 'utility',
      activityId: 'MA',
      item: { id: 'i2', name: 'Multiattack', type: 'feat' },
    });
    await tool.handleManageActivity({
      action: 'add',
      actorIdentifier: 'Devil',
      itemIdentifier: 'Multiattack',
      type: 'utility',
      name: 'Multiattack',
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.type).toBe('utility');
    expect(call?.[1].activity.name).toBe('Multiattack');
  });

  it('edit forwards a relative patch', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'edit',
      activityId: 'A1',
      editedKeys: ['system.activities.A1.attack.bonus'],
      item: { id: 'i1', name: 'Claws', type: 'weapon' },
    });
    await tool.handleManageActivity({
      action: 'edit',
      actorIdentifier: 'Devil',
      itemIdentifier: 'Claws',
      activityId: 'A1',
      patch: { 'attack.bonus': '3' },
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].patch).toEqual({ 'attack.bonus': '3' });
  });

  it('requires type for add and activityId for edit/remove', async () => {
    const { tool } = makeTool();
    await expect(tool.handleManageActivity({ action: 'add', itemIdentifier: 'X' })).rejects.toThrow(
      /requires `type`/
    );
    await expect(
      tool.handleManageActivity({ action: 'edit', itemIdentifier: 'X', patch: { a: 1 } })
    ).rejects.toThrow(/requires `activityId`/);
    await expect(
      tool.handleManageActivity({ action: 'remove', itemIdentifier: 'X' })
    ).rejects.toThrow(/requires `activityId`/);
  });

  it('requires per-type mechanics (save needs ability+DC, heal needs amount, damage needs parts)', async () => {
    const { tool } = makeTool();
    // save without saveAbility/saveDC would write a malformed save.ability:[undefined]
    await expect(
      tool.handleManageActivity({ action: 'add', itemIdentifier: 'X', type: 'save' })
    ).rejects.toThrow(/"save" requires saveAbility and saveDC/);
    await expect(
      tool.handleManageActivity({ action: 'add', itemIdentifier: 'X', type: 'heal' })
    ).rejects.toThrow(/"heal" requires healAmount/);
    await expect(
      tool.handleManageActivity({ action: 'add', itemIdentifier: 'X', type: 'damage' })
    ).rejects.toThrow(/"damage" requires at least one damageParts/);
    // utility needs nothing beyond type
    const { tool: tool2, calls } = makeTool({
      success: true,
      action: 'add',
      type: 'utility',
      activityId: 'U',
      item: { id: 'i', name: 'X', type: 'feat' },
    });
    await tool2.handleManageActivity({
      action: 'add',
      itemIdentifier: 'X',
      type: 'utility',
      name: 'Multiattack',
    });
    expect(calls.some(([n]) => n === 'manageActivity')).toBe(true);
  });

  it('add cast forwards spellUuid + castLevel->level + charges + saveDC', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      type: 'cast',
      activityId: 'C1',
      spell: 'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00',
      item: { id: 'w', name: 'Wand of Fireballs', type: 'equipment' },
    });
    const res = await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Wand of Fireballs',
      type: 'cast',
      spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00',
      castLevel: 3,
      charges: 1,
      saveDC: 15,
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.type).toBe('cast');
    expect(call?.[1].activity.spellUuid).toBe(
      'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00'
    );
    // the tool maps the friendly `castLevel` param onto the page builder's `level`
    expect(call?.[1].activity.level).toBe(3);
    expect(call?.[1].activity.charges).toBe(1);
    expect(call?.[1].activity.saveDC).toBe(15);
    expect(res.message).toContain('linking spell');
  });

  it('cast requires spellUuid, and refuses both saveDC and attackBonus', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleManageActivity({ action: 'add', itemIdentifier: 'X', type: 'cast' })
    ).rejects.toThrow(/"cast" requires `spellUuid`/);
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'X',
        type: 'cast',
        spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00',
        saveDC: 15,
        attackBonus: 7,
      })
    ).rejects.toThrow(/saveDC OR attackBonus/);
  });
});

describe('manage-activity — duration override (dnd5e 6.0 expiry)', () => {
  it('advertises duration.units + duration.expiry enums and forwards a duration on add and edit', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      activityId: 'A1',
      type: 'utility',
      item: { id: 'i1', name: 'Roar', type: 'feat' },
    });
    const schema: any = tool.getToolDefinitions()[0].inputSchema;
    expect(schema.properties.duration.properties.units.enum).toContain('minute');
    expect(JSON.stringify(schema.properties.duration.properties.expiry)).toContain('targetEnd');
    await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Roar',
      type: 'utility',
      name: 'Frightful Presence',
      duration: { value: 1, units: 'minute', expiry: 'targetEnd' },
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.duration).toEqual({ value: 1, units: 'minute', expiry: 'targetEnd' });
    calls.length = 0;
    await tool.handleManageActivity({
      action: 'edit',
      itemIdentifier: 'Roar',
      activityId: 'A1',
      duration: { expiry: 'sourceStart' },
    });
    expect(calls.find(([n]) => n === 'manageActivity')?.[1].activity.duration).toEqual({
      expiry: 'sourceStart',
    });
    await expect(
      tool.handleManageActivity({
        action: 'edit',
        itemIdentifier: 'Roar',
        activityId: 'A1',
        duration: { expiry: 'nextDawn' },
      })
    ).rejects.toThrow();
  });
});

describe('manage-activity — area template + behaviors (dnd5e 6.0)', () => {
  it('advertises template / affects / behaviors and forwards an authored Web', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      activityId: 'A1',
      type: 'save',
      item: { id: 'i1', name: 'Web', type: 'feat' },
      effects: [
        {
          ref: 'Restrained',
          uuid: 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa',
          name: 'Restrained',
          source: 'dnd5e.effects',
        },
      ],
    });
    const schema: any = tool.getToolDefinitions()[0].inputSchema;
    expect(schema.properties.template.properties.type.enum).toContain('cube');
    expect(schema.properties.affects.properties.type.enum).toContain('enemy');
    expect(schema.properties.behaviors.items.properties.type.enum).toEqual([
      'applyActiveEffect',
      'difficultTerrain',
    ]);
    const res = await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Web',
      type: 'save',
      saveAbility: 'dex',
      saveDC: 13,
      template: { type: 'cube', size: 20 },
      affects: { type: 'creature' },
      behaviors: [
        { type: 'applyActiveEffect', effects: ['Restrained'] },
        { type: 'difficultTerrain', terrainTypes: ['web'] },
      ],
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.template).toEqual({ type: 'cube', size: 20 });
    expect(call?.[1].activity.affects).toEqual({ type: 'creature' });
    expect(call?.[1].activity.behaviors).toEqual([
      { type: 'applyActiveEffect', effects: ['Restrained'] },
      { type: 'difficultTerrain', terrainTypes: ['web'] },
    ]);
    expect(res.summary).toContain('✦ effect "Restrained" (dnd5e.effects)');
  });

  it('refuses behaviors without a template on add, and an unknown terrain / shape at the contract', async () => {
    const { tool } = makeTool({ success: true });
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'Web',
        type: 'utility',
        behaviors: [{ type: 'difficultTerrain' }],
      })
    ).rejects.toThrow(/ride on an area template/);
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'Web',
        type: 'utility',
        template: { type: 'blob', size: 5 },
      })
    ).rejects.toThrow();
    await expect(
      tool.handleManageActivity({
        action: 'edit',
        itemIdentifier: 'Web',
        activityId: 'A1',
        behaviors: [{ type: 'difficultTerrain', terrainTypes: ['lava'] }],
      })
    ).rejects.toThrow();
  });
});

describe('manage-activity — teleport + transform (dnd5e 6.0)', () => {
  it('advertises the two types and forwards a teleport distance', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      activityId: 'A1',
      type: 'teleport',
      item: { id: 'i1', name: 'Misty Step', type: 'spell' },
    });
    const schema: any = tool.getToolDefinitions()[0].inputSchema;
    expect(schema.properties.type.enum).toContain('teleport');
    expect(schema.properties.type.enum).toContain('transform');
    expect(schema.properties.transformMode.enum).toEqual(['direct', 'cr', 'form']);
    expect(schema.properties.transformPreset.enum).toEqual([
      'wildshape',
      'polymorph',
      'polymorphSelf',
    ]);
    await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Misty Step',
      type: 'teleport',
      activationType: 'bonus',
      teleportDistance: 30,
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity).toMatchObject({
      type: 'teleport',
      activationType: 'bonus',
      teleportDistance: 30,
    });
  });

  it('forwards transform profiles / forms and reports resolved form actors; guards the modes', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      activityId: 'A2',
      type: 'transform',
      item: { id: 'i1', name: 'Wild Shape', type: 'feat' },
      transformActors: [
        {
          name: 'Giant Wolf Spider',
          uuid: 'Compendium.dnd-monster-manual.actors.Actor.aaaaaaaaaaaaaaaa',
        },
      ],
    });
    const res = await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Wild Shape',
      type: 'transform',
      transformMode: 'direct',
      transformPreset: 'wildshape',
      profiles: [{ actor: 'Giant Wolf Spider' }],
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity).toMatchObject({
      type: 'transform',
      transformMode: 'direct',
      transformPreset: 'wildshape',
      profiles: [{ actor: 'Giant Wolf Spider' }],
    });
    expect(res.summary).toContain('✦ form "Giant Wolf Spider"');
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'X',
        type: 'transform',
        transformMode: 'form',
      })
    ).rejects.toThrow(/requires `forms`/);
    await expect(
      tool.handleManageActivity({ action: 'add', itemIdentifier: 'X', type: 'transform' })
    ).rejects.toThrow(/at least one profiles/);
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'X',
        type: 'transform',
        transformMode: 'direct',
        profiles: [{ cr: 1 }],
      })
    ).rejects.toThrow(/need an `actor`/);
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'X',
        type: 'transform',
        profiles: [{ name: 'no cr' }],
      })
    ).rejects.toThrow(/need a `cr`/);
  });
});

describe('manage-activity — transformSettings (dnd5e 6.0 customize)', () => {
  it('advertises the category enums and forwards the settings', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      activityId: 'A3',
      type: 'transform',
      item: { id: 'i1', name: 'Wild Shape', type: 'feat' },
    });
    const schema: any = tool.getToolDefinitions()[0].inputSchema;
    expect(schema.properties.transformSettings.properties.merge.items.enum).toEqual([
      'saves',
      'skills',
    ]);
    expect(schema.properties.transformSettings.properties.keep.items.enum).toContain('resistances');
    await tool.handleManageActivity({
      action: 'add',
      itemIdentifier: 'Wild Shape',
      type: 'transform',
      transformPreset: 'wildshape',
      profiles: [{ cr: 1, creatureTypes: ['beast'] }],
      transformSettings: { keep: ['hp', 'resistances'], tempFormula: '@classes.druid.levels' },
    });
    expect(calls.find(([n]) => n === 'manageActivity')?.[1].activity.transformSettings).toEqual({
      keep: ['hp', 'resistances'],
      tempFormula: '@classes.druid.levels',
    });
    await expect(
      tool.handleManageActivity({
        action: 'add',
        itemIdentifier: 'X',
        type: 'transform',
        profiles: [{ cr: 1 }],
        transformSettings: { keep: ['wings'] },
      })
    ).rejects.toThrow();
  });
});

describe('manage-activity — appliesEffects (dnd5e 6.0 activity.effects[])', () => {
  it('advertises appliesEffects and forwards it on add and edit', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'add',
      type: 'save',
      activityId: 'S1',
      item: { id: 'i1', name: 'Stinger', type: 'weapon' },
      effects: [
        {
          ref: 'Poisoned',
          uuid: 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa',
          name: 'Poisoned',
          source: 'dnd5e.effects',
        },
      ],
    });
    const props = (tool.getToolDefinitions()[0].inputSchema as any).properties;
    expect(props.appliesEffects).toBeDefined();
    expect(props.appliesEffects.items.required).toContain('ref');
    expect(JSON.stringify(props.duration)).toMatch(/inherit/i);

    const res = await tool.handleManageActivity({
      action: 'add',
      actorIdentifier: 'Wasp',
      itemIdentifier: 'Stinger',
      type: 'save',
      saveAbility: 'con',
      saveDC: 13,
      duration: { value: 1, units: 'minute' },
      appliesEffects: [{ ref: 'Poisoned', onSave: false }],
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.appliesEffects).toEqual([{ ref: 'Poisoned', onSave: false }]);
    expect(res.message).toContain('Poisoned');

    const { tool: t2, calls: c2 } = makeTool({
      success: true,
      action: 'edit',
      activityId: 'S1',
      item: { id: 'i1', name: 'Stinger', type: 'weapon' },
    });
    await t2.handleManageActivity({
      action: 'edit',
      itemIdentifier: 'Stinger',
      activityId: 'S1',
      appliesEffects: [{ ref: 'Restrained', level: { min: 3 } }],
    });
    expect(c2.find(([n]) => n === 'manageActivity')?.[1].activity.appliesEffects).toEqual([
      { ref: 'Restrained', level: { min: 3 } },
    ]);
  });
});

describe('manage-activity — edit refuses the typed fields it cannot apply', () => {
  it('names the offenders and points at patch, without calling the bridge', async () => {
    const { tool, calls } = makeTool();
    await expect(
      tool.handleManageActivity({
        action: 'edit',
        itemIdentifier: 'Claws',
        activityId: 'A1',
        saveDC: 16,
        damageParts: [{ number: 1, denomination: 6, type: 'fire' }],
      })
    ).rejects.toThrow(/cannot change damageParts, saveDC/);
    await expect(
      tool.handleManageActivity({
        action: 'edit',
        itemIdentifier: 'Wild Shape',
        activityId: 'A1',
        transformPreset: 'wildshape',
      })
    ).rejects.toThrow(/`patch`/);
    expect(calls.find(([n]) => n === 'manageActivity')).toBeUndefined();
  });

  it('still allows name / duration / template / affects / behaviors / appliesEffects / patch', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'edit',
      activityId: 'A1',
      item: { id: 'i1', name: 'Web', type: 'feat' },
    });
    await tool.handleManageActivity({
      action: 'edit',
      itemIdentifier: 'Web',
      activityId: 'A1',
      name: 'Webbing',
      duration: { value: 1, units: 'hour' },
      template: { type: 'cube', size: 20 },
      affects: { type: 'creature' },
      behaviors: [{ type: 'difficultTerrain', terrainTypes: ['web'] }],
      appliesEffects: [{ ref: 'Restrained' }],
      patch: { 'save.dc.formula': '13' },
    });
    const call = calls.find(([n]) => n === 'manageActivity');
    expect(call?.[1].activity.name).toBe('Webbing');
    expect(call?.[1].patch).toEqual({ 'save.dc.formula': '13' });
  });
});
