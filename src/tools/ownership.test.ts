/**
 * Unit tests for OwnershipTools (set-actor-ownership, list-actor-ownership).
 *
 * These handlers are private and reached through `handleToolCall(name, args)`.
 * Each one resolves actors/players via extra bridge calls before applying
 * (or reading) ownership, so the mock foundry dispatches per-method via a
 * function response. The handlers return result OBJECTS (not strings), so the
 * assertions inspect those object fields against what the format code builds.
 */

import { describe, it, expect } from 'vitest';
import { OwnershipTools } from './ownership.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new OwnershipTools({ foundry, logger: makeLogger() });
  return { tools, calls, foundry };
}

describe('OwnershipTools.getToolDefinitions', () => {
  it('exposes exactly the two ownership tools', () => {
    const { tools } = build();
    const names = tools
      .getToolDefinitions()
      .map(t => t.name)
      .sort();
    expect(names).toEqual(['list-actor-ownership', 'set-actor-ownership']);
  });

  it('every definition has an object inputSchema', () => {
    const { tools } = build();
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('set-actor-ownership requires actor/player/permission and exposes the level enum', () => {
    const { tools } = build();
    const def = tools.getToolDefinitions().find(t => t.name === 'set-actor-ownership')!;
    expect(def.inputSchema.required).toEqual([
      'actorIdentifier',
      'playerIdentifier',
      'permissionLevel',
    ]);
    expect((def.inputSchema.properties as any).permissionLevel.enum).toEqual([
      'NONE',
      'LIMITED',
      'OBSERVER',
      'OWNER',
      'INHERIT',
    ]);
  });

  it('documents NONE as an explicit deny and INHERIT as the fallback-to-default', () => {
    const { tools } = build();
    const def = tools.getToolDefinitions().find(t => t.name === 'set-actor-ownership')!;
    const levelDoc = (def.inputSchema.properties as any).permissionLevel.description as string;
    // NONE must NOT read as "remove it" — that's INHERIT's job.
    expect(levelDoc).toMatch(/NONE stores a level-0 deny/);
    expect(levelDoc).toMatch(/INHERIT removes the entry/);
    expect(def.description).toMatch(/INHERIT removes the entry/);
  });
});

describe('set-actor-ownership (assignActorOwnership)', () => {
  // Dispatcher: findActor -> single actor; findPlayers -> single player;
  // setActorOwnership -> success payload the formatter reads.
  function singleAssignResponse(method: string) {
    switch (method) {
      case 'findActor':
        return { id: 'actor1', name: 'Aragorn' };
      case 'findPlayers':
        return [{ id: 'user1', name: 'John' }];
      case 'setActorOwnership':
        return { success: true, message: 'ok' };
      default:
        return {};
    }
  }

  it('forwards the correct bridge method + numeric permission and reports success', async () => {
    const { tools, calls } = build(singleAssignResponse);
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    // The mutating call carries the resolved ids and the numeric OWNER level (3).
    const ownershipCall = calls.find(c => c[0] === 'setActorOwnership');
    expect(ownershipCall).toBeDefined();
    expect(ownershipCall![1]).toEqual({ actorId: 'actor1', userId: 'user1', permission: 3 });

    expect(out).toMatchObject({
      success: true,
      message: '1 ownership assignments completed',
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      actor: 'Aragorn',
      player: 'John',
      permission: 'OWNER',
      success: true,
    });
  });

  it('maps each permission level name to its numeric Foundry constant', async () => {
    for (const [level, numeric] of [
      ['NONE', 0],
      ['LIMITED', 1],
      ['OBSERVER', 2],
      ['OWNER', 3],
    ] as const) {
      const { tools, calls } = build(singleAssignResponse);
      await tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: level,
      });
      const ownershipCall = calls.find(c => c[0] === 'setActorOwnership');
      expect(ownershipCall![1].permission).toBe(numeric);
    }
  });

  it('forwards INHERIT as permission:null (delete the key) — NOT as a numeric level', async () => {
    const { tools, calls } = build(singleAssignResponse);
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'INHERIT',
    });

    const ownershipCall = calls.find(c => c[0] === 'setActorOwnership');
    expect(ownershipCall![1]).toEqual({ actorId: 'actor1', userId: 'user1', permission: null });
    // Explicitly not 0 — an explicit 0 would override a permissive default instead of falling back.
    expect(ownershipCall![1].permission).not.toBe(0);
    expect(out.results[0]).toMatchObject({ permission: 'INHERIT', success: true });
  });

  it('a write the page refuses, with nothing landed, is the call error (design.md §3)', async () => {
    const refusal = Object.assign(new Error('User not found: u'), { code: 'not-found' });
    const { tools } = build((method: string) => {
      if (method === 'findActor') return { id: 'a', name: 'Aragorn' };
      if (method === 'findPlayers') return [{ id: 'u', name: 'John' }];
      if (method === 'setActorOwnership') throw refusal;
      return {};
    });
    await expect(
      tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: 'OBSERVER',
      })
    ).rejects.toBe(refusal);
  });

  it('a bulk write keeps a row per pair and counts the ones the page refused', async () => {
    const { tools } = build((method: string, args: any) => {
      if (method === 'getFriendlyNPCs')
        return [
          { id: 'n1', name: 'Guard' },
          { id: 'n2', name: 'Merchant' },
        ];
      if (method === 'findPlayers') return [{ id: 'u', name: 'John' }];
      if (method === 'setActorOwnership') {
        if (args.actorId === 'n2') throw new Error('Actor not found: n2');
        return { success: true, message: 'ok', target: 'actor' };
      }
      return {};
    });
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 'all friendly npcs',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
      confirmBulkOperation: true,
    });
    expect(out.message).toBe('1 ownership assignments completed, 1 failed');
    expect(out.results[1]).toMatchObject({ actor: 'Merchant', success: false });
  });

  it('blocks a bulk operation (multiple actors) unless confirmBulkOperation is set', async () => {
    // "all friendly npcs" resolves via getFriendlyNPCs -> 2 actors -> bulk.
    const { tools, calls } = build((method: string) => {
      if (method === 'getFriendlyNPCs')
        return [
          { id: 'n1', name: 'Guard' },
          { id: 'n2', name: 'Merchant' },
        ];
      if (method === 'findPlayers') return [{ id: 'u', name: 'John' }];
      return {};
    });
    // The guard throws (a curated FormattedToolError), reporting the change count in its message.
    await expect(
      tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'all friendly npcs',
        playerIdentifier: 'John',
        permissionLevel: 'OBSERVER',
      })
    ).rejects.toThrow(/Bulk operation detected: 2 actors × 1 players = 2/);
    // It must NOT have written anything when unconfirmed.
    expect(calls.some(c => c[0] === 'setActorOwnership')).toBe(false);
  });

  it('proceeds with a bulk operation when confirmBulkOperation is true', async () => {
    const { tools, calls } = build((method: string) => {
      if (method === 'getFriendlyNPCs')
        return [
          { id: 'n1', name: 'Guard' },
          { id: 'n2', name: 'Merchant' },
        ];
      if (method === 'findPlayers') return [{ id: 'u', name: 'John' }];
      if (method === 'setActorOwnership') return { success: true };
      return {};
    });
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 'all friendly npcs',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
      confirmBulkOperation: true,
    });
    expect(out.success).toBe(true);
    expect(out.results).toHaveLength(2);
    expect(calls.filter(c => c[0] === 'setActorOwnership')).toHaveLength(2);
  });

  it('rejects an invalid permission level via the zod enum', async () => {
    const { tools } = build(singleAssignResponse);
    await expect(
      tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: 'GODMODE',
      })
    ).rejects.toThrow();
  });
});

