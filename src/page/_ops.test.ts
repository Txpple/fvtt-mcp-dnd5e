/**
 * The page-op table (issue #14): every op the page registers is tagged, nothing else is, and the
 * calls whose kind depends on their arguments resolve the way their handlers behave. The compile
 * step holds the same set (`satisfies Record<keyof PageApi, OpKind>`); this is the runtime backstop,
 * read from the registration block the way src/foundry.seam.test.ts reads it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPS, opKind } from './_ops.js';

/** The method names in `const api = { … } satisfies` in src/page/index.ts. */
function registeredOps(): string[] {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
  const start = src.indexOf('const api = {');
  const end = src.indexOf('} satisfies', start);
  if (start < 0 || end < 0) throw new Error('could not locate the page `api` registration block');
  const names: string[] = [];
  for (const line of src.slice(start, end).split('\n')) {
    const m = /^\s*([a-zA-Z]\w*)\s*,\s*$/.exec(line);
    if (m) names.push(m[1]!);
  }
  return names;
}

describe('the op table', () => {
  it('tags every registered page op, and nothing else', () => {
    const registered = registeredOps();
    expect(registered.length).toBeGreaterThan(150);
    expect(Object.keys(OPS).sort()).toEqual([...registered].sort());
  });

  it('pins the ops a name would misread', () => {
    // the regex took `remap` for a read and ran it in a dry run (issue #14)
    expect(opKind('remapSceneTeleporters', { sourceModule: 'x' })).toBe('write');
    // moves connected players' views without touching a document
    expect(opKind('pullUsersToScene', {})).toBe('write');
    for (const read of [
      'prepareSceneShot',
      'auditContent',
      'warmCompendiumIndexes',
      'getWorldInfo',
    ])
      expect(opKind(read, {}), read).toBe('read');
    // evaluates the table without drawing or posting
    expect(opKind('rollOnTable', { identifier: 't' })).toBe('read');
    expect(opKind('deleteScenes', { identifiers: ['s'] })).toBe('delete');
    expect(opKind('removeActorItems', {})).toBe('delete');
    expect(opKind('createActorFromCompendium', {})).toBe('write');
  });

  it('an action decides: the read actions read, the delete actions delete, the rest write', () => {
    expect(opKind('configureAreaSounds', { action: 'list' })).toBe('read');
    expect(opKind('configureAreaSounds', { action: 'library' })).toBe('read');
    expect(opKind('configureAreaSounds', { action: 'add' })).toBe('write');
    expect(opKind('configureAreaSounds', { action: 'update' })).toBe('write');
    expect(opKind('configureAreaSounds', { action: 'remove' })).toBe('delete');
    expect(opKind('manageEffect', { action: 'list' })).toBe('read');
    expect(opKind('manageEffect', { action: 'create' })).toBe('write');
    expect(opKind('manageEffect', { action: 'edit' })).toBe('write');
    expect(opKind('manageEffect', { action: 'delete' })).toBe('delete');
    expect(opKind('manageActivity', { action: 'list' })).toBe('read');
    expect(opKind('manageActivity', { action: 'add' })).toBe('write');
    expect(opKind('manageActivity', { action: 'remove' })).toBe('delete');
    expect(opKind('manageCalendar', { action: 'read' })).toBe('read');
    expect(opKind('manageCalendar', { action: 'advance', hours: 1 })).toBe('write');
    expect(opKind('manageCalendar', { action: 'set', day: 3 })).toBe('write');
    // the handler's own default: no action reads
    expect(opKind('manageCalendar', {})).toBe('read');
    expect(opKind('manageCalendar', undefined)).toBe('read');
    // an action an op does not know is a write, never a read
    expect(opKind('manageEffect', { action: 'purge' })).toBe('write');
    expect(opKind('manageEffect', {})).toBe('write');
  });

  it('a configure op with no argument reads; any named field writes', () => {
    for (const op of [
      'configureDnd5eSettings',
      'configureCombatTracker',
      'configurePrimaryParty',
    ]) {
      expect(opKind(op, undefined), op).toBe('read');
      expect(opKind(op, {}), op).toBe('read');
      expect(opKind(op, { x: undefined }), op).toBe('read');
    }
    expect(opKind('configureCombatTracker', { skipDefeated: false })).toBe('write');
    expect(opKind('configurePrimaryParty', { groupIdentifier: 'Party' })).toBe('write');
    expect(opKind('configurePrimaryParty', { clear: true })).toBe('write');
    expect(opKind('configureDnd5eSettings', { rulesVersion: 'modern' })).toBe('write');
  });

  it("an op's own preview reads; without it the op is what it is", () => {
    expect(opKind('bulkDelete', { documentType: 'Actor', identifiers: ['a'], dryRun: true })).toBe(
      'read'
    );
    expect(opKind('bulkDelete', { documentType: 'Actor', identifiers: ['a'] })).toBe('delete');
    expect(opKind('bulkDelete', { dryRun: 'yes' })).toBe('delete');
    expect(opKind('relinkAsset', { oldPath: 'a', newPath: 'b', dryRun: true })).toBe('read');
    expect(opKind('relinkAsset', { oldPath: 'a', newPath: 'b' })).toBe('write');
  });

  it('a name that is not a page op is a write', () => {
    expect(opKind('notAnOp', {})).toBe('write');
    expect(opKind('constructor', {})).toBe('write');
    expect(opKind('toString', {})).toBe('write');
  });
});
