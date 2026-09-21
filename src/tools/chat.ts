import { z } from 'zod';
import { actorTarget } from './_targets.js';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, isAbsolute, basename } from 'node:path';
import type { FoundryBridge } from '../foundry.js';
import { Logger } from '../logger.js';
import type { FilePlane, Host } from '../hosts/types.js';
import { filePlaneFor } from '../hosts/index.js';
import {
  guessContentType,
  humanSize,
  looksLikeWorldDbPath,
  toDataRelative,
  worldDbRefusal,
} from '../hosts/paths.js';
import { toInputSchema } from '../utils/schema.js';
import { formatDeletionResult } from '../utils/format.js';
import { validateExportDestinations } from '../utils/transcript.js';
import { fileErrorMessage } from './assets/access.js';

/**
 * Chat-log tools — post / list / delete / export chat messages, plus rich dnd5e cards.
 *
 * send-chat-message covers all five visibility modes (public / public-as-character / gm / blind /
 * self) and embeds images as a first-class param (local files are uploaded through the file plane,
 * then linked).
 * post-item-card drives the dnd5e Activity system so its Attack/Damage/Apply-Effects buttons actually
 * work (the only way without an installed module). export-chat-log writes to a local file AND/OR a
 * Data/ path through the file plane. GM-only writes; the bridge user is a GM.
 */

const ImageSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('An absolute local file (uploaded), a Data-relative asset path, or an https URL.'),
  caption: z.string().optional().describe('Caption under the image.'),
  alt: z.string().optional().describe('Alt text (default the caption).'),
  embed: z
    .enum(['upload', 'dataUri'])
    .default('upload')
    .describe(
      'upload = a local file goes to the world and is linked; dataUri = inlined as base64 (small images).'
    ),
});

const SendChatMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      'HTML; inline rolls ([[/r 1d20+5]]) and @UUID links are enriched. Images: the images param.'
    ),
  visibility: z
    .enum(['public', 'gm', 'blind', 'self'])
    .default('public')
    .describe(
      'public = everyone; gm = a whisper to the GMs; blind = gm + the blind flag; self = the bridge user.'
    ),
  speakerActor: z
    .string()
    .optional()
    .describe(
      'Actor id or name (substring ok), or a token id: the message speaks as that character.'
    ),
  flavor: z.string().optional().describe('A secondary header line.'),
  style: z
    .enum(['ooc', 'ic', 'emote', 'other'])
    .optional()
    .describe('Default ic with speakerActor, else ooc.'),
  enrich: z
    .boolean()
    .default(true)
    .describe('Resolve @UUID links and inline rolls before posting.'),
  images: z
    .array(ImageSchema)
    .optional()
    .describe('Images to embed; an uploaded file is served publicly, without auth.'),
  imageFolder: z
    .string()
    .optional()
    .describe('Data-relative folder for uploads (default "worlds/<world>/assets/chat").'),
  overwriteImages: z
    .boolean()
    .default(false)
    .describe('Overwrite an existing upload of the same name.'),
});

const ListChatMessagesSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(50)
    .describe('The most recent N (newest last).'),
  sinceTimestamp: z
    .number()
    .int()
    .optional()
    .describe('Only messages with timestamp (ms epoch) at/after this value.'),
  contentMode: z
    .enum(['html', 'text', 'none'])
    .default('text')
    .describe('Raw HTML, text, or no content.'),
});

const DeleteChatMessagesSchema = z
  .object({
    ids: z.array(z.string().min(1)).optional().describe('Message ids.'),
    beforeTimestamp: z
      .number()
      .int()
      .optional()
      .describe('Every message older than this epoch ms (needs confirm).'),
    clearAll: z.boolean().default(false).describe('Every message (needs confirm).'),
    confirm: z
      .boolean()
      .default(false)
      .describe('Required by the two bulk modes (irreversible); not by ids.'),
  })
  .refine(a => (a.ids && a.ids.length > 0) || a.beforeTimestamp !== undefined || a.clearAll, {
    message: 'Provide ids, beforeTimestamp, or clearAll.',
  });

