/**
 * The context budgets — printed on every `npm test`, and ratcheted.
 *
 * Three budgets, each with the client that pays it (the suite's
 * docs/reviews/2026-10-15-mcp-tool-surface.md §4; the 3.0 milestones that set the numbers are in
 * docs/history/plan-3.0-consolidation.md):
 *
 *   (a) PER PROMPT, a deferred client (Claude Code): the tool names once per registration plus the
 *       skill front-matter descriptions — paid on every turn, whatever is fetched.
 *   (b) PER FETCH, the same client: one tool's schema, its `anyOf` flattened (src/measure.ts
 *       `flattenTool`) — paid once per session per tool used; and the flatten-safety rule, since a
 *       key two members describe differently is shown with the first member's shape only.
 *   (c) THE EAGER LIST, a client that loads every schema at connect: `tools/list` whole, with a
 *       row per toolset. A change that adds advertised chars pays in its own toolset's row, or
 *       raises that row in the same commit with the reason beside it; the total has working
 *       headroom so a growth in one family never trims another's prose.
 *
 * Every ceiling is today's measurement rounded up; a diet lowers its ceiling in the same commit,
 * so a number can never quietly climb back.
 */

import { describe, expect, it } from 'vitest';
import { createHost, resolveHostConfig } from './hosts/index.js';
import {
  DEFAULT_REGISTRATIONS,
  PROSE_BUDGET,
  approxTokens,
  charsByGroup,
  decomposeToolsList,
  flattenToolsList,
  jsonChars,
  measureNames,
  proseOffenders,
  readSkillDescriptions,
  totalSkillDescriptionChars,
} from './measure.js';
import { buildToolRegistry } from './registry.js';
import { ACTOR_TARGET, ACTOR_TARGET_STRICT, ITEM_TARGET, SCENE_TARGET } from './tools/_targets.js';
import { makeFoundry, makeLogger } from './tools/test-helpers.js';
import { ALWAYS_ON, READONLY, TOOLSET_NAMES, type ToolsetName, toolsetOf } from './toolsets.js';

/** The ratchets (chars). The comment names who pays each and the commit that set it. */
const BUDGET = {
  // (a) per prompt, Claude Code: 13,916 on 2026-10-15 (6,143 names for two registrations +
  // 7,773 skill descriptions); a new tool costs it about 90 chars.
  perPrompt: 14_000,
  // 11,147 at 2.2.0; 6,153 after M8 (151 names → 81; the target was ≤ 7,000, now the ceiling)
  nameChars: 7_000,
  skillDescriptionChars: 8_000, // 15,381 at 2.2.0; 7,998 after M3 (all 17 rewritten, 120/120 trigger phrases kept)
  // (b) per fetch, Claude Code: the largest single tool flattened — manage-placeables. 13,164 on
  // 2026-10-15 with one kind's shapes under `items` / `patches` / `ids` (the lossy view: the tiles'
  // fields shown for every kind); 36,758 the same day once each kind's entries ride its own key
  // (tiles / tilePatches / tileIds …), so the view carries every kind's real fields — the cost of
  // a view that is right, paid once per session that uses the tool. 38,981 on 2026-10-28: the
  // token's own light (`light{}` on tokens create and update, eleven sub-fields each).
  perFetch: 39_000,
  // (c) the eager list: 283,945 at 2.2.0; +4,379 for the closed top level
  // (`additionalProperties:false` × 151, M2 — the cost the plan accepted for refusing unknown
  // arguments); 205,248 after M7 (the prose diet: every leaf ≤ 120, every description ≤ 400 — the
  // test below; the M7 target was ≤ 230,000); 201,562 after M8 (the CRUD consolidation); the ceiling
  // sat at 205,000 until 4.6.0 reached 204,987 and had to trim its neighbours' prose to fit.
  // 220,000 since 2026-10-15: 7% of working headroom, the per-toolset rows below the ratchet.
  toolsListChars: 220_000,
  // the always-on toolset — every registration carries it, however narrow (10,814 as `world`;
  // M7 split it into `session` + the opt-in `settings` and set the ceiling at 2,100)
  alwaysOnChars: 2_100,
};

