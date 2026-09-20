import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatTools } from './chat.js';
import { makeFoundry, makeLogger } from './test-helpers.js';

/** A FilePlane stand-in (no network, no disk). `putFile` is the plane's `write`. */
function fakeDav(overrides: Record<string, any> = {}) {
  const d: any = {
    label: 'stub',
    exists: vi.fn(async () => false),
    ensureParents: vi.fn(async () => {}),
    putFile: vi.fn(async () => {}),
    ...overrides,
  };
  d.write = (...a: any[]) => d.putFile(...a);
  return d;
}

/** A stub Host over `files` (a fakeDav(), or null = no direct plane → the bridge plane). */
function fakeHost(files: any, serverUrl = 'https://srv'): any {
  return {
    kind: 'molten',
    label: 'stub',
    unreachableHint: '',
    redact: (m: string) => m,
    files,
    publicUrl: (p: string) => `${serverUrl}/${p}`,
  };
}

function build(response: any = {}, files: any = null) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new ChatTools({ foundry, logger: makeLogger(), host: fakeHost(files) });
  return { tools, calls, foundry };
}

const tmpFiles: string[] = [];
function tmpFile(name: string): string {
  const p = join(tmpdir(), `mcp-chat-test-${name}`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map(p => rm(p, { force: true })));
});

describe('send-chat-message', () => {
  it('forwards parsed args to postChatMessage and formats the result', async () => {
    const { tools, calls } = build({
      id: 'c1',
      alias: 'GM',
      visibility: 'public',
      whisperCount: 0,
    });
    const out = await tools.handleSendChatMessage({
      content: '<p>The winter is coming.</p>',
      visibility: 'public',
    });
    expect(calls[0][0]).toBe('postChatMessage');
    expect(calls[0][1]).toMatchObject({
      content: '<p>The winter is coming.</p>',
      visibility: 'public',
      enrich: true,
    });
    expect(out).toContain('Posted chat message c1');
    expect(out).toContain('public');
  });

  it('rejects empty content (zod)', async () => {
    const { tools } = build();
    await expect(tools.handleSendChatMessage({ content: '' })).rejects.toThrow();
  });

  it('embeds an https image URL directly (no upload)', async () => {
    const { tools, calls } = build({
      id: 'c2',
      alias: 'GM',
      visibility: 'public',
      whisperCount: 0,
    });
    await tools.handleSendChatMessage({
      content: '<p>Behold.</p>',
      images: [{ path: 'https://example.com/x.png', caption: 'A map' }],
    });
    const forwarded = calls[0][1].content as string;
    expect(forwarded).toContain('<img src="https://example.com/x.png"');
    expect(forwarded).toContain('<figcaption>A map</figcaption>');
  });

  it("uploads a local image through the host's file plane and embeds its public URL", async () => {
    const dav = fakeDav();
    const { tools, calls } = build(
      {
        id: 'c3',
        alias: 'GM',
        visibility: 'public',
        whisperCount: 0,
      },
      dav
    );

    const img = tmpFile('pic.webp');
    await writeFile(img, Buffer.from([1, 2, 3]));

    await tools.handleSendChatMessage({
      content: '<p>Handout.</p>',
      images: [{ path: img }],
      imageFolder: 'worlds/w/assets/chat',
    });

    expect(dav.putFile).toHaveBeenCalledTimes(1);
    const forwarded = calls[0][1].content as string;
    expect(forwarded).toContain('<img src="https://srv/worlds/w/assets/chat/');
  });

  it('uploads a local image through the bridge plane when the host has no direct plane', async () => {
    // No direct plane → FilePicker through the page: statFile (exists?) → createDirectory ×4
    // (ensureParents) → uploadFile → postChatMessage.
    const { tools, calls } = build((name: string) => {
      if (name === 'statFile') return null;
      if (name === 'createDirectory') return { ok: true, existed: true };
      if (name === 'uploadFile')
        return { ok: true, path: 'worlds/w/assets/chat/mcp-chat-test-pic2.webp' };
      return { id: 'c4', alias: 'GM', visibility: 'public', whisperCount: 0 };
    }, null);

    const img = tmpFile('pic2.webp');
    await writeFile(img, Buffer.from([1]));

    await tools.handleSendChatMessage({
      content: '<p>x</p>',
      images: [{ path: img }],
      imageFolder: 'worlds/w/assets/chat',
    });
    const names = calls.map(c => c[0]);
    expect(names).toEqual([
      'statFile',
      'createDirectory', // worlds
      'createDirectory', // worlds/w
      'createDirectory', // worlds/w/assets
      'createDirectory', // worlds/w/assets/chat
      'uploadFile',
      'postChatMessage',
    ]);
    expect(calls[5][1]).toMatchObject({
      path: 'worlds/w/assets/chat/mcp-chat-test-pic2.webp',
      base64: 'AQ==',
    });
    const forwarded = calls[6][1].content as string;
    expect(forwarded).toContain(
      '<img src="https://srv/worlds/w/assets/chat/mcp-chat-test-pic2.webp"'
    );
  });

  it('inlines a local image as a base64 data: URI with embed:"dataUri" (no upload)', async () => {
    const dav = fakeDav();
    const { tools, calls } = build(
      {
        id: 'c5',
        alias: 'GM',
        visibility: 'public',
        whisperCount: 0,
      },
      dav
    );

    const img = tmpFile('inline.webp');
    await writeFile(img, Buffer.from([1, 2, 3]));

    await tools.handleSendChatMessage({
      content: '<p>Inline.</p>',
      images: [{ path: img, embed: 'dataUri' }],
    });

    // dataUri reads the file directly — no upload through the plane.
    expect(dav.putFile).not.toHaveBeenCalled();
    const forwarded = calls[0][1].content as string;
    expect(forwarded).toContain('<img src="data:image/webp;base64,AQID"');
  });

  it('the embed modes are upload and dataUri — the 2.x plane name is refused by name', async () => {
    const { tools } = build();
    await expect(
      tools.handleSendChatMessage({
        content: '<p>x</p>',
        images: [{ path: 'C:/x.png', embed: 'webdav' }],
      })
    ).rejects.toThrow(/embed/);
  });

  it('refuses embed:"dataUri" for an http URL', async () => {
    const { tools } = build();
    const out = await tools.handleSendChatMessage({
      content: '<p>x</p>',
      images: [{ path: 'https://example.com/x.png', embed: 'dataUri' }],
    });
    expect(out).toMatch(/needs a LOCAL file/i);
  });
});

