/**
 * Offline unit tests for the shared activity builder (src/page/dnd5e/activities.ts).
 *
 * The attack + save cases pin the EXACT object shapes that addAttackToActor /
 * addAttackWithSaveToActor used to build inline — proving routing those tools through buildActivity
 * is behaviorally identical (no drift). The heal/check/utility/damage cases assert the lean shapes
 * (dnd5e fills the rest on create, verified live).
 */

import { describe, it, expect } from 'vitest';
import {
  assertEditableActivityFields,
  behaviorId,
  buildActivity,
  buildActivityBehavior,
  buildAppliedEffect,
  damagePartToActivity,
  normalizeActivityDuration,
  normalizeActivityTarget,
} from './activities.js';

describe('damagePartToActivity', () => {
  it('maps a raw part to the dnd5e activity-part shape', () => {
    expect(damagePartToActivity({ number: 2, denomination: 6, type: 'fire' })).toEqual({
      types: ['fire'],
      number: 2,
      denomination: 6,
      bonus: '',
      scaling: { mode: '', number: 1 },
      custom: { enabled: false },
    });
  });
});

describe("buildActivity('attack') — byte-equivalent to the old inline attack activity", () => {
  it('2014 melee, no bonus, single base part (no activity parts)', () => {
    const act = buildActivity('attack', {
      id: 'ACT0000000000000',
      activationType: 'action',
      attackType: 'melee',
      attackBonus: 0,
      classification: 'weapon',
      includeBase: true,
      damageParts: [],
    });
    expect(act).toEqual({
      _id: 'ACT0000000000000',
      type: 'attack',
      name: '',
      img: '',
      sort: 0,
      description: {},
      activation: { type: 'action', value: 1, condition: '', override: false },
      duration: { units: '', value: '', override: false },
      target: {
        template: {
          count: '',
          contiguous: false,
          type: '',
          size: '',
          width: '',
          height: '',
          units: '',
        },
        affects: { count: '', type: '', choice: false, special: '' },
        prompt: true,
        override: false,
      },
      range: { units: 'self', override: false },
      uses: { spent: 0, max: '', recovery: [] },
      consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
      attack: {
        ability: '',
        bonus: '',
        critical: { threshold: null },
        flat: false,
        type: { value: 'melee', classification: 'weapon' },
      },
      damage: { critical: { bonus: '' }, includeBase: true, parts: [] },
      effects: [],
      save: { ability: '', dc: { formula: '', calculation: '' } },
    });
  });

  it('2024 sets attack.ability and emits extra damage parts; bonus formats to a string', () => {
    const act = buildActivity('attack', {
      id: 'ACT0000000000000',
      attackType: 'ranged',
      attackBonus: 2,
      classification: '',
      ability: 'dex',
      damageParts: [{ number: 1, denomination: 4, type: 'fire' }],
    });
    expect(act.attack.ability).toBe('dex');
    expect(act.attack.bonus).toBe('2');
    expect(act.attack.type).toEqual({ value: 'ranged', classification: '' });
    expect(act.damage.parts).toEqual([
      damagePartToActivity({ number: 1, denomination: 4, type: 'fire' }),
    ]);
  });
});

describe("buildActivity('save') — byte-equivalent to the old inline save activity", () => {
  it('builds the sort-1 save activity with independent damage', () => {
    const act = buildActivity('save', {
      id: 'SAV0000000000000',
      sort: 1,
      activationType: 'action',
      saveAbility: 'con',
      saveDC: 15,
      onSave: 'none',
      damageParts: [{ number: 2, denomination: 6, type: 'poison' }],
    });
    expect(act).toEqual({
      _id: 'SAV0000000000000',
      type: 'save',
      name: '',
      sort: 1,
      description: {},
      activation: { type: 'action', value: 1, override: false },
      duration: { units: 'inst', concentration: false, override: false },
      effects: [],
      range: { units: 'self', override: false },
      uses: { spent: 0, recovery: [] },
      consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
      target: {
        template: {
          count: '',
          contiguous: false,
          type: '',
          size: '',
          width: '',
          height: '',
          units: '',
        },
        affects: { count: '1', type: 'creature', choice: false, special: '' },
        override: false,
        prompt: true,
      },
      damage: {
        onSave: 'none',
        parts: [damagePartToActivity({ number: 2, denomination: 6, type: 'poison' })],
      },
      save: { ability: ['con'], dc: { calculation: '', formula: '15' } },
    });
  });
});

