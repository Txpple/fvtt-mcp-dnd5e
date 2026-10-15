/**
 * Unit tests for setActorOwnership — the page-side write behind set-actor-ownership.
 *
 * The load-bearing distinction: Foundry treats an ABSENT ownership key and an explicit
 * level-0 entry differently. An absent key inherits `ownership.default`; an explicit 0
 * OVERRIDES it. So INHERIT must REMOVE the user's key (rebuilding the whole object —
 * the `{"ownership.-=<id>": null}` idiom silently no-ops on this field), while NONE must
 * keep storing an explicit 0.
 *
 * `game` is a page global; these tests stand up a minimal actors/users fake around it and
 * record what actor.update() was handed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { findPlayers, getActorOwnership, setActorOwnership } from './ownership.js';

type UpdateCall = { data: any; options?: any };

/**
 * Install a fake `game` with one actor (carrying `ownership`) and one user. Returns the
 * recorded update calls; `update` also applies the write so post-state can be asserted.
 */
function stubWorld(ownership: Record<string, number>) {
  const updates: UpdateCall[] = [];
  const actor: any = {
    id: 'actor1',
    name: 'The Party',
    ownership: { ...ownership },
    update: async (data: any, options?: any) => {
      updates.push({ data, options });
      actor.ownership = { ...data.ownership };
    },
  };
  (globalThis as any).game = {
    actors: { get: (id: string) => (id === actor.id ? actor : undefined) },
    users: { get: (id: string) => (id === 'u1' ? { id: 'u1', name: 'John' } : undefined) },
  };
  return { actor, updates };
}

afterEach(() => {
  delete (globalThis as any).game;
});

describe('setActorOwnership — INHERIT (permission: null)', () => {
  it('REMOVES the user key so the actor default applies again', async () => {
    // The party-stash shape: default OWNER, one player pinned to an explicit 0.
    const { actor, updates } = stubWorld({ default: 3, u1: 0, u2: 2 });

    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: null });

    expect(out.success).toBe(true);
    expect(updates).toHaveLength(1);
    // The key is GONE — not set to 0, not set to undefined.
    expect(updates[0].data.ownership).toEqual({ default: 3, u2: 2 });
    expect(Object.hasOwn(updates[0].data.ownership, 'u1')).toBe(false);
    expect(Object.hasOwn(actor.ownership, 'u1')).toBe(false);
    // Other entries (including `default`) survive untouched.
    expect(actor.ownership.default).toBe(3);
    expect(actor.ownership.u2).toBe(2);
  });

  it('writes the whole object with diff/recursive off (a recursive merge would re-add the key)', async () => {
    const { updates } = stubWorld({ default: 3, u1: 0 });
    await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: null });
    expect(updates[0].options).toEqual({ diff: false, recursive: false });
    // And it must not reach for the `-=` deletion idiom, which silently no-ops here.
    expect(Object.keys(updates[0].data)).toEqual(['ownership']);
  });

  it('reports the level the user now inherits', async () => {
    const { updates } = stubWorld({ default: 3, u1: 0 });
    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: null });
    expect(out.message).toMatch(/Removed John's explicit ownership entry.*inherits.*\(OWNER\)/);
    expect(updates).toHaveLength(1);
  });

  it('is idempotent when there is no explicit entry to remove', async () => {
    const { actor, updates } = stubWorld({ default: 2 });
    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: null });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/no explicit ownership entry.*already inheriting.*\(OBSERVER\)/);
    expect(updates[0].data.ownership).toEqual({ default: 2 });
    expect(actor.ownership).toEqual({ default: 2 });
  });

  it('falls back to NONE when the actor has no default entry at all', async () => {
    stubWorld({ u1: 3 });
    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: null });
    expect(out.message).toMatch(/\(NONE\)/);
  });
});

