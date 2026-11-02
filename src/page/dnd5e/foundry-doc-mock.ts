// Offline mock of the slice of the Foundry document + compendium API that the page-side PC engine
// (advancement.ts) drives, so its ORCHESTRATION can be unit-tested with NO browser/live world. It does
// NOT simulate real dnd5e advancement math — advancement behaviors are injected per test (an `apply`
// that mutates the mock actor, or one that throws) — so assertions target control flow: persist-once,
// no-persist-on-error, a refused level-up writing nothing, and the rest-to-full top-off. The real dnd5e
// math is gated live by tests/integration/pc.int.test.ts.
//
// It keeps the page apart from the server the way Foundry does, because that is where a level-up lost
// its advancements: `updateSource` (what every advancement.apply() writes through) changes only the
// page's copy; the database calls (`Actor.create`, `update`, the embedded create/update/delete,
// dnd5e's `performBulkUpdate`) change the server's record too, and `update` sends only what differs
// from the page's source, so an update the page already holds sends nothing. `server(id)` reads the
// record; `reconnect()` rebuilds every page document from it, as a fresh page would.
//
// Test-only (not imported by src/page/index.ts, so it never enters the page bundle). Co-located as a
// normal .ts — typechecked by the gate, like src/tools/test-helpers.ts — and installs onto globalThis,
// which advancement.ts reads at call time (bare `game`/`Roll`/`fromUuid` + globalThis.Actor).

/** An advancement behavior a test attaches to a fake class — its apply() effect (or a throw). */
export interface AdvBehaviorSpec {
  id: string;
  type: string; // 'HitPoints' | 'ItemGrant' | 'Trait' | 'Subclass' | 'AbilityScoreImprovement' | …
  title: string;
  levels: number[];
  classRestriction?: string | undefined;
  /** The advancement's configuration (an ItemChoice's `choices` and `pool`, a Trait's `choices`). */
  configuration?: Record<string, any> | undefined;
  /**
   * Mutate the owning actor when applied (e.g. bump HP, add an item with `actor.updateSource({ items })`,
   * set spell slots), in memory as dnd5e's apply does. The apply also records `data` as the
   * advancement's value on its item (`system.advancement.<id>.value.<level>`), as dnd5e's does.
   */
  effect?: (actor: MockActor, level: number, data: any, opts: any) => void;
  /** When true, apply() throws — to exercise the corrupting-failure path. */
  throws?: boolean | undefined;
}

/** A fake premium-book class/species/background/subclass document, or a feature (`feat`) a grant embeds. */
export interface FakeDocSpec {
  name: string;
  type: 'class' | 'race' | 'background' | 'subclass' | 'feat';
  /** A subclass's key is `subclass:<identifier>`: the data a Subclass effect embeds carries it as `__advKey`. */
  identifier: string;
  packId: string;
  advancements?: AdvBehaviorSpec[] | undefined;
  /** Base system data merged onto an embedded copy (e.g. seed spell slots to test rest top-off). */
  system?: Record<string, any> | undefined;
}

let nextId = 1000;
const genId = (): string => `mock${nextId++}`;

/** Deep-clone plain data the way toObject() would (no functions, no live refs). */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null));
}

function getPath(obj: any, path: string): unknown {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Structural equality of plain data (key order aside), the test Foundry's diff applies. */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.hasOwn(b, k) && equal((a as any)[k], (b as any)[k]));
}

