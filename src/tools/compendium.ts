import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { detectGameSystem, type GameSystem } from '../utils/system-detection.js';
import { assertNoSrdPacks, isHiddenFromEnumeration } from '../utils/compendium-sources.js';
import { toInputSchema } from '../utils/schema.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

// Single source of truth for each tool's input contract: the handlers parse with these schemas
// and getToolDefinitions() advertises toInputSchema(...) of the same schema, so the advertised
// and enforced contracts cannot drift (e.g. the limit default that previously said 500 but
// enforced 100). The lenient coercion unions below are deliberate — they recover stringified
// argument shapes some MCP clients send — and `io: 'input'` advertises that accepted input side.
//
// The four searches are ONE tool, `search-compendium`, selected by `type` (any / creatures /
// spells / items; src/tools/_union.ts — M8 of the 3.0 plan): the name search across every pack
// and the three faceted searches over the one page-side engine.

export const SEARCH_COMPENDIUM = 'search-compendium';

const SearchCompendiumSchema = z.object({
  query: z
    .string()
    .min(2, 'Search query must be at least 2 characters')
    .describe('Name terms (all must appear); descriptions are not searched.'),
  packType: z.string().optional().describe('Pack document type ("Item", "Actor", "JournalEntry").'),
  limit: z.number().min(1).max(50).default(50).describe('Max results.'),
});

const GetCompendiumEntrySchema = z.object({
  packId: z.string().min(1, 'Pack ID cannot be empty').describe('Compendium pack id.'),
  itemId: z.string().min(1).describe('Entry id within the pack.'),
  compact: z
    .boolean()
    .default(false)
    .describe('Key stats, abilities and actions only; no descriptions or system data.'),
});

const ListCreaturesByCriteriaSchema = z.object({
  name: z.string().optional(),
  // D&D 5e: challengeRating
  challengeRating: z
    .union([
      z
        .object({
          min: z.number().optional().default(0).describe('Minimum CR (default: 0)'),
          max: z.number().optional().default(30).describe('Maximum CR (default: 30)'),
        })
        .describe('CR range object (e.g., {"min": 10, "max": 15})'),
      z
        .string()
        .refine(
          val => {
            try {
              const parsed = JSON.parse(val);
              return (
                typeof parsed === 'object' &&
                parsed !== null &&
                (typeof parsed.min === 'number' || typeof parsed.max === 'number')
              );
            } catch {
              return false;
            }
          },
          {
            message: 'Challenge rating range must be valid JSON object with min/max numbers',
          }
        )
        .transform(val => {
          const parsed = JSON.parse(val);
          return {
            min: parsed.min || 0,
            max: parsed.max || 30,
          };
        }),
      z.number().describe('Exact CR value (e.g., 12)'),
      z
        .string()
        .refine(val => !Number.isNaN(parseFloat(val)), {
          message: 'Challenge rating must be a valid number',
        })
        .transform(val => parseFloat(val)),
    ])
    .optional()
    .describe('A number, a string ("1/4"), or a {min, max} range.'),

  // Common filters
  creatureType: z.string().optional().describe('Creature type key.'), // Accept any string, validate per system
  size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']).optional(),

  // Spellcasting flags
  hasSpells: z
    .union([
      z.boolean(),
      z
        .string()
        .refine(val => ['true', 'false'].includes(val.toLowerCase()))
        .transform(val => val.toLowerCase() === 'true'),
    ])
    .optional()
    .describe('Spellcasters only (an approximate index flag).'),
  hasLegendaryActions: z
    .union([
      z.boolean(),
      z
        .string()
        .refine(val => ['true', 'false'].includes(val.toLowerCase()))
        .transform(val => val.toLowerCase() === 'true'),
    ])
    .optional()
    .describe('Legendary-action creatures only (an approximate index flag).'),

  limit: z
    .union([
      z.number().min(1).max(500),
      z
        .string()
        .refine(val => {
          const num = parseInt(val, 10);
          return !Number.isNaN(num) && num >= 1 && num <= 500;
        })
        .transform(val => parseInt(val, 10)),
    ])
    .optional()
    .default(50)
    .describe('Max results (default 50); totalFound is the full count.'),
});

const ListCompendiumPacksSchema = z.object({
  type: z.string().optional().describe('Pack document type.'),
});

