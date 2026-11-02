// Offline ORCHESTRATION tests for the PC engine (createPcActor / levelUpPc), driving the REAL functions
// against the in-memory Foundry mock (foundry-doc-mock.ts). These lock in the control flow the live
// suite proves end-to-end but that a green `npm test` otherwise never exercises — most importantly the
// Phase-1 fail-loud posture (no-persist-on-error for create, rollback-on-error for level-up) and the
// rest-to-full top-off. Advancement MATH is not simulated; tests inject simple apply effects.

import { describe, it, expect, afterEach } from 'vitest';
import { createPcActor, levelUpPc } from './advancement.js';
import {
  installFoundryMock,
  type AdvBehaviorSpec,
  type FakeDocSpec,
  type MockHandle,
} from './foundry-doc-mock.js';
import { PageError } from '../errors.js';

const PACK = 'dnd-players-handbook.classes';

/** A fighter-like class: forced HP (sets max), a forced feature grant, and a spell-slot seeder. */
function fighter(overrides: Partial<FakeDocSpec> = {}): FakeDocSpec {
  return {
    name: 'Fighter',
    type: 'class',
    identifier: 'fighter',
    packId: PACK,
    advancements: [
      {
        id: 'hp1',
        type: 'HitPoints',
        title: 'Hit Points',
        levels: [1],
        effect: actor => {
          actor.system.attributes = actor.system.attributes ?? {};
          actor.system.attributes.hp = { value: 0, max: 10 };
        },
      },
      {
        id: 'grant1',
        type: 'ItemGrant',
        title: 'Second Wind',
        levels: [1],
        effect: actor => {
          actor.system.spells = { spell1: { value: 0, max: 2 } };
        },
      },
    ],
    ...overrides,
  };
}

let mock: MockHandle | undefined;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

