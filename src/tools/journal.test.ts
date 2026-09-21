/**
 * Unit tests for JournalTools — manage-journals (the M8 union: action create / list / get / update
 * / delete / delete-page) and the five tools that stay their own (the styled-block quest tools,
 * search-journals, set-journal-page-visibility).
 *
 * Each handler: zod.parse(args) -> one or more foundry.call('<op>', data) calls -> a result. The
 * tests assert (a) the correct bridge method + payload is forwarded and the result matches what the
 * format code builds (the union's §3 shapes: the list lines, the one-line confirmations, get's
 * JSON, a miss as an error), and (b) zod rejects bad input. Handlers do not map their own errors —
 * a validation failure (or a page-reported failure) just throws and bubbles to the central mapper.
 */

import { describe, it, expect } from 'vitest';
import { JournalTools, MANAGE_JOURNALS } from './journal.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new JournalTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handleManageJournals(args);
  return { tools, calls, foundry, run };
}

describe('JournalTools.getToolDefinitions', () => {
  it('exposes the union and the five tools that stay', () => {
    const { tools } = build();
    const names = tools
      .getToolDefinitions()
      .map(t => t.name)
      .sort();
    expect(names).toEqual([
      'create-quest-journal',
      'link-quest-to-npc',
      MANAGE_JOURNALS,
      'search-journals',
      'set-journal-page-visibility',
      'update-quest-journal',
    ]);
  });

  it('every definition has an object inputSchema', () => {
    const { tools } = build();
    for (const def of tools.getToolDefinitions()) {
      expect(def.inputSchema.type).toBe('object');
    }
  });
});

describe('manage-journals (the M8 union: action create / list / get / update / delete / delete-page)', () => {
  it('advertises the action enum, the shared journalId leaf, closed members', () => {
    const def = build()
      .tools.getToolDefinitions()
      .find(t => t.name === MANAGE_JOURNALS)!;
    const schema = def.inputSchema as any;
    expect(schema.properties.action.enum).toEqual([
      'create',
      'list',
      'get',
      'update',
      'delete',
      'delete-page',
    ]);
    expect(schema.properties.journalId.description).toBe('Journal entry id or exact name.');
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    expect(byAction.get.properties.journalId).toEqual({ type: 'string' });
    expect(byAction.get.required).toEqual(['action', 'journalId']);
    expect(byAction['delete-page'].required).toEqual(['action', 'journalId', 'pageId']);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'search', journalId: 'x' })).rejects.toThrow(
      'manage-journals: action must be one of "create", "list", "get", "update", "delete", "delete-page" (got "search").'
    );
    await expect(run({ action: 'list', journalId: 'x' })).rejects.toThrow(
      'manage-journals (action "list"): unknown argument "journalId" — it takes: action, nameFilter, filterQuests.'
    );
  });
});

describe('manage-journals list (the §3 line shape)', () => {
  it('one line per journal with its page count; forwards the name filter', async () => {
    const journals = [
      { id: 'a', name: 'Quest One', pages: [{ id: 'p1' }, { id: 'p2' }] },
      { id: 'b', name: 'Lore', pages: [] },
    ];
    const { calls, run } = build((method: string) => (method === 'listJournals' ? journals : {}));
    const out = await run({ action: 'list', nameFilter: 'o' });
    expect(calls[0][0]).toBe('listJournals');
    expect(calls[0][1]).toEqual({ nameFilter: 'o' });
    expect(out).toBe('2 journal(s): id name pages\na "Quest One" 2\nb Lore 0');
  });

  it('filters to quest-related journals when filterQuests is true; an empty result is the header alone', async () => {
    const journals = [
      { id: 'a', name: 'Quest One', pages: [] },
      { id: 'b', name: 'Lore Notes', pages: [] },
      { id: 'c', name: 'The Mission', pages: [] },
    ];
    const { run } = build((method: string) => (method === 'listJournals' ? journals : {}));
    expect(await run({ action: 'list', filterQuests: true })).toBe(
      '2 journal(s): id name pages\na "Quest One" 0\nc "The Mission" 0'
    );
    expect(
      await build((m: string) => (m === 'listJournals' ? [] : {})).run({ action: 'list' })
    ).toBe('0 journal(s).');
  });
});

