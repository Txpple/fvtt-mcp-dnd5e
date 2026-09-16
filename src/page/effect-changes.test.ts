import { describe, expect, it } from 'vitest';
import {
  ADVANTAGE_VALUES,
  CORE_EXPIRY_EVENTS,
  DND5E_EXPIRY_EVENTS,
  EXPIRY_EVENTS,
  FILTER_COMPARISONS,
  FILTER_OPERATORS,
  ACTIVITY_DURATION_SCALAR_UNITS,
  DAMAGE_TYPES,
  MOVEMENT_TYPES,
  RULE_KEYS,
  RULE_TYPES,
} from '../utils/dnd5e-canonical.js';
import {
  EMPTY_CONDITIONS,
  describeFilter,
  describeRule,
  normalizeChange,
  normalizeConditions,
  normalizeDuration,
  normalizePatch,
  parseConditions,
  projectDuration,
  ruleChangeProblem,
  summarizeChanges,
  validateRuleChange,
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

  it('throws on an unknown unit and returns undefined for nothing usable', () => {
    expect(() => normalizeDuration({ value: 3, units: 'fortnights' })).toThrow(
      /not a Foundry duration unit/
    );
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

// ---------------------------------------------------------------------------------------------
// dnd5e 6.0 — Filters (effect + change conditions)
// ---------------------------------------------------------------------------------------------

describe('normalizeConditions (dnd5e 6.0 Filter JSON → persisted string)', () => {
  it('locks the Filter vocabulary (module/filter.mjs OPERATOR_FUNCTIONS + COMPARISON_FUNCTIONS)', () => {
    expect([...FILTER_OPERATORS]).toEqual(['AND', 'NAND', 'OR', 'NOR', 'XOR', 'NOT']);
    expect([...FILTER_COMPARISONS]).toEqual([
      'exact',
      'contains',
      'icontains',
      'startswith',
      'istartswith',
      'endswith',
      'iendswith',
      'empty',
      'has',
      'hasany',
      'hasall',
      'subsetof',
      'in',
      'gt',
      'gte',
      'lt',
      'lte',
    ]);
  });

  it('treats nothing / empty / "{}" / [] as no conditions → "{}" (the FiltersField initial)', () => {
    expect(EMPTY_CONDITIONS).toBe('{}');
    for (const empty of [undefined, null, '', '  ', '{}', {}, []]) {
      expect(normalizeConditions(empty, 'effect')).toBe('{}');
    }
  });

  it('serializes the wiki "Only when Bloodied" comparison (exact is the implicit default)', () => {
    expect(normalizeConditions({ k: 'statuses.bloodied', v: 1 }, 'effect')).toBe(
      '{"k":"statuses.bloodied","v":1}'
    );
  });

  it('accepts a JSON string and re-serializes only k / o / v', () => {
    expect(
      normalizeConditions('{"k":"item.properties","o":"has","v":"thr","label":"thrown"}', 'effect')
    ).toBe('{"k":"item.properties","o":"has","v":"thr"}');
  });

  it('serializes the wiki "ranged or thrown" OR operator with nested in / has', () => {
    const json = normalizeConditions(
      {
        o: 'OR',
        v: [
          { k: 'item.type.value', o: 'in', v: ['simpleR', 'martialR'] },
          { k: 'item.properties', o: 'has', v: 'thr' },
        ],
      },
      'effect'
    );
    expect(JSON.parse(json)).toEqual({
      o: 'OR',
      v: [
        { k: 'item.type.value', o: 'in', v: ['simpleR', 'martialR'] },
        { k: 'item.properties', o: 'has', v: 'thr' },
      ],
    });
  });

  it('keeps a top-level array (implicit AND) and a NOT with a single filter', () => {
    expect(
      JSON.parse(
        normalizeConditions(
          [
            { k: 'roll.skill', o: 'in', v: ['dec', 'itm', 'per'] },
            { o: 'NOT', v: { k: 'roll.ability', v: 'cha' } },
          ],
          'change'
        )
      )
    ).toEqual([
      { k: 'roll.skill', o: 'in', v: ['dec', 'itm', 'per'] },
      { o: 'NOT', v: { k: 'roll.ability', v: 'cha' } },
    ]);
  });

  it('defaults "empty" to true and lets "has" carry a nested filter', () => {
    expect(JSON.parse(normalizeConditions({ k: 'item.properties', o: 'empty' }, 'effect'))).toEqual(
      {
        k: 'item.properties',
        o: 'empty',
        v: true,
      }
    );
    expect(
      JSON.parse(
        normalizeConditions(
          { k: 'items', o: 'has', v: { k: 'type', v: 'weapon', extra: 1 } },
          'effect'
        )
      )
    ).toEqual({ k: 'items', o: 'has', v: { k: 'type', v: 'weapon' } });
  });

  it('rejects an unknown operator, a keyless comparison, a valueless comparison, and bad JSON', () => {
    expect(() => normalizeConditions({ k: 'a', o: 'equals', v: 1 }, 'effect')).toThrow(
      /unknown operator "equals"/
    );
    expect(() => normalizeConditions({ v: 1 }, 'effect')).toThrow(/needs a key path/);
    expect(() => normalizeConditions({ k: 'a' }, 'effect')).toThrow(/needs a value/);
    expect(() => normalizeConditions('{not json', 'effect')).toThrow(/not valid Filter JSON/);
    expect(() => normalizeConditions('nope', 'effect')).toThrow(/not valid Filter JSON/);
    expect(() => normalizeConditions(42, 'effect')).toThrow(/must be an object/);
  });

  it('rejects the wrong v shape for operators and typed comparisons', () => {
    expect(() => normalizeConditions({ o: 'AND', v: { k: 'a', v: 1 } }, 'effect')).toThrow(
      /AND takes a non-empty array/
    );
    expect(() => normalizeConditions({ o: 'OR', v: [] }, 'effect')).toThrow(/non-empty array/);
    expect(() => normalizeConditions({ o: 'NOT', v: [{ k: 'a', v: 1 }] }, 'effect')).toThrow(
      /NOT takes a single filter/
    );
    expect(() => normalizeConditions({ k: 'a', o: 'in', v: 'x' }, 'effect')).toThrow(
      /"in" takes a list/
    );
    expect(() => normalizeConditions({ k: 'a', o: 'gte', v: '10' }, 'effect')).toThrow(
      /"gte" takes a number/
    );
    expect(() => normalizeConditions({ k: 'a', o: 'empty', v: 'yes' }, 'effect')).toThrow(
      /"empty" takes true\/false/
    );
  });

  it('bars roll.* keys in effect scope (roll data only exists at roll time) but allows them on a change', () => {
    expect(() => normalizeConditions({ k: 'roll.ability', v: 'str' }, 'effect')).toThrow(
      /roll\.\* keys are only available on the conditions of a RULES-type change/
    );
    expect(normalizeConditions({ k: 'roll.ability', v: 'str' }, 'change')).toBe(
      '{"k":"roll.ability","v":"str"}'
    );
    // nested inside an operator too
    expect(() =>
      normalizeConditions({ o: 'AND', v: [{ k: 'roll.type', v: 'attack' }] }, 'effect')
    ).toThrow(/conditions\.v\[0\]\.k/);
  });
});

describe('parseConditions / describeFilter (read-back)', () => {
  it('parses a persisted string, returns null for empty / absent / invalid, passes objects through', () => {
    expect(parseConditions('{"k":"statuses.bloodied","v":1}')).toEqual({
      k: 'statuses.bloodied',
      v: 1,
    });
    expect(parseConditions('{}')).toBeNull();
    expect(parseConditions('')).toBeNull();
    expect(parseConditions(undefined)).toBeNull();
    expect(parseConditions('{oops')).toBeNull();
    expect(parseConditions({ k: 'a', v: 1 })).toEqual({ k: 'a', v: 1 });
    expect(parseConditions({})).toBeNull();
  });

  it('renders comparisons, lists, operators and NOT readably', () => {
    expect(describeFilter({ k: 'roll.ability', v: 'str' })).toBe('roll.ability = str');
    expect(describeFilter({ k: 'roll.skill', o: 'in', v: ['dec', 'itm'] })).toBe(
      'roll.skill in [dec, itm]'
    );
    expect(describeFilter({ k: 'item.properties', o: 'has', v: 'thr' })).toBe(
      'item.properties has thr'
    );
    expect(describeFilter({ k: 'x', o: 'gte', v: 10 })).toBe('x >= 10');
    expect(describeFilter({ k: 'x', o: 'empty' })).toBe('x is empty');
    expect(describeFilter({ k: 'x', o: 'empty', v: false })).toBe('x is not empty');
    expect(
      describeFilter({
        o: 'OR',
        v: [
          {
            o: 'AND',
            v: [
              { k: 'roll.ability', v: 'int' },
              { k: 'roll.skill', v: 'his' },
            ],
          },
          { o: 'NOT', v: { k: 'roll.proficient', v: true } },
        ],
      })
    ).toBe('((roll.ability = int AND roll.skill = his) OR NOT roll.proficient = true)');
    expect(
      describeFilter([
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ])
    ).toBe('(a = 1 AND b = 2)');
    expect(describeFilter([{ k: 'a', v: 1 }])).toBe('a = 1');
  });
});

// ---------------------------------------------------------------------------------------------
// dnd5e 6.0 — rules-type changes
// ---------------------------------------------------------------------------------------------

describe('rules-type changes (CONFIG.DND5E.activeEffectChangeTypes)', () => {
  it('locks the four rule types, six categories and the advantage vocabulary', () => {
    expect([...RULE_TYPES]).toEqual([
      'dnd5e.advantage',
      'dnd5e.bonus',
      'dnd5e.maximum',
      'dnd5e.minimum',
    ]);
    expect([...RULE_KEYS]).toEqual(['attack', 'check', 'd20', 'save', 'damage', 'healing']);
    expect([...ADVANTAGE_VALUES]).toEqual(['+1', '-1', '=+1', '=-1', '>=0', '<=0']);
  });

  it('normalizeChange keeps a rules change with its category key and stringified value', () => {
    expect(normalizeChange({ key: 'attack', value: '1d4', type: 'dnd5e.bonus' })).toEqual({
      key: 'attack',
      value: '1d4',
      type: 'dnd5e.bonus',
      phase: 'initial',
    });
    expect(normalizeChange({ key: 'attack', value: 10, type: 'dnd5e.minimum' }).value).toBe('10');
  });

  it('folds the advantage aliases (1 → +1, =1 → =+1) and accepts every listed value', () => {
    expect(normalizeChange({ key: 'd20', value: 1, type: 'dnd5e.advantage' }).value).toBe('+1');
    expect(normalizeChange({ key: 'd20', value: '=1', type: 'dnd5e.advantage' }).value).toBe('=+1');
    for (const v of ADVANTAGE_VALUES) {
      expect(validateRuleChange('dnd5e.advantage', 'save', v)).toBe(v);
    }
  });

  it('rejects an advantage value outside the vocabulary', () => {
    expect(() => normalizeChange({ key: 'd20', value: '+2', type: 'dnd5e.advantage' })).toThrow(
      /dnd5e\.advantage value must be one of/
    );
  });

  it('rejects a rules type on a data-path key, and a core type on a category key', () => {
    expect(() =>
      normalizeChange({ key: 'system.attributes.ac.bonus', value: '1', type: 'dnd5e.bonus' })
    ).toThrow(/its key must be a roll category/);
    expect(() => normalizeChange({ key: 'attack', value: '1', type: 'add' })).toThrow(
      /key "attack" is a roll category/
    );
    expect(() => normalizeChange({ key: 'damage', value: '1d4' })).toThrow(/roll category/);
  });

  it('allows damage / healing only with dnd5e.bonus', () => {
    expect(normalizeChange({ key: 'damage', value: '1d4[fire]', type: 'dnd5e.bonus' }).value).toBe(
      '1d4[fire]'
    );
    expect(normalizeChange({ key: 'healing', value: '@prof', type: 'dnd5e.bonus' }).value).toBe(
      '@prof'
    );
    for (const type of ['dnd5e.advantage', 'dnd5e.minimum', 'dnd5e.maximum'] as const) {
      expect(() => validateRuleChange(type, 'damage', '+1')).toThrow(/only supports dnd5e\.bonus/);
      expect(() => validateRuleChange(type, 'healing', '+1')).toThrow(/only supports dnd5e\.bonus/);
    }
  });

  it('requires a value for bonus / min / max and bars dice from min / max (deterministic formulas)', () => {
    expect(() => validateRuleChange('dnd5e.bonus', 'attack', '')).toThrow(/needs a value/);
    expect(() => validateRuleChange('dnd5e.minimum', 'attack', '1d4')).toThrow(/deterministic/);
    expect(() => validateRuleChange('dnd5e.maximum', 'check', 'd20')).toThrow(/deterministic/);
    expect(validateRuleChange('dnd5e.minimum', 'attack', '@prof')).toBe('@prof');
    expect(validateRuleChange('dnd5e.maximum', 'save', '@abilities.dex.mod + 2')).toBe(
      '@abilities.dex.mod + 2'
    );
  });

  it('describeRule renders the wiki worked examples readably', () => {
    expect(
      describeRule({
        type: 'dnd5e.minimum',
        key: 'attack',
        value: '10',
        conditions: '{"k":"roll.attack.type","v":"ranged"}',
      })
    ).toBe('d20 minimum 10 on attack rolls when roll.attack.type = ranged');
    expect(
      describeRule({
        type: 'dnd5e.bonus',
        key: 'damage',
        value: '1d4',
        conditions: '{"k":"roll.attack.mode","o":"startswith","v":"thrown"}',
      })
    ).toBe('+1d4 to damage rolls when roll.attack.mode starts with thrown');
    expect(
      describeRule({
        type: 'dnd5e.bonus',
        key: 'damage',
        value: '@prof',
        conditions: '{"k":"roll.damage.type","v":"fire"}',
      })
    ).toBe('+@prof to damage rolls when roll.damage.type = fire');
    expect(
      describeRule({
        type: 'dnd5e.advantage',
        key: 'd20',
        value: '-1',
        conditions: '{"k":"roll.ability","v":"str"}',
      })
    ).toBe('disadvantage on d20 tests when roll.ability = str');
    expect(describeRule({ type: 'dnd5e.advantage', key: 'save', value: '=+1' })).toBe(
      'forced advantage on saving throws'
    );
    expect(describeRule({ type: 'dnd5e.advantage', key: 'check', value: '>=0' })).toBe(
      'immune to disadvantage on ability checks'
    );
    expect(describeRule({ type: 'dnd5e.advantage', key: 'attack', value: '1' })).toBe(
      'advantage on attack rolls'
    );
    expect(describeRule({ type: 'dnd5e.maximum', key: 'd20', value: '15' })).toBe(
      'd20 maximum 15 on d20 tests'
    );
    expect(describeRule({ type: 'dnd5e.bonus', key: 'healing', value: '-2' })).toBe(
      '-2 to healing rolls'
    );
    expect(
      describeRule({ type: 'add', key: 'system.attributes.ac.bonus', value: '1' })
    ).toBeUndefined();
  });
});

describe('normalizeChange — per-change conditions / replacement / priority (dnd5e 6.0)', () => {
  it('validates change conditions in CHANGE scope (roll.* allowed) and persists the JSON string', () => {
    expect(
      normalizeChange({
        key: 'check',
        value: '1d4',
        type: 'dnd5e.bonus',
        conditions: { k: 'roll.skill', o: 'in', v: ['his', 'med'] },
      })
    ).toEqual({
      key: 'check',
      value: '1d4',
      type: 'dnd5e.bonus',
      phase: 'initial',
      conditions: '{"k":"roll.skill","o":"in","v":["his","med"]}',
    });
  });

  it('omits empty conditions, keeps a valid replacement, drops an empty one, rejects an unknown one', () => {
    expect(normalizeChange({ key: 'k', value: 1, conditions: {} })).toEqual({
      key: 'k',
      value: '1',
      type: 'add',
      phase: 'initial',
    });
    expect(
      normalizeChange({ key: 'k', value: '@abilities.wis.mod', replacement: 'origin' }).replacement
    ).toBe('origin');
    expect(normalizeChange({ key: 'k', value: 1, replacement: '' })).not.toHaveProperty(
      'replacement'
    );
    expect(() => normalizeChange({ key: 'k', value: 1, replacement: 'caster' })).toThrow(
      /replacement must be "origin" or "target"/
    );
  });

  it('keeps a numeric priority', () => {
    expect(normalizeChange({ key: 'k', value: 1, priority: 20 }).priority).toBe(20);
    expect(normalizeChange({ key: 'k', value: 1, priority: 'high' })).not.toHaveProperty(
      'priority'
    );
  });

  it('surfaces a bad change condition with the change context', () => {
    expect(() =>
      normalizeChange({
        key: 'attack',
        value: '1',
        type: 'dnd5e.bonus',
        conditions: { k: 'a', o: 'nope', v: 1 },
      })
    ).toThrow(/unknown operator "nope"/);
  });
});

describe('summarizeChanges — 6.0 read-back extras', () => {
  it('adds parsed conditions, replacement and a readable rule only when present', () => {
    expect(
      summarizeChanges([
        {
          key: 'system.attributes.ac.bonus',
          value: '1',
          type: 'add',
          conditions: '{}',
          replacement: '',
        },
        {
          key: 'attack',
          value: '1d4',
          type: 'dnd5e.bonus',
          conditions: '{"k":"roll.attack.type","v":"ranged"}',
          replacement: 'origin',
        },
      ])
    ).toEqual([
      { key: 'system.attributes.ac.bonus', value: '1', type: 'add' },
      {
        key: 'attack',
        value: '1d4',
        type: 'dnd5e.bonus',
        conditions: { k: 'roll.attack.type', v: 'ranged' },
        replacement: 'origin',
        rule: '+1d4 to attack rolls when roll.attack.type = ranged',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// dnd5e 6.0 — expiry events
// ---------------------------------------------------------------------------------------------

describe('normalizeDuration — expiry events (core + dnd5e 6.0)', () => {
  it('locks the vocabulary: 6 core combat events + 2 rest events + 4 source/target pseudo events', () => {
    expect([...CORE_EXPIRY_EVENTS]).toEqual([
      'combatStart',
      'roundStart',
      'turnStart',
      'combatEnd',
      'roundEnd',
      'turnEnd',
    ]);
    expect([...DND5E_EXPIRY_EVENTS]).toEqual([
      'shortRest',
      'longRest',
      'sourceStart',
      'sourceEnd',
      'targetStart',
      'targetEnd',
    ]);
    expect(EXPIRY_EVENTS).toHaveLength(12);
  });

  it('keeps a core expiry alongside a finite duration', () => {
    expect(normalizeDuration({ value: 1, units: 'rounds', expiry: 'turnEnd' })).toEqual({
      value: 1,
      units: 'rounds',
      expiry: 'turnEnd',
    });
    expect(normalizeDuration({ rounds: 10, expiry: 'roundEnd' })).toEqual({
      value: 10,
      units: 'rounds',
      expiry: 'roundEnd',
    });
  });

  it('keeps a core expiry with NO value (it expires at the first matching event)', () => {
    // Core 14.367 ActiveEffectRegistry#refresh: durationReached = remaining <= 0 ||
    // !Number.isFinite(remaining), and _prepareDuration yields remaining: Infinity with no value.
    expect(normalizeDuration({ expiry: 'combatEnd' })).toEqual({ expiry: 'combatEnd' });
    expect(normalizeDuration({ expiry: 'turnEnd' })).toEqual({ expiry: 'turnEnd' });
  });

  it('accepts the long time units and throws on an unknown one', () => {
    expect(normalizeDuration({ value: 2, units: 'months' })).toEqual({ value: 2, units: 'months' });
    expect(normalizeDuration({ value: 1, units: 'years' })).toEqual({ value: 1, units: 'years' });
    expect(() => normalizeDuration({ value: 1, units: 'fortnights' })).toThrow(
      /not a Foundry duration unit/
    );
  });

  it('drops value + units for the duration-less dnd5e expiries (the system nulls them anyway)', () => {
    expect(normalizeDuration({ expiry: 'targetEnd' })).toEqual({ expiry: 'targetEnd' });
    expect(normalizeDuration({ value: 1, units: 'rounds', expiry: 'sourceStart' })).toEqual({
      expiry: 'sourceStart',
    });
    expect(normalizeDuration({ expiry: 'longRest' })).toEqual({ expiry: 'longRest' });
    expect(normalizeDuration({ expiry: 'shortRest' })).toEqual({ expiry: 'shortRest' });
  });

  it('rejects an expiry outside the vocabulary and passes an explicit null through', () => {
    expect(() => normalizeDuration({ expiry: 'nextDawn' })).toThrow(/not an expiry event/);
    expect(normalizeDuration({ value: 2, units: 'turns', expiry: null })).toEqual({
      value: 2,
      units: 'turns',
      expiry: null,
    });
  });
});

describe('ruleChangeProblem (content-audit predicate over PERSISTED changes)', () => {
  it('is silent for a sound core change and a sound rules change', () => {
    expect(
      ruleChangeProblem({ key: 'system.attributes.ac.bonus', value: '1', type: 'add' })
    ).toBeUndefined();
    expect(ruleChangeProblem({ key: 'attack', value: '1d4', type: 'dnd5e.bonus' })).toBeUndefined();
    expect(ruleChangeProblem({ key: 'd20', value: '+1', type: 'dnd5e.advantage' })).toBeUndefined();
    expect(ruleChangeProblem({ key: 'k', value: '1', mode: 2 })).toBeUndefined();
  });

  it('names a rules type on a data path, a non-bonus damage rule, a bad advantage value, and a core type on a category', () => {
    expect(
      ruleChangeProblem({ key: 'system.attributes.ac.bonus', value: '1', type: 'dnd5e.bonus' })
    ).toMatch(/must be a roll category/);
    expect(ruleChangeProblem({ key: 'damage', value: '+1', type: 'dnd5e.advantage' })).toMatch(
      /only supports dnd5e\.bonus/
    );
    expect(ruleChangeProblem({ key: 'save', value: 'yes', type: 'dnd5e.advantage' })).toMatch(
      /value must be one of/
    );
    expect(ruleChangeProblem({ key: 'attack', value: '2', type: 'add' })).toMatch(
      /writes to nowhere/
    );
    expect(ruleChangeProblem({ key: 'attack', value: '2', mode: 2 })).toMatch(/writes to nowhere/);
  });
});

describe('projectDuration (the read-back shape both page paths emit)', () => {
  it('projects a finite duration with its units, expiry and finite remaining', () => {
    expect(
      projectDuration({ value: 10, units: 'rounds', expiry: 'turnEnd', remaining: 6 })
    ).toEqual({ value: 10, units: 'rounds', expiry: 'turnEnd', remaining: 6 });
    expect(projectDuration({ value: 60 })).toEqual({ value: 60, units: 'seconds' });
  });

  it('projects a value-less expiry, dropping a non-finite remaining', () => {
    expect(projectDuration({ expiry: 'targetEnd', remaining: Infinity })).toEqual({
      expiry: 'targetEnd',
    });
    expect(projectDuration({ value: null, expiry: 'turnEnd', remaining: 3 })).toEqual({
      expiry: 'turnEnd',
      remaining: 3,
    });
  });

  it('returns null for a permanent / passive (or absent) duration', () => {
    expect(projectDuration({ value: null, units: null })).toBeNull();
    expect(projectDuration(undefined)).toBeNull();
  });
});

describe('change type + phase (CONST.ACTIVE_EFFECT_CHANGE_TYPES / _PHASES)', () => {
  it('accepts the core subtract type', () => {
    expect(
      normalizeChange({ key: 'system.traits.di.value', value: 'fire', type: 'subtract' })
    ).toEqual({ key: 'system.traits.di.value', value: 'fire', type: 'subtract', phase: 'initial' });
  });

  it('refuses a type outside the core + rules vocabulary', () => {
    expect(() => normalizeChange({ key: 'a', value: '1', type: 'divide' })).toThrow(
      /is not a change type/
    );
  });

  it('accepts phase "final" and refuses anything else', () => {
    expect(normalizeChange({ key: 'a', value: '1', phase: 'final' }).phase).toBe('final');
    expect(normalizeChange({ key: 'a', value: '1' }).phase).toBe('initial');
    expect(() => normalizeChange({ key: 'a', value: '1', phase: 'late' })).toThrow(
      /must be "initial" or "final"/
    );
  });
});

describe('R1-012 — roll.* conditions belong to a RULES-type change only', () => {
  it('keeps roll.* on a rules change', () => {
    const out = normalizeChange({
      key: 'attack',
      value: '1d4',
      type: 'dnd5e.bonus',
      conditions: { k: 'roll.attack.type', v: 'ranged' },
    });
    expect(JSON.parse(String(out.conditions))).toEqual({ k: 'roll.attack.type', v: 'ranged' });
  });

  it('refuses roll.* on a CORE-type change, naming the rules types', () => {
    expect(() =>
      normalizeChange({
        key: 'system.attributes.ac.bonus',
        value: '2',
        type: 'add',
        conditions: { k: 'roll.ability', v: 'str' },
      })
    ).toThrow(/dnd5e\.advantage \/ dnd5e\.bonus/);
  });

  it('still allows non-roll conditions on a core-type change', () => {
    const out = normalizeChange({
      key: 'system.attributes.ac.bonus',
      value: '2',
      type: 'add',
      conditions: { k: 'statuses.bloodied', v: 1 },
    });
    expect(JSON.parse(String(out.conditions))).toEqual({ k: 'statuses.bloodied', v: 1 });
  });

  it('ruleChangeProblem flags a persisted core-type change conditioned on roll.*', () => {
    expect(
      ruleChangeProblem({
        key: 'system.attributes.ac.bonus',
        value: '2',
        type: 'add',
        conditions: JSON.stringify({ o: 'AND', v: [{ k: 'roll.ability', v: 'str' }] }),
      })
    ).toMatch(/no roll data/);
    expect(
      ruleChangeProblem({
        key: 'system.attributes.ac.bonus',
        value: '2',
        type: 'add',
        conditions: JSON.stringify({ k: 'statuses.bloodied', v: 1 }),
      })
    ).toBeUndefined();
  });
});

describe('canonical vocabularies locked against the dnd5e 6.0.1 source', () => {
  it('CONFIG.DND5E.damageTypes has 13 keys (no none / vitality)', () => {
    expect(DAMAGE_TYPES.size).toBe(13);
    expect(DAMAGE_TYPES.has('none')).toBe(false);
    expect(DAMAGE_TYPES.has('vitality')).toBe(false);
  });

  it('CONFIG.DND5E.movementTypes has 6 keys, including jump', () => {
    expect(MOVEMENT_TYPES).toEqual(['walk', 'burrow', 'climb', 'fly', 'jump', 'swim']);
    expect(MOVEMENT_TYPES.length).toBe(6);
  });

  it('drops week from the scalar activity duration units (timeUnits marks it option: false)', () => {
    expect(ACTIVITY_DURATION_SCALAR_UNITS).not.toContain('week');
    expect(ACTIVITY_DURATION_SCALAR_UNITS).toEqual([
      'turn',
      'round',
      'minute',
      'hour',
      'day',
      'month',
      'year',
    ]);
  });
});