function setPath(obj: any, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] ?? {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** A live advancement bound to its owning item — what extractAdvancements lifts and calls .apply on. */
function buildAdvancement(spec: AdvBehaviorSpec, item: MockItem, actor: MockActor): any {
  return {
    id: spec.id,
    name: spec.title, // dnd5e 6.0 field (title is the deprecated getter)
    title: spec.title,
    levels: spec.levels,
    classRestriction: spec.classRestriction ?? '',
    configuration: spec.configuration ?? {},
    apply: async (level: number, data: any, opts: any) => {
      if (spec.throws) throw new Error(`mock advancement "${spec.title}" rejected`);
      spec.effect?.(actor, level, data, opts);
      item.updateSource({ [`system.advancement.${spec.id}.value.${level}`]: clone(data ?? {}) });
    },
  };
}

export class MockItem {
  id: string;
  name: string;
  type: string;
  system: any;
  isOriginalClass = false;
  /** the registry key for this item's advancement behaviors — preserved through persist so a level-up
   *  on a re-read actor can still apply them (real Foundry reconstructs advancements from stored data). */
  advKey?: string | undefined;
  /** Foundry's document stats; only `compendiumSource` matters here (a pack copy's stamp). */
  _stats: any;
  /** The item's flags; `dnd5e.advancementRoot` names the class or subclass whose grant embedded it. */
  flags: any;
  /** the advancement behaviors this item carries (a class/species/background) — bound when embedded. */
  private behaviors: AdvBehaviorSpec[];
  private actor: MockActor;

  constructor(data: any, actor: MockActor, behaviors: AdvBehaviorSpec[]) {
    this.id = data._id ?? genId();
    this.name = data.name ?? '';
    this.type = data.type ?? 'feat';
    this.system = clone(data.system ?? {});
    this.behaviors = behaviors;
    this.actor = actor;
    if (data.__advKey) this.advKey = data.__advKey;
    this._stats = clone(data._stats ?? {});
    this.flags = clone(data.flags ?? {});
    this.bindDerived();
  }

  /**
   * dnd5e's derived item getters a level-up reads, kept off the source (toObject skips them):
   * `advancementRootItem` (the item its advancementRoot flag names) and `advancementClassLinked`
   * (false only for a feat whose type is `feat`).
   */
  private bindDerived(): void {
    const item = this;
    Object.defineProperties(this.system, {
      advancementRootItem: {
        configurable: true,
        get: () =>
          item.actor.items.get(String(item.flags?.dnd5e?.advancementRoot ?? '').split('.')[0]),
      },
      advancementClassLinked: {
        configurable: true,
        get: () => !(item.type === 'feat' && item.system?.type?.value === 'feat'),
      },
    });
  }

  /** A subclass's class on the same actor (dnd5e's Item5e#class); null for any other item. */
  get class(): MockItem | null {
    if (this.type !== 'subclass') return null;
    return (
      this.actor.items.find(
        (i: MockItem) => i.type === 'class' && i.system?.identifier === this.system?.classIdentifier
      ) ?? null
    );
  }

  /** byType map the engine reads via extractAdvancements; apply() closes over the owning actor. */
  get advancement(): any {
    const byType: Record<string, any[]> = {};
    for (const b of this.behaviors) {
      byType[b.type] = byType[b.type] ?? [];
      byType[b.type].push(buildAdvancement(b, this, this.actor));
    }
    return { byType };
  }

  /** In memory only, as Foundry's: the server never hears of it. */
  updateSource(update: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(update)) setPath(this, k, clone(v));
    if (!Object.hasOwn(this.system, 'advancementRootItem')) this.bindDerived();
  }

  toObject(): any {
    return {
      _id: this.id,
      name: this.name,
      type: this.type,
      system: clone(this.system),
      _stats: clone(this._stats),
      flags: clone(this.flags),
      ...(this.advKey ? { __advKey: this.advKey } : {}),
    };
  }
}

export class MockActor {
  id: string;
  name: string;
  type: string;
  system: any;
  /** Foundry stamps prototypeToken.name from the actor name at creation when none is supplied — the
   *  mock mirrors that so the createPcActor persist path (which must re-point it off the scratch name)
   *  can be regression-tested. */
  prototypeToken: any;
  /** The portrait — what createPcActor's default-art step writes from the class pregen. */
  img: string | undefined;
  folder: { id: string } | null = null;
  /** A copy made by `clone()`: it is in no database, so a write through it throws. */
  isClone = false;
  private _items: MockItem[] = [];
  private store: MockStore;