/**
 * (c) per toolset: each row is that family's own tools on the eager list, today's number rounded
 * up to the next 100. A commit that grows a family raises its row here, with the reason, and
 * nothing else; a new toolset adds a row (the test refuses one without).
 */
const TOOLSET_CEILINGS: Record<ToolsetName, number> = {
  // every row: the 2026-10-15 measurement (4.6.0 plus the vetoed-delete fix), rounded up
  session: 1_800, // 1,778
  settings: 6_900, // 6,809
  actors: 75_700, // 74,911; 75,594 with add-feature's uuid copies (2026-10-28)
  items: 4_700, // 4,615
  compendium: 6_700, // 6,541; 6,662 once the four searches share one `limit` leaf (2026-10-15)
  scenes: 64_700, // 62,106; 62,398 with manage-placeables' per-kind keys (2026-10-15); 64,656 with the token light (2026-10-28)
  journals: 14_700, // 14,380; 14,635 once the members share one `name` and one `pageId` leaf
  tables: 6_200, // 5,935; 6,138 once create and update share their five leaves (2026-10-15)
  cards: 2_100, // 2,009
  audio: 5_200, // 5,119
  chat: 6_300, // 6,254
  combat: 1_200, // 1,141
  assets: 6_400, // 6,372
  organization: 5_900, // 5,775; 5,806 once the folder members share `name` and `parentFolder`
  scripting: 1_300, // 1,256
};

function surface(toolsets: readonly string[] = []) {
  const host = createHost(resolveHostConfig({}, 'generic'), makeLogger());
  const { foundry } = makeFoundry();
  return buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets }).tools;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const line = (label: string, chars: number, detail: string) =>
  `    ${label.padEnd(20)} ${fmt(chars).padStart(8)} chars ≈ ${fmt(approxTokens(chars)).padStart(6)} tokens  ${detail}`;

