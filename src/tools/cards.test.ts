/**
 * Unit tests for CardsTools — manage-cards (the M8 union: action create / import / list / delete).
 * Covers the two things the handlers own before the bridge is reached: zod validation (required
 * fields, enum membership, non-empty strings/arrays; the member selected by `action` and its
 * refusals by name) and the §3 shapes (the list lines, the one-line confirmations).
 */

import { describe, it, expect } from 'vitest';
import { CardsTools, MANAGE_CARDS } from './cards.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new CardsTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handle(MANAGE_CARDS, args);
  return { tools, calls, run };
}

describe('manage-cards (the M8 union: action create / import / list / delete)', () => {
  it('advertises one tool: the action enum, the shared folderName leaf, closed members', () => {
    const [def] = build().tools.getToolDefinitions();
    expect(def!.name).toBe(MANAGE_CARDS);
    const schema = def!.inputSchema as any;
    expect(schema.properties.action.enum).toEqual(['create', 'import', 'list', 'delete']);
    expect(schema.properties.folderName.description).toBe('Folder (created if absent).');
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    expect(byAction.create.properties.folderName).toEqual({ type: 'string' });
    expect(byAction.import.properties.folderName).toEqual({ type: 'string' });
    expect(byAction.import.required).toEqual(['action', 'preset']);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'draw' })).rejects.toThrow(
      'manage-cards: action must be one of "create", "import", "list", "delete" (got "draw").'
    );
    await expect(run({ action: 'import', preset: 'pokerDark', type: 'hand' })).rejects.toThrow(
      'manage-cards (action "import"): unknown argument "type" — it takes: action, preset, name, folderName.'
    );
  });
});

describe('manage-cards create', () => {
  it('forwards a valid request and confirms on one line', async () => {
    const { calls, run } = build({
      type: 'deck',
      cardsName: 'Tarokka',
      cardsId: 'c1',
      cardCount: 54,
    });
    const out = await run({ action: 'create', name: 'Tarokka', type: 'deck' });
    expect(calls[0]![0]).toBe('createCards');
    expect(calls[0]![1]).toMatchObject({ name: 'Tarokka', type: 'deck' });
    expect(out).toBe('Created deck "Tarokka" (c1) with 54 card(s)');
  });

  it('passes description, folderName and cards (text + img) through; appends the warnings', async () => {
    const { calls, run } = build({
      type: 'pile',
      cardsName: 'Loot',
      cardsId: 'x',
      cardCount: 1,
      warnings: ['cards/gem.png did not resolve (404).'],
    });
    const out = await run({
      action: 'create',
      name: 'Loot',
      type: 'pile',
      description: 'Treasure',
      folderName: 'Decks',
      cards: [{ name: 'Gem', text: '<p>A ruby.</p>', img: 'cards/gem.png' }],
    });
    expect(calls[0]![1]).toMatchObject({
      description: 'Treasure',
      folderName: 'Decks',
      cards: [{ name: 'Gem', text: '<p>A ruby.</p>', img: 'cards/gem.png' }],
    });
    expect(out).toBe(
      'Created pile "Loot" (x) with 1 card(s)\n\n⚠️ 1 warning(s):\n- cards/gem.png did not resolve (404).'
    );
  });

  it('rejects an empty name, an unknown type, and a card without a name', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: '' })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'X', type: 'stack' })).rejects.toThrow();
    await expect(
      run({ action: 'create', name: 'X', cards: [{ text: 'no name' }] })
    ).rejects.toThrow();
  });
});

describe('manage-cards import', () => {
  it('forwards the preset and confirms on one line', async () => {
    const { calls, run } = build({
      type: 'deck',
      cardsName: 'Poker',
      cardsId: 'p1',
      preset: 'pokerDark',
      cardCount: 52,
    });
    const out = await run({ action: 'import', preset: 'pokerDark', name: 'Poker' });
    expect(calls[0]![0]).toBe('importCardsPreset');
    expect(calls[0]![1]).toMatchObject({ preset: 'pokerDark', name: 'Poker' });
    expect(out).toBe('Imported deck "Poker" (p1) from preset "pokerDark": 52 card(s)');
  });

  it('rejects a missing preset', async () => {
    const { run } = build();
    await expect(run({ action: 'import', name: 'X' })).rejects.toThrow();
  });
});

describe('manage-cards list (the §3 line shape)', () => {
  it('one line per stack under the column header', async () => {
    const { calls, run } = build([
      { id: 'c1', name: 'Deck of Many Things', type: 'deck', cardCount: 22 },
      { id: 'c2', name: 'Discard', type: 'pile', cardCount: 0 },
    ]);
    const out = await run({ action: 'list' });
    expect(calls[0]![0]).toBe('listCards');
    expect(out).toBe(
      '2 stack(s): id name type cards\nc1 "Deck of Many Things" deck 22\nc2 Discard pile 0'
    );
  });

  it('an empty world (or a non-array result) is the header alone', async () => {
    expect(await build([]).run({ action: 'list' })).toBe('0 stack(s).');
    expect(await build(null).run({ action: 'list' })).toBe('0 stack(s).');
  });
});

describe('manage-cards delete', () => {
  it('forwards deleteCards and confirms the deletions with the not-found tail', async () => {
    const { calls, run } = build({
      deletedCount: 1,
      deleted: [{ id: 'c1', name: 'Tarokka' }],
      notFound: ['ghost'],
    });
    const out = await run({ action: 'delete', identifiers: ['c1', 'ghost'] });
    expect(calls[0]![0]).toBe('deleteCards');
    expect(calls[0]![1]).toEqual({ identifiers: ['c1', 'ghost'] });
    expect(out).toBe('Deleted 1 stack(s): "Tarokka" (c1) (1 not found: ghost)');
  });

  it('rejects an empty identifiers array and an empty-string identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});
