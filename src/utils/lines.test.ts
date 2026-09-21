import { describe, expect, it } from 'vitest';
import { cell, listLines, warningBlock } from './lines.js';

describe('listLines (the §3 list shape: header + one line per record)', () => {
  it('names the column order, then one row per record in that order', () => {
    expect(
      listLines(
        '2 macro(s)',
        ['id', 'name', 'type'],
        [
          { id: 'm1', name: 'Graze', type: 'script', extra: 'ignored' },
          { id: 'm2', type: 'chat' },
        ]
      )
    ).toBe('2 macro(s): id name type\nm1 Graze script\nm2 - chat');
  });

  it('an empty list is the header alone', () => {
    expect(listLines('0 macro(s)', ['id'], [])).toBe('0 macro(s).');
  });
});

describe('cell', () => {
  it('- for null / missing, bare tokens, quoted strings with whitespace, JSON for the rest', () => {
    expect(cell(undefined)).toBe('-');
    expect(cell(null)).toBe('-');
    expect(cell(3)).toBe('3');
    expect(cell(false)).toBe('false');
    expect(cell('Graze')).toBe('Graze');
    expect(cell('Big Rock')).toBe('"Big Rock"');
    expect(cell('')).toBe('""');
    expect(cell([0, 0, 100, 0])).toBe('0,0,100,0');
    expect(cell(['x', 'y'])).toBe('["x","y"]');
    expect(cell({ x: 1 })).toBe('{"x":1}');
  });
});

describe('warningBlock', () => {
  it('is empty without warnings and a counted bullet block with them', () => {
    expect(warningBlock()).toBe('');
    expect(warningBlock([])).toBe('');
    expect(warningBlock(['a', 'b'])).toBe('\n\n⚠️ 2 warning(s):\n- a\n- b');
  });
});
