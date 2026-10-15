// Page-side: chat-log reads + writes. Runs INSIDE the headless Foundry page.
//
// Posts/lists/deletes ChatMessage documents and builds export transcripts. Reaches ChatMessage /
// CONST / foundry.applications.ux.TextEditor off the page globals (collections.ts pattern; they are
// not declared in foundry-globals.d.ts). Pure logic (visibility mapping, record/transcript building,
// roll-request tokens) lives in chat-helpers.ts and is unit-tested offline. The bridge is always a
// ready GM, so all five visibility modes are reachable. No rollback; best-effort writes.
//
// Version-grounded for Foundry 14.367 / dnd5e 6.0.1 (see docs/history/dnd5e-6.0-compat-review.md):
//  - presentation = `style` (CONST.CHAT_MESSAGE_STYLES, by NAME), NOT the doc-subtype `type`;
//  - whisper-ness derives from the `whisper` id array (no WHISPER style); set whisper+blind
//    explicitly and pass NO rollMode so explicit recipients are respected;
//  - enrichHTML is async + namespaced (foundry.applications.ux.TextEditor.implementation);
//  - clear-all = deleteDocuments([], {deleteAll:true}); NEVER game.messages.flush() (blocking dialog);
//  - export builds the string in-page (never game.messages.export() — uncapturable browser download);
//  - rich dnd5e cards come from the Activity system (use/rollAttack/rollDamage), the only path whose
//    buttons rebind through the system's own listeners.

import { ambiguousTarget, fuzzyTier, resolveActorFuzzy, MCP_FLAG_SCOPE } from './_shared.js';
import {
  buildMessageVisibility,
  toMessageRecord,
  buildMarkdownTranscript,
  buildHtmlTranscript,
  buildPlaintextTranscript,
  buildRollRequestExpression,
  narratorSpeaker,
  type MessageRecord,
  type RawMessageFields,
  type Visibility,
  type StyleName,
} from './chat-helpers.js';
import { invalid, notFound, unsupported } from './errors.js';

const CONST_: any = (globalThis as any).CONST;

// File extension per transcript format. Inlined (not imported from utils/transcript.ts) so the
// page bundle stays browser-only — transcript.ts pulls in node:path for the Node-side validator.
const FORMAT_EXT: Record<'markdown' | 'html' | 'json' | 'plaintext', string> = {
  markdown: 'md',
  html: 'html',
  json: 'json',
  plaintext: 'txt',
};

/** The configured ChatMessage document class (falls back to the global). */
function chatMessageClass(): any {
  return game.messages?.documentClass ?? (globalThis as any).ChatMessage;
}

/** Strip HTML to plain text using a detached element (browser-only). */
function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html ?? '';
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Enrich content HTML (resolve @UUID links + inline rolls). Async + namespaced on v13/v14. */
async function enrich(content: string, relativeTo?: any): Promise<string> {
  const TE = (globalThis as any).foundry?.applications?.ux?.TextEditor;
  const impl = TE?.implementation ?? TE;
  if (!impl?.enrichHTML) return content;
  const opts: any = { rolls: true, documents: true, secrets: !!game.user?.isGM };
  if (relativeTo) opts.relativeTo = relativeTo;
  return await impl.enrichHTML(content, opts);
}

/**
 * Render a message whose body lives in its system data. dnd5e 6.0 creates activity / roll cards
 * with NO `content` — the card is rendered at display time from `message.system` (a
 * ChatMessageDataModel with an async `render(options)`). Empty when the model has no template.
 */
async function renderSystemContent(m: any): Promise<string> {
  if (typeof m?.system?.render !== 'function') return '';
  try {
    const html = await m.system.render({});
    return typeof html === 'string' ? html : '';
  } catch {
    return '';
  }
}

