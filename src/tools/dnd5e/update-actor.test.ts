/**
 * Unit tests for manage-actors' update member (src/tools/dnd5e/update-actor.ts): validation +
 * forwarding to the bridge + the one-line confirmation. The bridge seam is mocked (the page-side
 * updateActor correctness is covered by the live acceptance script), so these assert the member's
 * contract, not Foundry behavior. The member is driven the way the union drives it: the schema
 * parses, then the handler runs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateActorSchema, updateActor } from './update-actor.js';
import { makeFoundry, makeLogger } from '../test-helpers.js';
import { clearSystemCache } from '../../utils/system-detection.js';

// detectGameSystem caches the result module-wide, so clear it between tests and have the mock
// answer getWorldInfo with the dnd5e marker (a bare string, matching the real bridge shape).
beforeEach(() => clearSystemCache());

function makeTool(response: any = {}) {
  const { foundry, calls } = makeFoundry((name: string) =>
    name === 'getWorldInfo' ? { system: 'dnd5e' } : response
  );
  const logger = makeLogger();
  const tool = {
    // async so a parse failure REJECTS (as the union's dispatch does) rather than throws
    handleUpdateActor: async (args: unknown) =>
      updateActor(foundry, logger, UpdateActorSchema.parse(args ?? {})),
  };
  return { tool, calls };
}

describe('the update member contract', () => {
  it('requires actorIdentifier', () => {
    expect(() => UpdateActorSchema.parse({ cr: 5 })).toThrow();
    expect(UpdateActorSchema.parse({ actorIdentifier: 'x' }).actorIdentifier).toBe('x');
  });
});

describe('handleUpdateActor', () => {
  it('forwards parsed args to the updateActor bridge call', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Barbed Devil', type: 'npc' },
      applied: ['abilities', 'cr'],
      warnings: [],
    });
    const res = await tool.handleUpdateActor({
      actorIdentifier: 'Barbed Devil',
      abilities: { str: 20 },
      cr: 5,
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call).toBeTruthy();
    expect(call?.[1].actorIdentifier).toBe('Barbed Devil');
    expect(call?.[1].abilities).toEqual({ str: 20 });
    expect(res).toBe('Updated "Barbed Devil" (a1, npc): abilities, cr');
  });

  it('forwards the prototype-token toggles (auto-rotate / ring)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Osric the Bartender', type: 'npc' },
      applied: ['tokenAutoRotate', 'tokenRing'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Osric the Bartender',
      tokenAutoRotate: true,
      tokenRing: false,
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].tokenAutoRotate).toBe(true);
    expect(call?.[1].tokenRing).toBe(false);
  });

  it('forwards the prototype-token nameplate (tokenName)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Morgash the Gravemaker', type: 'character' },
      applied: ['tokenName'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Morgash the Gravemaker',
      tokenName: 'Morgash',
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].tokenName).toBe('Morgash');
  });

  it('rejects an empty tokenName', async () => {
    const { tool } = makeTool();
    await expect(tool.handleUpdateActor({ actorIdentifier: 'X', tokenName: '' })).rejects.toThrow();
  });

  it('rejects a non-boolean token toggle', async () => {
    const { tool } = makeTool({});
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', tokenAutoRotate: 'yes' })
    ).rejects.toThrow();
  });

  it('forwards the prototype-token art scale', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Ettercap Broodmother', type: 'npc' },
      applied: ['tokenScale'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Ettercap Broodmother',
      tokenScale: 2,
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].tokenScale).toBe(2);
  });

  it('rejects a non-positive token scale', async () => {
    const { tool } = makeTool();
    await expect(tool.handleUpdateActor({ actorIdentifier: 'X', tokenScale: 0 })).rejects.toThrow();
  });

  it('forwards the prototype-token facing (tokenRotation)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Hobgoblin Archer', type: 'npc' },
      applied: ['tokenRotation'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Hobgoblin Archer',
      tokenRotation: 90,
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].tokenRotation).toBe(90);
  });

  it('rejects a non-numeric tokenRotation', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', tokenRotation: 'sideways' })
    ).rejects.toThrow();
  });

  it('forwards the prototype-token nameplate / HP-bar visibility', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Villager 01', type: 'npc' },
      applied: ['tokenDisplayName', 'tokenDisplayBars'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Villager 01',
      tokenDisplayName: 'none',
      tokenDisplayBars: 'none',
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].tokenDisplayName).toBe('none');
    expect(call?.[1].tokenDisplayBars).toBe('none');
  });

  it('rejects an invalid token display mode', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', tokenDisplayName: 'sometimes' })
    ).rejects.toThrow();
  });

  it('applies the default replace mode to Set fields', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'X', type: 'npc' },
      applied: ['damageImmunities'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'X',
      damageImmunities: { values: ['fire', 'poison'] },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].damageImmunities).toEqual({ mode: 'replace', values: ['fire', 'poison'] });
  });

  it('forwards weaponMasteries with the default replace mode', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Morgash the Gravemaker', type: 'character' },
      applied: ['weaponMasteries'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Morgash the Gravemaker',
      weaponMasteries: { values: ['greatsword', 'maul', 'battleaxe'] },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].weaponMasteries).toEqual({
      mode: 'replace',
      values: ['greatsword', 'maul', 'battleaxe'],
    });
  });

  it('rejects non-array weaponMasteries values', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', weaponMasteries: { values: 'greatsword' } })
    ).rejects.toThrow();
  });

  it('forwards a currency group with its default mode', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Knight', type: 'npc' },
      applied: ['currency'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Knight',
      currency: { gp: 30, sp: 5 },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].currency).toEqual({ mode: 'set', gp: 30, sp: 5 });
  });

  it('forwards currency mode add for loot adjustments', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Knight', type: 'npc' },
      applied: ['currency'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Knight',
      currency: { mode: 'add', gp: -10 },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].currency).toEqual({ mode: 'add', gp: -10 });
  });

  it('forwards the NPC spellcasting group (caster level + casting ability)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Skeletal Mage', type: 'npc' },
      applied: ['spellcasting.level', 'spellcasting.ability'],
      warnings: [],
    });
    const res = await tool.handleUpdateActor({
      actorIdentifier: 'Skeletal Mage',
      spellcasting: { level: 3, ability: 'int' },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].spellcasting).toEqual({ level: 3, ability: 'int' });
    expect(res).toContain(': spellcasting.level, spellcasting.ability');
  });

  it('accepts a caster level of 0 (not a slot caster — the 2024-MM free-cast default)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Wight', type: 'npc' },
      applied: ['spellcasting.level'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Wight',
      spellcasting: { level: 0 },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].spellcasting).toEqual({ level: 0 });
  });

  it('accepts an empty-string casting ability (clears it)', async () => {
    const { tool, calls } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Wight', type: 'npc' },
      applied: ['spellcasting.ability'],
      warnings: [],
    });
    await tool.handleUpdateActor({
      actorIdentifier: 'Wight',
      spellcasting: { ability: '' },
    });
    const call = calls.find(([n]) => n === 'updateActor');
    expect(call?.[1].spellcasting).toEqual({ ability: '' });
  });

  it('rejects a caster level outside 0-20 and an unknown casting ability', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', spellcasting: { level: 21 } })
    ).rejects.toThrow();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', spellcasting: { level: -1 } })
    ).rejects.toThrow();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', spellcasting: { level: 2.5 } })
    ).rejects.toThrow();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', spellcasting: { ability: 'luck' } })
    ).rejects.toThrow();
  });

  it('rejects a non-integer coin amount', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', currency: { gp: 1.5 } })
    ).rejects.toThrow();
  });

  it('surfaces bridge warnings in the response', async () => {
    const { tool } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Hero', type: 'character' },
      applied: ['abilities'],
      warnings: ['"cr" is an NPC-only field — skipped on character "Hero"'],
    });
    const res = await tool.handleUpdateActor({
      actorIdentifier: 'Hero',
      abilities: { str: 18 },
      cr: 5,
    });
    expect(res).toContain('⚠️ 1 warning(s):');
    expect(res).toContain('NPC-only');
  });

  it('surfaces a bad-img (404) warning from the page layer', async () => {
    const { tool } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Goblin', type: 'npc' },
      applied: ['img'],
      warnings: [
        'Supplied img "x/nope.webp" was not found on the server — substituted a real icon.',
      ],
    });
    const res = await tool.handleUpdateActor({
      actorIdentifier: 'Goblin',
      img: 'x/nope.webp',
    });
    expect(res).toContain('⚠️ 1 warning(s):');
    expect(res).toContain('not found on the server');
  });

  it('rejects a missing actorIdentifier', async () => {
    const { tool } = makeTool();
    await expect(tool.handleUpdateActor({ cr: 5 })).rejects.toThrow();
  });

  it('rejects an out-of-range ability score', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleUpdateActor({ actorIdentifier: 'X', abilities: { str: 99 } })
    ).rejects.toThrow();
  });
});
