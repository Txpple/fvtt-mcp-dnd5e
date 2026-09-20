import { describe, expect, it } from 'vitest';
import { capResult } from './cap.js';

const hit = (i: number) => ({
  id: `id${String(i).padStart(4, '0')}`,
  name: `Creature ${i}`,
  uuid: `Compendium.dnd-monster-manual.actors.Actor.id${i}`,
  facets: { cr: i % 20, type: 'beast' },
});

describe('capResult — record-level cap', () => {
  it('returns results under the cap untouched (string and object)', () => {
    expect(capResult('short', 100)).toBe('short');
    const obj = { results: [hit(1)], totalFound: 1 };
    expect(capResult(obj, 10_000)).toBe(JSON.stringify(obj));
  });

  it('cuts an object at whole records and keeps every other field, with a truncation stamp', () => {
    const results = Array.from({ length: 500 }, (_, i) => hit(i));
    const result = {
      documentType: 'creature',
      results,
      totalFound: 500,
      note: 'Premium book creatures only — narrow with name/challengeRating.',
    };
    const text = capResult(result, 20_000);
    expect(text.length).toBeLessThanOrEqual(20_000);
    const parsed = JSON.parse(text); // never torn mid-JSON
    expect(parsed.totalFound).toBe(500);
    expect(parsed.note).toContain('Premium book');
    expect(parsed.results.length).toBeGreaterThan(100);
    expect(parsed.results.length).toBeLessThan(500);
    expect(parsed.results.at(-1)).toEqual(hit(parsed.results.length - 1));
    expect(parsed.truncation).toMatchObject({
      path: 'results',
      kept: parsed.results.length,
      omitted: 500 - parsed.results.length,
      of: 500,
    });
    expect(parsed.truncation.note).toContain('response exceeded toolResponseMaxChars (20000)');
    // The longest prefix that fits: one more record would not.
    const oneMore = JSON.stringify({
      ...result,
      results: results.slice(0, parsed.results.length + 1),
      truncation: parsed.truncation,
    });
    expect(oneMore.length).toBeGreaterThan(20_000);
  });

  it('finds the largest array below the top level and stamps its dotted path', () => {
    const result = {
      character: {
        name: 'Gren',
        items: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}`, n: i })),
        effects: [{ id: 'e1' }],
      },
      warnings: ['one'],
    };
    const parsed = JSON.parse(capResult(result, 3_000));
    expect(parsed.truncation.path).toBe('character.items');
    expect(parsed.character.name).toBe('Gren');
    expect(parsed.character.effects).toEqual([{ id: 'e1' }]);
    expect(parsed.warnings).toEqual(['one']);
    expect(parsed.character.items.length).toBe(parsed.truncation.kept);
    expect(parsed.truncation.of).toBe(300);
  });

  it('cuts a string at the last newline and counts the lines it dropped', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- **Actor ${i}** (id: a${i})`);
    const text = capResult(lines.join('\n'), 1_000);
    const [body, marker] = text.split('\n…[');
    expect(body!.length).toBeLessThan(1_000);
    expect(body!.endsWith(')')).toBe(true); // a whole line
    const keptLines = body!.split('\n').length;
    expect(marker).toBe(
      `${200 - keptLines} more line(s) omitted — response exceeded toolResponseMaxChars (1000)]`
    );
  });

  it('falls back to the character cut when there is no array to cut', () => {
    const text = capResult({ description: 'x'.repeat(5_000) }, 1_000);
    expect(text.startsWith('{"description":"xxx')).toBe(true);
    expect(text).toContain('chars omitted — response exceeded toolResponseMaxChars (1000)');
    const arr = capResult('y'.repeat(5_000), 1_000); // a string with no newline
    expect(arr).toContain('more line(s) omitted');
  });

  it('falls back to the character cut when the rest of the object is itself over the cap', () => {
    const text = capResult({ blob: 'z'.repeat(5_000), rows: [1, 2, 3] }, 1_000);
    expect(text).toContain('chars omitted — response exceeded toolResponseMaxChars (1000)');
  });
});