describe('buildActivity — lean types (heal / check / utility / damage)', () => {
  it('heal carries a healing object', () => {
    const a = buildActivity('heal', {
      id: 'H',
      name: 'Cure',
      healing: { number: 2, denomination: 8, type: 'healing' },
    });
    expect(a.type).toBe('heal');
    expect(a.name).toBe('Cure');
    expect(a.healing).toMatchObject({ number: 2, denomination: 8, types: ['healing'] });
  });

  it('check carries ability + dc + associated skills', () => {
    const a = buildActivity('check', {
      id: 'C',
      checkAbility: 'dex',
      checkDC: 15,
      skills: ['acr'],
    });
    expect(a.type).toBe('check');
    expect(a.check).toEqual({
      associated: ['acr'],
      ability: 'dex',
      dc: { calculation: '', formula: '15' },
    });
  });

  it('utility is minimal (e.g. Multiattack)', () => {
    const a = buildActivity('utility', { id: 'U', name: 'Multiattack' });
    expect(a.type).toBe('utility');
    expect(a.name).toBe('Multiattack');
  });

  it('damage carries activity parts', () => {
    const a = buildActivity('damage', {
      id: 'D',
      damageParts: [{ number: 3, denomination: 6, type: 'fire' }],
    });
    expect(a.type).toBe('damage');
    expect(a.damage.parts).toHaveLength(1);
  });

  it('cast (save spell, charged) — byte-equivalent to the live Wand of Fireballs shape', () => {
    const a = buildActivity('cast', {
      id: 'CAST000000000000',
      name: 'Cast Fireball',
      spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00',
      level: 3,
      spellProperties: ['vocal', 'somatic', 'material'],
      saveDC: 15,
      charges: 1,
    });
    expect(a).toEqual({
      _id: 'CAST000000000000',
      type: 'cast',
      name: 'Cast Fireball',
      img: '',
      sort: 0,
      spell: {
        uuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplFireball00',
        challenge: { save: '15', attack: '', override: true },
        level: 3,
        properties: ['vocal', 'somatic', 'material'],
        spellbook: true,
      },
      activation: { type: 'action', value: null, override: false },
      consumption: {
        scaling: { allowed: false, max: '' },
        spellSlot: false,
        targets: [{ type: 'itemUses', value: '1', target: '', scaling: { mode: '', formula: '' } }],
      },
      description: { chatFlavor: '' },
      duration: { units: 'inst', concentration: false, override: false },
      range: { override: false, units: 'self' },
      target: {
        template: { contiguous: false, units: 'ft', stationary: false },
        affects: { choice: false },
        override: false,
        prompt: true,
      },
      uses: { spent: 0, recovery: [], max: '' },
      flags: {},
      visibility: {
        level: {},
        requireAttunement: false,
        requireIdentification: false,
        requireMagic: false,
      },
    });
  });

  it('cast challenge: attackBonus pins a fixed spell-attack (no save key)', () => {
    const a = buildActivity('cast', {
      id: 'C',
      spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplWitchBolt0',
      attackBonus: 5,
      charges: 1,
    });
    expect(a.spell.challenge).toEqual({ attack: '5', save: '', override: true });
  });

  it('cast challenge: neither saveDC nor attackBonus defers to the caster (override:false)', () => {
    const a = buildActivity('cast', {
      id: 'C',
      spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplMagicMissi',
      charges: 1,
    });
    expect(a.spell.challenge).toEqual({ attack: '', save: '', override: false });
  });

  it('cast without charges is at-will (empty consumption targets)', () => {
    const a = buildActivity('cast', {
      id: 'C',
      spellUuid: 'Compendium.dnd-players-handbook.spells.Item.phbsplRayOfFrost',
      level: 0,
    });
    expect(a.consumption.targets).toEqual([]);
    expect(a.consumption.spellSlot).toBe(false);
  });

  it('throws on an unknown activity type', () => {
    expect(() => buildActivity('bogus', { id: 'X' })).toThrow(/Unknown activity type/);
  });
});