describe('set-actor-ownership with a placed token id (issue #19)', () => {
  /** findActor resolving to a token's synthetic actor: the base actor's id, and the token. */
  const viaToken = (linked: boolean) => (method: string) => {
    if (method === 'findActor')
      return {
        id: 'base1',
        name: 'Goblin Sentry',
        token: { sceneId: 's1', tokenId: 't1', name: 'Goblin Sentry', linked },
      };
    if (method === 'findPlayers') return [{ id: 'u1', name: 'John' }];
    if (method === 'setActorOwnership')
      return linked
        ? {
            success: true,
            target: 'actor',
            message: 'Set Goblin ownership to LIMITED for John — token "Goblin Sentry" is linked',
          }
        : { success: true, target: 'token', message: 'Set token "Goblin Sentry" ownership' };
    return {};
  };

  it("an unlinked token: the write carries the scene and the token, so it lands on the token's own actor", async () => {
    const { tools, calls } = build(viaToken(false));
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 't1',
      playerIdentifier: 'John',
      permissionLevel: 'LIMITED',
    });
    // the lookup is a write's: a tie would be refused, not picked
    expect(calls.find(c => c[0] === 'findActor')![1]).toEqual({ identifier: 't1', forWrite: true });
    // the page call names the token, never the bare base actor id alone
    expect(calls.find(c => c[0] === 'setActorOwnership')![1]).toEqual({
      actorId: 'base1',
      userId: 'u1',
      permission: 1,
      sceneId: 's1',
      tokenId: 't1',
    });
    expect(out.results[0]).toMatchObject({
      actor: 'Goblin Sentry',
      token: { id: 't1', scene: 's1', linked: false },
      target: 'token',
      success: true,
    });
  });

  it('a linked token: the page is still handed the token, and the answer says the write went to the base actor', async () => {
    const { tools, calls } = build(viaToken(true));
    const out = await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 't1',
      playerIdentifier: 'John',
      permissionLevel: 'LIMITED',
    });
    expect(calls.find(c => c[0] === 'setActorOwnership')![1]).toMatchObject({
      sceneId: 's1',
      tokenId: 't1',
    });
    expect(out.results[0]).toMatchObject({ target: 'actor', token: { linked: true } });
    expect(out.results[0].message).toMatch(/is linked/);
  });

  it('INHERIT on a token travels as permission:null with the token', async () => {
    const { tools, calls } = build(viaToken(false));
    await tools.handleToolCall('set-actor-ownership', {
      actorIdentifier: 't1',
      playerIdentifier: 'John',
      permissionLevel: 'INHERIT',
    });
    expect(calls.find(c => c[0] === 'setActorOwnership')![1]).toMatchObject({
      permission: null,
      tokenId: 't1',
    });
  });
});