/** Extract the canonical per-message fields for listing/export. */
async function rawFields(m: any): Promise<RawMessageFields> {
  const authorId = typeof m.author === 'string' ? m.author : (m.author?.id ?? '');
  const authorName =
    (typeof m.author === 'object' ? m.author?.name : undefined) ??
    game.users?.get(authorId)?.name ??
    '';
  const whisper = Array.isArray(m.whisper)
    ? m.whisper.map((w: any) => (typeof w === 'string' ? w : (w?.id ?? '')))
    : [];
  // Build roll records without explicit-undefined keys (exactOptionalPropertyTypes).
  const rolls = Array.isArray(m.rolls)
    ? m.rolls.map((r: any) => {
        const o: { total?: number | undefined; formula?: string | undefined } = {};
        if (typeof r?.total === 'number') o.total = r.total;
        const f = r?.formula ?? r?._formula;
        if (typeof f === 'string') o.formula = f;
        return o;
      })
    : [];
  const content = m.content || (await renderSystemContent(m));
  return {
    id: m.id ?? '',
    author: authorId,
    authorName,
    alias: m.speaker?.alias ?? m.alias ?? '',
    timestamp: m.timestamp ?? 0,
    style: m.style ?? 0,
    content,
    title: m.title ?? '',
    flavor: m.flavor ?? '',
    whisper,
    blind: !!m.blind,
    isRoll: !!m.isRoll,
    rolls,
  };
}

// --- send -------------------------------------------------------------------

export async function postChatMessage(args: {
  content: string;
  visibility?: Visibility | undefined;
  speakerActor?: string | undefined;
  speakerAlias?: string | undefined;
  flavor?: string | undefined;
  style?: StyleName | undefined;
  enrich?: boolean | undefined;
}) {
  if (!args?.content || typeof args.content !== 'string') {
    throw invalid('content is required and must be a non-empty string');
  }
  const Cls = chatMessageClass();
  const visibility: Visibility = args.visibility ?? 'public';

  let actorDoc: any;
  let speaker: any;
  const aliasArg = (args.speakerAlias ?? '').trim();
  if (args.speakerActor) {
    actorDoc = resolveActorFuzzy(args.speakerActor, 'write');
    if (!actorDoc) throw notFound(`speakerActor "${args.speakerActor}" not found`);
    speaker = Cls.getSpeaker({ actor: actorDoc, ...(aliasArg ? { alias: aliasArg } : {}) });
  } else {
    // Never a bare getSpeaker(): it infers from the headless page's controlled token.
    speaker = narratorSpeaker(aliasArg, game.user?.name ?? 'Narrator');
  }
  const alias = speaker?.alias ?? actorDoc?.name ?? game.user?.name ?? '';

  const gmIds = Cls.getWhisperRecipients('GM').map((u: any) => u.id);
  const { whisper, blind, style } = buildMessageVisibility({
    visibility,
    styleName: args.style,
    hasSpeaker: !!actorDoc,
    styleConst: CONST_?.CHAT_MESSAGE_STYLES ?? {},
    gmIds,
    selfUserId: game.user?.id ?? '',
  });

  let content = args.content;
  if (args.enrich !== false) content = await enrich(content, actorDoc);

  const data: any = {
    content,
    speaker,
    whisper,
    blind,
    style,
    flags: { [MCP_FLAG_SCOPE]: { mcp: { tool: 'send-chat-message' } } },
  };
  if (args.flavor) data.flavor = args.flavor;

  const msg = await Cls.create(data);
  return { success: true, id: msg?.id, alias, visibility, whisperCount: whisper.length };
}

// --- list -------------------------------------------------------------------

export async function listChatMessages(args: {
  limit?: number | undefined;
  sinceTimestamp?: number | undefined;
  contentMode?: 'html' | 'text' | 'none' | undefined;
}) {
  const limit = args?.limit ?? 50;
  const contentMode = args?.contentMode ?? 'text';
  let msgs = (game.messages?.contents ?? [])
    .slice()
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (args?.sinceTimestamp !== undefined) {
    msgs = msgs.filter((m: any) => (m.timestamp ?? 0) >= args.sinceTimestamp!);
  }
  msgs = msgs.slice(-limit);
  const messages: unknown[] = [];
  for (const m of msgs) {
    messages.push(toMessageRecord(await rawFields(m), { contentMode, stripFn: stripHtml }));
  }
  return { count: messages.length, messages };
}

// --- delete -----------------------------------------------------------------

