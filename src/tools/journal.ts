import { z } from 'zod';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import { FormattedToolError } from '../utils/error-handler.js';
import { toInputSchema } from '../utils/schema.js';
// Journal STRUCTURING (typed blocks -> styled HTML) lives in ./journal/blocks (pure). The skill
// supplies the words as blocks; this class arranges/styles them. No prose is generated here — the
// former quest/quest-content.ts prose generators were deleted (design.md §2.1 / Invariant 1).
import { renderStyledHtml, blockSchema, type Block } from './journal/blocks.js';

// Single source of truth for each tool's input contract: the handler parses with these
// schemas and getToolDefinitions() advertises toInputSchema(...) of the same schema.

// A journal page = a name + ordered typed blocks (the skill's words) + optional player visibility.
// The tool renders the blocks into the `.mcp-journal` house style; it NEVER generates the words.
const journalPageSchema = z.object({
  name: z.string().min(1).describe('Page title (the tab name in the journal).'),
  playerVisible: z
    .boolean()
    .optional()
    .describe('Players can observe the page (a handout); default GM-only.'),
  blocks: z
    .array(blockSchema)
    .min(1)
    .describe(
      'The page body, in order: heading / lead / paragraph / readaloud / gmnote / list / grid / html.'
    ),
});

const CreateQuestJournalSchema = z.object({
  title: z.string().min(1, 'Title is required').describe('Journal entry name.'),
  pages: z.array(journalPageSchema).min(1).describe('The pages, in order.'),
  folderName: z.string().optional().describe('Folder (created if absent).'),
});

const LinkQuestToNPCSchema = z.object({
  journalId: z.string().min(1).describe('The quest journal id.'),
  npcName: z.string().min(1).describe('World Actor name or id; an unresolved one is refused.'),
  relationship: z
    .enum(['questGiver', 'target', 'ally', 'enemy', 'contact'])
    .describe('Relationship between the NPC and the quest.'),
  pageId: z.string().optional().describe('Page id; default the first text page.'),
});

const UpdateQuestJournalSchema = z.object({
  journalId: z
    .string()
    .min(1, 'Journal ID is required')
    .describe('ID of the quest journal to update.'),
  blocks: z
    .array(blockSchema)
    .min(1)
    .describe('The section to append, as typed blocks (a heading block labels it).'),
  pageId: z.string().optional().describe('Page id; default the first text page.'),
  newPageName: z.string().optional().describe('Without pageId: a new page of this name.'),
  playerVisible: z
    .boolean()
    .optional()
    .describe('Page visibility (true = a handout); omitted, unchanged (a new page is GM-only).'),
});

const ListJournalsSchema = z.object({
  nameFilter: z.string().optional().describe('Case-insensitive substring match on journal name.'),
  filterQuests: z.boolean().optional().default(false).describe('Quest-like journals only.'),
  includeContent: z.boolean().optional().default(false).describe('A content preview per journal.'),
  journalId: z.string().optional().describe('Read this journal instead of listing.'),
  pageId: z.string().optional().describe('With journalId: read this page.'),
});

const SearchJournalsSchema = z.object({
  searchQuery: z.string().min(1, 'Search query is required').describe('The text to find.'),
  searchType: z.enum(['title', 'content', 'both']).optional().default('both'),
});

// A create-journal page is either a TEXT page (HTML body) or an IMAGE page (a picture — e.g. a map
// legend key). `kind` selects which; an image page requires `src` (a Data-relative image path).
// Both kinds carry per-page `playerVisible` (handout) and an optional explicit `sort` for ordering.
// This lets an image-only journal (e.g. a Tom-Cartos legend pack) build in ONE call instead of
// create-journal + N add-journal-image (which also leaves a spurious leading text page).
const createJournalPageSchema = z
  .object({
    name: z.string().min(1).describe('Page title.'),
    kind: z.enum(['text', 'image']).default('text'),
    content: z.string().optional().default('').describe('text: the HTML body.'),
    src: z.string().optional().describe('image: the Data-relative image path (required).'),
    caption: z.string().optional().describe('image: the caption.'),
    sort: z.number().optional().describe('Sort key; default the array order.'),
    playerVisible: z
      .boolean()
      .optional()
      .describe('Players can observe the page (a handout); default GM-only.'),
  })
  .refine(p => p.kind !== 'image' || (typeof p.src === 'string' && p.src.trim().length > 0), {
    message: 'An image page requires "src" (a Data-relative image path).',
  });