  constructor(data: any, store: MockStore) {
    this.id = data._id ?? genId();
    this.name = data.name ?? '';
    this.type = data.type ?? 'character';
    this.img = data.img;
    this.system = clone(data.system ?? { attributes: { hp: {} }, spells: {}, details: {} });
    this.prototypeToken = data.prototypeToken ? clone(data.prototypeToken) : { name: this.name };
    this.store = store;
    // Rehydrate persisted items, re-attaching advancement behaviors via the preserved __advKey so a
    // later level-up on this re-read actor can still apply them (mirrors Foundry reconstructing them).
    for (const it of data.items ?? []) this._items.push(this.itemFrom(it, it._id ?? genId()));
  }

  /** Array-like items collection with the get/find/filter the engine uses. */
  get items(): any {
    const arr = this._items;
    return {
      get: (id: string) => arr.find(i => i.id === id),
      find: (fn: (i: MockItem) => boolean) => arr.find(fn),
      filter: (fn: (i: MockItem) => boolean) => arr.filter(fn),
      map: (fn: (i: MockItem) => unknown) => arr.map(fn),
      [Symbol.iterator]: () => arr[Symbol.iterator](),
      get length() {
        return arr.length;
      },
    };
  }

  reset(): void {
    /* derived-data recompute — no-op in the mock */
  }

  getRollData(): any {
    return {};
  }

  /** In memory only, as Foundry's: the server never hears of it. `items` merges by `_id`. */
  updateSource(update: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(update)) {
      if (k === 'items') {
        for (const data of v as any[]) {
          const existing = this._items.find(i => i.id === data._id);
          if (existing) existing.updateSource(data);
          else this._items.push(this.itemFrom(data, data._id));
        }
        continue;
      }
      setPath(this, k, clone(v));
    }
  }

  /** A copy of this actor, its items with their ids, in no database (Foundry's `clone`). */
  clone(): MockActor {
    const copy = new MockActor(this.toObject(), this.store);
    copy.isClone = true;
    return copy;
  }

  /** The server's record, for a database call; a clone has none. */
  private record(): any {
    if (this.isClone) throw new Error(`mock: a clone of "${this.name}" is in no database`);
    const rec = this.store.server.get(this.id);
    if (!rec) throw new Error(`mock: "${this.name}" is not on the server`);
    return rec;
  }

  private itemFrom(data: any, id: string): MockItem {
    const behaviors = data.__advKey ? (this.store.behaviors[data.__advKey] ?? []) : [];
    return new MockItem({ ...data, _id: id }, this, behaviors);
  }

  /**
   * Foundry's update: only what differs from the page's source is sent (nothing, when the page
   * already holds it), and an embedded collection is never written through its parent's update.
   */
  async update(update: Record<string, unknown>): Promise<void> {
    const rec = this.record();
    this.store.calls.push({ op: 'update', actor: this.id });
    const source = this.toObject();
    for (const [k, v] of Object.entries(update)) {
      if (k === 'items' || k === '_id' || equal(getPath(source, k), v)) continue;
      setPath(this, k, clone(v));
      setPath(rec, k, clone(v));
    }
  }

  async createEmbeddedDocuments(
    _type: string,
    dataArr: any[],
    opts: { keepId?: boolean } = {}
  ): Promise<MockItem[]> {
    const rec = this.record();
    this.store.calls.push({ op: 'createEmbeddedDocuments', actor: this.id, count: dataArr.length });
    const created: MockItem[] = [];
    for (const data of dataArr) {
      // Foundry assigns a new id unless asked to keep the given one.
      const item = this.itemFrom(data, opts.keepId && data._id ? data._id : genId());
      this._items.push(item);
      rec.items.push(item.toObject());
      created.push(item);
    }
    return created;
  }

  async updateEmbeddedDocuments(_type: string, updates: any[]): Promise<void> {
    const rec = this.record();
    this.store.calls.push({ op: 'updateEmbeddedDocuments', actor: this.id, count: updates.length });
    for (const u of updates) {
      const item = this._items.find(i => i.id === u._id);
      const stored = rec.items.find((i: any) => i._id === u._id);
      if (!item || !stored) continue;
      const source = item.toObject();
      for (const [k, v] of Object.entries(u)) {
        if (k === '_id' || equal(getPath(source, k), v)) continue;
        setPath(item, k, clone(v));
        setPath(stored, k, clone(v));
      }
    }
  }

  async deleteEmbeddedDocuments(_type: string, ids: string[]): Promise<void> {
    const rec = this.record();
    this.store.calls.push({ op: 'deleteEmbeddedDocuments', actor: this.id, ids });
    this._items = this._items.filter(i => !ids.includes(i.id));
    rec.items = rec.items.filter((i: any) => !ids.includes(i._id));
  }

  /** dnd5e's Actor5e#performBulkUpdate: the actor's update, then the item creates, deletes, updates. */
  async performBulkUpdate(
    updates: { actor?: any; create?: any[]; delete?: string[]; item?: any[] },
    options: Record<string, unknown> = {}
  ): Promise<void> {
    this.record();
    this.store.calls.push({ op: 'performBulkUpdate', actor: this.id, options });
    if (updates.actor && Object.keys(updates.actor).length > 0) await this.update(updates.actor);
    if (updates.create?.length) {
      await this.createEmbeddedDocuments('Item', updates.create, { keepId: true });
    }
    if (updates.delete?.length) await this.deleteEmbeddedDocuments('Item', updates.delete);
    if (updates.item?.length) await this.updateEmbeddedDocuments('Item', updates.item);
  }

  async delete(): Promise<void> {
    this.record();
    this.store.actors.delete(this.id);
    this.store.server.delete(this.id);
  }

  toObject(): any {
    return {
      _id: this.id,
      name: this.name,
      type: this.type,
      system: clone(this.system),
      ...(this.img !== undefined ? { img: this.img } : {}),
      prototypeToken: clone(this.prototypeToken),
      items: this._items.map(i => i.toObject()),
    };
  }
}