describe('manage-journals get (JSON)', () => {
  it('reads a journal: the first text page + the page list', async () => {
    const { calls, run } = build((method: string) =>
      method === 'getJournalContent'
        ? {
            content: '<p>body</p>',
            currentPage: 'Quest',
            allPages: [{ id: 'p1', name: 'Quest', type: 'text', playerVisible: false }],
            pageCount: 1,
          }
        : {}
    );
    const out = await run({ action: 'get', journalId: 'j1' });
    expect(calls[0][0]).toBe('getJournalContent');
    expect(calls[0][1]).toEqual({ journalId: 'j1' });
    expect(out).toEqual({
      journalId: 'j1',
      content: '<p>body</p>',
      currentPage: 'Quest',
      pages: [{ id: 'p1', name: 'Quest', type: 'text', playerVisible: false }],
      pageCount: 1,
    });
  });

  it('reads one page when pageId is supplied', async () => {
    const page = { id: 'p1', name: 'Quest', type: 'text', content: '<p>page body</p>' };
    const { calls, run } = build((method: string) =>
      method === 'getJournalPageContent' ? page : {}
    );
    expect(await run({ action: 'get', journalId: 'j1', pageId: 'p1' })).toEqual({
      journalId: 'j1',
      page,
    });
    expect(calls[0][1]).toEqual({ journalId: 'j1', pageId: 'p1' });
  });
});

describe('manage-journals create', () => {
  it('forwards name + pages and confirms on one line with each page id', async () => {
    const { calls, run } = build({
      id: 'j1',
      name: 'My Journal',
      pageCount: 2,
      pages: [
        { id: 'p1', name: 'Intro' },
        { id: 'p2', name: 'Details' },
      ],
    });
    const out = await run({
      action: 'create',
      name: 'My Journal',
      pages: [
        { name: 'Intro', content: '<p>Hi</p>' },
        { name: 'Details', content: '<p>More</p>' },
      ],
    });
    expect(calls[0][0]).toBe('createJournal');
    expect(calls[0][1].name).toBe('My Journal');
    expect(calls[0][1].pages).toHaveLength(2);
    expect(out).toBe('Created journal "My Journal" (j1): 2 page(s): "Intro" (p1), "Details" (p2)');
  });

  it('defaults missing page content to an empty string and passes folderName', async () => {
    const { calls, run } = build({ id: 'j2', name: 'J', pageCount: 1, pages: [] });
    await run({ action: 'create', name: 'J', pages: [{ name: 'OnlyName' }], folderName: 'Lore' });
    expect(calls[0][1].pages[0]).toEqual({ name: 'OnlyName', content: '' });
    expect(calls[0][1].folderName).toBe('Lore');
  });

  it('forwards an image page (kind:image -> src + caption + ownership) beside text pages', async () => {
    const { calls, run } = build({ id: 'j3', name: 'Keys', pageCount: 2, pages: [] });
    await run({
      action: 'create',
      name: 'Keys',
      pages: [
        { name: 'Overview', content: '<p>Map keys</p>' },
        {
          name: 'Iris Key',
          kind: 'image',
          src: 'worlds/w/assets/iris_Key.webp',
          caption: 'Iris',
          playerVisible: true,
        },
      ],
    });
    const pages = calls[0][1].pages;
    // text page unchanged (no kind/src leaks in)
    expect(pages[0]).toEqual({ name: 'Overview', content: '<p>Map keys</p>' });
    // image page carries kind + src + caption + ownership, NOT a content field
    expect(pages[1]).toEqual({
      name: 'Iris Key',
      kind: 'image',
      src: 'worlds/w/assets/iris_Key.webp',
      caption: 'Iris',
      ownership: { default: 2 },
    });
  });

  it('forwards an explicit sort key when given', async () => {
    const { calls, run } = build({ id: 'j', name: 'J', pageCount: 1, pages: [] });
    await run({ action: 'create', name: 'J', pages: [{ name: 'P', content: 'x', sort: 200 }] });
    expect(calls[0][1].pages[0]).toEqual({ name: 'P', content: 'x', sort: 200 });
  });

  it('appends page-side asset warnings (a non-resolving image src is kept, not substituted)', async () => {
    const { run } = build({
      id: 'j4',
      name: 'Keys',
      pageCount: 1,
      pages: [{ id: 'p1', name: 'Bad' }],
      warnings: [
        'Supplied src "x/nope.webp" was not found on the server — the document was created.',
      ],
    });
    const out = String(
      await run({
        action: 'create',
        name: 'Keys',
        pages: [{ name: 'Bad', kind: 'image', src: 'x/nope.webp' }],
      })
    );
    expect(out.startsWith('Created journal "Keys" (j4): 1 page(s): "Bad" (p1)')).toBe(true);
    expect(out).toContain('⚠️ 1 warning(s):');
    expect(out).toContain('not found on the server');
  });

  it('rejects an image page with no src (refine), an empty name, no pages, a nameless page', async () => {
    const { run } = build();
    await expect(
      run({ action: 'create', name: 'J', pages: [{ name: 'Img', kind: 'image' }] })
    ).rejects.toThrow();
    await expect(run({ action: 'create', name: '', pages: [{ name: 'p' }] })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'J', pages: [] })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'J', pages: [{ name: '' }] })).rejects.toThrow();
  });
});

