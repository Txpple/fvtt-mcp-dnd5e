/**
 * The bridge file plane (hosts/bridge-files.ts) over a fake page: the FilePlane contract the
 * asset tools rely on — Data-relative in and out, one directory per mkdir + ensureParents, the
 * FilePlaneError statuses — and the two operations FilePicker does not have, refused by name.
 */

import { describe, it, expect, vi } from 'vitest';
import { BridgeFilePlane } from './bridge-files.js';
import { FilePlaneError } from './types.js';

/** A page whose five file functions answer from `responses` (by page-function name). */
function fakePage(responses: Record<string, (args: any) => unknown>) {
  const calls: Array<[string, any]> = [];
  const call = vi.fn(async (name: string, args?: any) => {
    calls.push([name, args]);
    const fn = responses[name];
    if (!fn) throw new Error(`unexpected page call ${name}`);
    return fn(args);
  });
  return { page: { call }, calls };
}

describe('BridgeFilePlane', () => {
  it('list: dirs then files, Data-relative, with the HEAD metadata the page attached', async () => {
    const { page, calls } = fakePage({
      browseFiles: () => ({
        dirs: [{ path: 'assets/maps', name: 'maps' }],
        files: [
          {
            path: 'assets/a b.webp',
            name: 'a b.webp',
            size: 12,
            contentType: 'image/webp',
            lastModified: 'Sun, 20 Sep 2026 21:55:30 GMT',
          },
        ],
      }),
    });
    const out = await new BridgeFilePlane(page).list('/Data/assets/');
    expect(calls).toEqual([['browseFiles', { dir: 'assets' }]]);
    expect(out).toEqual([
      { path: 'assets/maps', name: 'maps', isDirectory: true },
      {
        path: 'assets/a b.webp',
        name: 'a b.webp',
        isDirectory: false,
        size: 12,
        contentType: 'image/webp',
        lastModified: 'Sun, 20 Sep 2026 21:55:30 GMT',
      },
    ]);
  });

  it('list / stat: null when the page says the entry does not exist', async () => {
    const { page } = fakePage({ browseFiles: () => null, statFile: () => null });
    const plane = new BridgeFilePlane(page);
    expect(await plane.list('nope')).toBeNull();
    expect(await plane.stat('nope/x.png')).toBeNull();
    expect(await plane.exists('nope/x.png')).toBe(false);
  });

  it('stat: a file entry with its name and metadata; a directory entry', async () => {
    const { page } = fakePage({
      statFile: ({ path }: { path: string }) =>
        path === 'assets/maps' ? { isDirectory: true } : { isDirectory: false, size: 3 },
    });
    const plane = new BridgeFilePlane(page);
    expect(await plane.stat('assets/maps')).toEqual({
      path: 'assets/maps',
      name: 'maps',
      isDirectory: true,
    });
    expect(await plane.stat('assets/a.png')).toEqual({
      path: 'assets/a.png',
      name: 'a.png',
      isDirectory: false,
      size: 3,
    });
  });

  it('read: the base64 body back as bytes; 404 when not served', async () => {
    const { page } = fakePage({
      readFileBase64: ({ path }: { path: string }) =>
        path === 'a.txt' ? { base64: Buffer.from('hi').toString('base64') } : null,
    });
    const plane = new BridgeFilePlane(page);
    expect(Buffer.from(await plane.read('a.txt')).toString()).toBe('hi');
    await expect(plane.read('b.txt')).rejects.toMatchObject({ status: 404 });
  });

  it('write: bytes go up as base64 with the content type; the three refusals map to statuses', async () => {
    const { page, calls } = fakePage({
      uploadFile: ({ path }: { path: string }) => {
        if (path.endsWith('.html'))
          return { ok: false, reason: 'extension', detail: 'accepts only … — not ".html"' };
        if (path.startsWith('missing/'))
          return {
            ok: false,
            reason: 'no-directory',
            detail: 'directory "Data/missing" does not exist',
          };
        if (path.endsWith('bad.png'))
          return {
            ok: false,
            reason: 'refused',
            detail: 'Foundry refused the upload of "bad.png"',
          };
        return { ok: true, path };
      },
    });
    const plane = new BridgeFilePlane(page);
    await plane.write('assets/a.png', new Uint8Array([1, 2, 3]), 'image/png');
    expect(calls[0]).toEqual([
      'uploadFile',
      { path: 'assets/a.png', base64: 'AQID', contentType: 'image/png' },
    ]);
    await expect(plane.write('x.html', new Uint8Array([1]))).rejects.toMatchObject({
      status: 415,
      message: expect.stringMatching(/bridge plane.*FOUNDRY_DATA_DIR or FOUNDRY_WEBDAV_\*/),
    });
    await expect(plane.write('missing/a.png', new Uint8Array([1]))).rejects.toMatchObject({
      status: 409,
    });
    await expect(plane.write('bad.png', new Uint8Array([1]))).rejects.toMatchObject({
      status: 500,
    });
  });

  it('mkdir: existing is success; a missing parent is a 409; ensureParents walks the ancestors', async () => {
    const made: string[] = [];
    const { page } = fakePage({
      createDirectory: ({ path }: { path: string }) => {
        if (path === 'orphan/x')
          return { ok: false, reason: 'no-parent', detail: 'the parent is missing' };
        made.push(path);
        return { ok: true, existed: path === 'a' };
      },
    });
    const plane = new BridgeFilePlane(page);
    await plane.mkdir('a'); // existed → fine
    await expect(plane.mkdir('orphan/x')).rejects.toMatchObject({ status: 409 });
    await plane.ensureParents('a/b/c/file.png');
    expect(made).toEqual(['a', 'a', 'a/b', 'a/b/c']);
  });

  it('remove and move are refused by name (501), naming the direct planes', async () => {
    const { page, calls } = fakePage({});
    const plane = new BridgeFilePlane(page);
    for (const p of [plane.remove('a.png'), plane.move('a.png', 'b.png', false)]) {
      const err = await p.catch(e => e);
      expect(err).toBeInstanceOf(FilePlaneError);
      expect(err.status).toBe(501);
      expect(err.message).toMatch(/through the bridge plane/);
      expect(err.message).toMatch(/FOUNDRY_DATA_DIR/);
      expect(err.message).toMatch(/FOUNDRY_WEBDAV_URL/);
    }
    expect(calls).toEqual([]); // nothing reached the page
  });

  it('copy: a file is a read + a write; a directory is refused', async () => {
    const { page, calls } = fakePage({
      readFileBase64: () => ({ base64: 'AQID' }),
      uploadFile: ({ path }: { path: string }) => ({ ok: true, path }),
    });
    const plane = new BridgeFilePlane(page);
    await plane.copy('a/x.png', 'b/y.png', false, false);
    expect(calls.map(c => c[0])).toEqual(['readFileBase64', 'uploadFile']);
    expect(calls[1][1]).toMatchObject({ path: 'b/y.png', base64: 'AQID' });
    await expect(plane.copy('a', 'b', false, true)).rejects.toMatchObject({ status: 501 });
  });

  it('refuses path traversal before anything reaches the page', async () => {
    const { page, calls } = fakePage({});
    await expect(new BridgeFilePlane(page).stat('assets/../worlds/w/data/x')).rejects.toMatchObject(
      { status: 400 }
    );
    expect(calls).toEqual([]);
  });
});
