/**
 * Offline unit tests for the dnd5e message-data readers in src/page/combat-stats.ts. They lock the
 * dnd5e 6.0 chat shape (typed messages, `message.system.{item,origin,targets}`, targets carrying
 * `actor`/`token` uuids instead of `uuid`) AND the 5.x flag fallback, so the fold's wire vocabulary
 * (rollType names, `targets[].uuid` = actor uuid) stays stable across the system upgrade.
 */

import { describe, it, expect } from 'vitest';
import { messageItemUuid, messageOrigin, messageRollType, messageTargets } from './combat-stats.js';

describe('messageRollType', () => {
  it('maps dnd5e 6.0 typed messages to the 5.x roll vocabulary', () => {
    expect(messageRollType({ type: 'attack', system: {} })).toBe('attack');
    expect(messageRollType({ type: 'damage', system: {} })).toBe('damage');
    expect(messageRollType({ type: 'healing', system: {} })).toBe('healing');
    expect(messageRollType({ type: 'save', system: { type: 'ability' } })).toBe('save');
    expect(messageRollType({ type: 'save', system: { type: 'death' } })).toBe('death');
    expect(messageRollType({ type: 'save', system: { type: 'concentration' } })).toBe(
      'concentration'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'dex', skill: 'ste' } })).toBe(
      'skill'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'dex', tool: 'thief' } })).toBe(
      'tool'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'wis' } })).toBe('ability');
    expect(messageRollType({ type: 'check', system: { ability: 'dex', type: 'initiative' } })).toBe(
      'initiative'
    );
  });

  it('falls back to the 5.x flags.dnd5e.roll.type on an untyped (base) message', () => {
    expect(messageRollType({ type: 'base', flags: { dnd5e: { roll: { type: 'attack' } } } })).toBe(
      'attack'
    );
    expect(messageRollType({ type: 'base', flags: {} })).toBeUndefined();
    expect(messageRollType({})).toBeUndefined();
  });
});

describe('messageItemUuid', () => {
  it('prefers system.item, then the 5.x use/item flags', () => {
    expect(messageItemUuid({ system: { item: { uuid: 'Actor.a.Item.i' } }, flags: {} })).toBe(
      'Actor.a.Item.i'
    );
    expect(messageItemUuid({ system: {}, flags: { dnd5e: { use: { itemUuid: 'X' } } } })).toBe('X');
    expect(messageItemUuid({ system: {}, flags: { dnd5e: { item: { id: 'i1' } } } })).toBe('i1');
    expect(messageItemUuid({})).toBeNull();
  });
});

describe('messageOrigin', () => {
  it('reads system.origin as an id string or a resolved document', () => {
    expect(messageOrigin({ _source: { system: { origin: 'm0' } }, system: { origin: {} } })).toBe(
      'm0'
    );
    expect(messageOrigin({ system: { origin: { id: 'm0' } } })).toBe('m0');
    expect(
      messageOrigin({ system: { origin: null }, flags: { dnd5e: { originatingMessage: 'm9' } } })
    ).toBe('m9');
    expect(messageOrigin({ system: {} })).toBeNull();
  });
});

describe('messageTargets', () => {
  it('normalizes 6.0 {actor, token, name, ac} descriptors to the {uuid, name, ac} wire shape', () => {
    const t = messageTargets({
      system: {
        targets: [
          { actor: 'Scene.s.Token.t.Actor.a', token: 'Scene.s.Token.t', name: 'Goblin', ac: 15 },
          { actor: 'Actor.pc', token: 'Scene.s.Token.p', name: 'Anya', ac: null },
        ],
      },
    });
    expect(t).toEqual([
      { uuid: 'Scene.s.Token.t.Actor.a', name: 'Goblin', ac: 15, token: 'Scene.s.Token.t' },
      { uuid: 'Actor.pc', name: 'Anya', ac: null, token: 'Scene.s.Token.p' },
    ]);
  });

  it('reads the 5.x flags.dnd5e.targets shape unchanged, and null when absent', () => {
    expect(
      messageTargets({
        system: {},
        flags: { dnd5e: { targets: [{ uuid: 'Actor.x', name: 'X', ac: 12 }] } },
      })
    ).toEqual([{ uuid: 'Actor.x', name: 'X', ac: 12 }]);
    expect(messageTargets({ system: {}, flags: {} })).toBeNull();
  });
});