describe('manage-journals update', () => {
  it('forwards a rename + content update and confirms on one line', async () => {
    const { calls, run } = build({ success: true, renamed: true, pageId: 'p1', pageName: 'Body' });
    const out = await run({
      action: 'update',
      journalId: 'j1',
      name: 'Renamed',
      content: '<p>new</p>',
    });
    expect(calls[0][0]).toBe('updateJournal');
    expect(calls[0][1]).toMatchObject({ journalId: 'j1', name: 'Renamed', content: '<p>new</p>' });
    expect(out).toBe('Updated journal j1: renamed to "Renamed"; page "Body" (p1) written');
  });

  it('omits unset optional fields from the bridge payload', async () => {
    const { calls, run } = build({ success: true, renamed: true });
    expect(await run({ action: 'update', journalId: 'j1', name: 'OnlyName' })).toBe(
      'Updated journal j1: renamed to "OnlyName"'
    );
    expect(calls[0][1]).toEqual({ journalId: 'j1', name: 'OnlyName' });
  });

  it('forwards ownership when playerVisible is given', async () => {
    const { calls, run } = build({ success: true, pageId: 'p1', pageName: 'Handout' });
    expect(
      await run({
        action: 'update',
        journalId: 'j1',
        newPageName: 'Handout',
        content: '<p>x</p>',
        playerVisible: true,
      })
    ).toBe('Updated journal j1: page "Handout" (p1) written');
    expect(calls[0][1].ownership).toEqual({ default: 2 });
  });

  it('propagates a page throw untouched', async () => {
    const { run } = build(() => {
      throw new Error('nope');
    });
    await expect(run({ action: 'update', journalId: 'j1', name: 'X' })).rejects.toThrow(/^nope$/);
  });

  it('rejects when neither name nor content is provided (refine), and an empty journalId', async () => {
    const { run } = build();
    await expect(run({ action: 'update', journalId: 'j1', pageId: 'p1' })).rejects.toThrow();
    await expect(run({ action: 'update', journalId: '', name: 'X' })).rejects.toThrow();
  });
});

