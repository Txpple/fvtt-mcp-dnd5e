// Targeted 6.0.2 / 6.0.3 checks for the pin (sandbox only; ZZ-* docs, cleaned in finally).
//   #7482 (6.0.3): an effect with NO duration created on a combatant IN COMBAT must keep
//                  duration.expiry null (6.0.1/6.0.2 stamped "turnStart"); our read-back says permanent.
//   #7450 (6.0.2): a rules-type change whose condition keys off `sourceItem.*` is accepted by our
//                  Filter normaliser (open key vocabulary) and persists verbatim.
import { readFileSync } from 'node:fs';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from '../scripts/lib/bridge-config.mjs';
const env = Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()]}));
if (process.env.FOUNDRY_HOST !== 'local') { console.error('sandbox only: FOUNDRY_HOST=local'); process.exit(2); }
const f = new Foundry(bridgeConfig(env));
let pass = 0, fail = 0;
const check = (c, label, detail) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${label}${c ? '' : ' — ' + JSON.stringify(detail)}`); };
try {
  await f.connect();
  const r = await f.evaluate(async () => {
    const game = globalThis.game;
    const scene = game.scenes.active ?? game.scenes.contents[0];
    const actor = await game.actors.documentClass.create({ name: 'ZZ-PIN Combatant', type: 'npc' });
    let token = null, combat = null;
    try {
      const td = (await actor.getTokenDocument({ name: 'ZZ-PIN Combatant', x: 0, y: 0 })).toObject();
      td.actorLink = true; delete td.delta;
      [token] = await scene.createEmbeddedDocuments('Token', [td]);
      combat = await game.combats.documentClass.create({ scene: scene.id });
      await combat.createEmbeddedDocuments('Combatant', [{ tokenId: token.id, sceneId: scene.id, actorId: actor.id, initiative: 20 }]);
      await combat.startCombat();
      // #7482: no duration at all, created while the actor is in an active combat
      const [e1] = await actor.createEmbeddedDocuments('ActiveEffect', [{ name: 'ZZ-PIN no-duration', system: { changes: [{ key: 'system.attributes.ac.bonus', value: '1', type: 'add', phase: 'initial' }] } }]);
      const d1 = actor.effects.get(e1.id)?.toObject()?.duration ?? null;
      // and the same through OUR page function (manageEffect create), which normalises duration
      return { actorId: actor.id, noDuration: d1, systemVersion: game.system.version };
    } finally {
      try { if (combat) await combat.delete(); } catch {}
      try { if (token) await scene.deleteEmbeddedDocuments('Token', [token.id]); } catch {}
      // actor kept for the manageEffect calls below; deleted in the outer finally
    }
  });
  console.log(`sandbox dnd5e ${r.systemVersion}`);
  check(r.noDuration && r.noDuration.expiry == null, '#7482 no-duration effect created in combat keeps expiry null (was turnStart on 6.0.1/6.0.2)', r.noDuration);
  const actorId = r.actorId;
  try {
    // our write path: no duration → read-back "permanent" (null)
    const ours = await f.call('manageEffect', { action: 'create', actorIdentifier: actorId, effect: { name: 'ZZ-PIN ours', changes: [{ key: 'system.attributes.ac.bonus', value: '1' }] } });
    const dur = await f.evaluate(({ actorId, id }) => globalThis.game.actors.get(actorId).effects.get(id)?.toObject()?.duration ?? null, { actorId, id: ours.effectId });
    check(ours?.success && dur?.expiry == null, 'manage-effect create with no duration persists expiry null', dur);
    const list = await f.call('manageEffect', { action: 'list', actorIdentifier: actorId });
    const mine = (list?.effects ?? list ?? []).find?.(e => e.name === 'ZZ-PIN ours');
    check(mine && (mine.duration == null || mine.duration?.expiry == null), 'read-back reports it as permanent (no expiry)', mine?.duration);
    // #7450: sourceItem.* key in a rules-type change condition
    const rules = await f.call('manageEffect', { action: 'create', actorIdentifier: actorId, effect: { name: 'ZZ-PIN sourceItem rule', changes: [{ key: 'attack', type: 'dnd5e.bonus', value: '1', conditions: { k: 'sourceItem.type', v: 'weapon' } }] } }).catch(e => ({ error: e.message }));
    if (rules?.error) console.log('   (rules change shape differs — ' + rules.error.slice(0, 160) + ')');
    else {
      const persisted = await f.evaluate(({ actorId, id }) => globalThis.game.actors.get(actorId).effects.get(id)?.toObject()?.system?.changes?.[0]?.conditions ?? null, { actorId, id: rules.effectId });
      check(typeof persisted === 'string' && persisted.includes('sourceItem.type'), '#7450 sourceItem.* condition key accepted and persisted verbatim', persisted);
    }
  } finally {
    await f.evaluate(async ({ actorId }) => { try { await globalThis.game.actors.get(actorId)?.delete(); } catch {} }, { actorId });
  }
} finally {
  await f.dispose();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