// Thin typed facade over the page-side faceted engine (searchCompendiumFaceted). The tool hard-codes
// documentType: 'spell', so only spell facets are representable here (design.md §2.1, "a tool is a
// contract"). Lenient string/number unions mirror the other compendium schemas — they recover the
// stringified argument shapes some MCP clients send.
const SearchCompendiumSpellsSchema = z.object({
  name: z.string().optional(),
  spellLevel: z
    .union([
      z
        .object({
          min: z.number().min(0).max(9).optional().describe('Minimum level (0 = cantrip)'),
          max: z.number().min(0).max(9).optional().describe('Maximum level'),
        })
        .describe('Level range, e.g. {"min":1,"max":3}'),
      z.number().min(0).max(9).describe('Exact spell level (0 = cantrip … 9)'),
      z
        .string()
        .refine(
          val => {
            try {
              const parsed = JSON.parse(val);
              return (
                typeof parsed === 'object' &&
                parsed !== null &&
                (typeof parsed.min === 'number' || typeof parsed.max === 'number')
              );
            } catch {
              return false;
            }
          },
          { message: 'Spell-level range must be valid JSON with min/max numbers' }
        )
        .transform(val => JSON.parse(val) as { min?: number; max?: number }),
      z
        .string()
        .refine(val => !Number.isNaN(parseInt(val, 10)), {
          message: 'Spell level must be a valid number',
        })
        .transform(val => parseInt(val, 10)),
    ])
    .optional()
    .describe('A level (0 = cantrip) or a {min, max} range.'),
  spellSchool: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('School name or dnd5e 3-letter key; one or an array.'),
  damageType: z
    .string()
    .optional()
    .describe('Damage type dealt ("fire"); a second pass over the facet-filtered candidates.'),
  limit: z
    .union([
      z.number().min(1).max(200),
      z
        .string()
        .refine(val => {
          const num = parseInt(val, 10);
          return !Number.isNaN(num) && num >= 1 && num <= 200;
        })
        .transform(val => parseInt(val, 10)),
    ])
    .default(50)
    .describe('Max results (default 50).'),
});

// Thin typed facade over the faceted engine for GEAR. documentType narrows the item family
// (gear=all / weapon / armor / consumable); only gear facets are representable (design.md §2.1).
const SearchCompendiumItemsSchema = z.object({
  documentType: z
    .enum(['gear', 'weapon', 'armor', 'consumable'])
    .default('gear')
    .describe('gear = every physical item; or one family.'),
  name: z.string().optional(),
  rarity: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('common … artifact (case-insensitive); one or an array.'),
  itemType: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Subtype key (system.type.value: "wand", "ring", "potion", "martialM" …); one or an array.'
    ),
  properties: z
    .array(z.string())
    .optional()
    .describe('Any of these dnd5e property keys ("mgc", "fin", "ver").'),
  magical: z
    .union([
      z.boolean(),
      z
        .string()
        .refine(val => ['true', 'false'].includes(val.toLowerCase()))
        .transform(val => val.toLowerCase() === 'true'),
    ])
    .optional()
    .describe('Magical items only ("mgc").'),
  limit: z
    .union([
      z.number().min(1).max(200),
      z
        .string()
        .refine(val => {
          const num = parseInt(val, 10);
          return !Number.isNaN(num) && num >= 1 && num <= 200;
        })
        .transform(val => parseInt(val, 10)),
    ])
    .default(50)
    .describe('Max results (default 50).'),
});

/**
 * THE search-hit shape, shared by all four search tools: `{id, name, type, uuid, pack, img?, facets?}`
 * — `pack` is the pack id string everywhere (feed `pack` + `id` to get-compendium-entry /
 * create-actor-from-compendium / import-item; `uuid` to a roll-table result). Nothing derivable or
 * empty rides along (no packLabel, no index "description", no summary).
 */
export function compactHit(hit: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: hit?.id,
    name: hit?.name,
    type: hit?.type,
    uuid: hit?.uuid,
    pack: typeof hit?.pack === 'string' ? hit.pack : hit?.pack?.id,
  };
  if (hit?.img) out.img = hit.img;
  if (hit?.facets && Object.keys(hit.facets).length) out.facets = hit.facets;
  return out;
}

/** The one search body: what was asked, the hits, how many came back, how many matched. */
function searchBody(
  head: Record<string, unknown>,
  hits: any[],
  totalFound: number
): Record<string, unknown> {
  const results = hits.map(compactHit);
  return { ...head, results, showing: results.length, totalFound };
}