const CreateJournalSchema = z.object({
  name: z.string().min(1).describe('Journal entry name.'),
  pages: z.array(createJournalPageSchema).min(1).describe('The pages, in order.'),
  folderName: z.string().optional().describe('Folder (created if absent).'),
});

const UpdateJournalSchema = z
  .object({
    journalId: z
      .string()
      .min(1, 'Journal ID is required')
      .describe('Journal entry id or exact name.'),
    name: z.string().optional().describe('Rename the entry.'),
    content: z.string().optional().describe('HTML that replaces the target page.'),
    pageId: z.string().optional().describe('The target page id; default the first text page.'),
    newPageName: z.string().optional().describe('Without pageId: a new page of this name.'),
    playerVisible: z
      .boolean()
      .optional()
      .describe('Visibility of the written page (true = a handout); omitted, unchanged.'),
  })
  .refine(v => v.name !== undefined || v.content !== undefined, {
    message: 'Provide at least one of: name, content',
  });

const SetJournalPageVisibilitySchema = z.object({
  journalId: z
    .string()
    .min(1, 'Journal ID is required')
    .describe('Journal entry id or exact name.'),
  pageId: z.string().min(1).describe('Page id.'),
  playerVisible: z.boolean().describe('true = a handout players can observe; false = GM-only.'),
});

const DeleteJournalPageSchema = z.object({
  journalId: z
    .string()
    .min(1, 'Journal ID is required')
    .describe('Journal entry id or exact name.'),
  pageId: z.string().min(1).describe('Page id.'),
});

const DeleteJournalSchema = z.object({
  identifiers: z
    .array(z.string().min(1))
    .min(1, 'At least one identifier is required')
    .describe('Exact ids (preferred) or exact names of journals to delete.'),
});

export interface JournalToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
}

export class JournalTools {
  private foundry: FoundryBridge;
  private logger: Logger;

  constructor(options: JournalToolsOptions) {
    this.foundry = options.foundry;
    this.logger = options.logger;
  }

  /**
   * Get all tool definitions for MCP registration
   */
  getToolDefinitions() {
    return [
      {
        name: 'create-quest-journal',
        description:
          'Create a multi-page journal from typed blocks (heading / lead / paragraph / readaloud / ' +
          'gmnote / list / grid / html), rendered in the house style, with per-page visibility. ' +
          'Raw HTML pages: create-journal.',
        inputSchema: toInputSchema(CreateQuestJournalSchema),
      },
      {
        name: 'link-quest-to-npc',
        description:
          'Append a @UUID link to a world NPC, labelled with the relationship, in a GM note of a ' +
          'quest journal; an unresolved NPC is refused.',
        inputSchema: toInputSchema(LinkQuestToNPCSchema),
      },
      {
        name: 'update-quest-journal',
        description:
          'Append a styled section of typed blocks to a journal page (the first text page, pageId, ' +
          'or a new page via newPageName).',
        inputSchema: toInputSchema(UpdateQuestJournalSchema),
      },
      {
        name: 'list-journals',
        description:
          'Journals with their pages (id, name, type, playerVisible); with journalId, that journal ' +
          "(first text page + page list); with pageId too, that page's content.",
        inputSchema: toInputSchema(ListJournalsSchema),
      },
      {
        name: 'search-journals',
        description:
          'Search every journal page by title and/or content; reports the matching pages.',
        inputSchema: toInputSchema(SearchJournalsSchema),
      },
      {
        name: 'create-journal',
        description:
          'Create a JournalEntry from explicit pages: text (HTML) or image (kind:"image" + src), ' +
          'each with its own visibility. Styled blocks: create-quest-journal.',
        inputSchema: toInputSchema(CreateJournalSchema),
      },
      {
        name: 'update-journal',
        description:
          'Rename a JournalEntry and/or replace a page (the first text page, pageId, or a new page ' +
          'via newPageName) with HTML. Appending blocks: update-quest-journal. GM-only.',
        inputSchema: toInputSchema(UpdateJournalSchema),
      },
      {
        name: 'set-journal-page-visibility',
        description:
          'Set one journal page player-visible (a handout) or GM-only without touching its content. ' +
          'GM-only.',
        inputSchema: toInputSchema(SetJournalPageVisibilitySchema),
      },
      {
        name: 'delete-journal-page',
        description: 'Delete one page of a JournalEntry by id. GM-only.',
        inputSchema: toInputSchema(DeleteJournalPageSchema),
      },
      {
        name: 'delete-journal',
        description: 'Permanently delete journals by exact id or exact name. GM-only.',
        inputSchema: toInputSchema(DeleteJournalSchema),
      },
    ];
  }

