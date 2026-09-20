// Page-side: compendium reads. Runs INSIDE the Foundry page.
//
// Pure reads against game.packs. No module settings, permissions, transactions,
// sockets, or other legacy scaffolding — those are all gone. The consuming Node
// tools (src/tools/compendium.ts) do the input validation, limiting, and output
// shaping; these functions return the raw bridge-shaped values those tools
// expect (faithful to the old data-access.ts oracle).

import { toSource, sanitizeDocData } from './_shared.js';
import { excludeSrdPacks, packPriority } from '../utils/compendium-sources.js';

interface CompendiumSearchArgs {
  query: string;
  packType?: string;
  limit?: number;
}

interface CompendiumSearchResult {
  id: string;
  name: string;
  type: string;
  uuid: string;
  pack: string;
  img?: string;
}

interface GetCompendiumDocumentArgs {
  packId: string;
  documentId: string;
}

interface CompendiumItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

interface CompendiumEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: Record<string, unknown>;
}

interface CompendiumEntryFull {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system: Record<string, unknown>;
  items?: CompendiumItem[];
  effects?: CompendiumEffect[];
  fullData: Record<string, unknown>;
}

/**
 * Search every (non-Scene) premium compendium pack's index for entries whose NAME matches all
 * whitespace-separated terms in the query. Name-only matching — descriptions/traits are not
 * indexed, and there is no faceted/heuristic filtering (use search-compendium-creatures/-spells/
 * -items for real-system-data facets). Every match is ranked (premium-first, exact-name, then
 * alphabetical); the first `limit` (default 50) come back with the full match count.
 */
export async function searchCompendium(
  args: CompendiumSearchArgs
): Promise<{ results: CompendiumSearchResult[]; totalFound: number }> {
  const query = args?.query;
  const packType = args?.packType;
  const limit = args?.limit ?? 50;

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    throw new Error('Search query must be a string with at least 2 characters');
  }

  const cleanQuery = query.toLowerCase().trim();
  const searchTerms = cleanQuery
    .split(' ')
    .filter(term => term && typeof term === 'string' && term.length > 0);

  if (searchTerms.length === 0) {
    throw new Error('Search query must contain valid search terms');
  }

  // Filter packs by requested type; never search Scene packs; never search SRD packs.
  // SRD (`dnd5e.*`) packs are excluded outright (design.md §2.3) — dropping them here, before we
  // index, also keeps the RESULT_LIMIT budget reserved for the premium books.
  const packs: any[] = excludeSrdPacks(
    Array.from(game.packs.values()) as any[],
    (pack: any) => pack.metadata.id
  ).filter((pack: any) => {
    if (packType && pack.metadata.type !== packType) {
      return false;
    }
    return pack.metadata.type !== 'Scene';
  });

  const results: CompendiumSearchResult[] = [];

  for (const pack of packs) {
    try {
      if (!pack.indexed) {
        await pack.getIndex({});
      }

      const entries = Array.from(pack.index.values());

      for (const entry of entries) {
        try {
          const typedEntry = entry as any;
          if (
            !typedEntry?.name ||
            typeof typedEntry.name !== 'string' ||
            typedEntry.name.trim().length === 0
          ) {
            continue;
          }

          const entryNameLower = typedEntry.name.toLowerCase();
          const nameMatch = searchTerms.every(term => entryNameLower.includes(term));
          if (!nameMatch) {
            continue;
          }

          const id = typedEntry._id || '';
          results.push({
            id,
            name: typedEntry.name,
            type: typedEntry.type || 'unknown',
            uuid: typedEntry.uuid || `Compendium.${pack.metadata.id}.${pack.documentName}.${id}`,
            pack: pack.metadata.id,
            ...(typedEntry.img ? { img: typedEntry.img } : {}),
          });
        } catch {}
      }
    } catch {
      // Skip packs that fail to index/search; keep going.
    }
  }

  // Relevance ranking: premium-first, then exact name, then alphabetical.
  results.sort((a, b) => {
    // Premium books first, SRD (dnd5e.*) always last — we author only from the books (design.md §2.3).
    const aPri = packPriority(a.pack);
    const bPri = packPriority(b.pack);
    if (aPri !== bPri) return aPri - bPri;

    const aExact = a.name.toLowerCase() === query.toLowerCase();
    const bExact = b.name.toLowerCase() === query.toLowerCase();
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return a.name.localeCompare(b.name);
  });

  return { results: results.slice(0, limit), totalFound: results.length };
}

/**
 * List the visible compendium packs with their basic metadata. SRD (`dnd5e.*`) packs are excluded
 * (design.md §2.3) so they never surface to the caller. The Node tool filters by type and derives
 * availableTypes from this list.
 */
export function getAvailablePacks(): unknown {
  return excludeSrdPacks(
    Array.from(game.packs.values()) as any[],
    (pack: any) => pack.metadata.id
  ).map((pack: any) => ({
    id: pack.metadata.id,
    label: pack.metadata.label,
    type: pack.metadata.type,
    system: pack.metadata.system,
    private: pack.metadata.private,
  }));
}

/**
 * Load a single compendium document in full: sanitized system data, sanitized
 * raw toObject() data, plus embedded items and active effects when present.
 */
export async function getCompendiumDocumentFull(
  args: GetCompendiumDocumentArgs
): Promise<CompendiumEntryFull> {
  const packId = args?.packId;
  const documentId = args?.documentId;

  const pack = game.packs.get(packId);
  if (!pack) {
    throw new Error(`Compendium pack ${packId} not found`);
  }

  const document = await pack.getDocument(documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found in pack ${packId}`);
  }

  // Sanitize toObject() SOURCE, not the live document: dnd5e 5.x system.activities is a
  // Map and Object.keys() on a Map is [] — sanitizing the live `system` would empty it to {}.
  const source: any = document.toObject();

  const fullEntry: CompendiumEntryFull = {
    id: document.id || '',
    name: document.name || '',
    type: document.type || 'unknown',
    img: document.img || undefined,
    pack: packId,
    packLabel: pack.metadata.label,
    system: sanitizeData(source.system || {}),
    fullData: sanitizeData(source),
  };

  if (document.items) {
    fullEntry.items = document.items.map((item: any) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img || undefined,
      system: sanitizeData(toSource(item).system || {}),
    }));
  }

  if (document.effects) {
    fullEntry.effects = document.effects.map((effect: any) => ({
      id: effect.id,
      name: effect.name || effect.label || 'Unknown Effect',
      icon: effect.icon || undefined,
      disabled: effect.disabled || false,
      duration: sanitizeData(effect.duration || {}),
    }));
  }

  return fullEntry;
}

// --- local helpers -------------------------------------------------------

/**
 * JSON-safe sanitize: strips sensitive/problematic/deprecated fields and most
 * underscore-prefixed keys (keeps _id), handles cycles, and works around dnd5e
 * 5.3 deprecated senses getters. Returns a plain JSON-clonable copy.
 */
/**
 * Sanitize compendium data for output. Delegates the field-stripping/cycle-guarding to the
 * shared sanitizeDocData (the page layer's single chokepoint), then runs a JSON round-trip so
 * the result is guaranteed plain-JSON-clonable for the bridge return path.
 */
function sanitizeData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data !== 'object') {
    return data;
  }
  try {
    return JSON.parse(safeJSONStringify(sanitizeDocData(data)));
  } catch {
    return {};
  }
}

function safeJSONStringify(obj: any): string {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (key === 'save' && typeof value === 'object' && value !== null) {
        return undefined;
      }
      return value;
    });
  } catch {
    return '{}';
  }
}
