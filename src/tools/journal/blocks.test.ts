/**
 * Offline unit tests for the pure journal block renderer (src/tools/journal/blocks.ts).
 *
 * Pins the EXACT HTML each block type produces (dnd5e's documented block kit, System-HTML on the
 * dnd5e wiki), and proves the renderer only ever emits the CALLER's words (no invented prose) — the
 * structural counterpart to evicting quest-content.ts's prose generators.
 */

import { describe, it, expect } from 'vitest';
import { renderBlock, renderBlocks, blockSchema, randomID, type Block } from './blocks.js';

describe('renderBlock — exact per-type HTML', () => {
  it('heading defaults to h2, level 3 -> h3', () => {
    expect(renderBlock({ type: 'heading', text: 'Objectives' })).toBe('<h2>Objectives</h2>');
    expect(renderBlock({ type: 'heading', text: 'Details', level: 3 })).toBe('<h3>Details</h3>');
  });

  it('lead and paragraph are plain paragraphs', () => {
    expect(renderBlock({ type: 'lead', html: 'A grim hook.' })).toBe('<p>A grim hook.</p>');
    expect(renderBlock({ type: 'paragraph', html: 'Plain body.' })).toBe('<p>Plain body.</p>');
  });

  it('readaloud is the dnd5e narrative box; bare text gets a paragraph', () => {
    expect(renderBlock({ type: 'readaloud', html: '<p>Cold air bites.</p>' })).toBe(
      '<div class="fvtt narrative"><p>Cold air bites.</p></div>'
    );
    expect(renderBlock({ type: 'readaloud', html: 'Cold air bites.' })).toBe(
      '<div class="fvtt narrative"><p>Cold air bites.</p></div>'
    );
    expect(renderBlock({ type: 'readaloud', html: '<p>One.</p><p>Two.</p>' })).toBe(
      '<div class="fvtt narrative"><p>One.</p><p>Two.</p></div>'
    );
  });

  it('gmnote is a core Foundry secret with a unique secret-<randomID> id', () => {
    const block: Block = { type: 'gmnote', html: '<p>The druid is charmed.</p>' };
    const a = renderBlock(block);
    expect(a).toMatch(
      /^<section class="secret" id="secret-[A-Za-z0-9]{16}"><p>The druid is charmed\.<\/p><\/section>$/
    );
    // Foundry's toggleRevealed() matches `<section[^i]+id="<id>"` — no "i" may precede the id.
    expect(a.slice('<section'.length, a.indexOf(' id='))).not.toContain('i');
    expect(renderBlock(block)).not.toBe(a);
  });

  it('every secret on a page gets its own id', () => {
    const html = renderBlocks([
      { type: 'gmnote', html: '<p>One.</p>' },
      { type: 'readaloud', html: '<p>Boxed.</p>' },
      { type: 'gmnote', html: '<p>Two.</p>' },
    ]);
    const ids = [...html.matchAll(/id="(secret-[A-Za-z0-9]{16})"/g)].map(m => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(html.startsWith('<section class="secret"')).toBe(true);
  });

  it('list', () => {
    expect(renderBlock({ type: 'list', items: ['Find the druid', 'Cleanse the spring'] })).toBe(
      '<ul><li>Find the druid</li><li>Cleanse the spring</li></ul>'
    );
  });

  it('grid draws each headed list as a notable callout', () => {
    expect(
      renderBlock({
        type: 'grid',
        columns: [
          { heading: 'Quest Details', items: ['Type: Side', 'Difficulty: Hard'] },
          { items: ['200 gp'] },
        ],
      })
    ).toBe(
      '<aside class="notable"><h4>Quest Details</h4><ul><li>Type: Side</li><li>Difficulty: Hard</li></ul></aside>' +
        '<aside class="notable"><ul><li>200 gp</li></ul></aside>'
    );
  });

  it('notable is an aside with an optional h4 title', () => {
    expect(renderBlock({ type: 'notable', title: 'Cover', html: 'Half cover: +2 AC.' })).toBe(
      '<aside class="notable"><h4>Cover</h4><p>Half cover: +2 AC.</p></aside>'
    );
    expect(renderBlock({ type: 'notable', html: '<p>No title.</p>' })).toBe(
      '<aside class="notable"><p>No title.</p></aside>'
    );
  });

  it('advice and quest are fvtt cards; the round icon is optional and its src is attribute-safe', () => {
    expect(
      renderBlock({
        type: 'advice',
        title: 'Casting in Armor',
        html: 'Proficiency matters.',
        img: 'icons/robe "x".webp',
      })
    ).toBe(
      '<div class="fvtt advice"><figure class="icon"><img src="icons/robe &quot;x&quot;.webp" class="round"></figure>' +
        '<article><h4>Casting in Armor</h4><p>Proficiency matters.</p></article></div>'
    );
    expect(renderBlock({ type: 'quest', title: 'Find the Key', html: '<p>In the well.</p>' })).toBe(
      '<div class="fvtt quest"><article><h4>Find the Key</h4><p>In the well.</p></article></div>'
    );
  });

  it('quote is a floated quote-lg aside with an optional author line', () => {
    expect(renderBlock({ type: 'quote', html: 'Not all who wander…', author: 'Bilbo' })).toBe(
      '<aside class="quote-lg float-right"><p><q>Not all who wander…</q></p>' +
        '<p class="quote-author">Bilbo</p></aside>'
    );
    expect(renderBlock({ type: 'quote', html: 'Anon.' })).toBe(
      '<aside class="quote-lg float-right"><p><q>Anon.</q></p></aside>'
    );
  });

  it('html escape hatch is verbatim', () => {
    expect(renderBlock({ type: 'html', html: '<table><tr><td>x</td></tr></table>' })).toBe(
      '<table><tr><td>x</td></tr></table>'
    );
  });

  it('strips <script> from caller HTML defensively', () => {
    expect(renderBlock({ type: 'paragraph', html: 'safe<script>alert(1)</script> text' })).toBe(
      '<p>safe text</p>'
    );
  });

  it('dnd5e enrichers pass through untouched', () => {
    const text =
      '[[/check dex 15]] [[/save ability=str/dex dc=20]] &Reference[prone] [[/damage 2d6 fire]]';
    expect(renderBlock({ type: 'paragraph', html: text })).toBe(`<p>${text}</p>`);
    expect(renderBlock({ type: 'readaloud', html: text })).toBe(
      `<div class="fvtt narrative"><p>${text}</p></div>`
    );
  });
});

describe('renderBlocks', () => {
  it('concatenates blocks in order, with no wrapper and no stylesheet', () => {
    const blocks: Block[] = [
      { type: 'heading', text: 'Hook' },
      { type: 'paragraph', html: 'Body.' },
    ];
    const html = renderBlocks(blocks);
    expect(html).toBe('<h2>Hook</h2><p>Body.</p>');
    expect(html).not.toContain('mcp-journal');
    expect(html).not.toContain('<style');
  });

  it('emits ONLY caller words — never invents prose', () => {
    // Sentinel words that the deleted quest generators used to fabricate.
    const html = renderBlocks([
      { type: 'readaloud', html: '<p>OnlyMyWords</p>' },
      { type: 'list', items: ['DoThisThing'] },
    ]);
    expect(html).toContain('OnlyMyWords');
    expect(html).toContain('DoThisThing');
    for (const fabricated of [
      'approaches the party',
      'urgent news',
      'blight is spreading',
      'Report back',
      'innocent people are at risk',
    ]) {
      expect(html).not.toContain(fabricated);
    }
  });
});

describe('randomID', () => {
  it('is 16 characters of the Foundry id alphabet by default', () => {
    expect(randomID()).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(randomID(8)).toHaveLength(8);
  });
});

describe('blockSchema', () => {
  it('accepts a valid discriminated block and rejects an unknown type / empty content', () => {
    expect(blockSchema.safeParse({ type: 'list', items: ['a'] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: 'quest', html: 'x', img: 'a.webp' }).success).toBe(true);
    expect(blockSchema.safeParse({ type: 'bogus', html: 'x' }).success).toBe(false);
    expect(blockSchema.safeParse({ type: 'paragraph', html: '' }).success).toBe(false);
    expect(blockSchema.safeParse({ type: 'notable', title: 'T' }).success).toBe(false);
  });
});