const ExportChatLogSchema = z
  .object({
    format: z
      .enum(['markdown', 'html', 'json', 'plaintext'])
      .default('markdown')
      .describe(
        'markdown / plaintext strip HTML (roll totals kept); html is the raw markup; json the records.'
      ),
    localPath: z
      .string()
      .min(1)
      .optional()
      .describe('Absolute local path (parent directories created).'),
    remotePath: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Data-relative path for a copy through the file plane (returns its URL; no html on the bridge plane).'
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The most recent N (default the whole log).'),
    sinceTimestamp: z
      .number()
      .int()
      .optional()
      .describe('Only messages at/after this ms-epoch timestamp.'),
    overwrite: z
      .boolean()
      .default(false)
      .describe('Overwrite an existing file at either destination.'),
  })
  .refine(a => a.localPath || a.remotePath, {
    message: 'Provide localPath, remotePath, or both.',
  });

const PostItemCardSchema = z.object({
  actor: actorTarget,
  item: z.string().min(1).describe('Item / feature / spell id or exact name on that actor.'),
  activity: z.string().optional().describe('Activity id or name (default the first).'),
  action: z
    .enum(['use', 'attack', 'damage'])
    .default('use')
    .describe(
      'use = the usage card with its buttons; attack / damage = roll it to chat (no auto-targets headless).'
    ),
  consume: z.boolean().default(false).describe('Spend the uses / slots (default false).'),
  critical: z.boolean().default(false).describe('damage: roll a critical.'),
});

const RequestRollSchema = z
  .object({
    kind: z
      .enum(['save', 'check', 'skill'])
      .describe('save and check take ability; skill takes skill.'),
    ability: z.string().optional().describe('Ability key ("dex", "wis").'),
    skill: z.string().optional().describe('Skill key ("ste", "prc").'),
    dc: z.number().int().positive().optional().describe('DC shown on the card.'),
    flavor: z.string().optional().describe('A label.'),
    visibility: z
      .enum(['public', 'gm'])
      .default('public')
      .describe('public = the whole table; gm = GMs only.'),
  })
  .refine(a => (a.kind === 'skill' ? !!a.skill : !!a.ability), {
    message: 'save/check require an ability; skill requires a skill.',
  });

export interface ChatToolsOptions {
  foundry: FoundryBridge;
  logger: Logger;
  /** Where Foundry runs — the file plane for image uploads / the remote export copy. */
  host: Host;
}

export class ChatTools {
  private foundry: FoundryBridge;
  private logger: Logger;
  private host: Host;
  /** The file plane for image uploads and the export's remote copy (direct, else the bridge). */
  private files: FilePlane;

  constructor({ foundry, logger, host }: ChatToolsOptions) {
    this.foundry = foundry;
    this.logger = logger.child({ component: 'ChatTools' });
    this.host = host;
    this.files = filePlaneFor(host, foundry);
  }

  getToolDefinitions() {
    return [
      {
        name: 'send-chat-message',
        description:
          'Post an HTML message to the chat log as the bridge user, with a visibility, optionally as ' +
          'a character (speakerActor), with images (an uploaded file is public). GM-only.',
        inputSchema: toInputSchema(SendChatMessageSchema),
      },
      {
        name: 'list-chat-messages',
        description:
          'Recent chat messages: id, author, time, whisper / blind, content (per contentMode).',
        inputSchema: toInputSchema(ListChatMessagesSchema),
      },
      {
        name: 'delete-chat-messages',
        description:
          'Delete chat messages by id, older than a timestamp, or all; the bulk modes need ' +
          'confirm:true. Irreversible. GM-only.',
        inputSchema: toInputSchema(DeleteChatMessagesSchema),
      },
      {
        name: 'export-chat-log',
        description:
          'Export the chat transcript (markdown / html / json / plaintext) to a local file and/or a ' +
          'Data path through the file plane. Refuses an existing file unless overwrite:true.',
        inputSchema: toInputSchema(ExportChatLogSchema),
      },
      {
        name: 'post-item-card',
        description:
          "Post an actor item's dnd5e usage card with its working buttons, or roll its attack / " +
          'damage to chat; an item with no activity says so. GM-only.',
        inputSchema: toInputSchema(PostItemCardSchema),
      },
      {
        name: 'request-roll',
        description:
          'Post a click-to-roll request card (save / check / skill, with a DC) players click to ' +
          'roll their own. GM-only.',
        inputSchema: toInputSchema(RequestRollSchema),
      },
    ];
  }

  // --- send -----------------------------------------------------------------