  /** Map a playerVisible flag to a page ownership patch: true = OBSERVER (2), false = GM-only (0). */
  private ownershipFor(playerVisible?: boolean): { default: number } | undefined {
    if (playerVisible === undefined) return undefined;
    return { default: playerVisible ? 2 : 0 };
  }

  /**
   * Handle create quest journal request
   */
  async handleCreateQuestJournal(args: any): Promise<any> {
    const request = CreateQuestJournalSchema.parse(args);

    // STRUCTURE the caller's blocks into styled HTML; map playerVisible -> per-page ownership
    // (2 = players observe a handout). The words are the caller's blocks — no prose generated here.
    const pages = request.pages.map(p => ({
      name: p.name,
      content: renderStyledHtml(p.blocks),
      ...(p.playerVisible ? { ownership: { default: 2 } } : {}),
    }));

    const result = await this.foundry.call('createJournal', {
      name: request.title,
      pages,
      ...(request.folderName ? { folderName: request.folderName } : {}),
    });

    return {
      success: true,
      journalId: result.id,
      journalName: result.name,
      pageCount: result.pageCount,
      pages: result.pages,
      message: `Journal "${result.name}" created with ${result.pageCount} page(s).`,
    };
  }

  /**
   * Handle link quest to NPC request
   */
  async handleLinkQuestToNPC(args: any): Promise<any> {
    const request = LinkQuestToNPCSchema.parse(args);

    // Resolve the NPC to a REAL Actor — a quest link must point at a live document, never a dead
    // name (ask-don't-invent). findActor returns { id, name } or null.
    const actor = (await this.foundry.call('findActor', {
      identifier: request.npcName,
    })) as { id?: string; name?: string } | null;
    if (!actor?.id) {
      throw new FormattedToolError(
        `NPC "${request.npcName}" not found in the world — create the actor first (or check the ` +
          'name). A quest link must point at a real Actor; I will not insert a dead reference.'
      );
    }

    // Build a Foundry @UUID enricher link (clickable on render) inside a GM note, labelled with the
    // relationship. This is STRUCTURE (a real document link), not prose.
    const link = `@UUID[Actor.${actor.id}]{${actor.name ?? request.npcName}}`;
    const relationshipText = request.relationship
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    const linkBlocks: Block[] = [
      {
        type: 'gmnote',
        html: `<p><strong>Related NPC:</strong> ${link} — ${relationshipText}</p>`,
      },
    ];

    const current = await this.readPageContent(request.journalId, request.pageId);
    await this.foundry.call('updateJournalContent', {
      journalId: request.journalId,
      content: current + renderStyledHtml(linkBlocks),
      ...(request.pageId ? { pageId: request.pageId } : {}),
    });

    return {
      success: true,
      npc: { id: actor.id, name: actor.name ?? request.npcName },
      link,
      message: `Linked ${actor.name ?? request.npcName} to the quest as ${relationshipText}.`,
    };
  }

  /**
   * Append a new styled section (from typed blocks) to a quest/journal page — the progress /
   * session-recap path. Structuring only: the words are the caller's blocks; the tool styles + appends.
   */
  async handleUpdateQuestJournal(args: any): Promise<any> {
    const request = UpdateQuestJournalSchema.parse(args);
    const sectionHtml = renderStyledHtml(request.blocks);
    const ownership = this.ownershipFor(request.playerVisible);

    // New page: set its content directly (nothing to append to).
    if (request.newPageName) {
      const result = await this.foundry.call('updateJournalContent', {
        journalId: request.journalId,
        content: sectionHtml,
        newPageName: request.newPageName,
        ...(ownership ? { ownership } : {}),
      });
      return {
        success: true,
        message: `New page "${request.newPageName}" added.`,
        pageId: result.pageId,
        pageName: result.pageName,
      };
    }

    // Existing page: append the new styled section after the current content.
    const current = await this.readPageContent(request.journalId, request.pageId);
    const result = await this.foundry.call('updateJournalContent', {
      journalId: request.journalId,
      content: current + sectionHtml,
      ...(request.pageId ? { pageId: request.pageId } : {}),
      ...(ownership ? { ownership } : {}),
    });
    return {
      success: true,
      message: 'Appended a new section to the journal page.',
      pageId: result.pageId,
      pageName: result.pageName,
    };
  }

