/**
 * Unit tests for PlaylistTools — manage-playlists (the M8 union: action create / list / update /
 * delete). Covers the two things the handlers own before the bridge is reached: zod validation
 * (required fields, enum membership, ranges; the member selected by `action` and its refusals by
 * name) and the §3 shapes (the list lines, the one-line confirmations, a miss as an error).
 */

import { describe, it, expect } from 'vitest';
import { MANAGE_PLAYLISTS, PlaylistTools } from './playlist.js';
import { makeLogger, makeFoundry } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new PlaylistTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handle(MANAGE_PLAYLISTS, args);
  return { tools, calls, run };
}

describe('manage-playlists (the M8 union: action create / list / update / delete)', () => {
  it('advertises one tool: the action enum, the shared mode leaf at the root, closed members', () => {
    const [def] = build().tools.getToolDefinitions();
    expect(def!.name).toBe(MANAGE_PLAYLISTS);
    const schema = def!.inputSchema as any;
    expect(schema.properties.action.enum).toEqual(['create', 'list', 'update', 'delete']);
    expect(schema.properties.mode.enum).toEqual([
      'sequential',
      'shuffle',
      'simultaneous',
      'soundboard',
      'disabled',
    ]);
    const byAction = Object.fromEntries(
      schema.anyOf.map((m: any) => [m.properties.action.const, m])
    );
    expect(Object.keys(byAction)).toEqual(['create', 'list', 'update', 'delete']);
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
    // the shared leaf is bare on the members that take it — the root carries its prose and enum
    expect(byAction.create.properties.mode).toEqual({ type: 'string' });
    expect(byAction.update.properties.mode).toEqual({ type: 'string' });
    expect(byAction.list.properties.mode).toBeUndefined();
    expect(byAction.create.required).toEqual(['action', 'name', 'soundPaths']);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'play' })).rejects.toThrow(
      'manage-playlists: action must be one of "create", "list", "update", "delete" (got "play").'
    );
    await expect(run({ action: 'list', name: 'x' })).rejects.toThrow(
      'manage-playlists (action "list"): unknown argument "name" — it takes: action.'
    );
  });
});

describe('manage-playlists create', () => {
  it('forwards a valid playlist (mode / repeat defaulted) and confirms on one line', async () => {
    const { calls, run } = build({
      playlistName: 'Tavern',
      playlistId: 'pl1',
      mode: 'sequential',
      soundCount: 2,
      sounds: [
        { name: 'lute.ogg', path: 'snd/lute.ogg' },
        { name: 'crowd.ogg', path: 'snd/crowd.ogg' },
      ],
    });
    const out = await run({
      action: 'create',
      name: 'Tavern',
      soundPaths: ['snd/lute.ogg', 'snd/crowd.ogg'],
    });
    expect(calls[0]![0]).toBe('createPlaylist');
    expect(calls[0]![1]).toMatchObject({
      name: 'Tavern',
      soundPaths: ['snd/lute.ogg', 'snd/crowd.ogg'],
      mode: 'sequential',
      repeat: false,
    });
    expect(out).toBe('Created playlist "Tavern" (pl1): mode sequential, 2 track(s)');
  });

  it('appends the page-side warnings (a track that 404s)', async () => {
    const { run } = build({
      playlistName: 'Tavern',
      playlistId: 'pl1',
      mode: 'shuffle',
      soundCount: 1,
      sounds: [{ name: 'lute.ogg', path: 'snd/lute.ogg' }],
      warnings: ['snd/lute.ogg did not resolve on the static server (404); kept as given.'],
    });
    const out = await run({
      action: 'create',
      name: 'Tavern',
      soundPaths: ['snd/lute.ogg'],
      mode: 'shuffle',
    });
    expect(out).toBe(
      'Created playlist "Tavern" (pl1): mode shuffle, 1 track(s)' +
        '\n\n⚠️ 1 warning(s):\n- snd/lute.ogg did not resolve on the static server (404); kept as given.'
    );
  });

  it('rejects an empty name, an empty soundPaths array, a bad mode, a volume out of range', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: '', soundPaths: ['a.ogg'] })).rejects.toThrow();
    await expect(run({ action: 'create', name: 'X', soundPaths: [] })).rejects.toThrow();
    await expect(
      run({ action: 'create', name: 'X', soundPaths: ['a.ogg'], mode: 'random' })
    ).rejects.toThrow();
    await expect(
      run({ action: 'create', name: 'X', soundPaths: ['a.ogg'], defaultVolume: 1.5 })
    ).rejects.toThrow();
  });
});