  async handleSendChatMessage(args: any): Promise<string> {
    const parsed = SendChatMessageSchema.parse(args ?? {});

    let content = parsed.content;
    if (parsed.images && parsed.images.length > 0) {
      const assembled = await this.assembleImages(
        parsed.images,
        parsed.imageFolder ?? `worlds/${await this.foundry.worldId()}/assets/chat`,
        parsed.overwriteImages
      );
      if ('refusal' in assembled) return assembled.refusal;
      content = `${content}\n${assembled.figures.join('\n')}`;
    }

    const result = await this.foundry.call('postChatMessage', {
      content,
      visibility: parsed.visibility,
      speakerActor: parsed.speakerActor,
      flavor: parsed.flavor,
      style: parsed.style,
      enrich: parsed.enrich,
    });
    return (
      `Posted chat message ${result?.id} as "${result?.alias}" ` +
      `(${result?.visibility}, whisper: ${result?.whisperCount}).`
    );
  }

  /**
   * Resolve each image to a public URL (uploading absolute local files through the file plane) and
   * build the <figure> HTML. Returns a plain refusal string on a plane / world-DB guard rather than
   * throwing.
   */
  private async assembleImages(
    images: Array<{
      path: string;
      caption?: string | undefined;
      alt?: string | undefined;
      embed?: 'upload' | 'dataUri' | undefined;
    }>,
    folder: string,
    overwrite: boolean
  ): Promise<{ figures: string[] } | { refusal: string }> {
    const figures: string[] = [];
    for (const img of images) {
      const p = img.path;
      let url: string;

      // dataUri: inline a LOCAL file as base64 directly in the HTML (no upload).
      if (img.embed === 'dataUri') {
        if (/^https?:\/\//i.test(p) || p.startsWith('data:')) {
          return {
            refusal: `Image "${p}": embed:"dataUri" needs a LOCAL file path, not a URL. Use embed:"upload" or pass a local file.`,
          };
        }
        let bytes: Buffer;
        try {
          bytes = await readFile(p);
        } catch (err) {
          return {
            refusal: `Cannot read local image "${p}" for dataUri embed: ${(err as Error).message}`,
          };
        }
        const mime = guessContentType(p) || 'application/octet-stream';
        url = `data:${mime};base64,${bytes.toString('base64')}`;
        figures.push(figureHtml(url, img.caption, img.alt));
        continue;
      }

      if (/^https?:\/\//i.test(p)) {
        url = p;
      } else if (isAbsolute(p)) {
        // Local file → upload through the file plane, then link the public URL.
        const files = this.files;
        const remote = toDataRelative(`${folder}/${basename(p)}`);
        if (looksLikeWorldDbPath(remote)) return { refusal: worldDbRefusal(remote) };
        let bytes: Uint8Array;
        try {
          bytes = await readFile(p);
        } catch (err) {
          return { refusal: `Cannot read local image "${p}": ${(err as Error).message}` };
        }
        try {
          if (overwrite || !(await files.exists(remote))) {
            await files.ensureParents(remote);
            await files.write(remote, bytes, guessContentType(p));
          }
          url = this.host.publicUrl(remote);
        } catch (err) {
          return {
            refusal: fileErrorMessage('send-chat-message (image upload)', err, this.logger),
          };
        }
      } else {
        // Treat as an existing Data-relative asset path.
        url = this.host.publicUrl(toDataRelative(p));
      }

      figures.push(figureHtml(url, img.caption, img.alt));
    }
    return { figures };
  }

  // --- list -----------------------------------------------------------------

  async handleListChatMessages(args: any): Promise<string> {
    const parsed = ListChatMessagesSchema.parse(args ?? {});
    const res = await this.foundry.call('listChatMessages', parsed);
    const messages: any[] = res?.messages ?? [];
    if (messages.length === 0) return 'No chat messages.';
    const lines = messages.map(m => {
      const preview = (m.content ?? '').replace(/\s+/g, ' ').slice(0, 80);
      const w = m.whisperCount ? ` [whisper:${m.whisperCount}${m.blind ? ',blind' : ''}]` : '';
      const who = m.alias || m.authorName || '?';
      return `  - ${m.id} [${m.time}] ${who}${w}: ${preview}`;
    });
    return `${messages.length} message(s):\n${lines.join('\n')}`;
  }

  // --- delete ---------------------------------------------------------------