describe('setActorOwnership — explicit levels', () => {
  it('NONE stores an EXPLICIT 0 (an override of the default, not a removal)', async () => {
    const { actor, updates } = stubWorld({ default: 3, u2: 2 });

    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: 0 });

    expect(out.success).toBe(true);
    expect(updates[0].data.ownership).toEqual({ default: 3, u2: 2, u1: 0 });
    expect(Object.hasOwn(actor.ownership, 'u1')).toBe(true);
    expect(actor.ownership.u1).toBe(0);
    // The message has to say what a stored 0 actually does, or a GM reads it as "removed".
    expect(out.message).toMatch(/NONE.*explicit deny.*INHERIT/);
  });

  it('merges a granted level into the existing map without disturbing other entries', async () => {
    const { actor } = stubWorld({ default: 0, u2: 2 });
    const out = await setActorOwnership({ actorId: 'actor1', userId: 'u1', permission: 3 });
    expect(actor.ownership).toEqual({ default: 0, u2: 2, u1: 3 });
    expect(out.message).toBe('Set The Party ownership to OWNER for John');
  });
});

/**
 * Install a fake `game` for the READ path: one actor carrying `ownership`, plus a
 * player and a GM. `testUserPermission` mirrors Foundry's cascade — GMs are always
 * OWNER, everyone else gets their explicit entry or falls back to `default`.
 */
function stubReadWorld(ownership: Record<string, number> | undefined) {
  const LEVELS: Record<string, number> = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
  const actor: any = {
    id: 'actor1',
    name: 'The Party',
    type: 'group',
    ownership: ownership ? { ...ownership } : undefined,
    testUserPermission: (user: any, level: string) => {
      const map = actor.ownership ?? {};
      const held = user.isGM ? 3 : (map[user.id] ?? map.default ?? 0);
      return held >= LEVELS[level];
    },
  };
  const users = [
    { id: 'u1', name: 'John', isGM: false },
    { id: 'gm', name: 'Gamemaster', isGM: true },
  ];
  (globalThis as any).game = {
    actors: {
      contents: [actor],
      get: (id: string) => (id === actor.id ? actor : undefined),
      getName: (name: string) => (name === actor.name ? actor : undefined),
    },
    users: { contents: users, get: (id: string) => users.find(u => u.id === id) },
  };
  return { actor };
}

/** The single verbose row getActorOwnership produces for the lone player. */
function readRow(): any {
  return (getActorOwnership({ actorIdentifier: 'all', verbose: true }) as any).ownership[0];
}

describe('getActorOwnership — compact shape (default)', () => {
  it('lists the explicit entries by player name and the actor default', () => {
    stubReadWorld({ default: 3, u1: 0 });
    const out = getActorOwnership({}) as any;
    expect(out).toEqual({
      ownership: [
        { id: 'actor1', name: 'The Party', default: 'OWNER', explicit: { John: 'NONE' } },
      ],
      total: 1,
      listed: 1,
      trivialOmitted: 0,
    });
  });

  it('counts, but does not list, an actor with default NONE and no explicit entry', () => {
    stubReadWorld({ default: 0 });
    expect(getActorOwnership({})).toEqual({
      ownership: [],
      total: 1,
      listed: 0,
      trivialOmitted: 1,
    });
  });

  it('lists a non-NONE default without an explicit key', () => {
    stubReadWorld({ default: 2 });
    const out = getActorOwnership({}) as any;
    expect(out.ownership).toEqual([{ id: 'actor1', name: 'The Party', default: 'OBSERVER' }]);
  });

  it('lists a trivial actor when it was asked for by name', () => {
    stubReadWorld({ default: 0 });
    const out = getActorOwnership({ actorIdentifier: 'The Party' }) as any;
    expect(out.ownership).toEqual([{ id: 'actor1', name: 'The Party', default: 'NONE' }]);
    expect(out.trivialOmitted).toBe(0);
  });
});

