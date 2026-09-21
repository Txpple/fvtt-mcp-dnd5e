// Read-tool spine (live). Ports scripts/verify-read-tools.mjs: drives the REWIRED Node
// tool classes end-to-end against the live world. Unlike reads.int (which hits the page
// seam directly), this proves the whole tool spine — zod parse -> foundry.call seam ->
// page lib -> shaped response — for the read handlers.
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Foundry } from '../../dist/foundry.js';
import { SceneTools } from '../../dist/tools/scene.js';
import { ActorTools } from '../../dist/tools/actor.js';
import { CompendiumTools } from '../../dist/tools/compendium.js';
import { JournalTools } from '../../dist/tools/journal.js';
import { PlaylistTools } from '../../dist/tools/playlist.js';
import { LIVE, foundryConfig, noopLogger, CONNECT_TIMEOUT_MS } from './setup.js';

describe.skipIf(!LIVE)('read-tool spine (live)', () => {
  let foundry: Foundry;
  let scene: SceneTools;
  let character: ActorTools;
  let compendium: CompendiumTools;
  let journal: JournalTools;
  let playlist: PlaylistTools;
  let firstActorName: string | undefined;

  beforeAll(async () => {
    foundry = new Foundry(foundryConfig(), noopLogger);
    await foundry.connect();

    scene = new SceneTools({ foundry, logger: noopLogger });
    character = new ActorTools({ foundry, logger: noopLogger });
    compendium = new CompendiumTools({ foundry, logger: noopLogger });
    journal = new JournalTools({ foundry, logger: noopLogger });
    playlist = new PlaylistTools({ foundry, logger: noopLogger });

    // the §3 list lines: the first row's name cell (JSON-quoted when it has a space)
    const list = String(await character.handleManageActors({ action: 'list' }));
    const firstRow = list.split('\n')[1] ?? '';
    const cell = /^\S+ ("(?:[^"\\]|\\.)*"|\S+) /.exec(firstRow)?.[1];
    firstActorName = cell?.startsWith('"') ? JSON.parse(cell) : cell;
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await foundry?.dispose();
  });

  it('get-world-info returns a shaped world object', async () => {
    const out = await scene.handleGetWorldInfo({});
    expect(out).toBeTruthy();
    expect(out.system ?? out.worldId ?? out.title).toBeTruthy();
  });

  it('manage-actors list answers the §3 header', async () => {
    const out = String(await character.handleManageActors({ action: 'list' }));
    expect(out).toMatch(/^\d+ actor\(s\)/);
  });

  it('manage-actors get for the first actor', async ctx => {
    if (!firstActorName) return ctx.skip();
    const out: any = await character.handleManageActors({
      action: 'get',
      actorIdentifier: firstActorName,
    });
    expect(out?.name).toBeTruthy();
  });

  it('search-compendium(goblin)', async () => {
    await expect(compendium.handleSearchCompendium({ query: 'goblin' })).resolves.not.toBeNull();
  });

  it('manage-scenes list', async () => {
    await expect(scene.handleManageScenes({ action: 'list' })).resolves.toBeDefined();
  });

  it('manage-journals list', async () => {
    await expect(journal.handleManageJournals({ action: 'list' })).resolves.not.toBeNull();
  });

  it('manage-playlists list', async () => {
    await expect(playlist.handle('manage-playlists', { action: 'list' })).resolves.toBeDefined();
  });
});