  /** Read a journal page's current HTML (a specific page by id, else the first text page). */
  private async readPageContent(journalId: string, pageId?: string): Promise<string> {
    if (pageId) {
      const pageResult = await this.foundry.call('getJournalPageContent', { journalId, pageId });
      return pageResult.content || '';
    }
    const journal = await this.foundry.call('getJournalContent', { journalId });
    return journal.content || '';
  }

  /**
   * Handle list journals request
   */
  async handleListJournals(args: any): Promise<any> {
    const request = ListJournalsSchema.parse(args);

    // Mode: Read a specific page
    if (request.journalId && request.pageId) {
      const pageResult = await this.foundry.call('getJournalPageContent', {
        journalId: request.journalId,
        pageId: request.pageId,
      });

      return {
        success: true,
        mode: 'page',
        journalId: request.journalId,
        page: pageResult,
      };
    }

    // Mode: Read a specific journal (first page + page manifest)
    if (request.journalId) {
      const journalContent = await this.foundry.call('getJournalContent', {
        journalId: request.journalId,
      });

      return {
        success: true,
        mode: 'journal',
        journalId: request.journalId,
        content: journalContent.content,
        currentPage: journalContent.currentPage,
        allPages: journalContent.allPages,
        pageCount: journalContent.pageCount,
        note: journalContent.note,
      };
    }

    // Mode: List all journals
    const journals = await this.foundry.call('listJournals', {
      ...(request.nameFilter !== undefined ? { nameFilter: request.nameFilter } : {}),
    });

    let filteredJournals: Array<(typeof journals)[number] & { contentPreview?: string }> = journals;

    // Filter for quest-related journals if requested
    if (request.filterQuests) {
      filteredJournals = journals.filter((journal: any) => this.isQuestRelated(journal.name));
    }

    // Include content if requested
    if (request.includeContent) {
      for (const journal of filteredJournals) {
        try {
          const content = await this.foundry.call('getJournalContent', {
            journalId: journal.id,
          });
          journal.contentPreview = `${content?.content?.substring(0, 150)}...` || '';
        } catch (_error) {
          journal.contentPreview = 'Error loading content';
        }
      }
    }

    return {
      success: true,
      mode: 'list',
      journals: filteredJournals,
      total: filteredJournals.length,
    };
  }

  /**
   * Handle search journals request
   */
  async handleSearchJournals(args: any): Promise<any> {
    const request = SearchJournalsSchema.parse(args);

    // Get all journals (now includes page metadata)
    const journals = await this.foundry.call('listJournals', {});

    const searchResults = [];
    const query = request.searchQuery.toLowerCase();

    for (const journal of journals) {
      let matches = false;
      const matchInfo: any = {
        id: journal.id,
        name: journal.name,
        pageCount: journal.pages.length,
        matchType: [],
        matchedPages: [],
      };

      // Search title
      if (request.searchType === 'title' || request.searchType === 'both') {
        if (journal.name.toLowerCase().includes(query)) {
          matches = true;
          matchInfo.matchType.push('title');
        }
      }

      // Search content across ALL pages
      if (request.searchType === 'content' || request.searchType === 'both') {
        const pages = journal.pages || [];
        for (const page of pages) {
          if (page.type !== 'text') continue;
          try {
            const pageContent = await this.foundry.call('getJournalPageContent', {
              journalId: journal.id,
              pageId: page.id,
            });

            if (pageContent?.content?.toLowerCase().includes(query)) {
              matches = true;
              if (!matchInfo.matchType.includes('content')) {
                matchInfo.matchType.push('content');
              }
              matchInfo.matchedPages.push({
                pageId: page.id,
                pageName: page.name,
                contentSnippet: this.extractSnippet(pageContent.content, request.searchQuery),
              });
            }
          } catch (_error) {
            // Skip pages with content errors
          }
        }
      }

      if (matches) {
        searchResults.push(matchInfo);
      }
    }

    return {
      success: true,
      searchQuery: request.searchQuery,
      searchType: request.searchType,
      results: searchResults,
      totalMatches: searchResults.length,
    };
  }