describe('context budgets (three, each with the client that pays it)', () => {
  const tools = surface();
  const list = decomposeToolsList(tools);
  const alwaysOn = jsonChars(surface([ALWAYS_ON]));
  // FOUNDRY_TOOLSETS=readonly (issue #8): a different registration's list — reported, no ceiling
  const readOnlyTools = surface([READONLY]);
  const readOnly = jsonChars(readOnlyTools);
  const offenders = proseOffenders(tools);
  const names = measureNames(tools, DEFAULT_REGISTRATIONS);
  const skills = readSkillDescriptions();
  const skillChars = totalSkillDescriptionChars(skills);
  const perPrompt = names.prefixedChars + skillChars;
  const flat = flattenToolsList(tools);
  const toolToSet = toolsetOf();
  const byToolset = charsByGroup(tools, name => toolToSet.get(name));

  // biome-ignore lint/suspicious/noConsole: printing the budgets is the point of this test
  console.log(
    [
      'context budgets:',
      '  (a) per prompt — Claude Code, schemas deferred: paid on every turn',
      line(
        `names ×${DEFAULT_REGISTRATIONS.length}`,
        names.prefixedChars,
        `(${names.count} names; ≤ ${fmt(BUDGET.nameChars)})`
      ),
      line(
        'skill descriptions',
        skillChars,
        `(${skills.length} skills; ≤ ${fmt(BUDGET.skillDescriptionChars)})`
      ),
      line('per prompt', perPrompt, `(≤ ${fmt(BUDGET.perPrompt)})`),
      '  (b) per fetch — Claude Code, one tool with its anyOf flattened: paid once per tool used',
      line(
        'largest tool',
        flat.largest.chars,
        `(${flat.largest.name}, ${flat.largest.members} members, ${fmt(flat.largest.advertisedChars)} advertised; ≤ ${fmt(BUDGET.perFetch)})`
      ),
      `    every tool once     ${fmt(flat.chars).padStart(8)} chars (advertised ${fmt(list.chars)}); lossy keys: ${flat.lossy.length} (the rule is none)`,
      ...flat.lossy.map(k => `      ${k}`),
      '  (c) the eager list — a client that loads every schema at connect',
      line('tools/list', list.chars, `(${list.count} tools; ≤ ${fmt(BUDGET.toolsListChars)})`),
      ...TOOLSET_NAMES.map(name =>
        line(
          `  ${name}`,
          byToolset[name]?.chars ?? 0,
          `(${byToolset[name]?.count ?? 0} tools; ≤ ${fmt(TOOLSET_CEILINGS[name])})`
        )
      ),
      line(`always-on (${ALWAYS_ON})`, alwaysOn, `(≤ ${fmt(BUDGET.alwaysOnChars)})`),
      line(
        READONLY,
        readOnly,
        `(${readOnlyTools.length} tools; ${((100 * readOnly) / list.chars).toFixed(1)}% of the full list; reported, no ceiling)`
      ),
      `    leaf .describe() ${fmt(list.totals.leafDescriptions)} · descriptions ${fmt(list.totals.description + list.totals.memberDescriptions)} · ` +
        `structural ${fmt(list.totals.structural)} · longest leaf ${fmt(list.totals.longestLeafDescription)}`,
      `    prose budget: ${offenders.length} tools over (leaf ≤ ${PROSE_BUDGET.leaf}, description ≤ ${PROSE_BUDGET.description}; M7 done)`,
    ].join('\n')
  );

  // (a) per prompt
  it('the tool names, once per registration, stay within their ceiling', () => {
    expect(names.prefixedChars).toBeLessThanOrEqual(BUDGET.nameChars);
  });

  it('the skill front-matter descriptions stay within their ceiling', () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) expect(s.chars, `${s.skill} has no description`).toBeGreaterThan(0);
    expect(skillChars).toBeLessThanOrEqual(BUDGET.skillDescriptionChars);
  });

  it('(a) per prompt: the names and the skill descriptions together stay within their ceiling', () => {
    expect(perPrompt).toBeLessThanOrEqual(BUDGET.perPrompt);
  });

  // (b) per fetch
  it('(b) per fetch: the largest tool, flattened, stays within its ceiling', () => {
    expect(flat.largest.chars, flat.largest.name).toBeLessThanOrEqual(BUDGET.perFetch);
  });

  it('(b) flatten-safety: no key is described in two shapes across a union (the merge would show one)', () => {
    expect(flat.lossy, flat.lossy.join('\n')).toEqual([]);
  });

  // (c) the eager list
  it('(c) tools/list stays within its ceiling', () => {
    expect(list.chars).toBeLessThanOrEqual(BUDGET.toolsListChars);
  });

  it('(c) every toolset stays within its row, and every toolset has a row', () => {
    const over: string[] = [];
    for (const name of TOOLSET_NAMES) {
      const row = byToolset[name];
      expect(row, `${name} has no tools`).toBeDefined();
      expect(TOOLSET_CEILINGS[name], `${name} has no ceiling row`).toBeTypeOf('number');
      if (row && row.chars > TOOLSET_CEILINGS[name]) {
        over.push(`${name}: ${fmt(row.chars)} > ${fmt(TOOLSET_CEILINGS[name])}`);
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // every advertised tool belongs to a toolset (a stray one would hide outside every row)
    expect(Object.keys(byToolset).sort()).toEqual([...TOOLSET_NAMES].sort());
  });

  it('the always-on toolset stays within its ceiling', () => {
    expect(alwaysOn).toBeLessThanOrEqual(BUDGET.alwaysOnChars);
  });

  // M7 — the prose budget (docs/history/plan-3.0-consolidation.md; src/measure.ts PROSE_BUDGET): every
  // leaf `.describe()` ≤ 120 chars, every tool description ≤ 400. Field semantics live once, in
  // the leaf; a description is the contract (inputs, refusals, returns); doctrine is the skills'.
  it('every tool is within the prose budget (leaf ≤ 120, description ≤ 400)', () => {
    const report = offenders.map(o => {
      const bits = [];
      if (o.description) bits.push(`description ${o.description}`);
      for (const l of o.leaves) bits.push(`${l.path} ${l.length}`);
      return `${o.name}: ${bits.join(' · ')}`;
    });
    expect(report, report.join('\n')).toEqual([]);
  });

  it('every target leaf advertises the rule its page handler implements (F22)', () => {
    // The page resolves an actor two ways (src/tools/_targets.ts): fuzzy everywhere except the
    // tools below, where a substring hit would be the wrong actor (manage-actors' delete member
    // takes `identifiers`, the strict array — a key this check does not read). A leaf may append
    // a note, but the rule's text comes first, verbatim — so a tool cannot say "exact" and resolve
    // fuzzy.
    const STRICT_ACTOR_TOOLS = new Set(['set-actor-art', 'duplicate-actor']);
    const ACTOR_LEAVES = new Set(['actorIdentifier', 'actorIdentifiers', 'characterIdentifier']);
    // The same rule under another property name (renamed in M8; the rule is the contract today).
    const ACTOR_ALIASES: Record<string, string[]> = {
      actor: ['post-item-card'],
      character: ['update-user'],
    };
    const leafText = (schema: Record<string, unknown>): string => {
      const items = schema.items as Record<string, unknown> | undefined;
      return String((schema.type === 'array' ? items?.description : schema.description) ?? '');
    };
    const bad: string[] = [];
    for (const tool of tools) {
      // A union tool (src/tools/_union.ts) advertises its shared target leaves once, at the root;
      // a member lists such a leaf bare (no description) — the root's text is the contract. A leaf
      // a member describes itself is held to the rule like any other.
      const root = tool.inputSchema as {
        properties: Record<string, Record<string, unknown>>;
        anyOf?: Array<{ properties: Record<string, Record<string, unknown>> }>;
      };
      const leaves: Array<[string, Record<string, unknown>]> = Object.entries(root.properties);
      for (const member of root.anyOf ?? []) {
        for (const [key, schema] of Object.entries(member.properties)) {
          if (!leafText(schema) && key in root.properties) continue;
          leaves.push([key, schema]);
        }
      }
      for (const [key, schema] of leaves) {
        const text = leafText(schema);
        const isActor = ACTOR_LEAVES.has(key) || ACTOR_ALIASES[key]?.includes(tool.name);
        const want = isActor
          ? STRICT_ACTOR_TOOLS.has(tool.name)
            ? ACTOR_TARGET_STRICT
            : ACTOR_TARGET
          : key === 'sceneIdentifier'
            ? SCENE_TARGET
            : key === 'itemIdentifier'
              ? ITEM_TARGET
              : undefined;
        if (want && !text.startsWith(want)) bad.push(`${tool.name}.${key}: "${text}"`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
    // the strict set is exactly those three (a new actor tool is fuzzy unless listed here)
    for (const name of STRICT_ACTOR_TOOLS)
      expect(
        tools.some(t => t.name === name),
        name
      ).toBe(true);
  });

  it('the decomposition accounts for every byte of every tool', () => {
    // description + schema + the JSON envelope ({"name":…,"description":"…","inputSchema":…})
    for (const row of list.tools) {
      const envelope = row.total - row.description - row.schema;
      expect(envelope, row.name).toBeGreaterThan(0);
      expect(envelope, row.name).toBeLessThan(80);
      expect(row.structural, row.name).toBeGreaterThan(0);
    }
    // a plain tool's flattened view is its advertised one; a union's is smaller or equal
    for (const row of flat.tools) {
      if (row.members === 0) expect(row.chars, row.name).toBe(row.advertisedChars);
      else expect(row.chars, row.name).toBeLessThanOrEqual(row.advertisedChars);
    }
  });
});
