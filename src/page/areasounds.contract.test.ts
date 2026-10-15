/**
 * The Area Sounds mirror (src/page/areasounds.ts) against the module itself, read from its clone
 * beside this repo (MCP_AREASOUNDS_DIR names another place): its scripts/engine.js `normalizeSet`
 * and `gateAllows`, its scripts/store.js (the flag's scope, the read of a scene's sets, the library
 * path), and its contracts/sets.json (every field, default and clamp, at the version this repo's
 * contracts/consumes.json names). The flag shape `setsUpdate` writes must be the shape the engine
 * reads back unchanged. Without the clone (CI checks out this repo alone) the module half is
 * skipped, saying so; the hand-typed pins in areasounds.test.ts stand either way.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREASOUNDS_LIBRARY_PATH,
  AREASOUNDS_MODULE_ID,
  gateAllows,
  LEGACY_LIBRARY_PATH,
  LEGACY_MODULE_ID,
  NIGHT_DARKNESS,
  normalizeAreaSoundsSet,
  setsUpdate,
} from './areasounds.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = resolve(process.env.MCP_AREASOUNDS_DIR ?? join(REPO, '..', 'fvtt-mod-areasounds'));
const ENGINE = join(MODULE, 'scripts', 'engine.js');
const STORE = join(MODULE, 'scripts', 'store.js');
const CONTRACT = join(MODULE, 'contracts', 'sets.json');
const present = existsSync(ENGINE) && existsSync(STORE);

const consumes = JSON.parse(readFileSync(join(REPO, 'contracts', 'consumes.json'), 'utf8'));
const want = consumes.consumes.find(
  (c: any) => c.emitter === 'fvtt-mod-areasounds' && c.contract === 'sets'
);

/** Every blob the corpus feeds both normalizers: each field at its edges, garbage included. */
function corpus(): any[] {
  const numbers = [
    -1e9,
    -1,
    0,
    0.25,
    0.5,
    1,
    2,
    4.5,
    10,
    30,
    31,
    3600,
    9000,
    1e9,
    '7',
    '',
    null,
    [],
    'nope',
    true,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];
  const out: any[] = [
    {},
    { name: '  Rain  ' },
    { name: '' },
    { name: 5 },
    { files: ['a', 3, '', 'b', null] },
    { files: 'a' },
  ];
  for (const field of [
    'interval',
    'intervalVariation',
    'crossfade',
    'volume',
    'volumeVariation',
    'pitchVariation',
  ])
    for (const v of numbers) out.push({ [field]: v }, { interval: 10, [field]: v });
  for (const v of ['interval', 'loop', 'Loop', '', null, 3]) out.push({ playStyle: v });
  for (const v of ['always', 'day', 'night', 'dusk', '', null]) out.push({ whenToPlay: v });
  for (const v of [true, false, 0, null, 'false', undefined]) out.push({ active: v });
  return out.map(raw => ({ id: 'fixed', ...raw }));
}

describe.skipIf(!present)(
  "the mirror against Area Sounds' own engine (its scripts/engine.js and store.js)",
  async () => {
    const engine = present ? await import(pathToFileURL(ENGINE).href) : null;
    const store = present ? await import(pathToFileURL(STORE).href) : null;

    it('normalizes every blob of the corpus exactly as the engine does', () => {
      const differ = corpus().filter(
        raw =>
          JSON.stringify(normalizeAreaSoundsSet(raw).set) !==
          JSON.stringify(engine.normalizeSet(raw))
      );
      expect(differ, 'blobs the mirror repairs differently').toEqual([]);
    });

    it('makes a missing id the way the engine does: up to 10 base-36 characters', () => {
      expect(normalizeAreaSoundsSet({}).set.id).toMatch(/^[0-9a-z]{1,10}$/);
      expect(engine.normalizeSet({}).id).toMatch(/^[0-9a-z]{1,10}$/);
    });

    it('gates day and night as the engine does', () => {
      for (const whenToPlay of ['always', 'day', 'night'] as const)
        for (const darkness of [0, 0.25, 0.49, 0.5, 0.51, 1])
          expect(gateAllows({ whenToPlay }, darkness), `${whenToPlay} at ${darkness}`).toBe(
            engine.gateAllows({ whenToPlay }, darkness)
          );
    });

    it('writes the flag the module reads: its scope, and the library at its path', () => {
      expect(AREASOUNDS_MODULE_ID).toBe(store.MODULE_ID);
      expect(AREASOUNDS_LIBRARY_PATH).toBe(store.LIBRARY_PATH);
    });

    it('the sets setsUpdate stores read back through the engine unchanged, and a legacy scope is moved', () => {
      const sets = corpus()
        .slice(0, 12)
        .map(raw => normalizeAreaSoundsSet(raw).set);
      const scene = (update: Record<string, unknown>, before: Record<string, any> = {}) => {
        const flags: Record<string, any> = { ...before };
        for (const [path, value] of Object.entries(update)) {
          const [, scope, key] = path.split('.');
          if (scope?.startsWith('-=')) delete flags[scope.slice(2)];
          else if (scope && key) flags[scope] = { ...(flags[scope] ?? {}), [key]: value };
        }
        return { flags };
      };
      expect(store.getRawSets(scene(setsUpdate(sets, false))).map(engine.normalizeSet)).toEqual(
        sets
      );
      const moved = scene(setsUpdate(sets, true), {
        [LEGACY_MODULE_ID]: { sets: [{ id: 'old' }] },
      });
      expect(moved.flags[LEGACY_MODULE_ID]).toBeUndefined();
      expect(store.getRawSets(moved).map(engine.normalizeSet)).toEqual(sets);
      expect(
        store.getRawSets({ flags: { [LEGACY_MODULE_ID]: { sets: [{ id: 'old' }] } } })
      ).toEqual([{ id: 'old' }]);
    });
  }
);

describe.skipIf(!existsSync(CONTRACT))("Area Sounds' contract (its contracts/sets.json)", () => {
  const contract = existsSync(CONTRACT) ? JSON.parse(readFileSync(CONTRACT, 'utf8')) : null;

  it(`is the version contracts/consumes.json names (${want?.version})`, () => {
    expect(
      contract.version,
      `Area Sounds publishes sets version ${contract.version}: re-read its contracts/sets.json and scripts/engine.js against src/page/areasounds.ts, then set the version in contracts/consumes.json`
    ).toBe(want.version);
  });

  it('names every field the mirror writes, with the defaults the mirror fills', () => {
    const { set } = normalizeAreaSoundsSet({ id: 'fixed' });
    expect(Object.keys(contract.set).sort()).toEqual(Object.keys(set).sort());
    for (const [name, f] of Object.entries<any>(contract.set))
      if (name !== 'id') expect((set as any)[name], name).toEqual(f.default);
  });

  it('places the flag, the legacy scope, the library and night where the mirror does', () => {
    expect(contract.flag).toMatchObject({
      document: 'Scene',
      scope: AREASOUNDS_MODULE_ID,
      key: 'sets',
      legacyScope: LEGACY_MODULE_ID,
    });
    expect(contract.library).toEqual({
      path: AREASOUNDS_LIBRARY_PATH,
      legacyPath: LEGACY_LIBRARY_PATH,
    });
    expect(contract.night.darkness).toBe(NIGHT_DARKNESS);
  });
});

// Without the clone the skip says why, as a test of its own the run lists.
if (!present)
  it.skip(`Area Sounds' engine: no ${ENGINE}, so the module half is skipped (clone fvtt-mod-areasounds beside this repo, or set MCP_AREASOUNDS_DIR)`, () => {});