  async handleDeleteChatMessages(args: any): Promise<string> {
    const parsed = DeleteChatMessagesSchema.parse(args ?? {});
    // Guard the irreversible bulk deletes BEFORE touching the bridge (clearAll + beforeTimestamp).
    if (parsed.clearAll && !parsed.confirm) {
      return (
        'Refused: clearAll deletes EVERY chat message and is irreversible. ' +
        'Pass confirm:true to proceed.'
      );
    }
    if (parsed.beforeTimestamp !== undefined && !parsed.confirm) {
      return (
        'Refused: beforeTimestamp deletes every message older than the cutoff and is irreversible. ' +
        'Pass confirm:true to proceed.'
      );
    }
    const result = await this.foundry.call('deleteChatMessages', parsed);
    if (result?.clearedAll) {
      return `Cleared the chat log — deleted ${result.deletedCount} message(s).`;
    }
    return formatDeletionResult(result, 'chat message(s)');
  }

  // --- export ---------------------------------------------------------------

  async handleExportChatLog(args: any): Promise<string> {
    const parsed = ExportChatLogSchema.parse(args ?? {});
    // Build conditionally to avoid explicit-undefined props (exactOptionalPropertyTypes).
    const dest: { localPath?: string; remotePath?: string } = {};
    if (parsed.localPath) dest.localPath = parsed.localPath;
    if (parsed.remotePath) dest.remotePath = parsed.remotePath;
    const check = validateExportDestinations(dest);
    if (!check.ok) return `Refused: ${check.error}`;

    const res = await this.foundry.call('exportChatLog', {
      format: parsed.format,
      limit: parsed.limit,
      sinceTimestamp: parsed.sinceTimestamp,
    });
    const content: string = res?.content ?? '';
    const bytes = Buffer.from(content, 'utf8');
    const outLines: string[] = [];

    // Local destination.
    if (parsed.localPath) {
      if (!parsed.overwrite && (await fileExists(parsed.localPath))) {
        return `Refused: local file "${parsed.localPath}" already exists. Pass overwrite:true to replace it.`;
      }
      try {
        await mkdir(dirname(parsed.localPath), { recursive: true });
        await writeFile(parsed.localPath, bytes);
        outLines.push(`  local: ${parsed.localPath} (${humanSize(bytes.length)})`);
      } catch (err) {
        return `export-chat-log failed writing "${parsed.localPath}": ${(err as Error).message}`;
      }
    }

    // Remote destination — the file plane.
    if (parsed.remotePath) {
      const clean = toDataRelative(parsed.remotePath);
      if (looksLikeWorldDbPath(clean)) return worldDbRefusal(parsed.remotePath);
      const files = this.files;
      try {
        if (!parsed.overwrite && (await files.exists(clean))) {
          return `Refused: "Data/${clean}" already exists. Pass overwrite:true to replace it.`;
        }
        await files.ensureParents(clean);
        await files.write(clean, bytes, guessContentType(parsed.remotePath));
        outLines.push(`  Data/${clean}\n  public URL: ${this.host.publicUrl(clean)}`);
      } catch (err) {
        return fileErrorMessage('export-chat-log', err, this.logger);
      }
    }

    return `Exported ${res?.messageCount ?? 0} message(s) as ${parsed.format} →\n${outLines.join('\n')}`;
  }

  // --- dnd5e rich cards -----------------------------------------------------

  async handlePostItemCard(args: any): Promise<string> {
    const parsed = PostItemCardSchema.parse(args ?? {});
    const r = await this.foundry.call('postItemCard', parsed);
    if (!r.posted) return `Could not post a rich card: ${r.reason}`;
    return `Posted ${r.action} card for "${r.itemName}" (${r.activityType}) as ${r.actorName}.`;
  }

  async handleRequestRoll(args: any): Promise<string> {
    const parsed = RequestRollSchema.parse(args ?? {});
    const r = await this.foundry.call('requestRoll', parsed);
    return `Posted ${r?.kind} request (${r?.expression}) — players can click to roll.`;
  }
}

/** Escape a string for use in an HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text content for HTML. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build a <figure> with an embedded image (+ optional caption). */
function figureHtml(url: string, caption?: string, alt?: string): string {
  const altText = alt ?? caption ?? '';
  const cap = caption ? `<figcaption>${escapeText(caption)}</figcaption>` : '';
  return `<figure><img src="${escapeAttr(url)}" alt="${escapeAttr(altText)}">${cap}</figure>`;
}

/** True if a local path exists (used for the overwrite guard). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
