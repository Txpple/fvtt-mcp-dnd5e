// Live verification for the dnd5e 6.0 ActiveEffect surface (2.1.0, plan rows 1–4 + the read-back):
//   * effect-level CONDITIONS (system.conditions Filter JSON) — persisted as a string, gating the effect,
//   * per-change conditions + replacement,
//   * RULES-type changes (dnd5e.advantage / bonus / minimum / maximum on a roll category) — and the
//     proof that they FIRE in a real roll: a ranged-only +1d4 bonus shows up as a term of the longbow's
//     rollAttack (and not the shortsword's), a melee-only advantage flips the shortsword's mode (and not
//     the longbow's), an unconditional minimum 10 puts `min10` on the d20 of both, and a `1d4[fire]`
//     damage bonus lands in rollDamage,
//   * expiry events (duration-less targetEnd on an effect; a duration override on an activity),
//   * get-actor / manage-effect list read-back (type, magical, parsed conditions, readable rules),
//   * content-audit's dead-rules-change finding, and the write-time refusals.
//
// Drives a real headless Foundry session through the foundry.call seam (bypassing the MCP process, so
// it exercises the freshly-built dist/page.bundle.js WITHOUT a Claude Code restart). Everything it
// creates is tagged ZZ-FX and deleted in `finally`.
//
// Build first: npm run build. Run: FOUNDRY_PROFILE=local node scripts/verify-effects-6.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  if (line.trimStart().startsWith('#')) continue;
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

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
const tempActorIds = [];

