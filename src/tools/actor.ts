import { z } from 'zod';
import { actorTarget } from './_targets.js';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { listLines } from '../utils/lines.js';
import { toInputSchema } from '../utils/schema.js';
import { humanSize } from '../hosts/paths.js';
import { extractActorStats, extractActorBasicInfo } from './dnd5e/actor-stats.js';
import { DELETE_ACTOR_DESCRIPTION, DeleteActorSchema, deleteActors } from './actor-creation.js';
import { UPDATE_ACTOR_DESCRIPTION, UpdateActorSchema, updateActor } from './dnd5e/update-actor.js';
import { unionMember, unionTool, type UnionTool } from './_union.js';

// ActorTools — the actor building block (§5): the lifecycle as ONE tool, `manage-actors` (action
// list / get / update / delete; src/tools/_union.ts — M8 of the 3.0 plan; the update member's
// contract lives in dnd5e/update-actor.ts, the delete member's in actor-creation.ts), plus the
// read that stays its own (search-actor-contents). Actor
// *creation* lives in ActorCreationTools + DnD5eNpcTools (create-actor-from-compendium /
// author-npc); world-Item CRUD and add/remove-from-actor live in ItemTools (src/tools/items.ts).
//
// Single source of truth for each tool's input contract: the handler parses with these schemas and
// the advertised JSON Schema is derived from the same zod, so the advertised and enforced
// contracts cannot drift.

export const MANAGE_ACTORS = 'manage-actors';

const GetActorSchema = z.object({
  actorIdentifier: actorTarget,
});

const GetActorEntitySchema = z.object({
  actorIdentifier: actorTarget,
  entityIdentifier: z
    .string()
    .min(1)
    .describe('Item id, or the name of an item, action, spell or effect.'),
});

const ExportActorSchema = z.object({
  actorIdentifier: actorTarget,
  localPath: z
    .string()
    .min(1)
    .describe('Absolute local path for the JSON file; parent directories are created.'),
  overwrite: z.boolean().default(false).describe('Overwrite an existing file.'),
});

const ListActorsSchema = z.object({
  type: z.string().optional().describe('Filter by actor type ("character", "npc", "group").'),
  nameFilter: z.string().optional().describe('Case-insensitive substring match on actor name.'),
});

const SearchActorContentsSchema = z.object({
  characterIdentifier: actorTarget,
  query: z
    .string()
    .optional()
    .describe(
      'Case-insensitive text in item names and descriptions; empty = every item of the type.'
    ),
  type: z
    .string()
    .optional()
    .describe(
      'Item type: spell, weapon, armor, equipment, consumable, feat, feature, action, effect, or a system type.'
    ),
  category: z
    .string()
    .optional()
    .describe('Spells: cantrip / prepared / innate / focus. Items: equipped / carried / invested.'),
  limit: z.number().optional().describe('Max results (default 20).'),
});