describe('list-chat-messages', () => {
  it('formats a compact numbered list', async () => {
    const { tools, calls } = build({
      count: 1,
      messages: [
        { id: 'm1', time: '2026-01-01T00:00:00.000Z', alias: 'GM', whisperCount: 0, content: 'Hi' },
      ],
    });
    const out = await tools.handleListChatMessages({ limit: 10 });
    expect(calls[0][0]).toBe('listChatMessages');
    expect(out).toContain('m1');
    expect(out).toContain('GM');
  });

  it('reports an empty log', async () => {
    const { tools } = build({ count: 0, messages: [] });
    expect(await tools.handleListChatMessages({})).toBe('No chat messages.');
  });
});

describe('delete-chat-messages', () => {
  it('refuses clearAll without confirm and does NOT call the bridge', async () => {
    const { tools, calls } = build({});
    const out = await tools.handleDeleteChatMessages({ clearAll: true });
    expect(out).toMatch(/Refused/);
    expect(calls.length).toBe(0);
  });

  it('refuses beforeTimestamp without confirm and does NOT call the bridge', async () => {
    const { tools, calls } = build({});
    const out = await tools.handleDeleteChatMessages({ beforeTimestamp: 1_700_000_000_000 });
    expect(out).toMatch(/Refused/);
    expect(calls.length).toBe(0);
  });

  it('forwards a beforeTimestamp purge when confirmed', async () => {
    const { tools, calls } = build({ success: true, deletedCount: 3, deleted: [] });
    await tools.handleDeleteChatMessages({ beforeTimestamp: 1_700_000_000_000, confirm: true });
    expect(calls[0][0]).toBe('deleteChatMessages');
  });

  it('forwards an id delete and formats via formatDeletionResult', async () => {
    const { tools, calls } = build({
      success: true,
      deletedCount: 1,
      deleted: [{ id: 'm9', name: 'GM' }],
    });
    const out = await tools.handleDeleteChatMessages({ ids: ['m9'] });
    expect(calls[0][0]).toBe('deleteChatMessages');
    expect(out).toContain('Deleted 1 chat message(s)');
    expect(out).toContain('m9');
  });

  it('rejects when no selector is given (zod refine)', async () => {
    const { tools } = build();
    await expect(tools.handleDeleteChatMessages({})).rejects.toThrow();
  });

  it('summarizes a clear-all', async () => {
    const { tools } = build({ success: true, deletedCount: 5, deleted: [], clearedAll: true });
    const out = await tools.handleDeleteChatMessages({ clearAll: true, confirm: true });
    expect(out).toContain('Cleared the chat log');
    expect(out).toContain('5');
  });
});

