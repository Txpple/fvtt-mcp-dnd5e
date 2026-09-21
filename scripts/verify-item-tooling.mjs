// Live acceptance for the COMPLETE-NPC inventory build: add-item (structured physical-item builder)
// across every itemType + the update-actor currency group, then manage-items (action create / list /
// get / update / delete / import — the M8 union, src/tools/items.ts) through
// buildToolRegistry().dispatch. Exercises the page-side write/read seams against the live world;
// unit tests mock the seam, so this is the real correctness gate. Test docs are tagged ZZ-MCP-ITEM
// and cleaned up in a finally.
//
// Build first: npm run build. Run: node scripts/verify-item-tooling.mjs
import { loadEnv } from '../dist/env.js';
import { Foundry } from '../dist/foundry.js';
import { Logger } from '../dist/logger.js';
import { buildToolRegistry } from '../dist/registry.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();
const cfg = bridgeConfig(env);
const foundry = new Foundry(cfg);
// dnd5e 6.0 stores a rarity SET (`rarities`); toObject() data carries it as an array.
const rarityOf = s => (Array.isArray(s?.rarities) ? s.rarities[0] : s?.rarity) ?? '';

const results = [];
const pass = (n, s) => {
  results.push({ n, ok: true });
  console.log(`PASS  ${n}${s ? ` -> ${s}` : ''}`);
};
const fail = (n, e) => {
  results.push({ n, ok: false });
  console.log(`FAIL  ${n} -> ${e}`);
};
const tempActorIds = [];
const tempWorldItemIds = [];

async function makeTempNpc(name) {
  const r = await foundry.evaluate(async n => {
    const a = await globalThis.Actor.create({ name: n, type: 'npc' });
    return { id: a.id, name: a.name };
  }, name);
  tempActorIds.push(r.id);
  return r;
}
const ent = (actorId, name) =>
  foundry.call('getCharacterEntity', { characterIdentifier: actorId, entityIdentifier: name });

