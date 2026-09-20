// Live verification for the dnd5e 6.0 TELEPORT and TRANSFORM activities (2.1.1, plan rows 7 + 12):
//   * teleport — the distance override persists as a formula string and prepares to a number; a blank
//     distance prepares to Infinity (any distance); targets default to self;
//   * transform (cr mode) — profiles with CR / type / movement filters + a preset whose settings the
//     system materializes on prepare;
//   * transform (direct mode) — profile actors resolved by Monster Manual NAME to compendium uuids;
//   * transform (Select Form) — the item's own effects become the forms (effects[] by id), formless;
//   * the refusals: an SRD actor, an unknown creature, a form that is not an effect on the item.
//
// Drives a real headless Foundry session through the foundry.call seam (bypassing the MCP process, so
// it exercises the freshly-built dist/page.bundle.js WITHOUT a Claude Code restart). Everything it
// creates is tagged ZZ-FX and deleted in `finally` (three world items).
//
// Build first: npm run build. Run: FOUNDRY_PROFILE=local node scripts/verify-activities-6.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();

const TAG = 'ZZ-FX';
let passes = 0;
let fails = 0;
function assert(cond, msg, extra) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL  ${msg}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}
async function expectThrow(label, fn, re) {
  try {
    await fn();
    fails++;
    console.log(`  FAIL  ${label} — expected a throw, none thrown`);
  } catch (e) {
    const m = e?.message || String(e);
    if (re.test(m)) {
      passes++;
      console.log(`  PASS  ${label} — threw ${JSON.stringify(m.slice(0, 100))}`);
    } else {
      fails++;
      console.log(`  FAIL  ${label} — threw but message didn't match ${re}: ${m.slice(0, 160)}`);
    }
  }
}

const f = new Foundry(bridgeConfig(env));
const worldItemIds = [];
const makeFeat = async name => {
  const id = await f.evaluate(async n => {
    const [it] = await globalThis.Item.create([{ name: n, type: 'feat' }]);
    return it.id;
  }, name);
  worldItemIds.push(id);
  return id;
};
const activitySource = (itemId, activityId) =>
  f.evaluate(
    ({ itemId, activityId }) => {
      const item = globalThis.game.items.get(itemId);
      const src = item.toObject().system.activities[activityId];
      const act = item.system.activities.get(activityId);
      return {
        src,
        prepared: {
          teleportValue: act.teleport?.value ?? null,
          teleportUnits: act.teleport?.units ?? null,
          profiles: act.profiles?.length ?? null,
          available: act.availableProfiles?.length ?? null,
          preset: act.settings?.preset ?? null,
          mode: act.transform?.mode ?? null,
        },
      };
    },
    { itemId, activityId }
  );