describe('handleCreateQuestJournal (structuring — blocks -> styled HTML, no prose)', () => {
  it("renders each page's blocks into the house style + maps playerVisible to ownership", async () => {
    const { tools, calls } = build({
      id: 'j1',
      name: 'The Grove',
      pageCount: 2,
      pages: [{ id: 'p1' }, { id: 'p2' }],
    });
    const out = await tools.handleCreateQuestJournal({
      title: 'The Grove',
      pages: [
        {
          name: 'Overview',
          blocks: [
            { type: 'lead', html: 'A cursed grove.' },
            { type: 'readaloud', html: '<p>Cold air bites.</p>' },
            { type: 'list', items: ['Find the druid'] },
          ],
        },
        {
          name: 'Handout',
          playerVisible: true,
          blocks: [{ type: 'paragraph', html: 'For the players.' }],
        },
      ],
      folderName: 'Quests',
    });

    expect(calls[0][0]).toBe('createJournal');
    expect(calls[0][1].name).toBe('The Grove');
    expect(calls[0][1].folderName).toBe('Quests');
    const pages = calls[0][1].pages;
    expect(pages).toHaveLength(2);
    // page 1: GM-only (no ownership), styled content carrying ONLY the caller's words
    expect(pages[0].name).toBe('Overview');
    expect(pages[0].ownership).toBeUndefined();
    expect(pages[0].content).toContain('class="mcp-journal"');
    expect(pages[0].content).toContain('A cursed grove.');
    expect(pages[0].content).toContain('Cold air bites.');
    expect(pages[0].content).toContain('Find the druid');
    // page 2: player-visible handout -> ownership default 2 (observe)
    expect(pages[1].ownership).toEqual({ default: 2 });
    expect(pages[1].content).toContain('For the players.');

    expect(out).toMatchObject({
      success: true,
      journalId: 'j1',
      journalName: 'The Grove',
      pageCount: 2,
    });
  });

  it('never invents prose — the page HTML contains only the caller words', async () => {
    const { tools, calls } = build({ id: 'j', name: 'X', pageCount: 1, pages: [] });
    await tools.handleCreateQuestJournal({
      title: 'X',
      pages: [{ name: 'P', blocks: [{ type: 'paragraph', html: 'JustThis.' }] }],
    });
    const content = calls[0][1].pages[0].content;
    expect(content).toContain('JustThis.');
    for (const fabricated of [
      'approaches the party',
      'urgent news',
      'Report back',
      'innocent people',
    ]) {
      expect(content).not.toContain(fabricated);
    }
  });

  it('propagates a page throw untouched (the page throws on failure; nothing is rewrapped)', async () => {
    const { tools } = build(() => {
      throw new Error('boom');
    });
    await expect(
      tools.handleCreateQuestJournal({
        title: 'X',
        pages: [{ name: 'P', blocks: [{ type: 'paragraph', html: 'y' }] }],
      })
    ).rejects.toThrow(/^boom$/);
  });

  it('rejects missing pages / an empty title / a bad block type / empty blocks', async () => {
    const { tools } = build();
    await expect(tools.handleCreateQuestJournal({ title: 'X' })).rejects.toThrow();
    await expect(
      tools.handleCreateQuestJournal({
        title: '',
        pages: [{ name: 'P', blocks: [{ type: 'paragraph', html: 'y' }] }],
      })
    ).rejects.toThrow();
    await expect(
      tools.handleCreateQuestJournal({
        title: 'X',
        pages: [{ name: 'P', blocks: [{ type: 'bogus', html: 'y' }] }],
      })
    ).rejects.toThrow();
    await expect(
      tools.handleCreateQuestJournal({ title: 'X', pages: [{ name: 'P', blocks: [] }] })
    ).rejects.toThrow();
  });
});