describe('createPcActor orchestration', () => {
  it('persists exactly one actor, finishes rested, and reports success on a clean build', async () => {
    mock = installFoundryMock([fighter()]);
    const res: any = await createPcActor({
      name: 'Aria',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder', // skip getOrCreateFolder
    });

    expect(res.success).toBe(true);
    expect(mock.persistedActorCount()).toBe(1); // the temp build actor was cleaned up
    expect(res.actor?.hp).toBe(10);

    // restPcToFull topped HP and spell slots to max on the persisted actor.
    const persisted = [...mock.store.actors.values()].find(a => a.name === 'Aria');
    expect(persisted?.system.attributes.hp.value).toBe(10);
    expect(persisted?.system.spells.spell1.value).toBe(2);
  });

  it('re-points the prototype token off the `__mcp_pc_build_` scratch name so dragged tokens read clean', async () => {
    mock = installFoundryMock([fighter()]);
    const res: any = await createPcActor({
      name: 'Aria',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
    });

    expect(res.success).toBe(true);
    const persisted = [...mock.store.actors.values()].find(a => a.name === 'Aria');
    // The build happens on a temp `__mcp_pc_build_Aria` actor whose prototypeToken inherits that
    // scratch name; persist must reset it to the real name or every placed token shows the prefix.
    expect(persisted?.prototypeToken?.name).toBe('Aria');
    // …and the PC gets the shared table-ready token defaults: friendly, name+bars shown to all, vision on.
    expect(persisted?.prototypeToken?.displayName).toBe(50);
    expect(persisted?.prototypeToken?.displayBars).toBe(50);
    expect(persisted?.prototypeToken?.disposition).toBe(1); // a PC is friendly
    expect(persisted?.prototypeToken?.sight?.enabled).toBe(true);
  });

  it("defaults the portrait + token to the primary class's PHB pregen art, reported as actor.art", async () => {
    mock = installFoundryMock([fighter()], {
      pregens: [
        {
          packId: 'dnd-players-handbook.actors',
          name: 'Fighter',
          img: 'modules/dnd-players-handbook/assets/journal-art/fighter.webp',
          tokenSrc: 'modules/dnd-players-handbook/assets/tokens/fighter.webp',
        },
      ],
    });
    const res: any = await createPcActor({ name: 'Aria', className: 'Fighter', level: 1 });
    expect(res.success).toBe(true);
    const persisted = [...mock.store.actors.values()].find(a => a.name === 'Aria');
    expect(persisted?.img).toBe('modules/dnd-players-handbook/assets/journal-art/fighter.webp');
    expect(persisted?.prototypeToken?.texture?.src).toBe(
      'modules/dnd-players-handbook/assets/tokens/fighter.webp'
    );
    expect(res.actor.art).toEqual({
      portrait: 'modules/dnd-players-handbook/assets/journal-art/fighter.webp',
      token: 'modules/dnd-players-handbook/assets/tokens/fighter.webp',
      from: expect.stringMatching(/^dnd-players-handbook.actors./),
    });
    // The house token defaults still apply over the pregen's art (ring off, friendly, bars shown).
    expect(persisted?.prototypeToken?.ring?.enabled).toBe(false);
    expect(persisted?.prototypeToken?.disposition).toBe(1);
  });

  it('defaultArt:false leaves the art alone; a missing pregen warns instead of failing', async () => {
    mock = installFoundryMock([fighter()], {
      pregens: [{ packId: 'dnd-players-handbook.actors', name: 'Fighter', img: 'x/fighter.webp' }],
    });
    const optOut: any = await createPcActor({
      name: 'Own Art',
      className: 'Fighter',
      defaultArt: false,
    });
    expect(optOut.success).toBe(true);
    expect(optOut.actor.art).toBeNull();
    const persisted = [...mock.store.actors.values()].find(a => a.name === 'Own Art');
    expect(persisted?.img).toBeUndefined();
    expect(optOut.warnings.some((w: string) => /pregen/.test(w))).toBe(false);

    mock.uninstall();
    mock = installFoundryMock([fighter()]); // no premium Actor pack at all
    const absent: any = await createPcActor({ name: 'No Book', className: 'Fighter' });
    expect(absent.success).toBe(true);
    expect(absent.actor.art).toBeNull();
    expect(absent.warnings.some((w: string) => /No premium pregen named "Fighter"/.test(w))).toBe(
      true
    );
  });

  it('resolves a folder NAME to its Folder id before persisting (never passes a name as a folder id)', async () => {
    mock = installFoundryMock([fighter()]);
    // Seed an existing "DM Tools" Actor folder the resolver should match BY NAME and return its id.
    (globalThis as any).game.folders = {
      get: (id: string) =>
        id === 'fold-DM' ? { id: 'fold-DM', name: 'DM Tools', type: 'Actor' } : undefined,
      find: (fn: (f: any) => boolean) =>
        [{ id: 'fold-DM', name: 'DM Tools', type: 'Actor' }].find(fn),
    };

    const res: any = await createPcActor({
      name: 'Aria',
      className: 'Fighter',
      level: 1,
      folder: 'DM Tools', // a NAME — must resolve to the folder's id, not pass through as an id
    });

    expect(res.success).toBe(true);
    // Regression: the old code set snapshot.folder = "DM Tools" (the raw name), so Actor.create got a
    // name where Foundry expects a Folder id and THREW live. It must be the resolved id now.
    expect(res.actor.folder).toBe('fold-DM');
  });

  it('does NOT persist and throws rolled-back when a forced advancement throws', async () => {
    const broken = fighter();
    broken.advancements = [
      { id: 'hp1', type: 'HitPoints', title: 'Hit Points', levels: [1], throws: true },
    ];
    mock = installFoundryMock([broken]);

    const err: any = await createPcActor({
      name: 'Doomed',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
    }).catch(e => e);

    // a refused build is an error (design.md §3), coded rolled-back: nothing of it persists
    expect(err).toBeInstanceOf(PageError);
    expect(err.code).toBe('rolled-back');
    expect(err.message).toMatch(/^"Doomed" was not created: 1 advancement\(s\) failed — /);
    // No junk actor: the temp build actor was deleted in finally and nothing was persisted.
    expect(mock.persistedActorCount()).toBe(0);
  });

  it('refuses a choices entry no applied advancement reads (a word in place of an id), even with acceptDefaults', async () => {
    mock = installFoundryMock([fighter()]);
    const err: any = await createPcActor({
      name: 'Keyed Wrong',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
      acceptDefaults: true,
      choices: {
        '1': { grant1: {} }, // a real id at a built level: read, so not refused
        '3': { subclass: { uuid: 'Compendium.x.Item.y' } },
      },
    }).catch(e => e);

    expect(err).toBeInstanceOf(PageError);
    expect(err.code).toBe('rolled-back');
    expect(err.message).toMatch(
      /^"Keyed Wrong" was not created: 1 choices entry names no advancement this build applies: choices\["3"\]\["subclass"\]\./
    );
    expect(err.message).not.toMatch(/grant1"\]/);
    expect(mock.persistedActorCount()).toBe(0);
  });

  it('embeds the class stamped with its compendium source (dnd5e finds items by it)', async () => {
    mock = installFoundryMock([fighter()]);
    const res: any = await createPcActor({
      name: 'Aria',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
    });
    const stored = mock.server(res.actor.id);
    const cls = stored.items.find((i: any) => i.type === 'class');
    expect(cls._stats.compendiumSource).toMatch(
      /^Compendium\.dnd-players-handbook\.classes\.Item\./
    );
  });

  it('a build whose every choices entry is read persists as before', async () => {
    mock = installFoundryMock([fighter()]);
    const res: any = await createPcActor({
      name: 'Keyed Right',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
      choices: { '1': { grant1: {}, hp1: {} } },
    });
    expect(res.success).toBe(true);
    expect(mock.persistedActorCount()).toBe(1);
  });
});

describe('levelUpPc orchestration', () => {
  /** Build a level-1 Fighter, returning its persisted id. */
  async function buildL1(): Promise<string> {
    const res: any = await createPcActor({
      name: 'Climber',
      className: 'Fighter',
      level: 1,
      folder: 'fixed-folder',
    });
    return res.actor.id;
  }

  /** A Hit Points advancement at `levels`: +10 at level 1, +6 after, to value and max. */
  const hitPoints = (levels: number[]): AdvBehaviorSpec => ({
    id: 'hp',
    type: 'HitPoints',
    title: 'Hit Points',
    levels,
    effect: (actor, level) => {
      const hp = actor.system.attributes?.hp ?? {};
      const gain = level === 1 ? 10 : 6;
      actor.updateSource({
        'system.attributes.hp': { value: (hp.value ?? 0) + gain, max: (hp.max ?? 0) + gain },
      });
    },
  });

  /** An ItemGrant that embeds one feat, in memory, as dnd5e's apply does. */
  const grant = (id: string, levels: number[], name: string): AdvBehaviorSpec => ({
    id,
    type: 'ItemGrant',
    title: name,
    levels,
    effect: actor => {
      actor.updateSource({ items: [{ _id: `${id}-item`, name, type: 'feat' }] });
    },
  });

  /** Write calls that reached the server for `id` since call `from`. */
  const writesSince = (from: number, id: string) =>
    mock!
      .calls()
      .slice(from)
      .filter(c => c.actor === id && c.op !== 'reset');

  it('writes the level it applied: the granted feature, the advancement values and HP reach the server', async () => {
    mock = installFoundryMock([
      fighter({ advancements: [hitPoints([1, 2]), grant('surge', [2], 'Action Surge')] }),
    ]);
    const id = await buildL1();

    const res: any = await levelUpPc({ actorIdentifier: id, className: 'Fighter' });
    expect(res.success).toBe(true);

    // The page that applied the level holds its own copy; the server's record is the witness.
    mock.reconnect();
    const stored = mock.server(id);
    const fighterItem = stored.items.find((i: any) => i.type === 'class');
    expect(fighterItem.system.levels).toBe(2);
    expect(fighterItem.system.advancement.hp.value['2']).toEqual({ 2: 'avg' });
    expect(fighterItem.system.advancement.surge.value['2']).toEqual({});
    expect(stored.items.map((i: any) => i.name)).toContain('Action Surge');
    expect(stored.system.attributes.hp).toEqual({ value: 16, max: 16 });
    expect(res.actor.hp).toBe(16);
  });

  const champion = 'Compendium.dnd-players-handbook.classes.Item.champion';

  /** A Fighter whose level-3 Subclass advancement embeds the Champion, and the Champion's own grant. */
  const fighterAndChampion = (): FakeDocSpec[] => [
    fighter({
      advancements: [
        hitPoints([1, 2, 3]),
        {
          id: 'sub',
          type: 'Subclass',
          title: 'Fighter Subclass',
          levels: [3],
          effect: (actor, _level, data) => {
            if (data?.uuid !== champion) return;
            actor.updateSource({
              items: [
                {
                  _id: 'champion-item',
                  name: 'Champion',
                  type: 'subclass',
                  system: { classIdentifier: 'fighter' },
                  __advKey: 'subclass:champion',
                },
              ],
            });
          },
        },
      ],
    }),
    {
      name: 'Champion',
      type: 'subclass',
      identifier: 'champion',
      packId: PACK,
      advancements: [grant('crit', [3], 'Improved Critical')],
    },
  ];

  it('writes a subclass chosen at the new level with its own features', async () => {
    mock = installFoundryMock(fighterAndChampion());
    const built: any = await createPcActor({
      name: 'Climber',
      className: 'Fighter',
      level: 2,
      folder: 'fixed-folder',
    });
    const id = built.actor.id;

    const res: any = await levelUpPc({
      actorIdentifier: id,
      className: 'Fighter',
      choices: { '3': { sub: { uuid: champion } } },
    });
    expect(res.success).toBe(true);

    mock.reconnect();
    const stored = mock.server(id);
    const byName = (name: string) => stored.items.find((i: any) => i.name === name);
    expect(byName('Fighter').system.levels).toBe(3);
    expect(byName('Fighter').system.advancement.sub.value['3']).toEqual({ uuid: champion });
    expect(byName('Champion')?.system.classIdentifier).toBe('fighter');
    expect(byName('Champion').system.advancement.crit.value['3']).toEqual({});
    expect(byName('Improved Critical')?.type).toBe('feat');
  });

  it("a multiclass level runs only its own class's subclass, never another class's", async () => {
    mock = installFoundryMock([
      ...fighterAndChampion(),
      {
        name: 'Wizard',
        type: 'class',
        identifier: 'wizard',
        packId: PACK,
        advancements: [hitPoints([1, 2, 3])],
      },
    ]);
    const built: any = await createPcActor({
      name: 'Climber',
      className: 'Fighter',
      level: 3,
      folder: 'fixed-folder',
      choices: { '3': { sub: { uuid: champion } } },
    });
    const id = built.actor.id;

    let res: any;
    for (let n = 0; n < 3; n++) res = await levelUpPc({ actorIdentifier: id, className: 'Wizard' });

    // Wizard 3 is a level 3, as the Champion's grant is: it must not run for another class.
    expect(res.actor.classLevel).toBe(3);
    expect(res.applied.filter((r: any) => r.source === 'subclass')).toEqual([]);
    const stored = mock.server(id);
    expect(
      stored.items.find((i: any) => i.name === 'Champion').system.advancement.crit.value
    ).toEqual({ 3: {} });
  });

  it('writes nothing and throws rolled-back when the new level errors', async () => {
    // Fighter L2 advancement throws; L1 is clean so the initial build succeeds.
    mock = installFoundryMock([
      fighter({
        advancements: [
          {
            id: 'hp1',
            type: 'HitPoints',
            title: 'Hit Points',
            levels: [1],
            effect: actor => {
              actor.system.attributes = { hp: { value: 0, max: 10 } };
            },
          },
          { id: 'hp2', type: 'HitPoints', title: 'Hit Points', levels: [2], throws: true },
        ],
      }),
    ]);
    const id = await buildL1();
    const from = mock.calls().length;

    const err: any = await levelUpPc({ actorIdentifier: id, className: 'Fighter' }).catch(e => e);

    expect(err).toBeInstanceOf(PageError);
    expect(err.code).toBe('rolled-back');
    expect(err.message).toMatch(
      /was not leveled: 1 advancement\(s\) failed — .*Nothing was written/
    );
    // The level was applied on a clone: no write reached the server, the page's copy is untouched.
    expect(writesSince(from, id)).toEqual([]);
    expect(mock.server(id).items.find((i: any) => i.type === 'class').system.levels).toBe(1);
    const actor = [...mock.store.actors.values()].find(a => a.id === id);
    expect(actor?.items.find((i: any) => i.type === 'class')?.system.levels).toBe(1);
  });

  it('writes nothing and refuses a choices entry the new level never reads', async () => {
    mock = installFoundryMock([
      fighter({
        advancements: [
          {
            id: 'hp1',
            type: 'HitPoints',
            title: 'Hit Points',
            levels: [1],
            effect: actor => {
              actor.system.attributes = { hp: { value: 0, max: 10 } };
            },
          },
          { id: 'hp2', type: 'HitPoints', title: 'Hit Points', levels: [2] },
        ],
      }),
    ]);
    const id = await buildL1();
    const from = mock.calls().length;

    const err: any = await levelUpPc({
      actorIdentifier: id,
      className: 'Fighter',
      choices: { '2': { hp2: {} }, '3': { subclass: { uuid: 'Compendium.x.Item.y' } } },
    }).catch(e => e);

    expect(err?.code).toBe('rolled-back');
    expect(err.message).toMatch(
      /was not leveled: 1 choices entry names no advancement this build applies: choices\["3"\]\["subclass"\]\..*Nothing was written/
    );
    expect(writesSince(from, id)).toEqual([]);
    expect(mock.server(id).items.find((i: any) => i.type === 'class').system.levels).toBe(1);
  });

  it('writes nothing when a multiclass first level errors (the new class never reaches the server)', async () => {
    mock = installFoundryMock([
      fighter(),
      {
        name: 'Wizard',
        type: 'class',
        identifier: 'wizard',
        packId: PACK,
        advancements: [
          { id: 'whp1', type: 'HitPoints', title: 'Hit Points', levels: [1], throws: true },
        ],
      },
    ]);
    const id = await buildL1();
    const from = mock.calls().length;

    const err: any = await levelUpPc({ actorIdentifier: id, className: 'Wizard' }).catch(e => e);

    expect(err?.code).toBe('rolled-back');
    expect(writesSince(from, id)).toEqual([]);
    const stored = mock.server(id);
    expect(stored.items.filter((i: any) => i.type === 'class').length).toBe(1); // the Fighter only
    const actor = [...mock.store.actors.values()].find(a => a.id === id);
    expect(actor?.items.filter((i: any) => i.type === 'class').length).toBe(1);
  });

  it('a multiclass add writes the new class with its first level in one batch', async () => {
    mock = installFoundryMock([
      fighter(),
      {
        name: 'Wizard',
        type: 'class',
        identifier: 'wizard',
        packId: PACK,
        advancements: [hitPoints([1]), grant('arcane', [1], 'Arcane Recovery')],
      },
    ]);
    const id = await buildL1();
    const from = mock.calls().length;

    const res: any = await levelUpPc({ actorIdentifier: id, className: 'Wizard' });
    expect(res.success).toBe(true);
    expect(res.actor.classes).toEqual([
      { name: 'Fighter', levels: 1 },
      { name: 'Wizard', levels: 1 },
    ]);

    // One batch, with the option dnd5e's own level-up writes with.
    const batches = writesSince(from, id).filter(c => c.op === 'performBulkUpdate');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.options).toEqual({ isAdvancement: true });

    mock.reconnect();
    const stored = mock.server(id);
    const wizard = stored.items.find((i: any) => i.name === 'Wizard');
    expect(wizard.system.levels).toBe(1);
    expect(wizard.system.advancement.arcane.value['1']).toEqual({});
    expect(stored.items.map((i: any) => i.name)).toContain('Arcane Recovery');
  });
});