export async function deleteChatMessages(args: {
  ids?: string[] | undefined;
  beforeTimestamp?: number | undefined;
  clearAll?: boolean | undefined;
  confirm?: boolean | undefined;
}) {
  const Cls = chatMessageClass();

  // Precedence: clearAll > beforeTimestamp > ids.
  if (args?.clearAll) {
    if (!args.confirm) {
      return { success: false, refused: true, reason: 'clearAll requires confirm:true' };
    }
    const count = game.messages?.contents?.length ?? 0;
    await Cls.deleteDocuments([], { deleteAll: true });
    return { success: true, deletedCount: count, deleted: [], clearedAll: true };
  }

  let targets: any[];
  let notFound: string[] | undefined;
  if (args?.beforeTimestamp !== undefined) {
    // beforeTimestamp is destructive at scale (it deletes EVERY message older than the cutoff —
    // beforeTimestamp:Date.now() wipes the whole log), so gate it like clearAll, not like a targeted
    // id delete.
    if (!args.confirm) {
      return {
        success: false,
        refused: true,
        reason:
          'beforeTimestamp requires confirm:true (it deletes every message older than the cutoff)',
      };
    }
    const cutoff = args.beforeTimestamp;
    targets = (game.messages?.contents ?? []).filter((m: any) => (m.timestamp ?? 0) < cutoff);
  } else if (Array.isArray(args?.ids) && args.ids.length > 0) {
    targets = [];
    const missing: string[] = [];
    for (const id of args.ids) {
      const m = game.messages?.get(id);
      if (m) targets.push(m);
      else missing.push(id);
    }
    if (missing.length > 0) notFound = missing;
  } else {
    throw invalid('Provide ids, beforeTimestamp, or clearAll.');
  }

  const deleted = targets.map((m: any) => ({ id: m.id, name: m.speaker?.alias ?? m.alias ?? '' }));
  const ids = targets.map((m: any) => m.id);
  // One bulk DB op, chunked for very large logs.
  for (let i = 0; i < ids.length; i += 500) {
    await Cls.deleteDocuments(ids.slice(i, i + 500));
  }
  return {
    success: true,
    deletedCount: ids.length,
    deleted,
    ...(notFound ? { notFound } : {}),
  };
}

// --- export -----------------------------------------------------------------

export async function exportChatLog(args: {
  format?: 'markdown' | 'html' | 'json' | 'plaintext' | undefined;
  limit?: number | undefined;
  sinceTimestamp?: number | undefined;
}) {
  const format = args?.format ?? 'markdown';
  let msgs = (game.messages?.contents ?? [])
    .slice()
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (args?.sinceTimestamp !== undefined) {
    msgs = msgs.filter((m: any) => (m.timestamp ?? 0) >= args.sinceTimestamp!);
  }
  if (args?.limit) msgs = msgs.slice(-args.limit);

  const contentMode = format === 'html' ? 'html' : 'text';
  const records: MessageRecord[] = [];
  for (const m of msgs) {
    records.push(toMessageRecord(await rawFields(m), { contentMode, stripFn: stripHtml }));
  }

  let content: string;
  if (format === 'json') content = JSON.stringify(records, null, 2);
  else if (format === 'html') content = buildHtmlTranscript(records);
  else if (format === 'plaintext') content = buildPlaintextTranscript(records);
  else content = buildMarkdownTranscript(records);

  return {
    format,
    messageCount: records.length,
    content,
    suggestedFilename: `chat-log.${FORMAT_EXT[format]}`,
  };
}

// --- dnd5e rich cards -------------------------------------------------------