describe('handleLinkQuestToNPC (real @UUID link, never a dead name)', () => {
  it('resolves the NPC and appends a @UUID[Actor.id] enricher link', async () => {
    const { tools, calls } = build((method: string) => {
      if (method === 'findActor') return { id: 'abc123', name: 'Old Druid' };
      if (method === 'getJournalContent') return { content: '<section>old</section>' };
      if (method === 'updateJournalContent')
        return { success: true, pageId: 'p1', pageName: 'Quest' };
      return {};
    });

    const out = await tools.handleLinkQuestToNPC({
      journalId: 'j1',
      npcName: 'Old Druid',
      relationship: 'questGiver',
    });

    expect(calls.find(c => c[0] === 'findActor')![1]).toEqual({ identifier: 'Old Druid' });
    const updateCall = calls.find(c => c[0] === 'updateJournalContent')!;
    expect(updateCall[1].journalId).toBe('j1');
    expect(updateCall[1].content).toContain('@UUID[Actor.abc123]{Old Druid}');
    expect(updateCall[1].content).toContain('old'); // appended after existing content
    expect(out).toMatchObject({
      success: true,
      npc: { id: 'abc123', name: 'Old Druid' },
      link: '@UUID[Actor.abc123]{Old Druid}',
    });
  });

  it('throws (no dead link) when the NPC does not resolve', async () => {
    const { tools } = build((method: string) => (method === 'findActor' ? null : {}));
    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j1', npcName: 'Ghost', relationship: 'ally' })
    ).rejects.toThrow(/not found in the world/);
  });

  it('rejects an invalid relationship / empty npcName', async () => {
    const { tools } = build();
    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j', npcName: 'X', relationship: 'frenemy' })
    ).rejects.toThrow();
    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j', npcName: '', relationship: 'ally' })
    ).rejects.toThrow();
  });
});

describe('handleUpdateQuestJournal (append a styled section from blocks)', () => {
  it('creates a new page from blocks when newPageName is given (single write)', async () => {
    const { tools, calls } = build((method: string) =>
      method === 'updateJournalContent'
        ? { success: true, pageId: 'p9', pageName: 'Session 2' }
        : {}
    );

    const out = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newPageName: 'Session 2',
      blocks: [
        { type: 'heading', text: 'Session 2' },
        { type: 'paragraph', html: 'The party reached the keep.' },
      ],
    });

    // Only the create-page write — no read.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('updateJournalContent');
    expect(calls[0][1].newPageName).toBe('Session 2');
    expect(calls[0][1].content).toContain('The party reached the keep.');
    expect(calls[0][1].content).toContain('class="mcp-journal"');
    expect(out).toMatchObject({ success: true, pageId: 'p9', pageName: 'Session 2' });
  });

  it('appends a styled section to the first text page (read then write)', async () => {
    let stored = '<section class="mcp-journal"><div>old</div></section>';
    const { tools, calls } = build((method: string, data: any) => {
      if (method === 'getJournalContent') return { content: stored };
      if (method === 'updateJournalContent') {
        stored = data.content;
        return { success: true, pageId: 'p1', pageName: 'Quest' };
      }
      return {};
    });

    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      blocks: [{ type: 'paragraph', html: 'New milestone reached.' }],
    });

    expect(calls.map(c => c[0])).toEqual(['getJournalContent', 'updateJournalContent']);
    const writeCall = calls[1];
    expect(writeCall[1].content).toContain('old'); // existing content preserved
    expect(writeCall[1].content).toContain('New milestone reached.'); // appended
  });

  it('appends to a specific page when pageId is supplied', async () => {
    let stored = '<p>existing page text</p>';
    const { tools, calls } = build((method: string, data: any) => {
      if (method === 'getJournalPageContent') return { content: stored };
      if (method === 'updateJournalContent') {
        stored = data.content;
        return { success: true, pageId: 'p2', pageName: 'Notes' };
      }
      return {};
    });

    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'p2',
      blocks: [{ type: 'paragraph', html: 'A clue was found.' }],
    });

    expect(calls.map(c => c[0])).toEqual(['getJournalPageContent', 'updateJournalContent']);
    expect(calls[1][1].pageId).toBe('p2');
    expect(calls[1][1].content).toContain('existing page text');
    expect(calls[1][1].content).toContain('A clue was found.');
  });

  it('forwards ownership {default:2} to a NEW page when playerVisible:true (a handout)', async () => {
    const { tools, calls } = build((method: string) =>
      method === 'updateJournalContent' ? { success: true, pageId: 'p9', pageName: 'Flavor' } : {}
    );
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newPageName: 'Flavor',
      playerVisible: true,
      blocks: [{ type: 'paragraph', html: 'A weathered map.' }],
    });
    expect(calls[0][1].ownership).toEqual({ default: 2 });
  });

  it('omits ownership entirely when playerVisible is not given (inherits GM-only)', async () => {
    const { tools, calls } = build((method: string) =>
      method === 'updateJournalContent'
        ? { success: true, pageId: 'p9', pageName: 'Session 2' }
        : {}
    );
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newPageName: 'Session 2',
      blocks: [{ type: 'paragraph', html: 'x' }],
    });
    expect('ownership' in calls[0][1]).toBe(false);
  });

  it('rejects empty blocks / a bad block', async () => {
    const { tools } = build();
    await expect(tools.handleUpdateQuestJournal({ journalId: 'j1', blocks: [] })).rejects.toThrow();
    await expect(
      tools.handleUpdateQuestJournal({ journalId: 'j1', blocks: [{ type: 'nope', html: 'x' }] })
    ).rejects.toThrow();
  });
});