export interface ActorToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class ActorTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private union: UnionTool;

  constructor({ foundry, logger }: ActorToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ActorTools' });
    const log = this.logger;
    this.union = unionTool({
      name: MANAGE_ACTORS,
      description:
        'World actors: list / get / get-entity / export / update / delete (creation: ' +
        'create-actor-from-compendium / author-npc / create-pc). GM-only writes.',
      discriminators: ['action'],
      shared: { actorIdentifier: actorTarget },
      members: [
        unionMember({
          select: { action: 'list' },
          description: 'Actors: id, name, type.',
          schema: ListActorsSchema,
          handler: async ({ type, nameFilter }) => {
            log.info('Listing actors', { type, nameFilter });
            const actors = await foundry.call('listActors', {
              ...(type !== undefined ? { type } : {}),
              ...(nameFilter !== undefined ? { nameFilter } : {}),
            });
            const records = (Array.isArray(actors) ? actors : []).map(a => ({
              id: a.id,
              name: a.name,
              type: a.type,
            }));
            return listLines(`${records.length} actor(s)`, ['id', 'name', 'type'], records);
          },
        }),
        unionMember({
          select: { action: 'get' },
          description:
            'Compact sheet read: abilities, skills, saves, AC, HP, weapon-mastery kinds, action ' +
            'names, effects and conditions by name, every item with name / type / equipped / ' +
            'attunement / mastery (no descriptions; one in full: get-entity).',
          schema: GetActorSchema,
          handler: async ({ actorIdentifier }) => {
            log.info('Getting character information', { identifier: actorIdentifier });
            const characterData = await foundry.call('getCharacterInfo', {
              characterName: actorIdentifier,
            });
            return this.formatCharacterResponse(characterData);
          },
        }),
        unionMember({
          select: { action: 'get-entity' },
          description:
            'One item, action, spell or effect on an actor, in full: description, system data, ' +
            'module flags.',
          schema: GetActorEntitySchema,
          handler: parsed => this.getEntity(parsed),
        }),
        unionMember({
          select: { action: 'export' },
          description:
            'Write one actor to a local JSON file as a full-fidelity Foundry export (system, ' +
            'embedded items with uses and flags, effects, prototype token, ownership, the ' +
            "exportSource envelope — round-trips through the sheet's Import Data). An existing " +
            'file is refused unless overwrite:true.',
          schema: ExportActorSchema,
          handler: parsed => this.exportActor(parsed),
        }),
        unionMember({
          select: { action: 'update' },
          description: UPDATE_ACTOR_DESCRIPTION,
          schema: UpdateActorSchema,
          handler: parsed => updateActor(foundry, log, parsed),
        }),
        unionMember({
          select: { action: 'delete' },
          description: DELETE_ACTOR_DESCRIPTION,
          schema: DeleteActorSchema,
          handler: parsed => deleteActors(foundry, log, parsed),
        }),
      ],
    });
  }

  /** The actor union (registry-facing). */
  async handleManageActors(args: unknown): Promise<unknown> {
    return this.union.handle(args);
  }

  getToolDefinitions() {
    return [
      this.union.def,
      {
        name: 'search-actor-contents',
        description:
          "Search an actor's items, spells, actions and effects by text and type; matches come back " +
          'in full (spell targeting included).',
        inputSchema: toInputSchema(SearchActorContentsSchema),
      },
    ];
  }

  /** The export member: a full-fidelity native JSON export of one actor to a local file. */
  private async exportActor(parsed: z.output<typeof ExportActorSchema>): Promise<string> {
    if (!isAbsolute(parsed.localPath)) {
      throw new FormattedToolError(
        `Refused: localPath must be an absolute path (got "${parsed.localPath}").`
      );
    }
    if (!parsed.overwrite && (await fileExists(parsed.localPath))) {
      throw new FormattedToolError(
        `Refused: local file "${parsed.localPath}" already exists. Pass overwrite:true to replace it.`
      );
    }

    this.logger.info('Exporting actor', { identifier: parsed.actorIdentifier });
    const res = await this.foundry.call('exportActorData', { identifier: parsed.actorIdentifier });

    const bytes = Buffer.from(JSON.stringify(res.data, null, 2), 'utf8');
    try {
      await mkdir(dirname(parsed.localPath), { recursive: true });
      await writeFile(parsed.localPath, bytes);
    } catch (err) {
      throw new FormattedToolError(
        `manage-actors export failed writing "${parsed.localPath}": ${(err as Error).message}`
      );
    }

    return (
      `Exported "${res.name}" (${res.type}, ${res.itemCount} items, ${res.effectCount} effects) → ` +
      `${parsed.localPath} (${humanSize(bytes.length)})`
    );
  }

  /** The get-entity member: one item / action / spell / effect on an actor, in full. */
  private async getEntity({
    actorIdentifier,
    entityIdentifier,
  }: z.output<typeof GetActorEntitySchema>): Promise<Record<string, unknown>> {
    this.logger.info('Getting character entity', { actorIdentifier, entityIdentifier });

    // First get the character
    const characterData = await this.foundry.call('getCharacterInfo', {
      characterName: actorIdentifier,
    });

    // Try to find the entity in different collections
    let entity = null;
    let entityType = null;

    // 1. Try to find as an item (by ID or name)
    entity = characterData.items?.find(
      (i: any) =>
        i.id === entityIdentifier || i.name.toLowerCase() === entityIdentifier.toLowerCase()
    );
    if (entity) {
      entityType = 'item';
    }

    // 2. Try to find as an action (by name)
    if (!entity && characterData.actions) {
      entity = characterData.actions.find(
        (a: any) => a.name.toLowerCase() === entityIdentifier.toLowerCase()
      );
      if (entity) {
        entityType = 'action';
      }
    }

    // 3. Try to find as an effect (by name)
    if (!entity && characterData.effects) {
      entity = characterData.effects.find(
        (e: any) => e.name.toLowerCase() === entityIdentifier.toLowerCase()
      );
      if (entity) {
        entityType = 'effect';
      }
    }

    if (!entity) {
      throw new FormattedToolError(
        `Entity "${entityIdentifier}" not found on actor "${actorIdentifier}". Tried items, actions, and effects.`
      );
    }

    this.logger.debug('Successfully retrieved entity', {
      entityType,
      entityName: entity.name,
    });

    // Return full entity details based on type
    if (entityType === 'item') {
      return {
        entityType: 'item',
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.system?.description?.value || entity.system?.description || '',
        level: entity.system?.level, // dnd5e spell level (number); undefined for non-spells
        quantity: entity.system?.quantity ?? 1,
        equipped: entity.system?.equipped,
        attunement: entity.system?.attunement,
        hasImage: !!entity.img,
        // Full (source-sanitized) system data for advanced use cases.
        system: entity.system,
        // Module flags (source-sanitized) — the forensic read path for flag residue such as
        // item-piles' transfer leftovers (the NaN-attunement investigation needed a script
        // for exactly this before flags were surfaced here).
        ...(entity.flags && Object.keys(entity.flags).length > 0 ? { flags: entity.flags } : {}),
      };
    } else if (entityType === 'action') {
      return {
        entityType: 'action',
        name: entity.name,
        type: entity.type,
        itemId: entity.itemId,
        description: entity.description || 'Action from character strikes/abilities',
      };
    } else if (entityType === 'effect') {
      return {
        entityType: 'effect',
        id: entity.id,
        name: entity.name,
        description: entity.description || entity.name,
        duration: entity.duration,
        // Include full effect data
        ...entity,
      };
    }

    return entity;
  }

  async handleSearchCharacterItems(args: any): Promise<any> {
    const { characterIdentifier, query, type, category, limit } =
      SearchActorContentsSchema.parse(args);

    this.logger.info('Searching character items', {
      characterIdentifier,
      query,
      type,
      category,
      limit,
    });

    const result = await this.foundry.call('searchCharacterItems', {
      characterIdentifier,
      query,
      type,
      category,
      limit: limit ?? 20,
    });

    this.logger.debug('Successfully searched character items', {
      characterName: result.characterName,
      matchCount: result.matches?.length || 0,
    });

    return result;
  }

  private async formatCharacterResponse(characterData: any): Promise<any> {
    const response: any = {
      id: characterData.id,
      name: characterData.name,
      type: characterData.type,
      basicInfo: extractActorBasicInfo(characterData),
      stats: extractActorStats(characterData),
      items: this.formatItems(characterData.items || []),
      effects: this.formatEffects(characterData.effects || []),
      hasImage: !!characterData.img,
    };

    // Add actions with minimal data (name, traits, action cost only - no variants)
    if (characterData.actions && characterData.actions.length > 0) {
      response.actions = this.formatActions(characterData.actions);
    }

    // Add spellcasting data with spell lists
    if (characterData.spellcasting && characterData.spellcasting.length > 0) {
      response.spellcasting = this.formatSpellcasting(characterData.spellcasting);
    }

    // Exclude itemVariants and itemToggles - these are verbose and can be fetched via get-entity if needed

    return response;
  }

  private formatSpellcasting(spellcastingEntries: any[]): any[] {
    return spellcastingEntries.map(entry => {
      const formatted: any = {
        name: entry.name,
        type: entry.type,
      };

      // Spellcasting ability (dnd5e: int/wis/cha).
      if (entry.ability) {
        formatted.ability = entry.ability;
      }

      // Include spell slots if available
      if (entry.slots && Object.keys(entry.slots).length > 0) {
        formatted.slots = entry.slots;
      }

      // Format spells - minimal data for browsing, use get-entity for full details
      if (entry.spells && entry.spells.length > 0) {
        formatted.spells = entry.spells.map((spell: any) => {
          const spellData: any = {
            id: spell.id,
            name: spell.name,
            level: spell.level,
          };

          // Only include prepared status if it's false (assumed prepared by default)
          if (spell.prepared === false) {
            spellData.prepared = false;
          }

          // Include action cost
          if (spell.actionCost) {
            spellData.actionCost = spell.actionCost;
          }

          // Include targeting info - helps Claude decide whether to specify targets
          if (spell.range) {
            spellData.range = spell.range;
          }
          if (spell.target) {
            spellData.target = spell.target;
          }
          if (spell.area) {
            spellData.area = spell.area;
          }

          return spellData;
        });

        formatted.spellCount = entry.spells.length;
      }

      return formatted;
    });
  }

  private formatActions(actions: any[]): any[] {
    // Return minimal action data - just enough to identify and filter
    return actions.map(action => {
      const formatted: any = {
        name: action.name,
        type: action.type,
      };

      // Include traits if present (for filtering, e.g., "fire" attacks, "concentrate" actions)
      if (action.traits && action.traits.length > 0) {
        formatted.traits = action.traits;
      }

      // Include action cost (e.g., 1, 2, 3 actions, reaction, free)
      if (action.actions !== undefined) {
        formatted.actionCost = action.actions;
      }

      // Include itemId for cross-referencing with items
      if (action.itemId) {
        formatted.itemId = action.itemId;
      }

      return formatted;
    });
  }

  private formatItems(items: any[]): any[] {
    // Return ALL items with minimal data
    return items.map(item => {
      // Return minimal data - just enough to identify and filter items
      const formattedItem: any = {
        id: item.id,
        name: item.name,
        type: item.type,
      };

      // Include quantity if present
      if (item.system?.quantity !== undefined && item.system.quantity !== 1) {
        formattedItem.quantity = item.system.quantity;
      }

      // Include level for dnd5e spells (a plain number).
      if (typeof item.system?.level === 'number') {
        formattedItem.level = item.system.level;
      }

      // Include equipped status for equippable items
      if (item.system?.equipped !== undefined) {
        formattedItem.equipped = item.system.equipped;
      }

      // Include attuned status for D&D 5e magic items
      if (item.system?.attunement !== undefined) {
        formattedItem.attunement = item.system.attunement;
      }

      // dnd5e 2024 weapons: the mastery property (vex/topple/graze/...) — whether the ACTOR can
      // use it is stats.weaponMasteries (the weapon-kind unlock); surfacing both makes mastery
      // questions a single get call instead of a get-entity per weapon.
      if (typeof item.system?.mastery === 'string' && item.system.mastery) {
        formattedItem.mastery = item.system.mastery;
      }

      return formattedItem;
    });
  }

  // Minimal projection: name-level facts plus the dnd5e 6.0 hooks a skill needs to reason about
  // an effect without get-entity — its type when not a plain "base" effect, whether it is
  // conditional, and the roll-time rules it carries in readable form.
  private formatEffects(effects: any[]): any[] {
    return effects.map(effect => {
      const rules = (Array.isArray(effect.changes) ? effect.changes : [])
        .map((c: any) => c?.rule)
        .filter((r: unknown): r is string => typeof r === 'string');
      return {
        id: effect.id,
        name: effect.name,
        disabled: effect.disabled,
        ...(typeof effect.type === 'string' && effect.type !== 'base' ? { type: effect.type } : {}),
        ...(effect.magical ? { magical: true } : {}),
        ...(effect.conditions ? { conditional: true } : {}),
        ...(rules.length > 0 ? { rules } : {}),
        // The page sends the v14 projection ({ value, units, expiry?, remaining? }, or
        // { expiry, remaining? } for a value-less expiry) — never a `type`. Forward it as-is.
        duration: effect.duration
          ? {
              ...(effect.duration.value !== undefined ? { value: effect.duration.value } : {}),
              ...(effect.duration.units !== undefined ? { units: effect.duration.units } : {}),
              ...(effect.duration.expiry ? { expiry: effect.duration.expiry } : {}),
              ...(effect.duration.remaining !== undefined
                ? { remaining: effect.duration.remaining }
                : {}),
            }
          : null,
        hasIcon: !!effect.icon,
      };
    });
  }
}

/** True if a local file exists (same helper chat.ts uses for its export). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