describe('getActorOwnership — verbose: explicit vs inherited', () => {
  it('marks an explicit level-0 entry as an explicit DENY, not an absent one', async () => {
    // The party-stash shape: default OWNER, one player pinned to an explicit 0. Both this
    // and "no entry at all on a default-NONE actor" read as NONE — only `source` separates
    // them, and that is what decides between set-actor-ownership NONE and INHERIT.
    stubReadWorld({ default: 3, u1: 0 });

    const info = readRow();
    expect(info.defaultPermission).toBe('OWNER');
    expect(info.numericDefaultPermission).toBe(3);
    expect(info.ownership).toEqual([
      {
        userId: 'u1',
        userName: 'John',
        permission: 'NONE',
        numericPermission: 0,
        source: 'explicit',
        explicitPermission: 'NONE',
        numericExplicitPermission: 0,
      },
    ]);
  });

  it('marks a level the player only gets from the actor default as inherited', async () => {
    stubReadWorld({ default: 3 });

    const row = readRow().ownership[0];
    expect(row.permission).toBe('OWNER');
    expect(row.source).toBe('inherited');
    expect(row.explicitPermission).toBeNull();
    expect(row.numericExplicitPermission).toBeNull();
  });

  it('reports a granted entry as explicit even when it matches the default', async () => {
    stubReadWorld({ default: 2, u1: 2 });

    const row = readRow().ownership[0];
    expect(row.permission).toBe('OBSERVER');
    expect(row.source).toBe('explicit');
    expect(row.explicitPermission).toBe('OBSERVER');
  });

  it('defaults to NONE when the actor carries no ownership map at all', async () => {
    stubReadWorld(undefined);

    const info = readRow();
    expect(info.defaultPermission).toBe('NONE');
    expect(info.numericDefaultPermission).toBe(0);
    expect(info.ownership[0]).toMatchObject({ permission: 'NONE', source: 'inherited' });
  });

  it('still excludes GM users, who test as OWNER on everything', async () => {
    stubReadWorld({ default: 0 });
    expect(readRow().ownership.map((r: any) => r.userId)).toEqual(['u1']);
  });
});

describe('setActorOwnership — guards', () => {
  it('a miss (an unknown actor or user) is a not-found error, writing nothing (design.md §3)', async () => {
    const { updates } = stubWorld({ default: 3 });
    await expect(
      setActorOwnership({ actorId: 'nope', userId: 'u1', permission: null })
    ).rejects.toMatchObject({ code: 'not-found', message: 'Actor not found: nope' });
    await expect(
      setActorOwnership({ actorId: 'actor1', userId: 'ghost', permission: null })
    ).rejects.toMatchObject({ code: 'not-found', message: 'User not found: ghost' });
    expect(updates).toHaveLength(0);
  });
});

