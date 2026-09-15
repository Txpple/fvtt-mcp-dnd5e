/**
 * Unit tests for manage-effect: validation + forwarding + response shaping. The bridge seam is
 * mocked; live create/edit/delete/list against real docs is covered by the acceptance script.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DnD5eManageEffectTool } from './manage-effect.js';
import { makeFoundry, makeLogger } from '../test-helpers.js';
import { clearSystemCache } from '../../utils/system-detection.js';

// handleManageEffect now probes the system via assertDnd5e (getWorldInfo, module-cached), so the
// fake bridge answers that probe with the dnd5e marker and the cache is cleared before each test.
beforeEach(() => clearSystemCache());

function makeTool(response: any = {}) {
  const { foundry, calls } = makeFoundry((name: string) =>
    name === 'getWorldInfo' ? { system: 'dnd5e' } : response
  );
  const tool = new DnD5eManageEffectTool({ foundry, logger: makeLogger() });
  return { tool, calls };
}

describe('manage-effect tool', () => {
  it('advertises manage-effect with a generated inputSchema', () => {
    const { tool } = makeTool();
    const def = tool.getToolDefinitions()[0];
    expect(def.name).toBe('manage-effect');
    expect((def.inputSchema as any).required).toContain('action');
  });

  it('create forwards the effect (changes default type "add")', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'create',
      effectId: 'E1',
      name: '+1 AC',
      actor: { id: 'a1', name: 'Devil' },
    });
    const res = await tool.handleManageEffect({
      action: 'create',
      actorIdentifier: 'Devil',
      name: '+1 AC',
      changes: [{ key: 'system.attributes.ac.bonus', value: '1' }],
    });
    const call = calls.find(([n]) => n === 'manageEffect');
    expect(call?.[1].action).toBe('create');
    expect(call?.[1].effect.changes[0]).toMatchObject({
      key: 'system.attributes.ac.bonus',
      value: '1',
      type: 'add',
    });
    expect(res.message).toContain('+1 AC');
  });

  it('targets an embedded item when both ids are given', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'create',
      effectId: 'E2',
      name: 'Glow',
      actor: { id: 'a1', name: 'Hero' },
      item: { id: 'i1', name: 'Torch', type: 'equipment' },
    });
    await tool.handleManageEffect({
      action: 'create',
      actorIdentifier: 'Hero',
      itemIdentifier: 'Torch',
      name: 'Glow',
      changes: [{ key: 'system.attributes.ac.bonus', value: '0' }],
    });
    const call = calls.find(([n]) => n === 'manageEffect');
    expect(call?.[1].actorIdentifier).toBe('Hero');
    expect(call?.[1].itemIdentifier).toBe('Torch');
  });

  it('requires name + changes for create, effectId for edit/delete, and a target', async () => {
    const { tool } = makeTool();
    await expect(
      tool.handleManageEffect({ action: 'create', actorIdentifier: 'X', name: 'Y' })
    ).rejects.toThrow(/requires `name` and at least one/);
    await expect(tool.handleManageEffect({ action: 'edit', actorIdentifier: 'X' })).rejects.toThrow(
      /requires `effectId`/
    );
    await expect(
      tool.handleManageEffect({ action: 'delete', actorIdentifier: 'X' })
    ).rejects.toThrow(/requires `effectId`/);
    await expect(tool.handleManageEffect({ action: 'list' })).rejects.toThrow(
      /actorIdentifier and\/or itemIdentifier/
    );
  });
});

// dnd5e 6.0 — the contract advertises the rules types, the expiry vocabulary and the Filter
// shapes, and forwards them untouched to the page (which validates against the 6.0.1 source).
describe('manage-effect tool — dnd5e 6.0 surface', () => {
  it('advertises the four rules change types, the expiry events and the Filter union', () => {
    const { tool } = makeTool();
    const schema: any = tool.getToolDefinitions()[0].inputSchema;
    const changeType = schema.properties.changes.items.properties.type;
    for (const t of ['dnd5e.advantage', 'dnd5e.bonus', 'dnd5e.minimum', 'dnd5e.maximum']) {
      expect(changeType.enum).toContain(t);
    }
    expect(changeType.enum).toContain('add');
    const expiry = schema.properties.duration.properties.expiry;
    const expiryEnum = JSON.stringify(expiry);
    for (const e of ['turnEnd', 'shortRest', 'longRest', 'targetEnd', 'sourceStart']) {
      expect(expiryEnum).toContain(e);
    }
    expect(schema.properties.conditions).toBeDefined();
    expect(schema.properties.changes.items.properties.conditions).toBeDefined();
    expect(schema.properties.changes.items.properties.replacement.enum).toEqual([
      'origin',
      'target',
    ]);
    expect(schema.properties.magical.type).toBe('boolean');
  });

  it('forwards a rules change with its condition, an effect-level condition, magical and expiry', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'create',
      effectId: 'E9',
      name: 'Keen Aim',
      actor: { id: 'a1', name: 'Archer' },
    });
    await tool.handleManageEffect({
      action: 'create',
      actorIdentifier: 'Archer',
      name: 'Keen Aim',
      conditions: { k: 'statuses.bloodied', v: 1 },
      magical: true,
      duration: { expiry: 'targetEnd' },
      changes: [
        {
          key: 'attack',
          value: '1d4',
          type: 'dnd5e.bonus',
          conditions: { k: 'roll.attack.type', v: 'ranged' },
          replacement: 'origin',
        },
        { key: 'd20', value: '-1', type: 'dnd5e.advantage' },
      ],
    });
    const call = calls.find(([n]) => n === 'manageEffect');
    expect(call?.[1].effect.conditions).toEqual({ k: 'statuses.bloodied', v: 1 });
    expect(call?.[1].effect.magical).toBe(true);
    expect(call?.[1].effect.duration).toEqual({ expiry: 'targetEnd' });
    expect(call?.[1].effect.changes[0]).toMatchObject({
      key: 'attack',
      value: '1d4',
      type: 'dnd5e.bonus',
      conditions: { k: 'roll.attack.type', v: 'ranged' },
      replacement: 'origin',
    });
    expect(call?.[1].effect.changes[1]).toMatchObject({ type: 'dnd5e.advantage', value: '-1' });
  });

  it('accepts a JSON-string Filter and a null (clear) on edit; rejects an unknown expiry / replacement', async () => {
    const { tool, calls } = makeTool({
      success: true,
      action: 'edit',
      effectId: 'E1',
      actor: { id: 'a1', name: 'X' },
    });
    await tool.handleManageEffect({
      action: 'edit',
      actorIdentifier: 'X',
      effectId: 'E1',
      conditions: '{"k":"item.properties","o":"has","v":"thr"}',
    });
    expect(calls.find(([n]) => n === 'manageEffect')?.[1].effect.conditions).toBe(
      '{"k":"item.properties","o":"has","v":"thr"}'
    );
    calls.length = 0;
    await tool.handleManageEffect({
      action: 'edit',
      actorIdentifier: 'X',
      effectId: 'E1',
      conditions: null,
    });
    expect(calls.find(([n]) => n === 'manageEffect')?.[1].effect.conditions).toBeNull();
    await expect(
      tool.handleManageEffect({
        action: 'edit',
        actorIdentifier: 'X',
        effectId: 'E1',
        duration: { expiry: 'nextDawn' },
      })
    ).rejects.toThrow();
    await expect(
      tool.handleManageEffect({
        action: 'create',
        actorIdentifier: 'X',
        name: 'Y',
        changes: [{ key: 'k', value: '1', replacement: 'caster' }],
      })
    ).rejects.toThrow();
  });

  it('summarizes a list with conditional + rule tags', async () => {
    const { tool } = makeTool({
      success: true,
      actor: { id: 'a1', name: 'Archer' },
      effects: [
        {
          id: 'E1',
          name: 'Keen Aim',
          disabled: false,
          conditions: { k: 'statuses.bloodied', v: 1 },
          changes: [
            { key: 'attack', value: '1d4', type: 'dnd5e.bonus', rule: '+1d4 to attack rolls' },
          ],
        },
        { id: 'E2', name: 'Plain', disabled: true, changes: [] },
      ],
    });
    const res = await tool.handleManageEffect({ action: 'list', actorIdentifier: 'Archer' });
    expect(res.summary).toContain('"Keen Aim" (conditional; +1d4 to attack rolls)');
    expect(res.summary).toContain('"Plain" (disabled)');
  });
});