describe('normalizeActivityDuration + buildActivity duration override (dnd5e 6.0)', () => {
  it('returns undefined for nothing, and the DurationField shape for a scalar duration', () => {
    expect(normalizeActivityDuration(undefined)).toBeUndefined();
    expect(normalizeActivityDuration({})).toBeUndefined();
    expect(normalizeActivityDuration({ value: 1, units: 'minute' })).toEqual({
      value: '1',
      units: 'minute',
    });
    expect(
      normalizeActivityDuration({ value: '@prof', units: 'round', concentration: true })
    ).toEqual({
      value: '@prof',
      units: 'round',
      concentration: true,
    });
  });

  it('drops the value for a special / permanent unit and keeps a lone expiry', () => {
    expect(normalizeActivityDuration({ value: 3, units: 'inst' })).toEqual({ units: 'inst' });
    expect(normalizeActivityDuration({ value: 3, units: 'perm' })).toEqual({ units: 'perm' });
    expect(normalizeActivityDuration({ expiry: 'targetEnd' })).toEqual({ expiry: 'targetEnd' });
    expect(normalizeActivityDuration({ expiry: null })).toEqual({ expiry: null });
  });

  it('rejects an unknown unit, a scalar unit without a value, and an unknown expiry', () => {
    expect(() => normalizeActivityDuration({ units: 'fortnight' })).toThrow(
      /not a dnd5e time period/
    );
    expect(() => normalizeActivityDuration({ units: 'minute' })).toThrow(/needs a duration\.value/);
    expect(() => normalizeActivityDuration({ expiry: 'nextDawn' })).toThrow(/not an expiry event/);
  });

  it('buildActivity merges the duration over the type default and sets override:true', () => {
    const act = buildActivity('utility', {
      id: 'ACT0000000000000',
      name: 'Frightful Presence',
      duration: { value: 1, units: 'minute', expiry: 'targetEnd' },
    });
    expect(act.duration).toEqual({
      value: '1',
      units: 'minute',
      expiry: 'targetEnd',
      override: true,
    });
    const save = buildActivity('save', {
      id: 'ACT0000000000001',
      saveAbility: 'wis',
      saveDC: 13,
      duration: { expiry: 'sourceStart' },
    });
    expect(save.duration).toEqual({
      units: 'inst',
      concentration: false,
      expiry: 'sourceStart',
      override: true,
    });
  });

  it('leaves the duration untouched when none is given (no drift on the pinned shapes)', () => {
    const act = buildActivity('utility', { id: 'ACT0000000000000' });
    expect(act).not.toHaveProperty('duration');
  });
});

describe('normalizeActivityTarget (area template + affects, dnd5e 6.0 areas)', () => {
  it('returns undefined for nothing and the TargetField shape (string formulas, ft default)', () => {
    expect(normalizeActivityTarget(undefined, undefined)).toBeUndefined();
    expect(normalizeActivityTarget({ type: 'cube', size: 20 }, undefined)).toEqual({
      template: { type: 'cube', size: '20', units: 'ft' },
    });
    expect(
      normalizeActivityTarget(
        { type: 'line', size: 60, width: 5, units: 'ft', count: 2 },
        { type: 'enemy', count: 1, choice: true }
      )
    ).toEqual({
      template: { type: 'line', size: '60', width: '5', units: 'ft', count: '2' },
      affects: { type: 'enemy', count: '1', choice: true },
    });
  });

  it('rejects an unknown shape, a missing size, and an unknown affects type', () => {
    expect(() => normalizeActivityTarget({ type: 'blob', size: 5 }, undefined)).toThrow(
      /not an area shape/
    );
    expect(() => normalizeActivityTarget({ type: 'sphere', size: '' }, undefined)).toThrow(
      /template\.size is required/
    );
    expect(() => normalizeActivityTarget(undefined, { type: 'foes' })).toThrow(/not a target type/);
  });
});

