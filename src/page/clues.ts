// Page-side: the party's clues, through house module fvtt-mod-clueboard (Open Roll 5e: Clue Board).
// A Clue is that module's own Item type (`fvtt-mod-clueboard.clue`), made with createWorldItems like
// any world Item; collecting it puts an entry on the party's record (flags on the Group actor),
// where players read it in Mysteries. These ops go through the module's own API (`collect`,
// `uncollect`, `entries`), never its flags: the record's schema is the module's. The writes the
// API makes are this user's document updates, so the receipt recorder sees them like any other.
// Browser + Foundry globals only.

import { invalid, notFound, unsupported } from './errors.js';
import { ambiguousTarget, fuzzyTier } from './_shared.js';

const MODULE_ID = 'fvtt-mod-clueboard';
const CLUE_TYPE = `${MODULE_ID}.clue`;
/** The first release whose `collect` takes `stamp: false`. */
const STAMPLESS_SINCE = '1.2.0';

function clueApi(): any {
  const mod = game.modules?.get?.(MODULE_ID);
  if (!mod?.active || !mod.api) {
    throw unsupported(`The Clue Board module (${MODULE_ID}) is not active in this world.`);
  }
  return mod;
}

/** The party by id or name among the module's parties; omitted = the primary party, else the only one. */
function partyFor(api: any, identifier?: string): any {
  const parties: any[] = api.parties();
  if (identifier) {
    const tier = fuzzyTier(parties, identifier, { substring: false });
    if (tier.length > 1) throw ambiguousTarget('party', identifier, tier);
    if (!tier[0])
      throw notFound(
        `No party "${identifier}". Parties: ${parties.map(p => p.name).join(', ') || 'none'}`
      );
    return tier[0];
  }
  const primary = game.actors?.party;
  if (primary && parties.some(p => p.id === primary.id)) return primary;
  if (parties.length === 1) return parties[0];
  if (parties.length === 0)
    throw notFound('No party (a Group actor) in this world: nowhere to collect to.');
  throw invalid(`No primary party; name one of: ${parties.map(p => p.name).join(', ')}`);
}

/** A world Clue by exact id, then name (a write refuses a tie). */
function clueFor(identifier: string): any {
  const tier = fuzzyTier(game.items, identifier, {
    substring: false,
    where: (i: any) => i.type === CLUE_TYPE,
  });
  if (tier.length > 1) throw ambiguousTarget('Clue', identifier, tier);
  if (!tier[0]) throw notFound(`No world Clue "${identifier}" (an Item of type ${CLUE_TYPE}).`);
  return tier[0];
}

const entryRow = (e: any) => ({
  id: e.id,
  name: e.snapshot?.name ?? e.source?.name ?? '',
  kind: e.kind,
  scene: e.foundIn?.sceneName ?? '',
  readers: Object.keys(e.readers ?? {}).length,
  revision: e.snapshot?.revision ?? 1,
});

export interface ListCluesArgs {
  party?: string | undefined;
}

/** The party's collected clues, and the world Clues it has not been given. */
export async function listClues(args: ListCluesArgs = {}) {
  const { api } = clueApi();
  const group = partyFor(api, args.party);
  const entries: any[] = api.entries(group);
  const have = new Set(entries.map(e => e.id));
  const uncollected = (game.items?.contents ?? [])
    .filter((i: any) => i.type === CLUE_TYPE && !have.has(i.id))
    .map((i: any) => ({ id: i.id, name: i.name, kind: i.system?.kind ?? '' }));
  return { party: { id: group.id, name: group.name }, entries: entries.map(entryRow), uncollected };
}

export interface CollectCluesArgs {
  clues: string[];
  party?: string | undefined;
  /** false: no scene or calendar date in the stamp, for a clue found before it was collected. */
  stamp?: boolean | undefined;
}

/** Collect world Clues on the party, each once; one already on the record is reported, not redone. */
export async function collectClues(args: CollectCluesArgs) {
  const mod = clueApi();
  const { api } = mod;
  if (!Array.isArray(args?.clues) || args.clues.length === 0)
    throw invalid('clues: name at least one world Clue');
  const stamp = args.stamp !== false;
  if (!stamp && foundry.utils.isNewerVersion(STAMPLESS_SINCE, mod.version ?? '0')) {
    throw unsupported(
      `stamp: false needs Clue Board ${STAMPLESS_SINCE} or later; this world has ${mod.version}.`
    );
  }
  const group = partyFor(api, args.party);
  const items = args.clues.map(clueFor); // every name resolves before anything is written
  const collected: any[] = [];
  const already: string[] = [];
  for (const item of items) {
    if (api.entry(group, item.id)) {
      already.push(item.name);
      continue;
    }
    const entry = await api.collect(item, group, { how: 'mcp', stamp });
    if (!entry) throw invalid(`Clue Board did not collect "${item.name}" (its notice says why).`);
    collected.push(entryRow(entry));
  }
  return {
    party: { id: group.id, name: group.name },
    collected,
    already,
    entries: api.entries(group).length,
  };
}

export interface UncollectCluesArgs {
  clues: string[];
  party?: string | undefined;
}

/** Take Clues off the party's record (its readers and note on them go too); the world Clue stays. */
export async function uncollectClues(args: UncollectCluesArgs) {
  const { api } = clueApi();
  if (!Array.isArray(args?.clues) || args.clues.length === 0)
    throw invalid('clues: name at least one Clue');
  const group = partyFor(api, args.party);
  const items = args.clues.map(clueFor);
  const removed: string[] = [];
  const notOnRecord: string[] = [];
  for (const item of items) {
    if (!api.entry(group, item.id)) {
      notOnRecord.push(item.name);
      continue;
    }
    if (await api.uncollect(group, item.id, { confirm: false })) removed.push(item.name);
  }
  return {
    party: { id: group.id, name: group.name },
    removed,
    notOnRecord,
    entries: api.entries(group).length,
  };
}