export async function postItemCard(args: {
  actor: string;
  item: string;
  activity?: string | undefined;
  action?: 'use' | 'attack' | 'damage' | undefined;
  consume?: boolean | undefined;
  critical?: boolean | undefined;
}) {
  const actor = resolveActorFuzzy(args.actor, 'write');
  if (!actor) throw notFound(`actor "${args.actor}" not found`);
  // the exact id, then the exact name: a card is a write, so a name two items share is refused
  const named = fuzzyTier(actor.items, args.item, { substring: false, caseless: false });
  if (named.length > 1) throw ambiguousTarget('Item', args.item, named);
  const item = named[0];
  if (!item) throw notFound(`item "${args.item}" not found on actor "${actor.name}"`);

  const activities = item.system?.activities;
  const list: any[] = activities ? (activities.contents ?? Array.from(activities ?? [])) : [];
  let activity: any;
  if (args.activity) {
    activity =
      activities?.get?.(args.activity) ??
      activities?.getName?.(args.activity) ??
      list.find((a: any) => a?.id === args.activity || a?.name === args.activity);
  } else {
    activity = list[0];
  }

  if (!activity && args.activity) {
    const names = list.map((a: any) => `"${a?.name ?? a?.type}" (${a?.id})`).join(', ');
    throw notFound(
      `activity "${args.activity}" not found on "${item.name}"` +
        (names ? ` (its activities: ${names})` : ' (it has no activities)')
    );
  }
  if (!activity) {
    throw unsupported(
      `"${item.name}" on "${actor.name}" has no activities, and a rich card's buttons need one ` +
        '(dnd5e 5.x). Use send-chat-message for a plain description card.'
    );
  }

  // Nothing posted is a refusal: dnd5e returns undefined from use() and null from
  // rollAttack/rollDamage when a `dnd5e.preUseActivity` / pre-roll hook vetoes the action (e.g. By
  // the Books' require-target rule on an attack with nothing targeted) — nothing reaches chat then.
  // A module's veto is `unsupported`, as a vetoed delete is (deleteEmbeddedStrict).
  const vetoed = (what: string, tip = '') =>
    unsupported(
      `Nothing was posted: a module hook vetoed the ${what} of "${item.name}" (e.g. a ` +
        `require-target rule; the bridge targets no token).${tip}`
    );
  const action = args.action ?? 'use';
  const base = { success: true, actorName: actor.name, itemName: item.name, action };
  if (action === 'attack') {
    const atk = activities?.getByType?.('attack')?.[0] ?? activity;
    if (typeof atk?.rollAttack !== 'function') {
      throw invalid(`"${item.name}" has no attack activity: post it with action "use"`);
    }
    const rolls = await atk.rollAttack({}, { configure: false }, { create: true });
    if (!Array.isArray(rolls) || rolls.length === 0) throw vetoed('attack roll');
    return { ...base, posted: true as const, activityType: atk.type };
  }
  if (action === 'damage') {
    if (typeof activity.rollDamage !== 'function') {
      throw invalid(
        `the ${activity.type} activity of "${item.name}" rolls no damage: name one that does ` +
          '(activity) or post it with action "use"'
      );
    }
    const rolls = await activity.rollDamage(
      { critical: { allow: !!args.critical } },
      { configure: false },
      { create: true }
    );
    if (!Array.isArray(rolls) || rolls.length === 0) throw vetoed('damage roll');
    return { ...base, posted: true as const, activityType: activity.type };
  }
  // action === 'use' — the supported primary path; buttons rebind via the dnd5e listeners.
  const results = await activity.use?.(
    { consume: !!args.consume },
    { configure: false },
    { create: true }
  );
  if (!results) {
    throw vetoed(
      'use',
      ' Post the attack or damage roll directly with action "attack" / "damage".'
    );
  }
  return {
    ...base,
    posted: true as const,
    activityType: activity.type,
    ...(results?.message?.id ? { messageId: results.message.id } : {}),
  };
}

export async function requestRoll(args: {
  kind: 'save' | 'check' | 'skill';
  ability?: string | undefined;
  skill?: string | undefined;
  dc?: number | undefined;
  flavor?: string | undefined;
  visibility?: 'public' | 'gm' | undefined;
}) {
  const Cls = chatMessageClass();
  const expr = buildRollRequestExpression(args.kind, args.ability, args.skill, args.dc);
  const inner = `${args.flavor ? `<strong>${args.flavor}:</strong> ` : ''}${expr}`;
  const content = await enrich(`<p>${inner}</p>`);
  const whisper =
    args.visibility === 'gm' ? Cls.getWhisperRecipients('GM').map((u: any) => u.id) : [];
  const msg = await Cls.create({
    content,
    whisper,
    flags: { [MCP_FLAG_SCOPE]: { mcp: { tool: 'request-roll' } } },
  });
  return { success: true, id: msg?.id, kind: args.kind, expression: expr };
}
