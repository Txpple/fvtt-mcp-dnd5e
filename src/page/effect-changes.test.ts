import { describe, expect, it } from 'vitest';
import {
  normalizeChange,
  normalizeDuration,
  normalizePatch,
  summarizeChanges,
} from './effect-changes.js';

// These lock the dnd5e/Foundry-v14 ActiveEffect change mapping. If a Foundry version renumbers
// CONST.ACTIVE_EFFECT_MODES or changes the { key, value, type, phase } shape, these fail OFFLINE
// instead of letting the live write path silently author a wrong effect.

describe('normalizeChange', () => {
  it('passes a string type through and stringifies the value (with phase default)', () => {
    expect(normalizeChange({ key: 'system.attributes.ac.bonus', value: 2, type: 'add' })).toEqual({
      key: 'system.attributes.ac.bonus',
      value: '2',
      type: 'add',
      phase: 'initial',
    });
  });

  it('maps every legacy numeric mode to its v14 string type (CONST.ACTIVE_EFFECT_MODES)', () => {
    const modeToType: Array<[number, string]> = [
      [0, 'custom'],
      [1, 'multiply'],
      [2, 'add'],
      [3, 'downgrade'],
      [4, 'upgrade'],
      [5, 'override'],
    ];
    for (const [mode, type] of modeToType) {
      expect(normalizeChange({ key: 'k', value: 1, mode }).type).toBe(type);
    }
  });

  it('falls back to "add" for an unknown numeric mode', () => {
    expect(normalizeChange({ key: 'k', value: 1, mode: 99 }).type).toBe('add');
  });

  it('defaults type to "add" when neither type nor mode is present', () => {
    expect(normalizeChange({ key: 'k', value: 1 }).type).toBe('add');
  });

  it('prefers an explicit string type over a legacy numeric mode', () => {
    expect(normalizeChange({ key: 'k', value: 1, type: 'override', mode: 2 }).type).toBe(
      'override'
    );
  });

  it('coerces a missing key to "" and missing/null value to "", but keeps a 0 value', () => {
    expect(normalizeChange({})).toEqual({ key: '', value: '', type: 'add', phase: 'initial' });
    expect(normalizeChange({ key: 'k', value: null }).value).toBe('');
    expect(normalizeChange({ key: 'k', value: 0 }).value).toBe('0');
  });

  it('passes an explicit phase through', () => {
    expect(normalizeChange({ key: 'k', value: 1, phase: 'final' }).phase).toBe('final');
  });
});

describe('summarizeChanges', () => {
  it('returns [] for missing or empty input', () => {
    expect(summarizeChanges(undefined as any)).toEqual([]);
    expect(summarizeChanges([])).toEqual([]);
  });

  it('surfaces type from a string type or a legacy numeric mode', () => {
    expect(
      summarizeChanges([
        { key: 'a', value: '1', type: 'override' },
        { key: 'b', value: '2', mode: 2 },
      ])
    ).toEqual([
      { key: 'a', value: '1', type: 'override' },
      { key: 'b', value: '2', type: 'add' },
    ]);
  });

  it('reports an undefined type for an unknown legacy mode', () => {
    expect(summarizeChanges([{ key: 'c', value: '3', mode: 99 }])).toEqual([
      { key: 'c', value: '3', type: undefined },
    ]);
  });
});

describe('normalizeDuration (Foundry v14 { value, units } shape)', () => {
  it('passes the native shape through', () => {
    expect(normalizeDuration({ value: 10, units: 'rounds' })).toEqual({
      value: 10,
      units: 'rounds',
    });
    expect(normalizeDuration({ value: 1, units: 'hours', expiry: 'turnEnd' })).toEqual({
      value: 1,
      units: 'hours',
      expiry: 'turnEnd',
    });
  });

  it('translates the 5.x rounds / turns / seconds keys (first wins, like core)', () => {
    expect(normalizeDuration({ rounds: 10 })).toEqual({ value: 10, units: 'rounds' });
    expect(normalizeDuration({ turns: 1 })).toEqual({ value: 1, units: 'turns' });
    expect(normalizeDuration({ seconds: 60, rounds: 10 })).toEqual({ value: 60, units: 'seconds' });
  });

  it('drops an unknown unit and returns undefined for nothing usable', () => {
    expect(normalizeDuration({ value: 3, units: 'fortnights' })).toEqual({ value: 3 });
    expect(normalizeDuration(undefined)).toBeUndefined();
    expect(normalizeDuration({})).toBeUndefined();
  });
});

describe('normalizePatch', () => {
  it('rewrites 5.x duration.rounds/turns/seconds dot-paths and leaves the rest alone', () => {
    expect(normalizePatch({ 'duration.rounds': 10, tint: '#ff0000' })).toEqual({
      'duration.value': 10,
      'duration.units': 'rounds',
      tint: '#ff0000',
    });
    expect(normalizePatch({ 'duration.value': 2, 'duration.units': 'turns' })).toEqual({
      'duration.value': 2,
      'duration.units': 'turns',
    });
  });
});