describe('handleSearchJournals', () => {
  it('matches by title and reports the totals', async () => {
    const journals = [
      { id: 'a', name: 'Goblin Ambush', pageCount: 0, pages: [] },
      { id: 'b', name: 'Tavern Talk', pageCount: 0, pages: [] },
    ];
    const { tools, calls } = build((method: string) => (method === 'listJournals' ? journals : {}));
    const out = await tools.handleSearchJournals({ searchQuery: 'goblin', searchType: 'title' });
    expect(calls[0][0]).toBe('listJournals');
    expect(out).toMatchObject({
      success: true,
      searchQuery: 'goblin',
      searchType: 'title',
      totalMatches: 1,
    });
    expect(out.results[0]).toMatchObject({ id: 'a', name: 'Goblin Ambush' });
    expect(out.results[0].matchType).toContain('title');
  });

  it('matches by page content and records the matched page', async () => {
    const journals = [
      {
        id: 'a',
        name: 'Notes',
        pageCount: 1,
        pages: [{ id: 'p1', name: 'Body', type: 'text' }],
      },
    ];
    const { tools } = build((method: string) => {
      if (method === 'listJournals') return journals;
      if (method === 'getJournalPageContent')
        return { content: 'The dragon sleeps in the cavern.' };
      return {};
    });
    const out = await tools.handleSearchJournals({ searchQuery: 'dragon', searchType: 'content' });
    expect(out.totalMatches).toBe(1);
    expect(out.results[0].matchType).toContain('content');
    expect(out.results[0].matchedPages[0]).toMatchObject({ pageId: 'p1', pageName: 'Body' });
    expect(out.results[0].matchedPages[0].contentSnippet).toContain('dragon');
  });

  it('returns zero matches when nothing matches', async () => {
    const journals = [{ id: 'a', name: 'Notes', pageCount: 0, pages: [] }];
    const { tools } = build((method: string) => (method === 'listJournals' ? journals : {}));
    const out = await tools.handleSearchJournals({ searchQuery: 'zzz', searchType: 'both' });
    expect(out.totalMatches).toBe(0);
    expect(out.results).toEqual([]);
  });

  it('rejects an empty searchQuery', async () => {
    const { tools } = build();
    await expect(tools.handleSearchJournals({ searchQuery: '' })).rejects.toThrow();
  });

  it('rejects an invalid searchType enum value', async () => {
    const { tools } = build();
    await expect(
      tools.handleSearchJournals({ searchQuery: 'x', searchType: 'everywhere' })
    ).rejects.toThrow();
  });
});