try {
  console.log('[verify-activities-6] connecting…');
  await f.connect();
  console.log('[verify-activities-6] connected — teleport + transform\n');

  // ======================================================================
  // 1. Teleport
  // ======================================================================
  const blink = await makeFeat(`${TAG} Blink Step`);
  const tp = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: blink,
    activity: { type: 'teleport', name: 'Blink', activationType: 'bonus', teleportDistance: 30 },
  });
  assert(tp?.success && tp.type === 'teleport', `teleport activity added (${tp?.activityId})`, tp);
  const tpSrc = await activitySource(blink, tp.activityId);
  assert(
    tpSrc.src.teleport?.override === true &&
      tpSrc.src.teleport?.value === '30' &&
      tpSrc.src.teleport?.units === 'ft',
    'source: teleport {override:true, value:"30", units:"ft"} (a formula STRING)',
    tpSrc.src.teleport
  );
  assert(
    tpSrc.src.target?.affects?.type === 'self',
    'source: targets self by default',
    tpSrc.src.target
  );
  assert(tpSrc.src.activation?.type === 'bonus', 'source: bonus action', tpSrc.src.activation);
  assert(
    tpSrc.prepared.teleportValue === 30,
    'prepared: teleport.value resolves to 30',
    tpSrc.prepared
  );

  const any = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: blink,
    activity: { type: 'teleport', name: 'Plane Hop', affects: { type: 'willing', count: 1 } },
  });
  const anySrc = await activitySource(blink, any.activityId);
  assert(
    anySrc.src.teleport?.value === '' && anySrc.prepared.teleportValue === Infinity,
    'blank distance → any distance (prepares to Infinity)',
    anySrc.prepared
  );
  assert(
    anySrc.src.target?.affects?.type === 'willing' && anySrc.src.target?.affects?.count === '1',
    'affects override: one willing creature',
    anySrc.src.target
  );

  // ======================================================================
  // 2. Transform — by CR (Wild Shape)
  // ======================================================================
  const wild = await makeFeat(`${TAG} Wild Shape`);
  const cr = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: wild,
    activity: {
      type: 'transform',
      name: 'Wild Shape',
      transformMode: 'cr',
      transformPreset: 'wildshape',
      profiles: [
        { cr: 0.25, creatureTypes: ['beast'], restrictMovement: ['fly', 'swim'] },
        { name: 'CR 1 beasts', cr: '1', creatureTypes: ['beast'], level: { min: 8 } },
      ],
    },
  });
  assert(cr?.success && cr.type === 'transform', `transform (cr) added (${cr?.activityId})`, cr);
  const crSrc = await activitySource(wild, cr.activityId);
  assert(
    crSrc.src.transform?.mode === 'cr' && crSrc.src.transform?.preset === 'wildshape',
    'source: transform.mode cr + preset wildshape',
    crSrc.src.transform
  );
  assert(
    crSrc.src.profiles?.length === 2 &&
      crSrc.src.profiles[0].cr === '0.25' &&
      JSON.stringify(crSrc.src.profiles[0].types) === JSON.stringify(['beast']) &&
      JSON.stringify(crSrc.src.profiles[0].movement) === JSON.stringify(['fly', 'swim']) &&
      crSrc.src.profiles[1].level?.min === 8,
    'source: two profiles with cr / types / movement / level persisted',
    crSrc.src.profiles
  );
  assert(
    crSrc.prepared.preset === 'wildshape',
    'prepared: settings materialized from the preset',
    crSrc.prepared
  );
  assert(
    crSrc.prepared.available === 1,
    'prepared: level gate hides the min-8 profile at level 0 (1 available)',
    crSrc.prepared
  );

  // custom settings (transform.customize) — Wild Shape that also keeps resistances
  const custom = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: wild,
    activity: {
      type: 'transform',
      name: 'Wild Shape (custom)',
      transformMode: 'cr',
      transformPreset: 'wildshape',
      profiles: [{ cr: 1, creatureTypes: ['beast'] }],
      transformSettings: {
        keep: ['mental', 'hp', 'resistances'],
        merge: ['saves'],
      },
    },
  });
  const customSrc = await f.evaluate(
    ({ itemId, activityId }) => {
      const item = globalThis.game.items.get(itemId);
      const src = item.toObject().system.activities[activityId];
      const act = item.system.activities.get(activityId);
      const preset = globalThis.CONFIG.DND5E.transformation.presets.wildshape.settings;
      return {
        customize: src.transform?.customize,
        settings: src.settings,
        preset: {
          minimumAC: preset.minimumAC,
          tempFormula: preset.tempFormula,
          spellLists: Array.from(preset.spellLists ?? []),
          effects: Array.from(preset.effects ?? []),
        },
        preparedKeep: Array.from(act.settings?.keep ?? []),
        preparedPreset: act.settings?.preset ?? null,
      };
    },
    { itemId: wild, activityId: custom.activityId }
  );
  assert(
    customSrc.customize === true &&
      JSON.stringify(customSrc.settings?.keep) ===
        JSON.stringify(['mental', 'hp', 'resistances']) &&
      JSON.stringify(customSrc.settings?.merge) === JSON.stringify(['saves']),
    'custom settings: transform.customize + the overridden categories persisted (keep / merge)',
    customSrc
  );
  // The caller overrode keep + merge only — everything else must come FROM THE PRESET, not be lost
  // (dnd5e's own sheet seeds a customised settings object from presets[preset].settings).
  assert(
    customSrc.settings?.minimumAC === customSrc.preset.minimumAC &&
      customSrc.settings?.tempFormula === customSrc.preset.tempFormula &&
      JSON.stringify(customSrc.settings?.spellLists) ===
        JSON.stringify(customSrc.preset.spellLists) &&
      JSON.stringify(customSrc.settings?.effects) === JSON.stringify(customSrc.preset.effects),
    'custom settings SEED from the preset: minimumAC / tempFormula / spellLists / effects survive',
    { persisted: customSrc.settings, preset: customSrc.preset }
  );
  assert(
    customSrc.preparedKeep.includes('resistances') && customSrc.preparedPreset === 'wildshape',
    'prepared: the custom settings are what the system uses (keep has resistances, preset kept)',
    customSrc
  );

  // ======================================================================
  // 3. Transform — direct link by MM name
  // ======================================================================
  const direct = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: wild,
    activity: {
      type: 'transform',
      name: 'Known Forms',
      transformMode: 'direct',
      transformPreset: 'wildshape',
      profiles: [{ actor: 'Wolf' }, { name: 'Bear form', actor: 'Brown Bear' }],
    },
  });
  assert(direct?.success, `transform (direct) added (${direct?.activityId})`, direct);
  const actors = direct?.transformActors ?? [];
  assert(
    actors.length === 2 &&
      actors.every(a => /^Compendium\.dnd-monster-manual\.actors\.Actor\./.test(a.uuid)),
    'profile actors resolved by NAME to Monster Manual uuids (the MM wins over the DMG copies)',
    actors
  );
  const dSrc = await activitySource(wild, direct.activityId);
  assert(
    dSrc.src.transform?.mode === '' &&
      dSrc.src.profiles?.[0]?.uuid === actors[0].uuid &&
      dSrc.src.profiles?.[1]?.name === 'Bear form',
    'source: mode "" (direct), profile uuids + names persisted',
    dSrc.src.profiles
  );
  assert(
    dSrc.src.profiles?.[0]?.name === 'Wolf',
    'an unnamed direct profile takes the creature name',
    dSrc.src.profiles?.[0]
  );

  // ======================================================================
  // 4. Transform — Select Form (the item's own effects)
  // ======================================================================
  const shift = await makeFeat(`${TAG} Shape-Shift`);
  for (const [name, key, value] of [
    ['Hybrid Form', 'system.attributes.ac.bonus', '1'],
    ['Tiger Form', 'system.attributes.movement.walk', '40'],
  ]) {
    const r = await f.call('manageEffect', {
      action: 'create',
      itemIdentifier: shift,
      effect: { name, changes: [{ key, value, type: 'override' }], transfer: false },
    });
    assert(r?.success, `form effect "${name}" authored on the item (${r?.effectId})`);
  }
  const form = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: shift,
    activity: {
      type: 'transform',
      name: 'Shape-Shift',
      transformMode: 'form',
      formless: true,
      forms: ['Hybrid Form', 'tiger form'],
    },
  });
  assert(form?.success, `transform (form) added (${form?.activityId})`, form);
  const fSrc = await activitySource(shift, form.activityId);
  const itemEffectIds = await f.evaluate(
    id => globalThis.game.items.get(id).effects.map(e => e.id),
    shift
  );
  assert(
    fSrc.src.transform?.mode === 'form' && fSrc.src.transform?.formless === true,
    'source: transform.mode form + formless',
    fSrc.src.transform
  );
  assert(
    fSrc.src.effects?.length === 2 && fSrc.src.effects.every(e => itemEffectIds.includes(e._id)),
    "source: effects[] carries the item's own effect ids (name match is case-insensitive)",
    { effects: fSrc.src.effects, itemEffectIds }
  );
  assert(
    fSrc.prepared.available === 2,
    'prepared: both forms available (availableProfiles = applicableEffects)',
    fSrc.prepared
  );

  // ======================================================================
  // 4b. Applied effects (dnd5e 6.0 activity.effects[] — AppliedEffectField)
  // ======================================================================
  const sting = await makeFeat(`${TAG} Sting`);
  const poison = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: sting,
    activity: {
      type: 'save',
      name: 'Sting',
      saveAbility: 'con',
      saveDC: 13,
      duration: { value: 1, units: 'minute' },
      appliesEffects: [{ ref: 'Poisoned', onSave: false }],
    },
  });
  assert(
    poison?.success,
    `save activity with appliesEffects added (${poison?.activityId})`,
    poison
  );
  assert(
    poison?.effects?.[0]?.source === 'dnd5e.effects' && poison.effects[0].name === 'Poisoned',
    '"Poisoned" resolved from the stock pack and reported',
    poison?.effects
  );
  const stingSrc = await f.evaluate(
    ({ itemId, activityId }) => {
      const item = globalThis.game.items.get(itemId);
      const src = item.toObject().system.activities[activityId];
      const act = item.system.activities.get(activityId);
      return { effects: src.effects, duration: src.duration, prepared: act.effects?.length ?? 0 };
    },
    { itemId: sting, activityId: poison.activityId }
  );
  assert(
    stingSrc.effects?.length === 1 &&
      /^Compendium\.dnd5e\.effects\.ActiveEffect\./.test(stingSrc.effects[0].uuid ?? '') &&
      stingSrc.effects[0].onSave === false,
    'source: effects[0].uuid points at the stock effect, onSave false (survives the clean step)',
    stingSrc.effects
  );
  assert(
    stingSrc.duration?.value === '1' && stingSrc.duration?.units === 'minute',
    'the applied effect inherits the activity duration (1 minute) — it carries none of its own',
    stingSrc.duration
  );
  const stingList = await f.call('manageActivity', { action: 'list', itemIdentifier: sting });
  const stingRow = (stingList?.activities ?? []).find(a => a.id === poison.activityId);
  assert(
    stingRow?.effects?.length === 1 && stingRow.effects[0].onSave === false,
    'list: the applied effects are projected',
    stingRow
  );

  // an effect ON THE ITEM resolves to an _id, not a uuid
  await f.call('manageEffect', {
    action: 'create',
    itemIdentifier: sting,
    effect: {
      name: `${TAG} Numb`,
      changes: [{ key: 'system.attributes.ac.bonus', value: '-1', type: 'add' }],
      transfer: false,
    },
  });
  const numb = await f.call('manageActivity', {
    action: 'add',
    itemIdentifier: sting,
    activity: {
      type: 'damage',
      name: 'Numbing Sting',
      damageParts: [],
      appliesEffects: [{ ref: `${TAG} Numb` }],
    },
  });
  const numbSrc = await f.evaluate(
    ({ itemId, activityId }) => {
      const item = globalThis.game.items.get(itemId);
      return {
        effects: item.toObject().system.activities[activityId].effects,
        itemEffectIds: item.effects.map(e => e.id),
      };
    },
    { itemId: sting, activityId: numb.activityId }
  );
  assert(
    numbSrc.effects?.length === 1 &&
      !numbSrc.effects[0].uuid &&
      numbSrc.itemEffectIds.includes(numbSrc.effects[0]._id),
    'an effect ON THE ITEM persists as _id (not a uuid)',
    numbSrc
  );

  // edit REPLACES the list
  const replaced = await f.call('manageActivity', {
    action: 'edit',
    itemIdentifier: sting,
    activityId: poison.activityId,
    activity: { appliesEffects: [{ ref: 'Restrained', onSave: true }] },
  });
  const afterReplace = await f.evaluate(
    ({ itemId, activityId }) =>
      globalThis.game.items.get(itemId).toObject().system.activities[activityId].effects,
    { itemId: sting, activityId: poison.activityId }
  );
  assert(
    replaced?.success &&
      afterReplace?.length === 1 &&
      afterReplace[0].onSave === true &&
      afterReplace[0].uuid !== stingSrc.effects[0].uuid,
    'edit: appliesEffects REPLACES the list',
    afterReplace
  );

  // ======================================================================
  // 5. Refusals
  // ======================================================================
  await expectThrow(
    'edit refuses a typed field it cannot apply',
    () =>
      f.call('manageActivity', {
        action: 'edit',
        itemIdentifier: sting,
        activityId: poison.activityId,
        activity: { saveDC: 16 },
      }),
    /cannot change saveDC/
  );
  await expectThrow(
    'refuses appliesEffects on a transform (its effects[] ARE the forms)',
    () =>
      f.call('manageActivity', {
        action: 'add',
        itemIdentifier: wild,
        activity: {
          type: 'transform',
          profiles: [{ cr: 1 }],
          appliesEffects: [{ ref: 'Poisoned' }],
        },
      }),
    /ARE its forms/
  );
  await expectThrow(
    'refuses an SRD creature as a transform profile',
    () =>
      f.call('manageActivity', {
        action: 'add',
        itemIdentifier: wild,
        activity: {
          type: 'transform',
          transformMode: 'direct',
          profiles: [{ actor: 'Compendium.dnd5e.monsters24.Actor.aaaaaaaaaaaaaaaa' }],
        },
      }),
    /SRD|does not resolve/
  );
  await expectThrow(
    'refuses an unknown creature name',
    () =>
      f.call('manageActivity', {
        action: 'add',
        itemIdentifier: wild,
        activity: {
          type: 'transform',
          transformMode: 'direct',
          profiles: [{ actor: 'Definitely Not A Monster Zzz' }],
        },
      }),
    /not a premium-book creature/
  );
  await expectThrow(
    'refuses a form that is not an effect on the item',
    () =>
      f.call('manageActivity', {
        action: 'add',
        itemIdentifier: shift,
        activity: { type: 'transform', transformMode: 'form', forms: ['Bat Form'] },
      }),
    /is not an effect on/
  );
} catch (e) {
  fails++;
  console.log(`  FAIL  unexpected error: ${e?.stack || e}`);
} finally {
  try {
    await f.evaluate(async ids => {
      for (const id of ids) await globalThis.game.items.get(id)?.delete();
    }, worldItemIds);
    console.log(`\ncleanup -> deleted ${worldItemIds.length} world item(s)`);
  } catch (e) {
    console.log(`cleanup failed: ${e?.message || e}`);
  }
  await f.disconnect?.();
  console.log(`\n${passes}/${passes + fails} passed`);
  process.exit(fails > 0 ? 1 : 0);
}