describe('set-actor-ownership refuses a fuzzy name that names several (a write is never given the first)', () => {
  it('an actor name the page finds ambiguous is the call error, and nothing is written', async () => {
    const tie = Object.assign(new Error('Actor "Gob" matches 2: …'), { code: 'ambiguous' });
    const { tools, calls } = build((method: string) => {
      if (method === 'findActor') throw tie;
      return {};
    });
    await expect(
      tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Gob',
        playerIdentifier: 'John',
        permissionLevel: 'OWNER',
      })
    ).rejects.toBe(tie);
    expect(calls.some(c => c[0] === 'setActorOwnership')).toBe(false);
  });

  it('a player name that matches two players is refused, naming both, and nothing is written', async () => {
    const { tools, calls } = build((method: string) => {
      if (method === 'findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'findPlayers')
        return [
          { id: 'u1', name: 'John' },
          { id: 'u2', name: 'Johnny' },
        ];
      return {};
    });
    await expect(
      tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'joh',
        permissionLevel: 'OWNER',
        confirmBulkOperation: true,
      })
    ).rejects.toMatchObject({
      code: 'ambiguous',
      message: expect.stringMatching(/Player "joh" matches 2: "John" \(u1\), "Johnny" \(u2\)/),
    });
    expect(calls.some(c => c[0] === 'setActorOwnership')).toBe(false);
  });

  it('no actor and no player are misses (not-found), not an empty success', async () => {
    const none = build((method: string) => (method === 'findActor' ? null : []));
    await expect(
      none.tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Nobody',
        playerIdentifier: 'John',
        permissionLevel: 'OWNER',
      })
    ).rejects.toMatchObject({ code: 'not-found' });
    const noPlayer = build((method: string) =>
      method === 'findActor' ? { id: 'a1', name: 'Aragorn' } : []
    );
    await expect(
      noPlayer.tools.handleToolCall('set-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'Ghost',
        permissionLevel: 'OWNER',
      })
    ).rejects.toMatchObject({ code: 'not-found', message: expect.stringMatching(/"Ghost"/) });
  });
});

describe('list-actor-ownership (listActorOwnership)', () => {
  it('forwards identifiers to getActorOwnership and summarises the compact result', async () => {
    const ownership = [{ id: 'a1', name: 'Aragorn', default: 'NONE', explicit: { John: 'OWNER' } }];
    const { tools, calls } = build({ ownership, total: 168, listed: 1, trivialOmitted: 167 });
    const out = await tools.handleToolCall('list-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
    });
    expect(calls[0][0]).toBe('getActorOwnership');
    expect(calls[0][1]).toEqual({
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      verbose: undefined,
    });
    expect(out).toEqual({
      success: true,
      summary:
        '1 of 168 actor(s) with explicit entries or a non-NONE default; 167 inherit default NONE with no entries (not listed)',
      ownership,
    });
  });

  it('verbose: true asks the page for the per-player matrix', async () => {
    const { tools, calls } = build({ ownership: [], total: 2, listed: 2, trivialOmitted: 0 });
    const out = await tools.handleToolCall('list-actor-ownership', { verbose: true });
    expect(calls[0][1]).toMatchObject({ verbose: true });
    expect(out).toMatchObject({ summary: '2 actor(s), a row per player' });
  });

  it('lets a failed ownership query bubble to the central mapper (throws, not error-as-data)', async () => {
    const { tools } = build(() => {
      throw new Error('connection lost');
    });
    await expect(
      tools.handleToolCall('list-actor-ownership', { actorIdentifier: 'all' })
    ).rejects.toThrow(/connection lost/);
  });
});

describe('handleToolCall dispatch', () => {
  it('throws on an unknown tool name', async () => {
    const { tools } = build();
    await expect(tools.handleToolCall('not-a-tool', {})).rejects.toThrow(/Unknown ownership tool/);
  });
});