describe('handleSetJournalPageVisibility', () => {
  it('forwards journalId/pageId/playerVisible and reports the new state', async () => {
    const { tools, calls } = build({ success: true, pageId: 'p1', pageName: 'Flavor' });
    const out = await tools.handleSetJournalPageVisibility({
      journalId: 'j1',
      pageId: 'p1',
      playerVisible: true,
    });
    expect(calls[0][0]).toBe('setJournalPageVisibility');
    expect(calls[0][1]).toEqual({ journalId: 'j1', pageId: 'p1', playerVisible: true });
    expect(out).toMatchObject({ success: true, pageId: 'p1', playerVisible: true });
    expect(out.message).toContain('player-visible');
  });

  it('reports GM-only when hiding a page', async () => {
    const { tools } = build({ success: true, pageId: 'p1', pageName: 'Secrets' });
    const out = await tools.handleSetJournalPageVisibility({
      journalId: 'j1',
      pageId: 'p1',
      playerVisible: false,
    });
    expect(out.message).toContain('GM-only');
  });

  it('propagates a page throw untouched', async () => {
    const { tools } = build(() => {
      throw new Error('Page not found: p9');
    });
    await expect(
      tools.handleSetJournalPageVisibility({ journalId: 'j1', pageId: 'p9', playerVisible: true })
    ).rejects.toThrow(/^Page not found: p9$/);
  });

  it('rejects a missing playerVisible / empty ids', async () => {
    const { tools } = build();
    await expect(
      tools.handleSetJournalPageVisibility({ journalId: 'j1', pageId: 'p1' })
    ).rejects.toThrow();
    await expect(
      tools.handleSetJournalPageVisibility({ journalId: '', pageId: 'p1', playerVisible: true })
    ).rejects.toThrow();
  });
});

describe('manage-journals delete-page', () => {
  it('forwards journalId/pageId and confirms on one line', async () => {
    const { calls, run } = build({
      success: true,
      deleted: true,
      page: { id: 'p2', name: 'Stray' },
    });
    const out = await run({ action: 'delete-page', journalId: 'j1', pageId: 'p2' });
    expect(calls[0][0]).toBe('deleteJournalPage');
    expect(calls[0][1]).toEqual({ journalId: 'j1', pageId: 'p2' });
    expect(out).toBe('Deleted page "Stray" (p2) of journal j1');
  });

  it('a page that does not resolve is an error (§3), never prose in a success shape', async () => {
    const { run } = build({ success: true, deleted: false, notFound: 'p9' });
    await expect(run({ action: 'delete-page', journalId: 'j1', pageId: 'p9' })).rejects.toThrow(
      'Page not found: "p9". Nothing deleted.'
    );
  });

  it('rejects empty ids', async () => {
    const { run } = build();
    await expect(run({ action: 'delete-page', journalId: 'j1', pageId: '' })).rejects.toThrow();
  });
});

describe('manage-journals delete', () => {
  it('forwards identifiers and confirms the deletions on one line', async () => {
    const { calls, run } = build({
      deletedCount: 2,
      deleted: [
        { name: 'Quest One', id: 'a' },
        { name: 'Quest Two', id: 'b' },
      ],
      notFound: [],
    });
    const out = await run({ action: 'delete', identifiers: ['a', 'b'] });
    expect(calls[0][0]).toBe('deleteJournals');
    expect(calls[0][1]).toEqual({ identifiers: ['a', 'b'] });
    expect(out).toBe('Deleted 2 journal(s): "Quest One" (a), "Quest Two" (b)');
  });

  it('appends the not-found tail', async () => {
    const { run } = build({ deletedCount: 0, deleted: [], notFound: ['ghost'] });
    expect(await run({ action: 'delete', identifiers: ['ghost'] })).toBe(
      'Deleted 0 journal(s) (1 not found: ghost)'
    );
  });

  it('propagates a page throw untouched', async () => {
    const { run } = build(() => {
      throw new Error('failed');
    });
    await expect(run({ action: 'delete', identifiers: ['a'] })).rejects.toThrow(/^failed$/);
  });

  it('rejects an empty identifiers array and an empty-string identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});