/** A premium-book type:character pregen (the PHB class pregens) in a fake Actor pack. */
export interface FakePregenSpec {
  packId: string;
  name: string;
  img: string;
  tokenSrc?: string | undefined;
}

interface MockStore {
  /** The page's documents (`game.actors`). */
  actors: Map<string, MockActor>;
  /** What the server holds per actor: written by the database calls only, never by `updateSource`. */
  server: Map<string, any>;
  settings: Map<string, unknown>;
  behaviors: Record<string, AdvBehaviorSpec[]>;
  calls: Array<{ op: string; [k: string]: unknown }>;
}

export interface MockHandle {
  store: MockStore;
  /** number of persisted (non-deleted) actors — the temp build actor is deleted in finally. */
  persistedActorCount(): number;
  /** the calls recorded against actors, for asserting orchestration (persist/rollback/etc.). */
  calls(): Array<{ op: string; [k: string]: unknown }>;
  /** the server's record of an actor (plain data, items included), or undefined once deleted. */
  server(id: string): any;
  /** rebuild every page document from the server's records, as a fresh page would. */
  reconnect(): void;
  uninstall(): void;
}

/**
 * Install the mock onto globalThis (game/Actor/Roll/fromUuid). Returns a handle + uninstall.
 * `docs` are the fake premium-book class/species/background entries the engine resolves by name.
 */