describe('manage-playlists list (the §3 line shape)', () => {
  it('one line per playlist under the column header, the mode by name', async () => {
    const { calls, run } = build([
      { id: 'p1', name: 'Tavern Night', mode: 'sequential', soundCount: 3, playing: true },
      { id: 'p2', name: 'Storm', mode: 'shuffle', soundCount: 2, playing: false },
    ]);
    const out = await run({ action: 'list' });
    expect(calls[0]![0]).toBe('listPlaylists');
    expect(out).toBe(
      '2 playlist(s): id name mode tracks playing\n' +
        'p1 "Tavern Night" sequential 3 true\n' +
        'p2 Storm shuffle 2 false'
    );
  });

  it('an empty world (or a non-array result) is the header alone', async () => {
    expect(await build([]).run({ action: 'list' })).toBe('0 playlist(s).');
    expect(await build(null).run({ action: 'list' })).toBe('0 playlist(s).');
  });
});

describe('manage-playlists update', () => {
  it('forwards a valid update and confirms on one line', async () => {
    const { calls, run } = build({ updated: true, playlistName: 'Tavern v2', playlistId: 'pl1' });
    const out = await run({
      action: 'update',
      identifier: 'Tavern',
      name: 'Tavern v2',
      mode: 'shuffle',
    });
    expect(calls[0]![0]).toBe('updatePlaylist');
    expect(calls[0]![1]).toMatchObject({
      identifier: 'Tavern',
      name: 'Tavern v2',
      mode: 'shuffle',
    });
    expect(out).toBe('Updated playlist "Tavern v2" (pl1)');
  });

  it('a playlist that does not resolve is an error (§3), never prose in a success shape', async () => {
    const { run } = build({ updated: false, notFound: 'Ghost' });
    await expect(run({ action: 'update', identifier: 'Ghost', name: 'X' })).rejects.toThrow(
      'Playlist not found: "Ghost". Nothing changed.'
    );
  });

  it('rejects an empty identifier and an invalid mode', async () => {
    const { run } = build();
    await expect(run({ action: 'update', identifier: '', name: 'X' })).rejects.toThrow();
    await expect(run({ action: 'update', identifier: 'X', mode: 'loop' })).rejects.toThrow();
  });
});

describe('manage-playlists delete', () => {
  it('forwards deletePlaylists and confirms the deletions on one line', async () => {
    const { calls, run } = build({
      deletedCount: 2,
      deleted: [
        { id: 'p1', name: 'Tavern' },
        { id: 'p2', name: 'Storm' },
      ],
    });
    const out = await run({ action: 'delete', identifiers: ['p1', 'Storm'] });
    expect(calls[0]![0]).toBe('deletePlaylists');
    expect(calls[0]![1]).toEqual({ identifiers: ['p1', 'Storm'] });
    expect(out).toBe('Deleted 2 playlist(s): "Tavern" (p1), "Storm" (p2)');
  });

  it('appends the not-found tail when some identifiers do not resolve', async () => {
    const { run } = build({
      deletedCount: 1,
      deleted: [{ id: 'p1', name: 'Tavern' }],
      notFound: ['ghost'],
    });
    expect(await run({ action: 'delete', identifiers: ['p1', 'ghost'] })).toBe(
      'Deleted 1 playlist(s): "Tavern" (p1) (1 not found: ghost)'
    );
  });

  it('rejects an empty identifiers array and an empty-string identifier', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', identifiers: [] })).rejects.toThrow();
    await expect(run({ action: 'delete', identifiers: [''] })).rejects.toThrow();
  });
});