describe('export-chat-log', () => {
  it('rejects when no destination is given (zod refine)', async () => {
    const { tools } = build();
    await expect(tools.handleExportChatLog({ format: 'markdown' })).rejects.toThrow();
  });

  it('writes to a local file and summarizes', async () => {
    const { tools, calls } = build({ format: 'markdown', messageCount: 2, content: '# Log\nhi' });
    const out = await tools.handleExportChatLog({ localPath: tmpFile('log.md') });
    expect(calls[0][0]).toBe('exportChatLog');
    expect(out).toContain('Exported 2 message(s)');
    expect(out).toContain('local:');
    expect(await readFile(tmpFiles[0], 'utf8')).toBe('# Log\nhi');
  });

  it('refuses to clobber an existing local file without overwrite', async () => {
    const { tools } = build({ format: 'markdown', messageCount: 1, content: 'new' });
    const p = tmpFile('exists.md');
    await writeFile(p, 'old');
    const out = await tools.handleExportChatLog({ localPath: p });
    expect(out).toMatch(/already exists/);
    expect(await readFile(p, 'utf8')).toBe('old'); // untouched
  });

  it('a remote-only export goes through the bridge plane when the host has no direct plane', async () => {
    const { tools, calls } = build((name: string) => {
      if (name === 'statFile') return null;
      if (name === 'createDirectory') return { ok: true, existed: true };
      if (name === 'uploadFile') return { ok: true, path: 'worlds/w/exports/log.md' };
      return { format: 'markdown', messageCount: 2, content: '# Chat Log' };
    }, null);
    const out = await tools.handleExportChatLog({ remotePath: 'worlds/w/exports/log.md' });
    expect(out).toContain('Exported 2 message(s)');
    expect(out).toContain('public URL: https://srv/worlds/w/exports/log.md');
    expect(calls.map(c => c[0])).toContain('uploadFile');
  });

  it('a remote export the bridge plane cannot take (.html) fails by name', async () => {
    const { tools } = build((name: string) => {
      if (name === 'statFile') return null;
      if (name === 'createDirectory') return { ok: true, existed: true };
      if (name === 'uploadFile')
        return { ok: false, reason: 'extension', detail: 'accepts only md, txt — not ".html"' };
      return { format: 'html', messageCount: 1, content: '<html></html>' };
    }, null);
    const out = await tools.handleExportChatLog({
      remotePath: 'worlds/w/exports/log.html',
      format: 'html',
    });
    expect(out).toMatch(/export-chat-log failed/);
    expect(out).toMatch(/bridge plane/);
    expect(out).toMatch(/FOUNDRY_DATA_DIR or FOUNDRY_WEBDAV_\*/);
  });
});

describe('post-item-card', () => {
  it('formats a posted card', async () => {
    const { tools, calls } = build({
      success: true,
      posted: true,
      actorName: 'Ankylosaurus',
      itemName: 'Tail',
      activityType: 'attack',
      action: 'use',
    });
    const out = await tools.handlePostItemCard({ actor: 'Ankylosaurus', item: 'Tail' });
    expect(calls[0][0]).toBe('postItemCard');
    expect(out).toContain('Posted use card for "Tail"');
  });

  it('surfaces the reason when no activity exists', async () => {
    const { tools } = build({ success: true, posted: false, reason: 'item has no activities' });
    const out = await tools.handlePostItemCard({ actor: 'X', item: 'Plain Feature' });
    expect(out).toMatch(/Could not post a rich card/);
  });
});

describe('request-roll', () => {
  it('forwards and formats', async () => {
    const { tools, calls } = build({
      success: true,
      kind: 'save',
      expression: '[[/save dex dc=15]]',
    });
    const out = await tools.handleRequestRoll({ kind: 'save', ability: 'dex', dc: 15 });
    expect(calls[0][0]).toBe('requestRoll');
    expect(out).toContain('[[/save dex dc=15]]');
  });

  it('rejects a skill request without a skill (zod refine)', async () => {
    const { tools } = build();
    await expect(tools.handleRequestRoll({ kind: 'skill' })).rejects.toThrow();
  });
});
