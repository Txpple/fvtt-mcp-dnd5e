/**
 * The local host's FilePlane (hosts/local-files.ts) against a real temp directory.
 *
 * It must keep the WebDAV plane's contract to the letter — the asset tools are tested once against
 * a stub and trusted on both planes — so this pins: Data-relative canonicalisation, the
 * containment boundary (nothing resolves outside the root), list/stat/exists semantics (null for
 * an absent directory, children only), one-level mkdir + ensureParents, the overwrite rules of
 * move/copy, and the FilePlaneError statuses the tools' messages key off.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilePlane } from './local-files.js';
import { FilePlaneError } from './types.js';

let root: string;
let plane: LocalFilePlane;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fvtt-local-plane-'));
  mkdirSync(join(root, 'assets', 'maps'), { recursive: true });
  writeFileSync(join(root, 'assets', 'maps', 'cave.webp'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(root, 'assets', 'notes.txt'), 'hello');
  plane = new LocalFilePlane(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('list / stat / exists', () => {
  it('lists children only, with size + content type for files and mtime for both', async () => {
    const entries = (await plane.list('assets'))!;
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(['maps', 'notes.txt']);
    const dir = entries.find(e => e.name === 'maps')!;
    expect(dir.isDirectory).toBe(true);
    expect(dir.path).toBe('assets/maps');
    expect(dir.lastModified).toMatch(/GMT$/); // RFC-1123 like WebDAV
    const file = entries.find(e => e.name === 'notes.txt')!;
    expect(file).toMatchObject({ isDirectory: false, size: 5, path: 'assets/notes.txt' });
    expect(file.contentType).toBe('text/plain; charset=utf-8');
  });

  it('accepts the Data/ prefix and a leading slash, and lists the root for ""', async () => {
    expect((await plane.list('Data/assets'))!.length).toBe(2);
    expect((await plane.list('/assets/'))!.length).toBe(2);
    expect((await plane.list(''))!.map(e => e.name)).toEqual(['assets']);
  });

  it('returns null for an absent directory and for a file', async () => {
    expect(await plane.list('nope')).toBeNull();
    expect(await plane.list('assets/notes.txt')).toBeNull();
  });

  it('stat: entry or null; exists follows', async () => {
    expect(await plane.stat('assets/maps/cave.webp')).toMatchObject({
      name: 'cave.webp',
      size: 4,
      contentType: 'image/webp',
      isDirectory: false,
    });
    expect(await plane.stat('assets/maps')).toMatchObject({ isDirectory: true });
    expect(await plane.stat('ghost')).toBeNull();
    expect(await plane.exists('assets')).toBe(true);
    expect(await plane.exists('ghost')).toBe(false);
  });
});

describe('containment', () => {
  it('refuses a `..` segment (canonicalisation) and anything that would escape the root', async () => {
    await expect(plane.stat('assets/../../etc/passwd')).rejects.toBeInstanceOf(FilePlaneError);
    await expect(plane.read('../outside.txt')).rejects.toMatchObject({ status: 400 });
  });
});

describe('read / write / mkdir / ensureParents', () => {
  it('round-trips bytes', async () => {
    await plane.write('assets/new.bin', new Uint8Array([9, 8, 7]));
    expect(Array.from(await plane.read('assets/new.bin'))).toEqual([9, 8, 7]);
  });

  it('read of a missing file is a 404 FilePlaneError', async () => {
    await expect(plane.read('assets/missing.bin')).rejects.toMatchObject({ status: 404 });
  });

  it('write does NOT create parents (the caller uses ensureParents, as on WebDAV)', async () => {
    await expect(plane.write('deep/er/file.txt', new Uint8Array([1]))).rejects.toMatchObject({
      status: 404,
    });
    await plane.ensureParents('deep/er/file.txt');
    await plane.write('deep/er/file.txt', new Uint8Array([1]));
    expect(existsSync(join(root, 'deep', 'er', 'file.txt'))).toBe(true);
  });

  it('mkdir creates one level, is idempotent on a directory, and refuses a file of that name', async () => {
    await plane.mkdir('assets/audio');
    await plane.mkdir('assets/audio'); // already a directory — success
    expect((await plane.stat('assets/audio'))!.isDirectory).toBe(true);
    await expect(plane.mkdir('assets/notes.txt')).rejects.toMatchObject({ status: 409 });
    await expect(plane.mkdir('no/parent/here')).rejects.toMatchObject({ status: 404 });
  });
});

describe('remove / move / copy', () => {
  it('remove: a file; a directory only when asked; 404 when absent', async () => {
    await plane.remove('assets/notes.txt');
    expect(await plane.exists('assets/notes.txt')).toBe(false);
    await expect(plane.remove('assets/maps')).rejects.toBeInstanceOf(FilePlaneError); // not empty, not recursive
    await plane.remove('assets/maps', true);
    expect(await plane.exists('assets/maps')).toBe(false);
    await expect(plane.remove('assets/maps')).rejects.toMatchObject({ status: 404 });
  });

  it('move: renames; refuses an existing destination unless overwrite', async () => {
    await plane.ensureParents('assets/moved/cave.webp');
    await plane.move('assets/maps/cave.webp', 'assets/moved/cave.webp', false);
    expect(await plane.exists('assets/maps/cave.webp')).toBe(false);
    expect(await plane.exists('assets/moved/cave.webp')).toBe(true);
    await expect(
      plane.move('assets/notes.txt', 'assets/moved/cave.webp', false)
    ).rejects.toMatchObject({
      status: 412,
    });
    await plane.move('assets/notes.txt', 'assets/moved/cave.webp', true);
    expect(readFileSync(join(root, 'assets', 'moved', 'cave.webp'), 'utf8')).toBe('hello');
  });

  it('copy: a file, a directory tree; the same overwrite rule', async () => {
    await plane.copy('assets/maps/cave.webp', 'assets/cave-copy.webp', false);
    expect(await plane.exists('assets/maps/cave.webp')).toBe(true);
    expect(await plane.exists('assets/cave-copy.webp')).toBe(true);
    await expect(
      plane.copy('assets/notes.txt', 'assets/cave-copy.webp', false)
    ).rejects.toMatchObject({
      status: 412,
    });
    await plane.copy('assets/maps', 'assets/maps-copy', false, true);
    expect(await plane.exists('assets/maps-copy/cave.webp')).toBe(true);
  });
});