export function installFoundryMock(
  docs: FakeDocSpec[],
  opts: { pregens?: FakePregenSpec[] | undefined } = {}
): MockHandle {
  const store: MockStore = {
    actors: new Map(),
    server: new Map(),
    settings: new Map([['dnd5e.disableAdvancements', false]]),
    behaviors: {},
    calls: [],
  };

  // Register each fake doc's advancement behaviors under a per-doc key the embedded data carries.
  const indexByPack: Record<string, Array<{ _id: string; name: string; type: string }>> = {};
  const docById: Record<string, FakeDocSpec & { _id: string; advKey: string }> = {};
  for (const d of docs) {
    const _id = genId();
    const advKey = `${d.type}:${d.identifier}`;
    store.behaviors[advKey] = d.advancements ?? [];
    docById[_id] = { ...d, _id, advKey };
    indexByPack[d.packId] = indexByPack[d.packId] ?? [];
    indexByPack[d.packId].push({ _id, name: d.name, type: d.type });
  }

  /** A fake premium-book pack exposing the iterate/get/getIndex/getDocument surface the engine uses. */
  function makePack(packId: string) {
    return {
      documentName: 'Item',
      metadata: { id: packId },
      async getIndex() {
        return indexByPack[packId] ?? [];
      },
      async getDocument(_id: string) {
        const d = docById[_id];
        if (!d) return null;
        // A live source doc: toObject() carries the __advKey so an embedded copy rehydrates behaviors.
        return {
          pack: packId,
          uuid: `Compendium.${packId}.Item.${_id}`,
          name: d.name,
          type: d.type,
          system: { identifier: d.identifier, ...(d.system ?? {}) },
          toObject: () => ({
            name: d.name,
            type: d.type,
            system: { identifier: d.identifier, ...clone(d.system ?? {}) },
            __advKey: d.advKey,
          }),
        };
      },
    };
  }

  const packs: any[] = Object.keys(indexByPack).map(makePack);
  // Fake premium Actor packs — the index shape findClassPregenArt reads (type, img, token texture).
  const pregensByPack: Record<string, FakePregenSpec[]> = {};
  for (const pg of opts.pregens ?? []) {
    pregensByPack[pg.packId] = [...(pregensByPack[pg.packId] ?? []), pg];
  }
  for (const [packId, list] of Object.entries(pregensByPack)) {
    packs.push({
      documentName: 'Actor',
      metadata: { id: packId },
      async getIndex() {
        return list.map(pg => ({
          _id: genId(),
          name: pg.name,
          type: 'character',
          img: pg.img,
          prototypeToken: { texture: { src: pg.tokenSrc ?? pg.img } },
        }));
      },
    });
  }
  (packs as any).get = (id: string) => packs.find(p => p.metadata.id === id);

  const g = globalThis as any;
  const saved = {
    game: g.game,
    Actor: g.Actor,
    Roll: g.Roll,
    fromUuid: g.fromUuid,
    foundry: g.foundry,
  };

  g.game = {
    system: { id: 'dnd5e' },
    packs,
    actors: { get: (id: string) => store.actors.get(id) },
    settings: {
      get: (scope: string, key: string) => store.settings.get(`${scope}.${key}`),
      set: async (scope: string, key: string, value: unknown) => {
        store.settings.set(`${scope}.${key}`, value);
      },
    },
  };
  g.Actor = {
    create: async (data: any) => {
      const actor = new MockActor(data, store);
      store.actors.set(actor.id, actor);
      store.server.set(actor.id, actor.toObject());
      return actor;
    },
  };
  g.Roll = { replaceFormulaData: (formula: string) => formula };
  g.fromUuid = async () => null;
  g.foundry = { utils: { randomID: genId } };

  return {
    store,
    persistedActorCount: () =>
      [...store.server.values()].filter(a => !String(a.name).startsWith('__mcp_pc_build_')).length,
    calls: () => store.calls,
    server: (id: string) => store.server.get(id),
    reconnect: () => {
      store.actors.clear();
      for (const [id, rec] of store.server) store.actors.set(id, new MockActor(clone(rec), store));
    },
    uninstall: () => {
      g.game = saved.game;
      g.Actor = saved.Actor;
      g.Roll = saved.Roll;
      g.fromUuid = saved.fromUuid;
      g.foundry = saved.foundry;
    },
  };
}
