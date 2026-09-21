// dnd5e 6.0.2 #7470 (M1 leftover): does an ELEVATION write from our tools, on a scene the bridge
// does NOT view, with falling automation ON, mark the actor Falling / post fall damage?
// Sandbox only; ZZ-* docs; the setting and the docs restored in finally.
import { readFileSync } from 'node:fs';
import { Foundry } from '../dist/foundry.js';
import { bridgeConfig } from '../scripts/lib/bridge-config.mjs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()];
    })
);
if (process.env.FOUNDRY_HOST !== 'local') {
  console.error('sandbox only: FOUNDRY_HOST=local');
  process.exit(2);
}
const f = new Foundry(bridgeConfig(env));
try {
  await f.connect();
  const setup = await f.evaluate(async () => {
    const game = globalThis.game;
    const wasDisabled = game.settings.get('dnd5e', 'disableFalling');
    if (wasDisabled) await game.settings.set('dnd5e', 'disableFalling', false);
    // a scene the bridge does not view: any non-active scene
    const scene = game.scenes.contents.find(s => !s.active && s.id !== game.scenes.current?.id);
    const actor = await game.actors.documentClass.create({ name: 'ZZ-7470 Faller', type: 'npc' });
    const td = (await actor.getTokenDocument({ name: 'ZZ-7470 Faller', x: 700, y: 700 })).toObject();
    td.actorLink = true;
    td.elevation = 0;
    delete td.delta;
    const [token] = await scene.createEmbeddedDocuments('Token', [td]);
    const chatBefore = game.messages.size;
    return {
      wasDisabled,
      sceneId: scene.id,
      sceneName: scene.name,
      viewed: game.scenes.current?.name ?? null,
      actorId: actor.id,
      tokenId: token.id,
      chatBefore,
      dnd5e: game.system.version,
    };
  });
  console.log(`dnd5e ${setup.dnd5e}; falling was ${setup.wasDisabled ? 'DISABLED' : 'enabled'}; scene "${setup.sceneName}" (viewed: "${setup.viewed}")`);
  try {
    // OUR write path: update-token elevation 0 → 30 (a balcony), then 30 → 0 (back down)
    const up = await f.call('updateSceneTokens', { sceneIdentifier: setup.sceneId, tokenIds: [setup.tokenId], elevation: 30 });
    await new Promise(r => setTimeout(r, 1500));
    const afterUp = await f.evaluate(({ actorId, sceneId, tokenId, chatBefore }) => {
      const game = globalThis.game;
      const actor = game.actors.get(actorId);
      const token = game.scenes.get(sceneId).tokens.get(tokenId);
      return {
        elevation: token.elevation,
        falling: actor.statuses.has('falling'),
        statuses: [...actor.statuses],
        newChat: game.messages.contents.slice(chatBefore).map(m => (m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)),
      };
    }, setup);
    console.log('after elevation 30:', JSON.stringify({ updated: up?.updated, ...afterUp }));
    const down = await f.call('updateSceneTokens', { sceneIdentifier: setup.sceneId, tokenIds: [setup.tokenId], elevation: 0 });
    await new Promise(r => setTimeout(r, 1500));
    const afterDown = await f.evaluate(({ actorId, sceneId, tokenId, chatBefore }) => {
      const game = globalThis.game;
      const actor = game.actors.get(actorId);
      const token = game.scenes.get(sceneId).tokens.get(tokenId);
      return {
        elevation: token.elevation,
        falling: actor.statuses.has('falling'),
        hp: actor.system.attributes.hp.value,
        newChat: game.messages.contents.slice(chatBefore).map(m => (m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)),
      };
    }, setup);
    console.log('after elevation 0:', JSON.stringify({ updated: down?.updated, ...afterDown }));
  } finally {
    await f.evaluate(async ({ actorId, sceneId, tokenId, chatBefore, wasDisabled }) => {
      const game = globalThis.game;
      try {
        await game.scenes.get(sceneId)?.deleteEmbeddedDocuments('Token', [tokenId]);
      } catch {}
      try {
        await game.actors.get(actorId)?.delete();
      } catch {}
      // any chat the probe produced
      const extra = game.messages.contents.slice(chatBefore).map(m => m.id);
      if (extra.length) await game.messages.documentClass.deleteDocuments(extra);
      if (wasDisabled) await game.settings.set('dnd5e', 'disableFalling', true);
    }, setup);
    console.log('cleaned up');
  }
} finally {
  await f.dispose();
}