try {
  console.log('[verify-effects-6] connecting…');
  await f.connect();
  console.log('[verify-effects-6] connected — dnd5e 6.0 effects\n');

  // --- A tagged MM Scout: a ranged (Longbow) AND a melee (Shortsword) attack on one actor ---
  const scoutId = await f.evaluate(async () => {
    const pack = globalThis.game.packs.get('dnd-monster-manual.actors');
    const idx = await pack.getIndex();
    return idx.find(e => e.name === 'Scout')?._id ?? null;
  });
  assert(!!scoutId, 'MM Scout found in dnd-monster-manual.actors');
  const created = await f.call('createActorFromCompendium', {
    packId: 'dnd-monster-manual.actors',
    itemId: scoutId,
    customNames: [`${TAG} Scout`],
    quantity: 1,
    addToScene: false,
  });
  const actorId = created?.actors?.[0]?.id;
  assert(!!actorId, `created "${TAG} Scout" (${actorId})`);
  tempActorIds.push(actorId);

  const weapons = await f.evaluate(id => {
    const a = globalThis.game.actors.get(id);
    return a.items
      .filter(i => i.type === 'weapon')
      .map(i => ({
        name: i.name,
        type: i.system.type?.value,
        attackType: i.system.activities?.find(x => x.type === 'attack')?.attack?.type?.value,
      }));
  }, actorId);
  const ranged = weapons.find(w => w.attackType === 'ranged');
  const melee = weapons.find(w => w.attackType === 'melee');
  assert(
    !!ranged && !!melee,
    `Scout carries a ranged (${ranged?.name}) and a melee (${melee?.name}) weapon`,
    weapons
  );

  // ======================================================================
  // 1. RULES effect: four rules changes, a change condition, a replacement, magical, targetEnd
  // ======================================================================
  const rules = await f.call('manageEffect', {
    action: 'create',
    actorIdentifier: actorId,
    effect: {
      name: `${TAG} Rules`,
      magical: true,
      duration: { expiry: 'targetEnd' },
      changes: [
        {
          key: 'attack',
          value: '1d4',
          type: 'dnd5e.bonus',
          conditions: { k: 'roll.attack.type', v: 'ranged' },
        },
        {
          key: 'attack',
          value: '+1',
          type: 'dnd5e.advantage',
          conditions: { k: 'roll.attack.type', v: 'melee' },
        },
        { key: 'attack', value: '10', type: 'dnd5e.minimum' },
        { key: 'damage', value: '1d4[fire]', type: 'dnd5e.bonus', replacement: 'origin' },
      ],
    },
  });
  assert(
    rules?.success && rules.effectId,
    `manage-effect create "${TAG} Rules" (${rules?.effectId})`
  );

  const rulesSrc = await f.evaluate(
    ({ actorId, effectId }) => {
      const e = globalThis.game.actors.get(actorId).effects.get(effectId);
      const src = e.toObject();
      return {
        type: e.type,
        magical: src.system.magical,
        conditions: src.system.conditions,
        expiry: src.duration.expiry,
        value: src.duration.value,
        changes: src.system.changes.map(c => ({
          key: c.key,
          type: c.type,
          value: c.value,
          conditions: c.conditions,
          replacement: c.replacement,
        })),
      };
    },
    { actorId, effectId: rules.effectId }
  );
  assert(rulesSrc.type === 'base', 'effect type is "base"', rulesSrc.type);
  assert(rulesSrc.magical === true, 'system.magical persisted', rulesSrc.magical);
  assert(
    rulesSrc.conditions === '{}',
    'effect-level conditions default to "{}"',
    rulesSrc.conditions
  );
  assert(
    rulesSrc.expiry === 'targetEnd' && rulesSrc.value === null,
    'duration.expiry targetEnd, value nulled (duration-less)',
    {
      expiry: rulesSrc.expiry,
      value: rulesSrc.value,
    }
  );
  assert(
    rulesSrc.changes[0].conditions === '{"k":"roll.attack.type","v":"ranged"}',
    'change conditions persisted as the Filter JSON string',
    rulesSrc.changes[0].conditions
  );
  assert(
    rulesSrc.changes[0].type === 'dnd5e.bonus' && rulesSrc.changes[1].type === 'dnd5e.advantage',
    'rules change types persisted'
  );
  assert(
    rulesSrc.changes[3].replacement === 'origin',
    'change replacement persisted',
    rulesSrc.changes[3].replacement
  );

  // read-back through manage-effect list
  const list = await f.call('manageEffect', { action: 'list', actorIdentifier: actorId });
  const listed = (list?.effects ?? []).find(e => e.id === rules.effectId);
  assert(listed?.type === 'base' && listed?.magical === true, 'list: type + magical surfaced');
  assert(
    listed?.duration?.expiry === 'targetEnd',
    'list: duration-less expiry surfaced',
    listed?.duration
  );
  const ruleTexts = (listed?.changes ?? []).map(c => c.rule);
  assert(
    ruleTexts[0] === '+1d4 to attack rolls when roll.attack.type = ranged' &&
      ruleTexts[1] === 'advantage on attack rolls when roll.attack.type = melee' &&
      ruleTexts[2] === 'd20 minimum 10 on attack rolls' &&
      ruleTexts[3] === '+1d4[fire] to damage rolls',
    'list: readable rule text for every rules change',
    ruleTexts
  );
  assert(
    listed?.changes?.[0]?.conditions?.k === 'roll.attack.type',
    'list: change conditions come back PARSED (not the JSON string)',
    listed?.changes?.[0]?.conditions
  );

  // read-back through get-actor's page projection
  const info = await f.call('getCharacterInfo', { characterId: actorId });
  const infoEff = (info?.effects ?? []).find(e => e.id === rules.effectId);
  assert(
    infoEff?.type === 'base' && infoEff?.magical === true,
    'getCharacterInfo: effect type + magical'
  );
  assert(
    infoEff?.changes?.[0]?.rule === '+1d4 to attack rolls when roll.attack.type = ranged' &&
      infoEff?.changes?.[0]?.conditions?.v === 'ranged',
    'getCharacterInfo: change rule text + parsed conditions',
    infoEff?.changes?.[0]
  );

  // ======================================================================
  // 2. THE RULES FIRE in real rolls (no dialog, no chat message)
  // ======================================================================
  const rollAttack = itemName =>
    f.evaluate(
      async ({ actorId, itemName }) => {
        const a = globalThis.game.actors.get(actorId);
        const item = a.items.find(i => i.name === itemName);
        const act = item.system.activities.find(x => x.type === 'attack');
        const rolls = await act.rollAttack({}, { configure: false }, { create: false });
        const r = rolls?.[0];
        return r
          ? {
              formula: r.formula,
              advantage: r.hasAdvantage,
              disadvantage: r.hasDisadvantage,
              minimum: r.options.minimum ?? null,
              terms: r.terms.map(t => t.formula ?? t.expression ?? String(t.constructor.name)),
            }
          : null;
      },
      { actorId, itemName }
    );
  const rollDamage = itemName =>
    f.evaluate(
      async ({ actorId, itemName }) => {
        const a = globalThis.game.actors.get(actorId);
        const item = a.items.find(i => i.name === itemName);
        const act = item.system.activities.find(x => x.type === 'attack');
        const rolls = await act.rollDamage({}, { configure: false }, { create: false });
        return (rolls ?? []).map(r => ({
          formula: r.formula,
          types: Array.from(r.options?.types ?? []),
          type: r.options?.type ?? null,
        }));
      },
      { actorId, itemName }
    );

  const rangedRoll = await rollAttack(ranged.name);
  assert(!!rangedRoll, `rollAttack(${ranged.name}) produced a roll`, rangedRoll);
  assert(
    /1d4/.test(rangedRoll?.formula ?? ''),
    `ranged attack formula carries the +1d4 rule term (${rangedRoll?.formula})`
  );
  assert(
    /min10/.test(rangedRoll?.formula ?? '') || rangedRoll?.minimum === 10,
    `ranged attack d20 has minimum 10 (${rangedRoll?.formula})`
  );
  assert(
    rangedRoll?.advantage === false,
    'ranged attack has NO advantage (rule is melee-only)',
    rangedRoll
  );

  const meleeRoll = await rollAttack(melee.name);
  assert(!!meleeRoll, `rollAttack(${melee.name}) produced a roll`, meleeRoll);
  assert(
    !/1d4/.test(meleeRoll?.formula ?? ''),
    `melee attack formula has NO 1d4 (rule is ranged-only) (${meleeRoll?.formula})`
  );
  assert(
    meleeRoll?.advantage === true,
    'melee attack HAS advantage (dnd5e.advantage +1 flipped the mode)',
    meleeRoll
  );
  assert(
    /min10/.test(meleeRoll?.formula ?? '') || meleeRoll?.minimum === 10,
    `melee attack d20 has minimum 10 (${meleeRoll?.formula})`
  );

  const dmg = await rollDamage(ranged.name);
  const dmgText = JSON.stringify(dmg);
  assert(dmg.length > 0, `rollDamage(${ranged.name}) produced ${dmg.length} roll(s)`);
  assert(
    /1d4/.test(dmgText) && /fire/.test(dmgText),
    `damage carries the 1d4[fire] bonus part (${dmgText.slice(0, 160)})`
  );

  // ======================================================================
  // 3. CONDITIONAL effect: effect-level conditions gate the whole effect
  // ======================================================================
  const hp = await f.evaluate(id => {
    const a = globalThis.game.actors.get(id);
    return {
      value: a.system.attributes.hp.value,
      max: a.system.attributes.hp.max,
      ac: a.system.attributes.ac.value,
    };
  }, actorId);
  const cond = await f.call('manageEffect', {
    action: 'create',
    actorIdentifier: actorId,
    effect: {
      name: `${TAG} Wounded Guard`,
      conditions: { k: 'attributes.hp.value', o: 'lt', v: hp.max },
      changes: [{ key: 'system.attributes.ac.bonus', value: '2', type: 'add' }],
      duration: { value: 1, units: 'rounds', expiry: 'turnEnd' },
    },
  });
  assert(
    cond?.success,
    `manage-effect create "${TAG} Wounded Guard" (conditional +2 AC below full HP)`
  );
  const condSrc = await f.evaluate(
    ({ actorId, effectId }) => {
      const a = globalThis.game.actors.get(actorId);
      const src = a.effects.get(effectId).toObject();
      return {
        conditions: src.system.conditions,
        expiry: src.duration.expiry,
        value: src.duration.value,
        units: src.duration.units,
        ac: a.system.attributes.ac.value,
      };
    },
    { actorId, effectId: cond.effectId }
  );
  assert(
    condSrc.conditions === JSON.stringify({ k: 'attributes.hp.value', o: 'lt', v: hp.max }),
    'effect-level conditions persisted as the Filter JSON string',
    condSrc.conditions
  );
  assert(
    condSrc.expiry === 'turnEnd' && condSrc.value === 1 && condSrc.units === 'rounds',
    'core expiry kept WITH its duration',
    condSrc
  );
  assert(
    condSrc.ac === hp.ac,
    `AC unchanged at full HP (${condSrc.ac}) — effect suppressed by its condition`
  );

  const acHurt = await f.evaluate(
    async ({ actorId }) => {
      const a = globalThis.game.actors.get(actorId);
      await a.update({ 'system.attributes.hp.value': a.system.attributes.hp.value - 1 });
      return a.system.attributes.ac.value;
    },
    { actorId }
  );
  assert(
    acHurt === hp.ac + 2,
    `AC +2 once below full HP (${hp.ac} → ${acHurt}) — condition now true`
  );

  // edit: clear the condition → applies at any HP; list shows it as unconditional
  const cleared = await f.call('manageEffect', {
    action: 'edit',
    actorIdentifier: actorId,
    effectId: cond.effectId,
    effect: { conditions: null },
  });
  assert(
    cleared?.editedKeys?.includes('system.conditions'),
    'edit: conditions: null targets system.conditions',
    cleared?.editedKeys
  );
  const afterClear = await f.evaluate(
    async ({ actorId, effectId }) => {
      const a = globalThis.game.actors.get(actorId);
      await a.update({ 'system.attributes.hp.value': a.system.attributes.hp.max });
      return {
        conditions: a.effects.get(effectId).toObject().system.conditions,
        ac: a.system.attributes.ac.value,
      };
    },
    { actorId, effectId: cond.effectId }
  );
  assert(
    afterClear.conditions === '{}',
    'edit cleared the conditions back to "{}"',
    afterClear.conditions
  );
  assert(afterClear.ac === hp.ac + 2, `AC +2 at full HP once unconditional (${afterClear.ac})`);
  const list2 = await f.call('manageEffect', { action: 'list', actorIdentifier: actorId });
  const condListed = (list2?.effects ?? []).find(e => e.id === cond.effectId);
  assert(condListed && !('conditions' in condListed), 'list: no `conditions` key once cleared');

  // ======================================================================
  // 4. Refusals at the seam (the page validators, not just the zod layer)
  // ======================================================================
  await expectThrow(
    'refuses roll.* in an effect-level condition',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          conditions: { k: 'roll.ability', v: 'str' },
          changes: [{ key: 'system.attributes.ac.bonus', value: '1', type: 'add' }],
        },
      }),
    /roll\.\* keys are only available on the conditions of a RULES-type/
  );
  await expectThrow(
    'refuses a core type on a roll category',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: { name: `${TAG} bad`, changes: [{ key: 'attack', value: '1', type: 'add' }] },
      }),
    /roll category/
  );
  await expectThrow(
    'refuses an advantage value outside the vocabulary',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          changes: [{ key: 'd20', value: '+2', type: 'dnd5e.advantage' }],
        },
      }),
    /must be one of/
  );
  await expectThrow(
    'refuses a damage minimum rule',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          changes: [{ key: 'damage', value: '5', type: 'dnd5e.minimum' }],
        },
      }),
    /only supports dnd5e\.bonus/
  );
  await expectThrow(
    'refuses an unknown expiry event',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          duration: { expiry: 'nextDawn' },
          changes: [{ key: 'system.attributes.ac.bonus', value: '1' }],
        },
      }),
    /not an expiry event/
  );
  await expectThrow(
    'refuses an unknown duration unit',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          duration: { value: 1, units: 'fortnights' },
          changes: [{ key: 'system.attributes.ac.bonus', value: '1' }],
        },
      }),
    /not a Foundry duration unit/
  );
  {
    // A core expiry with NO value is legal: core's durationReached is `remaining <= 0 ||
    // !Number.isFinite(remaining)`, and _prepareDuration yields Infinity when no value is set,
    // so a bare { expiry: 'turnEnd' } expires at the FIRST turn end.
    const bare = await f.call('manageEffect', {
      action: 'create',
      actorIdentifier: actorId,
      effect: {
        name: `${TAG} bare turnEnd`,
        duration: { expiry: 'turnEnd' },
        changes: [{ key: 'system.attributes.ac.bonus', value: '1' }],
      },
    });
    const bareDur = await f.evaluate(
      ({ actorId, effectId }) => {
        const a = globalThis.game.actors.get(actorId);
        return a.effects.get(effectId)?.toObject()?.duration ?? null;
      },
      { actorId, effectId: bare.effectId }
    );
    assert(
      bare?.success && bareDur?.expiry === 'turnEnd' && bareDur?.value == null,
      'value-less core expiry persists as { expiry: "turnEnd" } with no value',
      bareDur
    );
    await f.call('manageEffect', {
      action: 'delete',
      actorIdentifier: actorId,
      effectId: bare.effectId,
    });
  }
  await expectThrow(
    'refuses an unknown Filter operator',
    () =>
      f.call('manageEffect', {
        action: 'create',
        actorIdentifier: actorId,
        effect: {
          name: `${TAG} bad`,
          conditions: { k: 'attributes.hp.value', o: 'below', v: 3 },
          changes: [{ key: 'system.attributes.ac.bonus', value: '1' }],
        },
      }),
    /unknown operator "below"/
  );

  // ======================================================================
  // 5. Activity duration override with an expiry (manage-activity)
  // ======================================================================
  const feat = await f.evaluate(
    async ({ actorId, name }) => {
      const a = globalThis.game.actors.get(actorId);
      const [it] = await a.createEmbeddedDocuments('Item', [{ name, type: 'feat' }]);
      return it.id;
    },
    { actorId, name: `${TAG} Frightful Presence` }
  );
  const added = await f.call('manageActivity', {
    action: 'add',
    actorIdentifier: actorId,
    itemIdentifier: feat,
    activity: {
      type: 'utility',
      name: 'Frighten',
      duration: { value: 1, units: 'minute', expiry: 'targetEnd' },
    },
  });
  const actDur = await f.evaluate(
    ({ actorId, itemId, activityId }) => {
      const a = globalThis.game.actors.get(actorId);
      const src = a.items.get(itemId).toObject();
      return src.system.activities[activityId]?.duration ?? null;
    },
    { actorId, itemId: feat, activityId: added.activityId }
  );
  assert(
    actDur?.value === '1' &&
      actDur?.units === 'minute' &&
      actDur?.expiry === 'targetEnd' &&
      actDur?.override === true,
    'activity duration override persisted with expiry (value "1", units minute, targetEnd, override)',
    actDur
  );
  const edited = await f.call('manageActivity', {
    action: 'edit',
    actorIdentifier: actorId,
    itemIdentifier: feat,
    activityId: added.activityId,
    activity: { duration: { expiry: 'sourceStart' } },
  });
  const actDur2 = await f.evaluate(
    ({ actorId, itemId, activityId }) => {
      const a = globalThis.game.actors.get(actorId);
      return a.items.get(itemId).toObject().system.activities[activityId]?.duration?.expiry ?? null;
    },
    { actorId, itemId: feat, activityId: added.activityId }
  );
  assert(
    edited?.success && actDur2 === 'sourceStart',
    'activity edit: duration.expiry → sourceStart',
    actDur2
  );

  // ======================================================================
  // 5b. A value-less CORE expiry really fires: bare { expiry: 'turnEnd' } on a combatant expires
  //     the first time that combatant's turn ends. (Core 14.367 ActiveEffectRegistry#refresh:
  //     durationReached = remaining <= 0 || !Number.isFinite(remaining); _prepareDuration gives
  //     Infinity with no value. CONFIG.ActiveEffect.expiryAction defaults to "update", which
  //     stamps duration.expired = true.) Everything it makes is ZZ-* and torn down in-page.
  // ======================================================================
  const turnEndCase = await f.evaluate(async () => {
    const game = globalThis.game;
    const scene = game.scenes.active ?? game.scenes.contents[0];
    if (!scene) return { error: 'no scene available to host a combat' };
    // Its OWN actor: the combat's turn/round events expire (and dnd5e's combat teardown then
    // DELETES) every combat-expiry effect on the combatant's actor — the shared temp actor
    // carries "Wounded Guard" (1 round / turnEnd), which section 6 still needs.
    const actor = await game.actors.documentClass.create({
      name: 'ZZ-FX Combatant Actor',
      type: 'npc',
    });
    const actorId = actor.id;
    let token = null;
    let combat = null;
    let effectId = null;
    try {
      const tokenData = (
        await actor.getTokenDocument({ name: 'ZZ-FX Combatant', x: 0, y: 0 })
      ).toObject();
      tokenData.actorLink = true; // the combatant's actor must BE the effect's actor
      delete tokenData.delta;
      [token] = await scene.createEmbeddedDocuments('Token', [tokenData]);
      combat = await game.combats.documentClass.create({ scene: scene.id });
      await combat.createEmbeddedDocuments('Combatant', [
        { tokenId: token.id, sceneId: scene.id, actorId, initiative: 20 },
      ]);
      const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [
        {
          name: 'ZZ-FX bare turnEnd',
          duration: { expiry: 'turnEnd' },
          system: {
            changes: [
              { key: 'system.attributes.ac.bonus', value: '1', type: 'add', phase: 'initial' },
            ],
          },
        },
      ]);
      effectId = effect.id;
      const before = actor.effects.get(effectId)?.toObject()?.duration ?? null;
      await combat.startCombat();
      await combat.nextTurn(); // one combatant: ends its turn (and the round)
      // Combat#_onUpdate runs the end-turn workflow (registry.refresh('turnEnd')) WITHOUT the
      // nextTurn promise awaiting it — poll for the expiry stamp.
      let after = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        after = actor.effects.get(effectId)?.toObject()?.duration ?? null;
        if (after?.expired === true) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return { before, after };
    } finally {
      try {
        if (effectId) await actor.deleteEmbeddedDocuments('ActiveEffect', [effectId]);
      } catch {}
      try {
        if (combat) await combat.delete();
      } catch {}
      try {
        if (token) await scene.deleteEmbeddedDocuments('Token', [token.id]);
      } catch {}
      try {
        await actor.delete();
      } catch {}
    }
  }, {});
  assert(
    turnEndCase?.before?.expiry === 'turnEnd' && turnEndCase?.before?.expired !== true,
    'bare { expiry: "turnEnd" } starts unexpired',
    turnEndCase?.before
  );
  assert(
    turnEndCase?.after?.expired === true,
    'bare { expiry: "turnEnd" } expired at the first end of its combatant turn',
    turnEndCase
  );

  // ======================================================================
  // 6. content-audit flags a DEAD rules change written by hand (bypassing manage-effect)
  // ======================================================================
  //    A fresh vehicle: 5b's combat round advanced worldTime, and core treats ANY time advance as
  //    satisfying a combat expiry for an actor NOT in combat (ActiveEffect#isExpiryEvent), after
  //    which dnd5e deletes the expired out-of-combat effect — "Wounded Guard" is gone by now.
  const vehicle = await f.call('manageEffect', {
    action: 'create',
    actorIdentifier: actorId,
    effect: {
      name: `${TAG} Audit Vehicle`,
      changes: [{ key: 'system.attributes.ac.bonus', value: '1', type: 'add' }],
    },
  });
  assert(vehicle?.success, `manage-effect create "${TAG} Audit Vehicle"`);
  await f.evaluate(
    async ({ actorId, effectId }) => {
      const a = globalThis.game.actors.get(actorId);
      await a.updateEmbeddedDocuments('ActiveEffect', [
        { _id: effectId, 'system.changes': [{ key: 'attack', value: '2', type: 'add' }] },
      ]);
    },
    { actorId, effectId: vehicle.effectId }
  );
  const audit = await f.call('auditContent', { actorIdentifiers: [actorId] });
  const dead = (audit?.findings ?? []).filter(x => x.issue === 'dead-rules-change');
  assert(
    dead.length === 1 && /writes to nowhere/.test(dead[0].detail),
    'content-audit: one dead-rules-change finding (core add on key "attack")',
    dead
  );
  assert(
    audit?.counts?.effects_dead_rule === 1,
    'content-audit: counts.effects_dead_rule = 1',
    audit?.counts
  );
} catch (e) {
  fails++;
  console.log(`  FAIL  unexpected error: ${e?.stack || e}`);
} finally {
  try {
    if (tempActorIds.length) {
      await f.call('deleteActor', { identifiers: tempActorIds });
      console.log(`\ncleanup -> deleted ${tempActorIds.length} temp actor(s)`);
    }
  } catch (e) {
    console.log(`cleanup failed: ${e?.message || e}`);
  }
  await f.disconnect?.();
  console.log(`\n${passes}/${passes + fails} passed`);
  process.exit(fails > 0 ? 1 : 0);
}