/** The faceted tools' body, with the engine's SRD exclusion re-applied as a backstop (design.md §2.3). */
function facetedBody(
  documentType: string,
  criteria: string,
  found: { results?: any[]; totalFound?: number } | any[] | null | undefined
): Record<string, unknown> {
  const list: any[] = Array.isArray(found) ? found : (found?.results ?? []);
  const visible = list.filter(hit => !isHiddenFromEnumeration(hit?.pack));
  const total = Array.isArray(found) ? visible.length : (found?.totalFound ?? visible.length);
  return searchBody({ documentType, criteria }, visible, total);
}

export interface CompendiumToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class CompendiumTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private gameSystem: GameSystem | null = null;
  private search: UnionTool;

  constructor({ foundry, logger }: CompendiumToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'CompendiumTools' });
    this.search = unionTool({
      name: SEARCH_COMPENDIUM,
      description:
        'Search the premium compendium packs (SRD packs are never searched), premium-first: type ' +
        'any = a name search over every document type; creatures / spells / items = facets on real ' +
        'system data. Hits are {id, name, type, uuid, pack, img, facets} with totalFound.',
      discriminators: ['type'],
      shared: { name: z.string().describe('Case-insensitive name substring.') },
      members: [
        unionMember({
          select: { type: 'any' },
          description: 'Name terms across every pack and document type, exact-name first.',
          schema: SearchCompendiumSchema,
          handler: parsed => this.searchByName(parsed),
        }),
        unionMember({
          select: { type: 'creatures' },
          description:
            'Creatures by CR, creature type, size, spellcasting, legendary actions across the ' +
            'Actor packs.',
          schema: ListCreaturesByCriteriaSchema,
          handler: parsed => this.searchCreatures(parsed),
        }),
        unionMember({
          select: { type: 'spells' },
          description: 'Spells by level, school, damage type.',
          schema: SearchCompendiumSpellsSchema,
          handler: parsed => this.searchSpells(parsed),
        }),
        unionMember({
          select: { type: 'items' },
          description: 'Gear by family, rarity, subtype, properties, magical.',
          schema: SearchCompendiumItemsSchema,
          handler: parsed => this.searchItems(parsed),
        }),
      ],
    });
  }

  /** The search union (registry-facing). */
  async handleSearchCompendium(args: unknown): Promise<unknown> {
    return this.search.handle(args);
  }

  /**
   * Get or detect the game system (cached)
   */
  private async getGameSystem(): Promise<GameSystem> {
    if (!this.gameSystem) {
      this.gameSystem = await detectGameSystem(this.foundry, this.logger);
    }
    return this.gameSystem;
  }

  /**
   * Tool definitions for compendium operations
   */
  getToolDefinitions() {
    return [
      this.search.def,
      {
        name: 'get-compendium-entry',
        description:
          'One compendium entry in full (items, spells, abilities, effects, system data), or compact. ' +
          'An SRD pack id is refused.',
        inputSchema: toInputSchema(GetCompendiumEntrySchema),
      },
      {
        name: 'list-compendium-packs',
        description: 'The compendium packs (SRD packs excluded).',
        inputSchema: toInputSchema(ListCompendiumPacksSchema),
      },
    ];
  }

  private async searchByName({
    query,
    packType,
    limit,
  }: z.output<typeof SearchCompendiumSchema>): Promise<Record<string, unknown>> {
    // Detect game system for appropriate filtering
    const gameSystem = await this.getGameSystem();

    this.logger.info('Compendium name search', { gameSystem, query, packType });

    const found = await this.foundry.call('searchCompendium', { query, packType, limit });

    // Enforced backstop to the page-side exclusion: an SRD (`dnd5e.*`) hit is never a result
    // (design.md §2.3). The page already drops SRD packs before indexing; we re-drop here so the
    // contract holds even if a pack slips past that filter.
    const results = (found?.results ?? []).filter(
      (hit: any) => !isHiddenFromEnumeration(hit?.pack)
    );

    this.logger.debug('Compendium search completed', {
      query,
      gameSystem,
      totalFound: found?.totalFound,
      returned: results.length,
    });

    return searchBody({ query }, results, found?.totalFound ?? results.length);
  }

  async handleGetCompendiumItem(args: any): Promise<any> {
    const { packId, itemId, compact } = GetCompendiumEntrySchema.parse(args);

    // SRD packs are not a source and are not even visible in lookups (design.md §2.3); refuse an
    // SRD packId outright rather than reading from it, consistent with the pull-tool guards.
    assertNoSrdPacks(packId, 'get-compendium-entry');

    // Use the proper document retrieval method that already exists in actor creation
    const item = await this.foundry.call('getCompendiumDocumentFull', {
      packId,
      documentId: itemId,
    });

    if (!item) {
      throw new Error(`Item ${itemId} not found in pack ${packId}`);
    }

    // Format the response using the detailed item data
    const baseResponse = {
      id: item.id,
      name: item.name,
      type: item.type,
      pack: {
        id: item.pack,
        label: item.packLabel,
      },
      description: this.extractDescription(item),
      hasImage: !!item.img,
      imageUrl: item.img,
    };

    if (compact) {
      // Compact response for UI performance
      const compactStats = this.extractCompactStats(item);
      return {
        ...baseResponse,
        stats: compactStats,
        properties: this.extractItemProperties(item),
        items: (item.items || []).slice(0, 5), // Limit items to prevent bloat
        mode: 'compact',
      };
    } else {
      // Full response
      return {
        ...baseResponse,
        fullDescription: this.extractFullDescription(item),
        system: this.sanitizeSystemData(item.system || {}),
        properties: this.extractItemProperties(item),
        items: item.items || [],
        effects: item.effects || [],
        fullData: item.fullData,
        mode: 'full',
      };
    }
  }

  private async searchCreatures(
    params: z.output<typeof ListCreaturesByCriteriaSchema>
  ): Promise<Record<string, unknown>> {
    const criteriaDescription = this.describeCriteria(params);
    this.logger.info('Creature faceted search', { criteria: criteriaDescription });

    // Re-backed on the one faceted engine (documentType:'creature'); CR/type/size are index
    // filters, hasSpells/hasLegendaryActions are engine post-filters on approximate index facets.
    const found = await this.foundry.call('searchCompendiumFaceted', {
      documentType: 'creature',
      name: params.name,
      challengeRating: params.challengeRating,
      creatureType: params.creatureType,
      size: params.size,
      hasSpells: params.hasSpells,
      hasLegendaryActions: params.hasLegendaryActions,
      limit: params.limit,
    });

    return facetedBody('creature', criteriaDescription, found);
  }

  async handleListCompendiumPacks(args: any): Promise<any> {
    const { type } = ListCompendiumPacksSchema.parse(args);

    this.logger.info('Listing compendium packs', { type });

    const rawPacks = await this.foundry.call('getAvailablePacks');

    // Enforced backstop to the page-side exclusion: SRD (`dnd5e.*`) packs are not visible in
    // lookups (design.md §2.3), and neither is the mechanical `dnd5e.effects` pack — it is
    // reached by name through the effect-uuid resolver, never browsed. The page already omits
    // them; re-drop here so the contract holds, and so `availableTypes` below is derived only
    // from the visible (book) packs.
    const packs = rawPacks.filter((pack: any) => !isHiddenFromEnumeration(pack?.id));

    // Filter by type if specified
    const filteredPacks = type ? packs.filter((pack: any) => pack.type === type) : packs;

    this.logger.debug('Successfully retrieved compendium packs', {
      total: packs.length,
      filtered: filteredPacks.length,
      type,
    });

    return {
      packs: filteredPacks.map((pack: any) => ({
        id: pack.id,
        label: pack.label,
        type: pack.type,
      })),
      total: filteredPacks.length,
      availableTypes: [...new Set(packs.map((pack: any) => pack.type))],
    };
  }

  private async searchSpells(
    params: z.output<typeof SearchCompendiumSpellsSchema>
  ): Promise<Record<string, unknown>> {
    const criteriaDescription = this.describeSpellCriteria(params);
    this.logger.info('Spell faceted search', { criteria: criteriaDescription });

    // Thin facade: hard-code the content type and forward the spell facets to the one engine.
    const found = await this.foundry.call('searchCompendiumFaceted', {
      documentType: 'spell',
      name: params.name,
      spellLevel: params.spellLevel,
      spellSchool: params.spellSchool,
      damageType: params.damageType,
      limit: params.limit,
    });

    return facetedBody('spell', criteriaDescription, found);
  }

  private async searchItems(
    params: z.output<typeof SearchCompendiumItemsSchema>
  ): Promise<Record<string, unknown>> {
    const criteriaDescription = this.describeItemCriteria(params);
    this.logger.info('Item faceted search', {
      documentType: params.documentType,
      criteria: criteriaDescription,
    });

    // Thin facade: forward the gear facets to the one engine (documentType picks the family).
    const found = await this.foundry.call('searchCompendiumFaceted', {
      documentType: params.documentType,
      name: params.name,
      rarity: params.rarity,
      itemType: params.itemType,
      properties: params.properties,
      magical: params.magical,
      limit: params.limit,
    });

    return facetedBody(params.documentType, criteriaDescription, found);
  }

  /** Human-readable summary of the item-search facets (transparency + logging). */
  private describeItemCriteria(params: z.infer<typeof SearchCompendiumItemsSchema>): string {
    const parts: string[] = [];
    if (params.rarity) {
      parts.push(Array.isArray(params.rarity) ? params.rarity.join('/') : params.rarity);
    }
    if (params.itemType) {
      parts.push(Array.isArray(params.itemType) ? params.itemType.join('/') : params.itemType);
    }
    if (params.magical !== undefined) parts.push(params.magical ? 'magical' : 'non-magical');
    if (params.properties?.length) parts.push(`properties:${params.properties.join('+')}`);
    if (params.name) parts.push(`name~"${params.name}"`);
    const facets = parts.length > 0 ? parts.join(', ') : 'no facets';
    return `${params.documentType} (${facets})`;
  }

  /** Human-readable summary of the spell-search facets (transparency + logging). */
  private describeSpellCriteria(params: z.infer<typeof SearchCompendiumSpellsSchema>): string {
    const parts: string[] = [];
    if (params.spellLevel !== undefined) {
      if (typeof params.spellLevel === 'number') {
        parts.push(params.spellLevel === 0 ? 'cantrip' : `level ${params.spellLevel}`);
      } else {
        const min = params.spellLevel.min ?? 0;
        const max = params.spellLevel.max ?? 9;
        parts.push(`level ${min}-${max}`);
      }
    }
    if (params.spellSchool) {
      parts.push(
        Array.isArray(params.spellSchool) ? params.spellSchool.join('/') : params.spellSchool
      );
    }
    if (params.damageType) parts.push(`${params.damageType} damage`);
    if (params.name) parts.push(`name~"${params.name}"`);
    return parts.length > 0 ? parts.join(', ') : 'no criteria';
  }

  private extractDescription(item: any): string {
    const system = item.system || {};

    // Try different common description fields
    const description =
      system.description?.value ||
      system.description?.content ||
      system.description ||
      system.details?.description ||
      '';

    return this.truncateText(this.stripHtml(description), 200);
  }

  private extractFullDescription(item: any): string {
    const system = item.system || {};

    const description =
      system.description?.value ||
      system.description?.content ||
      system.description ||
      system.details?.description ||
      '';

    return this.stripHtml(description);
  }

  /** Human-readable summary of the creature facets (transparency + logging). */
  private describeCriteria(params: any): string {
    const parts: string[] = [];

    if (params.name) parts.push(`name ~ "${params.name}"`);
    if (params.challengeRating !== undefined) {
      if (typeof params.challengeRating === 'number') {
        parts.push(`CR ${params.challengeRating}`);
      } else if (typeof params.challengeRating === 'object') {
        const min = params.challengeRating.min ?? 0;
        const max = params.challengeRating.max ?? 30;
        parts.push(`CR ${min}-${max}`);
      }
    }

    if (params.creatureType) parts.push(params.creatureType);
    if (params.size) parts.push(params.size);
    if (params.hasSpells) parts.push('spellcaster');
    if (params.hasLegendaryActions) parts.push('legendary');

    return parts.length > 0 ? parts.join(', ') : 'no criteria';
  }

  private extractCompactStats(item: any): any {
    const system = item.system || {};
    const stats: any = {};

    // Core combat stats
    if (system.attributes?.ac?.value) stats.armorClass = system.attributes.ac.value;
    if (system.attributes?.hp?.max) stats.hitPoints = system.attributes.hp.max;
    if (system.details?.cr !== undefined) stats.challengeRating = system.details.cr;

    // Basic info
    if (system.details?.type?.value) stats.creatureType = system.details.type.value;
    if (system.traits?.size) stats.size = system.traits.size;
    if (system.details?.alignment) stats.alignment = system.details.alignment;

    // Key abilities (only show notable ones)
    if (system.abilities) {
      const abilities: any = {};
      for (const [key, ability] of Object.entries(system.abilities)) {
        const abil = ability as any;
        if (abil.value !== undefined) {
          const mod = Math.floor((abil.value - 10) / 2);
          if (Math.abs(mod) >= 2) {
            // Only show significant modifiers
            abilities[key.toUpperCase()] = { value: abil.value, modifier: mod };
          }
        }
      }
      if (Object.keys(abilities).length > 0) stats.abilities = abilities;
    }

    // Speed (dnd5e 6.0 movement.speeds.*; 5.x source data kept movement.walk etc.)
    if (system.attributes?.movement) {
      const movement = system.attributes.movement;
      const sp = movement.speeds ?? movement;
      const speeds: string[] = [];
      if (sp.walk) speeds.push(`${sp.walk} ft`);
      if (sp.fly) speeds.push(`fly ${sp.fly} ft`);
      if (sp.swim) speeds.push(`swim ${sp.swim} ft`);
      if (speeds.length > 0) stats.speed = speeds.join(', ');
    }

    return stats;
  }

  private extractItemProperties(item: any): any {
    const system = item.system || {};
    const properties: any = {};

    // Common properties across different item types (dnd5e 6.0 `rarities` array, else 5.x `rarity`)
    const rarity = firstRarity(system);
    if (rarity) properties.rarity = rarity;
    if (system.price) properties.price = system.price;
    if (system.weight) properties.weight = system.weight;
    if (system.quantity) properties.quantity = system.quantity;

    // Spell-specific properties
    if (item.type.toLowerCase() === 'spell') {
      if (system.level !== undefined) properties.spellLevel = system.level;
      if (system.school) properties.school = system.school;
      if (system.components) properties.components = system.components;
      if (system.duration) properties.duration = system.duration;
      if (system.range) properties.range = system.range;
    }

    // Weapon-specific properties
    if (item.type.toLowerCase() === 'weapon') {
      if (system.damage) properties.damage = system.damage;
      if (system.weaponType) properties.weaponType = system.weaponType;
      if (system.properties) properties.weaponProperties = system.properties;
    }

    // Armor-specific properties
    if (item.type.toLowerCase() === 'armor') {
      if (system.armor) properties.armorClass = system.armor;
      if (system.stealth) properties.stealthDisadvantage = system.stealth;
    }

    return properties;
  }

  private sanitizeSystemData(systemData: any): any {
    // Remove potentially large or unnecessary fields
    const sanitized = { ...systemData };

    // Remove large description fields (already handled separately)
    delete sanitized.description;
    delete sanitized.details;

    // Remove internal/technical fields
    delete sanitized._id;
    delete sanitized.folder;
    delete sanitized.sort;
    delete sanitized.ownership;

    return sanitized;
  }

  private stripHtml(text: any): string {
    if (!text) return '';

    // Handle objects with value property (e.g., {value: "text"})
    if (typeof text === 'object' && text !== null) {
      if (text.value) {
        text = text.value;
      } else if (text.content) {
        text = text.content;
      } else {
        // For other objects, try to stringify or return empty
        try {
          text = JSON.stringify(text);
        } catch {
          return '';
        }
      }
    }

    // Handle arrays
    if (Array.isArray(text)) {
      return text.map(item => this.stripHtml(item)).join(' ');
    }

    // Ensure we have a string before calling replace()
    if (typeof text !== 'string') {
      const stringified = String(text || '');
      if (!stringified || stringified === '[object Object]') {
        return '';
      }
      text = stringified;
    }

    return text.replace(/<[^>]*>/g, '').trim();
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }
}

/** First rarity off sanitized system data — dnd5e 6.0 `rarities` (array once sanitized), else 5.x `rarity`. */
function firstRarity(system: any): string {
  const rs = system?.rarities;
  const first = Array.isArray(rs) ? rs[0] : rs instanceof Set ? Array.from(rs)[0] : undefined;
  if (typeof first === 'string' && first) return first;
  return typeof system?.rarity === 'string' ? system.rarity : '';
}
