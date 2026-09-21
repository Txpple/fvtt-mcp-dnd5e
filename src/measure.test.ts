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
import { makeFoundry, makeLogger } from './tools/test-helpers.js';
import { ALWAYS_ON, type ToolsetName, toolsetOf } from './toolsets.js';

/** The ratchets (chars). The comment names the milestone that lowers each one and its target. */
const BUDGET = {
  // 283,945 at 2.2.0; +4,379 for the closed top level (`additionalProperties:false` × 151, M2 —
  // the cost the plan accepted for refusing unknown arguments); M7 (prose diet) → ≤ 230,000
  toolsListChars: 288_200,
  nameChars: 11_200, // 11,147 at 2.2.0 — M8 (CRUD consolidation) → ≤ 7,000
  skillDescriptionChars: 8_000, // 15,381 at 2.2.0; 7,998 after M3 (all 17 rewritten, 120/120 trigger phrases kept)
  // the always-on toolset — every registration carries it, however narrow (10,814 as `world`;
  // M7 split it into `session` + the opt-in `settings` and set the ceiling at 2,100)
  alwaysOnChars: 2_100,
};

/**
 * M7 — the prose budget (docs/plan-3.0-consolidation.md; src/measure.ts PROSE_BUDGET): every leaf
 * `.describe()` ≤ 120 chars, every tool description ≤ 400. The diet lands one family per commit;
 * a family still to be dieted is listed here and its commit removes it, so the set is empty — and
 * this constant gone — when M7 closes. A tool in any other toolset over the budget fails the gate.
 */
const PROSE_DIET_PENDING = new Set<ToolsetName>([
  'actors',
  'items',
  'compendium',
  'scenes',
  'journals',
  'tables',
  'cards',
  'audio',
  'chat',
  'combat',
  'assets',
  'organization',
]);

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
  const setOf = toolsetOf();
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
        `(${list.count} tools; ≤ ${fmt(BUDGET.toolsListChars)}; M7 → ≤ 230,000)`
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
      `  prose budget: ${offenders.length} tools over (leaf ≤ ${PROSE_BUDGET.leaf}, description ≤ ${PROSE_BUDGET.description}); ` +
        `families pending: ${[...PROSE_DIET_PENDING].join(', ') || 'none'}`,
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

  it('every dieted family is within the prose budget (leaf ≤ 120, description ≤ 400)', () => {
    const over = offenders.filter(o => !PROSE_DIET_PENDING.has(setOf.get(o.name) as ToolsetName));
    const report = over.map(o => {
      const bits = [];
      if (o.description) bits.push(`description ${o.description}`);
      for (const l of o.leaves) bits.push(`${l.path} ${l.length}`);
      return `${o.name}: ${bits.join(' · ')}`;
    });
    expect(report, report.join('\n')).toEqual([]);
  });

  it('a family listed as pending is still over budget (else its entry is stale)', () => {
    const overSets = new Set(offenders.map(o => setOf.get(o.name)));
    for (const set of PROSE_DIET_PENDING) {
      expect(overSets.has(set), `${set} is within budget — remove it from PROSE_DIET_PENDING`).toBe(
        true
      );
    }
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