describe('buildActivityBehavior (dnd5e 6.0 activity.behaviors[] — AppliedBehaviorField)', () => {
  it('builds an applyActiveEffect entry with type + config written together', () => {
    expect(
      buildActivityBehavior(
        {
          type: 'applyActiveEffect',
          name: 'Webbed',
          effectUuids: ['Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa'],
          sizes: ['med', 'lg'],
          creatureTypes: ['humanoid'],
          level: { min: 2 },
        },
        'ACT000000000000b00'.slice(0, 16)
      )
    ).toEqual({
      _id: 'ACT000000000000b',
      type: 'applyActiveEffect',
      name: 'Webbed',
      level: { min: 2 },
      config: {
        effects: ['Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa'],
        sizes: ['med', 'lg'],
        types: ['humanoid'],
      },
    });
  });

  it('builds a difficultTerrain entry (types only) and defaults the lists', () => {
    expect(buildActivityBehavior({ type: 'difficultTerrain', terrainTypes: ['web'] }, 'B')).toEqual(
      {
        _id: 'B',
        type: 'difficultTerrain',
        name: '',
        level: {},
        config: { types: ['web'] },
      }
    );
    expect(buildActivityBehavior({ type: 'difficultTerrain' }, 'B').config).toEqual({ types: [] });
  });

  it('rejects an unknown type, an applyActiveEffect without effects, and unknown vocab keys', () => {
    expect(() => buildActivityBehavior({ type: 'lava' }, 'B')).toThrow(/behavior type "lava"/);
    expect(() => buildActivityBehavior({ type: 'applyActiveEffect' }, 'B')).toThrow(
      /needs at least one effect/
    );
    expect(() =>
      buildActivityBehavior(
        { type: 'applyActiveEffect', effectUuids: ['x'], sizes: ['giant'] },
        'B'
      )
    ).toThrow(/size "giant" is unknown/);
    expect(() =>
      buildActivityBehavior(
        { type: 'applyActiveEffect', effectUuids: ['x'], creatureTypes: ['robot'] },
        'B'
      )
    ).toThrow(/creature type "robot"/);
    expect(() =>
      buildActivityBehavior({ type: 'difficultTerrain', terrainTypes: ['lava'] }, 'B')
    ).toThrow(/terrain type "lava"/);
  });

  it('behaviorId derives a 16-char alphanumeric id per behavior of an activity', () => {
    expect(behaviorId('ACT0000000000000', 0)).toBe('ACT0000000000b00');
    expect(behaviorId('ACT0000000000000', 0)).toHaveLength(16);
    expect(behaviorId('ACT0000000000000', 1)).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(behaviorId('ACT0000000000000', 1)).not.toBe(behaviorId('ACT0000000000000', 0));
    expect(behaviorId('x', 3)).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});

describe('buildActivity — template / affects / behaviors (an authored Web)', () => {
  it('merges the template + affects over the save default with target.override and carries behaviors', () => {
    const act = buildActivity('save', {
      id: 'ACT0000000000000',
      saveAbility: 'dex',
      saveDC: 13,
      template: { type: 'cube', size: 20 },
      affects: { type: 'creature' },
      behaviors: [
        {
          type: 'applyActiveEffect',
          effectUuids: ['Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa'],
        },
        { type: 'difficultTerrain', terrainTypes: ['web'] },
      ],
    });
    expect(act.target.override).toBe(true);
    expect(act.target.template).toMatchObject({ type: 'cube', size: '20', units: 'ft' });
    expect(act.target.affects).toMatchObject({ type: 'creature', count: '1' });
    expect(act.behaviors).toHaveLength(2);
    expect(act.behaviors[0]).toMatchObject({
      type: 'applyActiveEffect',
      config: {
        effects: ['Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa'],
        sizes: [],
        types: [],
      },
    });
    expect(act.behaviors[1]).toMatchObject({
      type: 'difficultTerrain',
      config: { types: ['web'] },
    });
    expect(act.behaviors[0]._id).not.toBe(act.behaviors[1]._id);
  });

  it('refuses behaviors without an area template', () => {
    expect(() =>
      buildActivity('utility', {
        id: 'ACT0000000000000',
        behaviors: [{ type: 'difficultTerrain' }],
      })
    ).toThrow(/ride on an AREA TEMPLATE/);
  });
});

describe("buildActivity('teleport') — dnd5e 6.0", () => {
  it('always overrides the distance (a self range would mean 0) and targets self by default', () => {
    const act = buildActivity('teleport', {
      id: 'ACT0000000000000',
      name: 'Misty Step',
      activationType: 'bonus',
      teleportDistance: 30,
    });
    expect(act).toEqual({
      _id: 'ACT0000000000000',
      type: 'teleport',
      name: 'Misty Step',
      sort: 0,
      activation: { type: 'bonus', value: 1, override: false },
      range: { units: 'self', override: false },
      target: { affects: { type: 'self', count: '' }, override: true },
      teleport: { override: true, units: 'ft', value: '30' },
    });
  });

  it('a blank distance = any distance; a formula is kept as a string; affects can widen the target', () => {
    expect(buildActivity('teleport', { id: 'A' }).teleport).toEqual({
      override: true,
      units: 'ft',
      value: '',
    });
    expect(
      buildActivity('teleport', { id: 'A', teleportDistance: '@prof * 10' }).teleport.value
    ).toBe('@prof * 10');
    const dd = buildActivity('teleport', {
      id: 'A',
      teleportDistance: 500,
      affects: { type: 'willing', count: 1 },
    });
    expect(dd.target.affects).toEqual({ type: 'willing', count: '1' });
    expect(() => buildActivity('teleport', { id: 'A', teleportDistance: '30 ft!' })).toThrow(
      /not a deterministic formula/
    );
  });
});

describe("buildActivity('transform') — dnd5e 6.0", () => {
  it('cr mode: profiles with cr + filters, mode "cr", preset, no effects', () => {
    const act = buildActivity('transform', {
      id: 'ACT0000000000000',
      name: 'Wild Shape',
      transformMode: 'cr',
      transformPreset: 'wildshape',
      profiles: [
        {
          cr: 0.25,
          creatureTypes: ['beast'],
          restrictMovement: ['fly', 'swim'],
          level: { max: 3 },
        },
        { name: 'CR 1', cr: '1', creatureTypes: ['beast'], level: { min: 8 } },
      ],
    });
    expect(act.transform).toEqual({
      mode: 'cr',
      preset: 'wildshape',
      customize: false,
      formless: false,
    });
    expect(act.effects).toEqual([]);
    expect(act.profiles).toHaveLength(2);
    expect(act.profiles[0]).toEqual({
      _id: 'ACT0000000000b00',
      name: '',
      cr: '0.25',
      level: { max: 3 },
      movement: ['fly', 'swim'],
      sizes: [],
      types: ['beast'],
      uuid: null,
    });
    expect(act.profiles[1]).toMatchObject({ name: 'CR 1', cr: '1', level: { min: 8 } });
  });

  it('direct mode: mode "" with resolved actor uuids; form mode: the item effect ids + formless', () => {
    const direct = buildActivity('transform', {
      id: 'A',
      transformMode: 'direct',
      profiles: [
        { name: 'Wolf', actorUuid: 'Compendium.dnd-monster-manual.actors.Actor.aaaaaaaaaaaaaaaa' },
      ],
    });
    expect(direct.transform.mode).toBe('');
    expect(direct.profiles[0]).toMatchObject({
      uuid: 'Compendium.dnd-monster-manual.actors.Actor.aaaaaaaaaaaaaaaa',
      cr: '',
    });
    const form = buildActivity('transform', {
      id: 'A',
      transformMode: 'form',
      formless: true,
      formEffectIds: ['effectid00000001', 'effectid00000002'],
    });
    expect(form.transform).toEqual({ mode: 'form', preset: '', customize: false, formless: true });
    expect(form.profiles).toEqual([]);
    expect(form.effects).toEqual([
      { _id: 'effectid00000001', level: {} },
      { _id: 'effectid00000002', level: {} },
    ]);
  });

  it('refuses an unknown mode / preset / vocab, a cr profile without cr, a direct profile without an actor, a form transform without forms', () => {
    expect(() => buildActivity('transform', { id: 'A', transformMode: 'shape' })).toThrow(
      /transformMode "shape"/
    );
    expect(() =>
      buildActivity('transform', { id: 'A', transformPreset: 'lycanthrope', profiles: [{ cr: 1 }] })
    ).toThrow(/transformPreset "lycanthrope"/);
    expect(() => buildActivity('transform', { id: 'A', profiles: [{ sizes: ['med'] }] })).toThrow(
      /needs a `cr`/
    );
    expect(() =>
      buildActivity('transform', { id: 'A', transformMode: 'direct', profiles: [{ name: 'x' }] })
    ).toThrow(/needs an `actor`/);
    expect(() => buildActivity('transform', { id: 'A', transformMode: 'form' })).toThrow(
      /needs `forms`/
    );
    expect(() => buildActivity('transform', { id: 'A', profiles: [] })).toThrow(
      /at least one profile/
    );
    expect(() =>
      buildActivity('transform', { id: 'A', profiles: [{ cr: 1, restrictMovement: ['teleport'] }] })
    ).toThrow(/movement type "teleport"/);
  });
});

describe("buildActivity('transform') — custom settings (transform.customize)", () => {
  it('writes settings with the preset and sets customize; validates the category keys; refuses form mode', () => {
    const act = buildActivity('transform', {
      id: 'A',
      transformMode: 'cr',
      transformPreset: 'wildshape',
      profiles: [{ cr: 1 }],
      transformSettings: {
        keep: ['mental', 'resistances'],
        merge: ['saves'],
        effects: ['origin'],
        minimumAC: '13 + @abilities.wis.mod',
        tempFormula: '@classes.druid.levels',
        transformTokens: false,
        spellLists: ['subclass:moon'],
      },
    });
    expect(act.transform.customize).toBe(true);
    expect(act.settings).toEqual({
      preset: 'wildshape',
      keep: ['mental', 'resistances'],
      merge: ['saves'],
      effects: ['origin'],
      minimumAC: '13 + @abilities.wis.mod',
      tempFormula: '@classes.druid.levels',
      transformTokens: false,
      spellLists: ['subclass:moon'],
    });
    expect(buildActivity('transform', { id: 'A', profiles: [{ cr: 1 }] })).not.toHaveProperty(
      'settings'
    );
    expect(() =>
      buildActivity('transform', {
        id: 'A',
        profiles: [{ cr: 1 }],
        transformSettings: { keep: ['wings'] },
      })
    ).toThrow(/transformSettings\.keep "wings"/);
    expect(() =>
      buildActivity('transform', {
        id: 'A',
        transformMode: 'form',
        formEffectIds: ['e1'],
        transformSettings: { keep: ['hp'] },
      })
    ).toThrow(/not available in Select-Form mode/);
  });
});

// The wildshape preset's own settings, as the page resolves them off CONFIG (Sets -> arrays).
// dnd5e 6.0.1 config.mjs `transformation.presets.wildshape.settings`.
const WILDSHAPE_BASE = {
  effects: ['otherOrigin', 'origin', 'feat', 'spell', 'class', 'background'],
  keep: ['bio', 'class', 'feats', 'hp', 'languages', 'mental', 'tempHP', 'type'],
  merge: ['saves', 'skills'],
  minimumAC: '(13 + @abilities.wis.mod) * sign(@subclasses.moon.levels)',
  spellLists: ['subclass:moon'],
  tempFormula: 'max(@classes.druid.levels, @subclasses.moon.levels * 3)',
};

describe("buildActivity('transform') — custom settings SEED from the preset", () => {
  it('inherits the preset settings a caller did not override, and REPLACES the ones it did', () => {
    const act = buildActivity('transform', {
      id: 'A',
      transformMode: 'cr',
      transformPreset: 'wildshape',
      profiles: [{ cr: 1 }],
      transformPresetSettings: WILDSHAPE_BASE,
      transformSettings: { keep: ['mental', 'hp', 'resistances'] },
    });
    expect(act.transform.customize).toBe(true);
    // the overridden category is REPLACED wholesale (mergeObject semantics on arrays)…
    expect(act.settings.keep).toEqual(['mental', 'hp', 'resistances']);
    // …and every other preset setting survives
    expect(act.settings.minimumAC).toBe(WILDSHAPE_BASE.minimumAC);
    expect(act.settings.tempFormula).toBe(WILDSHAPE_BASE.tempFormula);
    expect(act.settings.spellLists).toEqual(['subclass:moon']);
    expect(act.settings.merge).toEqual(['saves', 'skills']);
    expect(act.settings.effects).toEqual(WILDSHAPE_BASE.effects);
    expect(act.settings.preset).toBe('wildshape');
  });

  it('a caller field beats the base; with no preset the base is empty', () => {
    const act = buildActivity('transform', {
      id: 'A',
      transformPreset: 'wildshape',
      profiles: [{ cr: 1 }],
      transformPresetSettings: WILDSHAPE_BASE,
      transformSettings: { tempFormula: '@classes.druid.levels', spellLists: [] },
    });
    expect(act.settings.tempFormula).toBe('@classes.druid.levels');
    expect(act.settings.spellLists).toEqual([]);
    expect(act.settings.keep).toEqual(WILDSHAPE_BASE.keep);

    const bare = buildActivity('transform', {
      id: 'A',
      profiles: [{ cr: 1 }],
      transformSettings: { keep: ['hp'] },
    });
    expect(bare.settings).toEqual({ preset: null, keep: ['hp'] });
  });
});

describe('buildAppliedEffect + buildActivity appliesEffects (dnd5e 6.0 activity.effects[])', () => {
  it('persists a uuid effect with a level band, and an on-item effect by _id', () => {
    expect(
      buildAppliedEffect(
        { uuid: 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa', level: { min: 3 } },
        'damage'
      )
    ).toEqual({
      uuid: 'Compendium.dnd5e.effects.ActiveEffect.aaaaaaaaaaaaaaaa',
      level: { min: 3 },
    });
    expect(buildAppliedEffect({ _id: 'effectid00000001' }, 'utility')).toEqual({
      _id: 'effectid00000001',
      level: {},
    });
  });

  it('carries onSave on a save activity only, and needs an identity', () => {
    const act = buildActivity('save', {
      id: 'A',
      saveAbility: 'con',
      saveDC: 13,
      duration: { value: 1, units: 'minute' },
      appliedEffects: [
        { uuid: 'Compendium.dnd5e.effects.ActiveEffect.bbbbbbbbbbbbbbbb', onSave: false },
      ],
    });
    expect(act.effects).toEqual([
      { uuid: 'Compendium.dnd5e.effects.ActiveEffect.bbbbbbbbbbbbbbbb', level: {}, onSave: false },
    ]);
    // the effect carries NO duration of its own — it inherits the activity's
    expect(act.duration).toMatchObject({ value: '1', units: 'minute', override: true });
    expect(() =>
      buildActivity('utility', { id: 'A', appliedEffects: [{ uuid: 'x', onSave: true }] })
    ).toThrow(/onSave only exists on a SAVE activity/);
    expect(() => buildAppliedEffect({}, 'save')).toThrow(/must resolve to an effect/);
  });

  it('refuses appliesEffects on a transform (its effects[] ARE the forms)', () => {
    expect(() =>
      buildActivity('transform', {
        id: 'A',
        profiles: [{ cr: 1 }],
        appliedEffects: [{ uuid: 'Compendium.dnd5e.effects.ActiveEffect.cccccccccccccccc' }],
      })
    ).toThrow(/ARE its forms/);
  });
});

describe('assertEditableActivityFields', () => {
  it('passes the fields edit understands and names the ones it does not', () => {
    expect(() => assertEditableActivityFields(undefined)).not.toThrow();
    expect(() =>
      assertEditableActivityFields({
        name: 'Web',
        duration: { units: 'minute', value: 1 },
        template: { type: 'cube', size: 20 },
        affects: { type: 'creature' },
        behaviors: [{ type: 'difficultTerrain' }],
        appliesEffects: [{ ref: 'Restrained' }],
      })
    ).not.toThrow();
    expect(() => assertEditableActivityFields({ saveDC: 15, damageParts: [] })).toThrow(
      /cannot change damageParts, saveDC/
    );
    expect(() => assertEditableActivityFields({ attackBonus: 3 })).toThrow(/`patch`/);
    // an undefined / null field is not an "offender" (the tool forwards the whole shape)
    expect(() =>
      assertEditableActivityFields({ saveDC: undefined, profiles: null, name: 'x' })
    ).not.toThrow();
  });
});