describe('setActorOwnership — a placed token (issue #19)', () => {
  /**
   * A base actor and one placed token of it on scene s1. The token's own ownership lives on its
   * ActorDelta (null: nothing of its own); its synthetic actor's map is the base's with the
   * delta's entries over it, per user — what Foundry's ActorDelta.applyDelta builds.
   */
  function stubTokenWorld(opts: { linked: boolean; delta?: Record<string, number> | null }) {
    const writes: Array<{ doc: string; data: any; options?: any }> = [];
    const base: any = {
      id: 'base1',
      name: 'Goblin',
      ownership: { default: 0, u2: 2 },
      update: async (data: any, options?: any) => {
        writes.push({ doc: 'base', data, options });
        base.ownership = { ...data.ownership };
      },
    };
    const delta: any = {
      ownership: opts.delta ?? null,
      update: async (data: any, options?: any) => {
        writes.push({ doc: 'delta', data, options });
        delta.ownership = data.ownership;
      },
    };
    const token: any = {
      id: 't1',
      name: 'Goblin Sentry',
      actorLink: opts.linked,
      actorId: 'base1',
      parent: { id: 's1' },
      delta,
    };
    (globalThis as any).game = {
      actors: { get: (id: string) => (id === 'base1' ? base : undefined) },
      users: { get: (id: string) => (id === 'u1' ? { id: 'u1', name: 'John' } : undefined) },
      scenes: {
        get: (id: string) =>
          id === 's1'
            ? { id: 's1', tokens: { get: (t: string) => (t === 't1' ? token : undefined) } }
            : undefined,
      },
    };
    return { base, delta, writes };
  }

  it("an unlinked token: the write lands on the token's own entries; the base actor is untouched", async () => {
    const { base, delta, writes } = stubTokenWorld({ linked: false });
    const out = await setActorOwnership({
      actorId: 'base1',
      userId: 'u1',
      permission: 1,
      sceneId: 's1',
      tokenId: 't1',
    });
    expect(out).toMatchObject({ success: true, target: 'token' });
    expect(out.message).toMatch(/Set token "Goblin Sentry" \(t1, scene s1\) ownership to LIMITED/);
    // only the token's own map, written whole: the base actor's entries are not copied in
    expect(writes).toEqual([
      { doc: 'delta', data: { ownership: { u1: 1 } }, options: { diff: false, recursive: false } },
    ]);
    expect(delta.ownership).toEqual({ u1: 1 });
    expect(base.ownership).toEqual({ default: 0, u2: 2 });
  });

  it("INHERIT on an unlinked token removes the token's entry; an empty map is nothing of its own", async () => {
    const { base, delta, writes } = stubTokenWorld({ linked: false, delta: { u1: 3 } });
    const out = await setActorOwnership({
      actorId: 'base1',
      userId: 'u1',
      permission: null,
      sceneId: 's1',
      tokenId: 't1',
    });
    expect(out.message).toMatch(
      /Removed John's own entry on token "Goblin Sentry".*inherits the default \(NONE\)/
    );
    expect(writes).toEqual([
      { doc: 'delta', data: { ownership: null }, options: { diff: false, recursive: false } },
    ]);
    expect(delta.ownership).toBeNull();
    expect(base.ownership).toEqual({ default: 0, u2: 2 });
  });

  it('a linked token has no ownership of its own: the base actor is written, and the answer says so', async () => {
    const { base, writes } = stubTokenWorld({ linked: true });
    const out = await setActorOwnership({
      actorId: 'base1',
      userId: 'u1',
      permission: 2,
      sceneId: 's1',
      tokenId: 't1',
    });
    expect(out.target).toBe('actor');
    expect(out.message).toMatch(/token "Goblin Sentry" is linked.*base actor "Goblin"/);
    expect(writes.map(w => w.doc)).toEqual(['base']);
    expect(base.ownership).toEqual({ default: 0, u2: 2, u1: 2 });
  });

  it('a token that is not on the scene is a not-found error, writing nothing', async () => {
    const { writes } = stubTokenWorld({ linked: false });
    await expect(
      setActorOwnership({
        actorId: 'base1',
        userId: 'u1',
        permission: 1,
        sceneId: 's1',
        tokenId: 'tX',
      })
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(writes).toEqual([]);
  });
});

describe('getActorOwnership — a placed token id (issue #19)', () => {
  it("reads the token's own actor and names the token, not the base actor", () => {
    const synthetic: any = {
      id: 'base1',
      name: 'Goblin',
      type: 'npc',
      ownership: { default: 0, u1: 1 },
      testUserPermission: () => false,
    };
    const token = {
      id: 't1',
      name: 'Goblin Sentry',
      actorLink: false,
      parent: { id: 's1' },
      actor: synthetic,
    };
    (globalThis as any).game = {
      actors: { contents: [], get: () => undefined },
      scenes: [{ tokens: { get: (id: string) => (id === 't1' ? token : undefined) } }],
      users: {
        contents: [{ id: 'u1', name: 'John', isGM: false }],
        get: (id: string) => (id === 'u1' ? { id: 'u1', name: 'John', isGM: false } : undefined),
        getName: () => undefined,
      },
    };
    const out = getActorOwnership({ actorIdentifier: 't1' }) as any;
    expect(out.ownership).toEqual([
      {
        id: 'base1',
        name: 'Goblin Sentry',
        token: { id: 't1', scene: 's1', linked: false },
        default: 'NONE',
        explicit: { John: 'LIMITED' },
      },
    ]);
  });
});

describe('findPlayers — one tier answers', () => {
  const users = [
    { id: 'u1', name: 'John', isGM: false },
    { id: 'u2', name: 'Johnny', isGM: false },
    { id: 'gm', name: 'Johann the GM', isGM: true },
  ];
  afterEach(() => {
    delete (globalThis as any).game;
  });
  const world = () => {
    (globalThis as any).game = {
      users: { contents: users, get: (id: string) => users.find(u => u.id === id) },
      actors: { contents: [] },
    };
  };

  it('an exact name answers alone; a substring names every player it matches; GMs never', () => {
    world();
    expect(findPlayers({ identifier: 'John' })).toEqual([{ id: 'u1', name: 'John' }]);
    expect(findPlayers({ identifier: 'joh' })).toEqual([
      { id: 'u1', name: 'John' },
      { id: 'u2', name: 'Johnny' },
    ]);
    expect(findPlayers({ identifier: 'u2' })).toEqual([{ id: 'u2', name: 'Johnny' }]);
    expect(findPlayers({ identifier: 'joh', allowPartialMatch: false })).toEqual([]);
  });
});
