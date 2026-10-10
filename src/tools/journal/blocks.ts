// Pure typed-block journal renderer — string/data in, HTML out, no Foundry / logger / IO.
//
// This is the STRUCTURING half of the journal building block (design.md §2.1 / §5): the skill supplies
// the WORDS as typed blocks, this renderer arranges them into dnd5e's documented journal block kit
// (https://github.com/foundryvtt/dnd5e/wiki/System-HTML — `fvtt narrative`, `notable`, `fvtt advice`,
// `fvtt quest`, `quote-lg`), which the system's own stylesheet draws inside its journal sheet, plus
// core Foundry's secret section. No wrapper and no stylesheet of ours: the classes are the system's.
// It NEVER invents prose — every `text`/`html`/`items` value is the caller's.
//
// `blockSchema` (zod) is the single source of truth for the block contract; the journal tools import it
// for their `pages[].blocks` input, and `Block` is its inferred type.

import { z } from 'zod';

const title = z.string().optional().describe('Title (an h4).');
const icon = z.string().optional().describe('Round icon off the left edge (image path).');

/**
 * The journal block contract. A discriminated union — each variant is a deterministic styling of
 * CALLER-SUPPLIED content (the skill's words). `grid` is intentionally NON-recursive (columns of headed
 * lists) to keep the generated MCP input schema flat and 2020-12-valid; `html` is the escape hatch for
 * anything the typed blocks don't cover.
 */
export const blockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().min(1).describe('Heading text (plain).'),
    level: z
      .union([z.literal(2), z.literal(3)])
      .optional()
      .describe('Heading level: 2 (default, section) or 3 (subsection).'),
  }),
  z.object({
    type: z.literal('lead'),
    html: z.string().min(1).describe('Summary/intro line (a plain paragraph).'),
  }),
  z.object({
    type: z.literal('paragraph'),
    html: z.string().min(1).describe('A body paragraph (inline HTML allowed).'),
  }),
  z.object({
    type: z.literal('readaloud'),
    html: z.string().min(1).describe('Boxed read-aloud text (the dnd5e narrative box).'),
  }),
  z.object({
    type: z.literal('gmnote'),
    html: z
      .string()
      .min(1)
      .describe(
        'A Foundry secret: hidden from players even on a shared page; the GM can Reveal it.'
      ),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string().min(1)).min(1).describe('Bulleted list items (inline HTML allowed).'),
  }),
  z.object({
    type: z.literal('grid'),
    columns: z
      .array(
        z.object({
          heading: z.string().optional().describe('Optional column heading.'),
          items: z.array(z.string().min(1)).min(1).describe('Column list items.'),
        })
      )
      .min(1)
      .describe('Headed lists, each drawn as a notable callout.'),
  }),
  z.object({
    type: z.literal('notable'),
    title,
    html: z.string().min(1).describe('Callout body: a rule or fact the table must remember.'),
  }),
  z.object({
    type: z.literal('advice'),
    title,
    html: z.string().min(1).describe('Card body: advice to the GM.'),
    img: icon,
  }),
  z.object({
    type: z.literal('quest'),
    title,
    html: z.string().min(1).describe('Card body: an objective.'),
    img: icon,
  }),
  z.object({
    type: z.literal('quote'),
    html: z.string().min(1).describe('Pull quote text (inline HTML), floated right.'),
    author: z.string().optional().describe('Attribution line.'),
  }),
  z.object({
    type: z.literal('html'),
    html: z.string().min(1).describe('Raw HTML escape hatch (rendered verbatim).'),
  }),
]);

export type Block = z.infer<typeof blockSchema>;

/** Defensively strip <script> from caller HTML (trusted GM tooling, but never inject script). */
function clean(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/**
 * Caller HTML as box content: kept as is when it already opens with a block element, else one `<p>`.
 * dnd5e's boxes draw their lower corner marks on the last child element, so bare text needs one.
 */
function body(html: string): string {
  const h = clean(html).trim();
  return /^<(p|ul|ol|table|h[1-6]|div|section|blockquote|figure|aside|dl)\b/i.test(h)
    ? h
    : `<p>${h}</p>`;
}

const h4 = (text?: string) => (text ? `<h4>${text}</h4>` : '');
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const ul = (items: string[]) => `<ul>${items.map(i => `<li>${clean(i)}</li>`).join('')}</ul>`;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A 16-character id in the alphabet of Foundry's `foundry.utils.randomID()` (unbiased, as there).
 * Foundry's reveal button finds a secret by its id, so each secret needs its own.
 */
export function randomID(length = 16): string {
  const cutoff = 0x100000000 - (0x100000000 % ID_CHARS.length);
  const random = new Uint32Array(length);
  do {
    crypto.getRandomValues(random);
  } while (random.some(x => x >= cutoff));
  let id = '';
  for (let i = 0; i < length; i++) id += ID_CHARS[random[i] % ID_CHARS.length];
  return id;
}

/** Render one block to its HTML fragment (dnd5e's block kit; core Foundry for the secret). */
export function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading':
      return block.level === 3 ? `<h3>${block.text}</h3>` : `<h2>${block.text}</h2>`;
    case 'lead':
    case 'paragraph':
      // A lead is a summary line, not scene-setting (that is a readaloud): a plain paragraph.
      return `<p>${clean(block.html)}</p>`;
    case 'readaloud':
      return `<div class="fvtt narrative">${body(block.html)}</div>`;
    case 'gmnote':
      // Core Foundry secret markup (the ProseMirror secret node's): enrichHTML drops it for anyone
      // who does not own the page, and the GM's sheet gets the Reveal / Hide button.
      return `<section class="secret" id="secret-${randomID()}">${clean(block.html)}</section>`;
    case 'list':
      return ul(block.items);
    case 'grid':
      // dnd5e has no column layout and a page cannot carry a stylesheet: one notable per column.
      return block.columns
        .map(col => `<aside class="notable">${h4(col.heading)}${ul(col.items)}</aside>`)
        .join('');
    case 'notable':
      return `<aside class="notable">${h4(block.title)}${body(block.html)}</aside>`;
    case 'advice':
    case 'quest': {
      // Without an icon dnd5e keeps the card's left inset (half an icon's width): an empty margin.
      const figure = block.img
        ? `<figure class="icon"><img src="${attr(block.img)}" class="round"></figure>`
        : '';
      return `<div class="fvtt ${block.type}">${figure}<article>${h4(block.title)}${body(block.html)}</article></div>`;
    }
    case 'quote':
      return (
        `<aside class="quote-lg float-right"><p><q>${clean(block.html)}</q></p>` +
        `${block.author ? `<p class="quote-author">${clean(block.author)}</p>` : ''}</aside>`
      );
    case 'html':
      return clean(block.html);
  }
}

/**
 * Render blocks to the HTML a journal page's `text.content` is set to, or that is appended to it.
 * Appending after legacy `<section class="mcp-journal">` markup closes nothing and opens nothing:
 * the new fragment sits after the old section, never inside it.
 */
export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join('');
}
