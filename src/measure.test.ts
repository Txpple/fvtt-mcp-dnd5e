/**
 * The context budgets — printed on every `npm test`, and ratcheted.
 *
 * Every 3.0 milestone (docs/plan-3.0-consolidation.md) is defined by these numbers: what an eager
 * client loads (`tools/list`), what every Claude Code prompt carries (the tool names, the skill
 * descriptions). The ceilings below are today's measurements rounded up; a milestone that lands
 * its diet lowers its ceiling in the same commit, so the number can never quietly climb back.
 */

import { describe, expect, it } from 'vitest';
import { createHost, resolveHostConfig } from './hosts/index.js';
import {
  DEFAULT_REGISTRATIONS,
  PROSE_BUDGET,
  approxTokens,
  decomposeToolsList,
  jsonChars,
  measureNames,
  proseOffenders,
  readSkillDescriptions,
  totalSkillDescriptionChars,
} from './measure.js';
import { buildToolRegistry } from './registry.js';
import { ACTOR_TARGET, ACTOR_TARGET_STRICT, ITEM_TARGET, SCENE_TARGET } from './tools/_targets.js';
import { makeFoundry, makeLogger } from './tools/test-helpers.js';
import { ALWAYS_ON } from './toolsets.js';

/** The ratchets (chars). The comment names the milestone that lowers each one and its target. */
const BUDGET = {
  // 283,945 at 2.2.0; +4,379 for the closed top level (`additionalProperties:false` × 151, M2 —
  // the cost the plan accepted for refusing unknown arguments); 205,248 after M7 (the prose diet:
  // every leaf ≤ 120, every description ≤ 400 — the test below; the M7 target was ≤ 230,000).
  // M8 (CRUD consolidation) must keep each family's advertised bytes ≤ today's.
  toolsListChars: 230_000,
  nameChars: 11_200, // 11,147 at 2.2.0 — M8 (CRUD consolidation) → ≤ 7,000
  skillDescriptionChars: 8_000, // 15,381 at 2.2.0; 7,998 after M3 (all 17 rewritten, 120/120 trigger phrases kept)
  // the always-on toolset — every registration carries it, however narrow (10,814 as `world`;
  // M7 split it into `session` + the opt-in `settings` and set the ceiling at 2,100)
  alwaysOnChars: 2_100,
};

function surface(toolsets: readonly string[] = []) {
  const host = createHost(resolveHostConfig({}, 'generic'), makeLogger());
  const { foundry } = makeFoundry();
  return buildToolRegistry({ foundry, logger: makeLogger(), host, toolsets }).tools;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const line = (label: string, chars: number, detail: string) =>
  `  ${label.padEnd(20)} ${fmt(chars).padStart(8)} chars ≈ ${fmt(approxTokens(chars)).padStart(6)} tokens  ${detail}`;

describe('context budgets (docs/plan-3.0-consolidation.md)', () => {
  const tools = surface();
  const list = decomposeToolsList(tools);
  const alwaysOn = jsonChars(surface([ALWAYS_ON]));
  const offenders = proseOffenders(tools);
  const names = measureNames(tools, DEFAULT_REGISTRATIONS);
  const skills = readSkillDescriptions();
  const skillChars = totalSkillDescriptionChars(skills);

  // biome-ignore lint/suspicious/noConsole: printing the budgets is the point of this test
  console.log(
    [
      'context budgets:',
      line(
        'tools/list',
        list.chars,
        `(${list.count} tools; ≤ ${fmt(BUDGET.toolsListChars)}; M7 done; M8 keeps each family ≤ today)`
      ),
      line(
        `names ×${DEFAULT_REGISTRATIONS.length}`,
        names.prefixedChars,
        `(${names.count} names; ≤ ${fmt(BUDGET.nameChars)}; M8 → ≤ 7,000)`
      ),
      line(
        'skill descriptions',
        skillChars,
        `(${skills.length} skills; ≤ ${fmt(BUDGET.skillDescriptionChars)}; M3 done)`
      ),
      `  leaf .describe() ${fmt(list.totals.leafDescriptions)} · descriptions ${fmt(list.totals.description)} · ` +
        `structural ${fmt(list.totals.structural)} · longest leaf ${fmt(list.totals.longestLeafDescription)}`,
      line(`always-on (${ALWAYS_ON})`, alwaysOn, `(≤ ${fmt(BUDGET.alwaysOnChars)})`),
      `  prose budget: ${offenders.length} tools over (leaf ≤ ${PROSE_BUDGET.leaf}, description ≤ ${PROSE_BUDGET.description}; M7 done)`,
    ].join('\n')
  );

  it('tools/list stays within its ceiling', () => {
    expect(list.chars).toBeLessThanOrEqual(BUDGET.toolsListChars);
  });

  it('the tool names, once per registration, stay within their ceiling', () => {
    expect(names.prefixedChars).toBeLessThanOrEqual(BUDGET.nameChars);
  });

  it('the skill front-matter descriptions stay within their ceiling', () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) expect(s.chars, `${s.skill} has no description`).toBeGreaterThan(0);
    expect(skillChars).toBeLessThanOrEqual(BUDGET.skillDescriptionChars);
  });

  it('the always-on toolset stays within its ceiling', () => {
    expect(alwaysOn).toBeLessThanOrEqual(BUDGET.alwaysOnChars);
  });

  // M7 — the prose budget (docs/plan-3.0-consolidation.md; src/measure.ts PROSE_BUDGET): every
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
    // three tools below, where a substring hit would be the wrong actor. A leaf may append a note,
    // but the rule's text comes first, verbatim — so a tool cannot say "exact" and resolve fuzzy.
    const STRICT_ACTOR_TOOLS = new Set(['set-actor-art', 'delete-actor', 'duplicate-actor']);
    const ACTOR_LEAVES = new Set(['actorIdentifier', 'actorIdentifiers', 'characterIdentifier']);
    // The same rule under another property name (renamed in M8; the rule is the contract today).
    const ACTOR_ALIASES: Record<string, string[]> = {
      identifier: ['get-actor', 'export-actor'],
      actor: ['post-item-card'],
      character: ['update-user'],
    };
    const leafText = (schema: Record<string, unknown>): string => {
      const items = schema.items as Record<string, unknown> | undefined;
      return String((schema.type === 'array' ? items?.description : schema.description) ?? '');
    };
    const bad: string[] = [];
    for (const tool of tools) {
      const props = (tool.inputSchema as { properties: Record<string, Record<string, unknown>> })
        .properties;
      for (const [key, schema] of Object.entries(props)) {
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
  });
});