  /**
   * Handle create generic journal request
   */
  async handleCreateJournal(args: any): Promise<any> {
    const request = CreateJournalSchema.parse(args);

    // Map each page to the bridge shape: a TEXT page forwards `content`; an IMAGE page forwards
    // `kind:'image'` + `src` (+ optional caption). `playerVisible` -> ownership.default 2 (observe);
    // an explicit `sort` is forwarded when given (otherwise the page side keeps the array order).
    const pages = request.pages.map(p => ({
      name: p.name,
      ...(p.kind === 'image'
        ? { kind: 'image' as const, src: p.src, ...(p.caption ? { caption: p.caption } : {}) }
        : { content: p.content }),
      ...(typeof p.sort === 'number' ? { sort: p.sort } : {}),
      ...(p.playerVisible ? { ownership: { default: 2 } } : {}),
    }));

    const result = await this.foundry.call('createJournal', {
      name: request.name,
      pages,
      ...(request.folderName ? { folderName: request.folderName } : {}),
    });

    // Surface any page-side asset warnings (e.g. an image page src that 404s — KEEP+WARN).
    const warns = Array.isArray(result?.warnings) ? result.warnings : [];
    let message = `Journal "${result.name}" created with ${result.pageCount} page(s)`;
    if (warns.length) {
      message += `\n\n⚠️ ${warns.length} warning(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`;
    }

    return {
      success: true,
      journalId: result.id,
      journalName: result.name,
      pageCount: result.pageCount,
      pages: result.pages,
      message,
    };
  }

  /**
   * Handle generic journal update (rename and/or set page content)
   */
  async handleUpdateJournal(args: any): Promise<any> {
    const request = UpdateJournalSchema.parse(args);
    const ownership = this.ownershipFor(request.playerVisible);

    const result = await this.foundry.call('updateJournal', {
      journalId: request.journalId,
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.content !== undefined ? { content: request.content } : {}),
      ...(request.pageId !== undefined ? { pageId: request.pageId } : {}),
      ...(request.newPageName !== undefined ? { newPageName: request.newPageName } : {}),
      ...(ownership ? { ownership } : {}),
    });

    return {
      success: true,
      journalId: request.journalId,
      renamed: result.renamed ?? false,
      pageId: result.pageId,
      pageName: result.pageName,
      message: 'Journal updated',
    };
  }

  /**
   * Flip a single journal page's player visibility without rewriting its content.
   */
  async handleSetJournalPageVisibility(args: any): Promise<any> {
    const request = SetJournalPageVisibilitySchema.parse(args);

    const result = await this.foundry.call('setJournalPageVisibility', {
      journalId: request.journalId,
      pageId: request.pageId,
      playerVisible: request.playerVisible,
    });

    return {
      success: true,
      journalId: request.journalId,
      pageId: result.pageId,
      pageName: result.pageName,
      playerVisible: request.playerVisible,
      message: `Page "${result.pageName}" is now ${request.playerVisible ? 'player-visible (handout)' : 'GM-only'}.`,
    };
  }

  /**
   * Delete one page from a journal by id, leaving the rest of the entry intact.
   */
  async handleDeleteJournalPage(args: any): Promise<any> {
    const request = DeleteJournalPageSchema.parse(args);

    const result = await this.foundry.call('deleteJournalPage', {
      journalId: request.journalId,
      pageId: request.pageId,
    });
    if (result.deleted === false) {
      return {
        success: true,
        deleted: false,
        notFound: result.notFound,
        message: `Page not found: "${result.notFound}". Nothing deleted.`,
      };
    }

    return {
      success: true,
      deleted: true,
      page: result.page,
      message: `Deleted page "${result.page?.name}" (${result.page?.id}).`,
    };
  }

  /**
   * Handle delete journal request
   */
  async handleDeleteJournal(args: any): Promise<any> {
    const request = DeleteJournalSchema.parse(args);

    const result = await this.foundry.call('deleteJournals', {
      identifiers: request.identifiers,
    });

    return {
      success: true,
      deletedCount: result.deletedCount,
      deleted: result.deleted,
      notFound: result.notFound,
      message: `Deleted ${result.deletedCount} journal(s)`,
    };
  }

  /**
   * Check if a journal appears to be quest-related
   */
  private isQuestRelated(journalName: string): boolean {
    const questKeywords = ['quest', 'mission', 'task', 'adventure', 'job', 'contract'];
    const nameLower = journalName.toLowerCase();
    return questKeywords.some(keyword => nameLower.includes(keyword));
  }

  /**
   * Extract content snippet around search term
   */
  private extractSnippet(content: string, searchTerm: string, maxLength: number = 200): string {
    const index = content.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (index === -1) return '';

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + maxLength);

    return `...${content.substring(start, end)}...`;
  }
}