try {
  const npc = await makeTempNpc('ZZ-MCP-ITEM NPC');

  // ── 1. Magic weapon the creature fights with (mgc + magicalBonus + attunement + attack) ──
  {
    const r = await foundry.call('addItem', {
      itemType: 'weapon',
      actorIdentifier: npc.id,
      name: '+1 Longsword',
      weaponClass: 'martialM',
      baseItem: 'longsword',
      damage: { number: 1, denomination: 8, types: ['slashing'] },
      attackType: 'melee',
      magicalBonus: 1,
      rarity: 'rare',
      attunement: 'required',
      attuned: true,
      properties: ['ver'],
      price: { value: 5000, denomination: 'gp' },
      weight: { value: 3 },
      withAttack: true,
    });
    const e = (await ent(npc.id, '+1 Longsword'))?.entity;
    const s = e?.system;
    const acts = Object.values(s?.activities ?? {});
    const ok =
      e?.type === 'weapon' &&
      s?.magicalBonus === '1' &&
      [...(s?.properties ?? [])].includes('mgc') &&
      [...(s?.properties ?? [])].includes('ver') &&
      s?.attunement === 'required' &&
      s?.equipped === true &&
      rarityOf(s) === 'rare' &&
      s?.damage?.base?.denomination === 8 &&
      acts.some(a => a.type === 'attack');
    ok
      ? pass('weapon: +1 magic longsword + attack', `mgc/+1/${s.attunement}/act=${acts.length}`)
      : fail(
          'weapon: +1 magic longsword',
          JSON.stringify({
            id: r?.item?.id,
            mb: s?.magicalBonus,
            props: s?.properties,
            att: s?.attunement,
            acts: acts.map(a => a.type),
          })
        );
  }

  // ── 2. Worn armor + wireAc (actor AC switches to default/armor-derived) ──
  {
    await foundry.call('addItem', {
      itemType: 'armor',
      actorIdentifier: npc.id,
      name: 'Chain Mail',
      armorType: 'heavy',
      armorValue: 16,
      dex: 0,
      strength: 13,
      proficient: 1,
      wireAc: true,
    });
    const e = (await ent(npc.id, 'Chain Mail'))?.entity;
    const info = await foundry.call('getCharacterInfo', { characterName: npc.id });
    // dnd5e 6.0: wireAc puts the actor on the default calcs (unarmored/armored) with no override;
    // get-actor reports the persisted calcs + the winning calc under `derived.ac`.
    const ac = info?.derived?.ac ?? {};
    const ok =
      e?.system?.armor?.value === 16 &&
      e?.system?.type?.value === 'heavy' &&
      Array.isArray(ac.calcs) &&
      ac.calcs.includes('armored') &&
      ac.override === undefined &&
      ac.value === 16;
    ok
      ? pass('armor: chain mail + wireAc', `armor=16, ac=${ac.value} via ${ac.calc}`)
      : fail('armor: chain mail + wireAc', JSON.stringify({ armor: e?.system?.armor, ac }));
  }

  // ── 3. Shield (defaults to +2, type.value shield) ──
  {
    await foundry.call('addItem', { itemType: 'shield', actorIdentifier: npc.id, name: 'Shield' });
    const e = (await ent(npc.id, 'Shield'))?.entity;
    e?.system?.type?.value === 'shield' && e?.system?.armor?.value === 2
      ? pass('shield: +2 AC', `value=${e.system.armor.value}`)
      : fail('shield', JSON.stringify(e?.system?.armor));
  }

  // ── 3b. wireAc on a SHIELD must NOT clobber an authored natural AC (the HIGH review fix) ──
  {
    const npc2 = await makeTempNpc('ZZ-MCP-ITEM ShieldGuard');
    await foundry.call('updateActor', {
      actorIdentifier: npc2.id,
      ac: { calc: 'natural', flat: 17 },
    });
    await foundry.call('addItem', {
      itemType: 'shield',
      actorIdentifier: npc2.id,
      name: 'Tower Shield',
      wireAc: true, // must be a no-op for a shield — calc stays 'natural'
    });
    const info = await foundry.call('getCharacterInfo', { characterName: npc2.id });
    const ac2 = info?.derived?.ac ?? {};
    JSON.stringify(ac2.calcs) === JSON.stringify(['natural']) && ac2.value === 19
      ? pass('shield + wireAc leaves natural AC intact', `calcs=${ac2.calcs} ac=${ac2.value}`)
      : fail('shield + wireAc clobbered AC', `${JSON.stringify(ac2)} (expected natural 17 + 2)`);
  }

  // ── 4. Consumable potion (uses + autoDestroy) ──
  {
    await foundry.call('addItem', {
      itemType: 'consumable',
      actorIdentifier: npc.id,
      name: 'Potion of Healing',
      consumableType: 'potion',
      rarity: 'common',
      uses: { max: 1, autoDestroy: true },
      price: { value: 50, denomination: 'gp' },
    });
    const e = (await ent(npc.id, 'Potion of Healing'))?.entity;
    const s = e?.system;
    e?.type === 'consumable' &&
    s?.type?.value === 'potion' &&
    String(s?.uses?.max) === '1' &&
    s?.uses?.autoDestroy === true
      ? pass(
          'consumable: potion of healing',
          `uses.max=${s.uses.max}, autoDestroy=${s.uses.autoDestroy}`
        )
      : fail('consumable: potion', JSON.stringify({ type: e?.type, t: s?.type, uses: s?.uses }));
  }

  // ── 5. Ammunition stack (quantity + base damage) ──
  {
    await foundry.call('addItem', {
      itemType: 'consumable',
      actorIdentifier: npc.id,
      name: 'Arrows',
      consumableType: 'ammo',
      subtype: 'arrow',
      quantity: 20,
      damage: { number: 1, denomination: 6, types: ['piercing'] },
    });
    const e = (await ent(npc.id, 'Arrows'))?.entity;
    const s = e?.system;
    s?.type?.value === 'ammo' && s?.quantity === 20 && s?.damage?.base?.denomination === 6
      ? pass('consumable: 20 arrows', `qty=${s.quantity}`)
      : fail(
          'consumable: arrows',
          JSON.stringify({ t: s?.type, qty: s?.quantity, dmg: s?.damage })
        );
  }

  // ── 6. Loot gem (priced, not equippable) ──
  {
    await foundry.call('addItem', {
      itemType: 'loot',
      actorIdentifier: npc.id,
      name: 'Ruby',
      lootType: 'gem',
      price: { value: 50, denomination: 'gp' },
    });
    const e = (await ent(npc.id, 'Ruby'))?.entity;
    const s = e?.system;
    e?.type === 'loot' &&
    s?.type?.value === 'gem' &&
    s?.price?.value === 50 &&
    s?.equipped === undefined
      ? pass('loot: ruby (50gp, not equippable)', `price=${s.price.value}`)
      : fail(
          'loot: ruby',
          JSON.stringify({ type: e?.type, t: s?.type, price: s?.price, equipped: s?.equipped })
        );
  }

  // ── 7. Container + nesting (child.system.container = container id) ──
  {
    const pouch = await foundry.call('addItem', {
      itemType: 'container',
      actorIdentifier: npc.id,
      name: 'Belt Pouch',
      capacity: { weight: { value: 6, units: 'lb' } },
    });
    const pouchId = pouch?.item?.id;
    await foundry.call('addItem', {
      itemType: 'loot',
      actorIdentifier: npc.id,
      name: 'Old Key',
      lootType: 'junk',
      container: 'Belt Pouch',
    });
    const key = (await ent(npc.id, 'Old Key'))?.entity;
    pouchId && key?.system?.container === pouchId
      ? pass('container: nest item via container name', `key.container=${key.system.container}`)
      : fail(
          'container: nesting',
          JSON.stringify({ pouchId, keyContainer: key?.system?.container })
        );
  }

  // ── 8. Actor currency (set then relative add) ──
  {
    const setR = await foundry.call('updateActor', {
      actorIdentifier: npc.id,
      currency: { gp: 30, sp: 5 },
    });
    const i1 = await foundry.call('getCharacterInfo', { characterName: npc.id });
    const okSet =
      (setR?.applied ?? []).includes('currency') &&
      i1?.system?.currency?.gp === 30 &&
      i1?.system?.currency?.sp === 5;
    okSet
      ? pass('currency: set 30gp/5sp', 'gp=30,sp=5')
      : fail('currency: set', JSON.stringify(i1?.system?.currency));

    await foundry.call('updateActor', {
      actorIdentifier: npc.id,
      currency: { mode: 'add', gp: -10 },
    });
    const i2 = await foundry.call('getCharacterInfo', { characterName: npc.id });
    i2?.system?.currency?.gp === 20
      ? pass('currency: add -10gp', `gp=${i2.system.currency.gp}`)
      : fail('currency: add', JSON.stringify(i2?.system?.currency));
  }

  // ── 9. World Items sidebar path (no actorIdentifier) ──
  {
    const r = await foundry.call('addItem', {
      itemType: 'wondrous',
      name: 'ZZ-MCP-ITEM Cloak of Protection',
      equipmentType: 'trinket',
      magical: true,
      rarity: 'uncommon',
      attunement: 'required',
      folder: 'ZZ-MCP-ITEM Loot',
    });
    const wid = r?.item?.id;
    if (wid) tempWorldItemIds.push(wid);
    const gi = await foundry.call('getWorldItem', { identifier: wid });
    gi?.type === 'equipment' &&
    [...(gi?.system?.properties ?? [])].includes('mgc') &&
    gi?.system?.attunement === 'required'
      ? pass('world item: wondrous (mgc + attunement)', `id=${wid}`)
      : fail(
          'world item: wondrous',
          JSON.stringify({
            type: gi?.type,
            props: gi?.system?.properties,
            att: gi?.system?.attunement,
          })
        );
  }

  // ── 10. dnd5e 6.0 "Rarity Varies": a LIST of rarities is written natively to system.rarities ──
  {
    const r = await foundry.call('addItem', {
      itemType: 'consumable',
      name: 'ZZ-MCP-ITEM Potion of Healing (varies)',
      consumableType: 'potion',
      rarity: ['common', 'uncommon'],
      folder: 'ZZ-MCP-ITEM Loot',
    });
    const wid = r?.item?.id;
    if (wid) tempWorldItemIds.push(wid);
    const gi = await foundry.call('getWorldItem', { identifier: wid });
    const rs = Array.isArray(gi?.system?.rarities) ? gi.system.rarities : [];
    rs.length === 2 && rs.includes('common') && rs.includes('uncommon')
      ? pass('world item: rarity list -> system.rarities', JSON.stringify(rs))
      : fail('world item: rarity list', JSON.stringify(gi?.system?.rarities));
    // and update-actor-item's 5.x `system.rarity` patch lands in `system.rarities`
    const npcForRarity = await makeTempNpc('ZZ-MCP-ITEM Rarity NPC');
    const r2 = await foundry.call('addItem', {
      itemType: 'wondrous',
      name: 'ZZ-MCP-ITEM Bauble',
      equipmentType: 'trinket',
      actorIdentifier: npcForRarity.id,
      rarity: 'common',
      lootCopy: false,
    });
    await foundry.call('updateActorItem', {
      actorIdentifier: npcForRarity.id,
      itemIdentifier: r2?.item?.id,
      patch: { 'system.rarity': 'rare' },
    });
    const bauble = await foundry.evaluate(
      ({ actorId, itemId }) =>
        globalThis.game.actors.get(actorId).items.get(itemId).toObject().system.rarities,
      { actorId: npcForRarity.id, itemId: r2?.item?.id }
    );
    JSON.stringify(bauble) === JSON.stringify(['rare'])
      ? pass('update-actor-item: system.rarity patch -> system.rarities', JSON.stringify(bauble))
      : fail('update-actor-item: rarity patch', JSON.stringify(bauble));
  }

  // ── 11. manage-items through the registry (the M8 union: action create / list / get / update /
  //        delete / import) ──
  {
    const { dispatch, tools } = buildToolRegistry({
      foundry,
      logger: new Logger({ level: 'error' }),
      host: cfg.host,
    });
    const names = new Set(tools.map(t => t.name));
    names.has('manage-items') &&
    names.has('remove-from-actor') &&
    ['create-item', 'list-items', 'get-item', 'update-item', 'delete-item', 'import-item'].every(
      n => !names.has(n)
    )
      ? pass('manage-items: advertised; the six per-op tools gone; remove-from-actor stays')
      : fail('manage-items: advertised', [...names].filter(n => /item/.test(n)).join(','));
    const mi = args => dispatch('manage-items', args);
    const cr = String(
      await mi({
        action: 'create',
        items: [
          { name: 'ZZ-MCP-ITEM Union Dagger', type: 'weapon' },
          { name: 'ZZ-MCP-ITEM Union Gem', type: 'loot' },
        ],
        folder: 'ZZ-MCP-ITEM Loot',
      })
    );
    const ids = [...cr.matchAll(/\((\w{16}), (\w+)\)/g)].map(m => m[1]);
    tempWorldItemIds.push(...ids);
    ids.length === 2 &&
    cr.startsWith('Created 2 world item(s) in folder "ZZ-MCP-ITEM Loot" (') &&
    cr.includes(
      `"ZZ-MCP-ITEM Union Dagger" (${ids[0]}, weapon), "ZZ-MCP-ITEM Union Gem" (${ids[1]}, loot)`
    )
      ? pass('manage-items create: one line, the folder, each id + type', cr.slice(0, 80))
      : fail('manage-items create', cr);
    const lines = String(await mi({ action: 'list', folder: 'ZZ-MCP-ITEM Loot' })).split('\n');
    /^\d+ item\(s\): id name type folder$/.test(lines[0] ?? '') &&
    lines.includes(`${ids[0]} "ZZ-MCP-ITEM Union Dagger" weapon "ZZ-MCP-ITEM Loot"`)
      ? pass('manage-items list: the header + the row (folder filter)', lines[0])
      : fail('manage-items list', lines.slice(0, 3).join(' | '));
    const got = await mi({ action: 'get', identifier: ids[1] });
    got?.id === ids[1] && got?.type === 'loot' && got?.folderName === 'ZZ-MCP-ITEM Loot'
      ? pass('manage-items get: the JSON read', `${got.name} / ${got.type}`)
      : fail('manage-items get', JSON.stringify(got).slice(0, 120));
    const up = String(
      await mi({
        action: 'update',
        updates: [
          { id: ids[0], name: 'ZZ-MCP-ITEM Union Dagger +1', system: { rarity: 'uncommon' } },
        ],
      })
    );
    up === `Updated 1 world item(s): "ZZ-MCP-ITEM Union Dagger +1" (${ids[0]}, weapon)`
      ? pass('manage-items update: one line', up)
      : fail('manage-items update', up);
    const imported = String(
      await mi({
        action: 'import',
        packId: 'dnd-players-handbook.equipment',
        itemId: (
          await foundry.call('searchCompendiumFaceted', {
            documentType: 'gear',
            name: 'Dagger',
            limit: 5,
          })
        )?.results?.find(h => h.name === 'Dagger')?.id,
        name: 'ZZ-MCP-ITEM Union Import',
        folder: 'ZZ-MCP-ITEM Loot',
      })
    );
    const impId = /: id (\w{16}), type/.exec(imported)?.[1];
    if (impId) tempWorldItemIds.push(impId);
    !!impId &&
    imported.startsWith(
      'Copied "ZZ-MCP-ITEM Union Import" (from "Dagger") onto world Items (folder "ZZ-MCP-ITEM Loot"): id '
    )
      ? pass('manage-items import: one line, the rename, the world target + folder', imported)
      : fail('manage-items import', imported);
    for (const [args, want] of [
      [
        { action: 'add-to-actor', items: [] },
        'action must be one of "create", "list", "get", "update", "delete", "import"',
      ],
      [{ action: 'get', id: 'x' }, 'unknown argument "id" — it takes: action, identifier'],
      [{ action: 'import', packId: 'dnd5e.items', itemId: 'x' }, 'SRD'],
      [{ action: 'get', identifier: 'ZZ-no-such-item' }, 'not found'],
    ]) {
      let msg = '';
      try {
        await mi(args);
      } catch (e) {
        msg = e?.message ?? String(e);
      }
      msg.includes(want)
        ? pass(`manage-items refused by name / a miss is an error: ${want.slice(0, 50)}`)
        : fail(`manage-items refusal: ${want.slice(0, 50)}`, msg.slice(0, 120));
    }
    const del = String(await mi({ action: 'delete', identifiers: [ids[1], 'ZZ-NOPE-ITEM'] }));
    del ===
    `Deleted 1 world item(s): "ZZ-MCP-ITEM Union Gem" (${ids[1]}) (1 not found: ZZ-NOPE-ITEM)`
      ? pass('manage-items delete: one line with the not-found tail', del)
      : fail('manage-items delete', del);
    tempWorldItemIds.splice(tempWorldItemIds.indexOf(ids[1]), 1);
  }
} catch (e) {
  fail('SUITE', e?.message || String(e));
} finally {
  if (tempWorldItemIds.length) {
    try {
      await foundry.call('deleteWorldItems', { identifiers: tempWorldItemIds });
    } catch (e) {
      console.log(`world-item cleanup FAILED: ${e?.message || e}`);
    }
  }
  if (tempActorIds.length) {
    try {
      const del = await foundry.call('deleteActor', { identifiers: tempActorIds });
      console.log(`cleanup -> deleted ${del?.deletedCount ?? 0} temp actor(s)`);
    } catch (e) {
      console.log(`cleanup FAILED: ${e?.message || e}`);
    }
  }
  await foundry.dispose?.();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
