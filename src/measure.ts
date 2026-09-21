/**
 * The context budgets, measured (docs/history/plan-3.0-consolidation.md — every 3.0 milestone is defined
 * by these numbers). What an MCP client pays for this server, in chars of JSON as the transport
 * sends it:
 *
 *   - the advertised `tools/list` — what an EAGER client loads at connect (283,945 at 2.2.0);
 *   - the tool NAMES — what every Claude Code prompt carries when schemas are deferred, in the
 *     `mcp__<registration>__<name>` form, once per registration (11,147 for two at 2.2.0);
 *   - the skill front-matter descriptions — also in every Claude Code prompt (15,381 at 2.2.0).
 *
 * `src/measure.test.ts` prints these and ratchets them; `scripts/measure/*` report them in detail
 * (per tool, per toolset, per skill). One implementation so the test and the scripts cannot
 * disagree about a number.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The shape `buildToolRegistry` advertises — what `tools/list` serialises. */
export interface AdvertisedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/** Wire chars of a value: `JSON.stringify` with no pretty-printing, as the stdio transport sends it. */
export const jsonChars = (value: unknown): number => JSON.stringify(value).length;

/** The chars→tokens ratio the review measured on this English + JSON mix (≈ 3.6 chars per token). */
export const approxTokens = (chars: number): number => Math.round(chars / 3.6);

// ---------------------------------------------------------------------------
// tools/list — the advertised bytes, decomposed
// ---------------------------------------------------------------------------

/** Where one advertised tool's bytes go. All figures are JSON chars. */
export interface ToolBytes {
  name: string;
  /** `JSON.stringify(tool).length` — the tool's share of the `tools/list` array. */
  total: number;
  /** The tool description as JSON-escaped chars, without its quotes (newlines count 2). */
  description: number;
  /**
   * A union tool's member descriptions (src/tools/_union.ts) — the descriptions its members' tools
   * carried before the family was consolidated; inside the schema, but prose of the same kind as
   * `description`, so the budget print sums the two.
   */
  memberDescriptions: number;
  /** `JSON.stringify(inputSchema).length`. */
  schema: number;
  /** Leaf `"description"` strings inside the schema — zod `.describe()` prose. */
  leafDescriptions: number;
  leafDescriptionCount: number;
  /** The longest leaf description, for the prose budget (M7: leaf ≤ 120 chars). */
  longestLeafDescription: number;
  /** `"enum": [...]` lists. */
  enums: number;
  enumCount: number;
  enumValues: number;
  defaults: number;
  consts: number;
  examples: number;
  /** The schema minus the buckets above: type / properties / required / items / anyOf … */
  structural: number;
}

interface SchemaBuckets {
  leafDescriptions: number;
  leafDescriptionCount: number;
  longestLeafDescription: number;
  enums: number;
  enumCount: number;
  enumValues: number;
  defaults: number;
  consts: number;
  examples: number;
}

// Walk a JSON-Schema node and attribute each `"key":value` pair (key + quotes + colon + value) to
// a bucket. Structural keys are not summed here — they are the remainder after the buckets.
function walkSchema(node: unknown, acc: SchemaBuckets): void {
  if (Array.isArray(node)) {
    for (const child of node) walkSchema(child, acc);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const pair = jsonChars(key) + 1 + jsonChars(value);
    if (key === 'description' && typeof value === 'string') {
      acc.leafDescriptions += pair;
      acc.leafDescriptionCount++;
      acc.longestLeafDescription = Math.max(acc.longestLeafDescription, value.length);
    } else if (key === 'enum' && Array.isArray(value)) {
      acc.enums += pair;
      acc.enumCount++;
      acc.enumValues += value.length;
    } else if (key === 'default') {
      acc.defaults += pair;
    } else if (key === 'const') {
      acc.consts += pair;
    } else if (key === 'examples') {
      acc.examples += pair;
    } else if (value && typeof value === 'object') {
      walkSchema(value, acc);
    }
  }
}

/** Decompose one advertised tool: description vs schema, and the schema's prose vs structure. */
export function decomposeTool(tool: AdvertisedTool): ToolBytes {
  const acc: SchemaBuckets = {
    leafDescriptions: 0,
    leafDescriptionCount: 0,
    longestLeafDescription: 0,
    enums: 0,
    enumCount: 0,
    enumValues: 0,
    defaults: 0,
    consts: 0,
    examples: 0,
  };
  const { root, members } = splitUnion(tool.inputSchema);
  walkSchema(root, acc);
  // A union tool's member descriptions (src/tools/_union.ts) are what the members' tools
  // advertised before the family was consolidated: descriptions, not leaves.
  let memberDescriptions = 0;
  for (const { description, ...rest } of members) {
    memberDescriptions += jsonChars(description ?? '') - 2;
    walkSchema(rest, acc);
  }
  const schema = jsonChars(tool.inputSchema);
  return {
    name: tool.name,
    total: jsonChars(tool),
    description: jsonChars(tool.description ?? '') - 2,
    memberDescriptions,
    schema,
    ...acc,
    structural:
      schema -
      memberDescriptions -
      acc.leafDescriptions -
      acc.enums -
      acc.defaults -
      acc.consts -
      acc.examples,
  };
}

/**
 * A union tool's root without its members, and the members. A plain tool is its own root with
 * no members. (`anyOf` below the root is an ordinary leaf union — a member is only a root one.)
 */
function splitUnion(inputSchema: unknown): {
  root: unknown;
  members: Array<Record<string, unknown>>;
} {
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    return { root: inputSchema, members: [] };
  }
  const { anyOf, ...root } = inputSchema as Record<string, unknown>;
  if (!Array.isArray(anyOf)) return { root: inputSchema, members: [] };
  return { root, members: anyOf as Array<Record<string, unknown>> };
}

/** The `tools/list` decomposition: the list's chars, the per-tool rows, and the column totals. */
export interface ToolsListBytes {
  /** `JSON.stringify(tools).length` — what an eager client receives. */
  chars: number;
  count: number;
  /** One row per tool, largest first. */
  tools: ToolBytes[];
  totals: Omit<ToolBytes, 'name'>;
}

export function decomposeToolsList(tools: AdvertisedTool[]): ToolsListBytes {
  const rows = tools.map(decomposeTool).sort((a, b) => b.total - a.total);
  const totals: ToolsListBytes['totals'] = {
    total: 0,
    description: 0,
    memberDescriptions: 0,
    schema: 0,
    leafDescriptions: 0,
    leafDescriptionCount: 0,
    longestLeafDescription: 0,
    enums: 0,
    enumCount: 0,
    enumValues: 0,
    defaults: 0,
    consts: 0,
    examples: 0,
    structural: 0,
  };
  for (const row of rows) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] =
        key === 'longestLeafDescription' ? Math.max(totals[key], row[key]) : totals[key] + row[key];
    }
  }
  return { chars: jsonChars(tools), count: tools.length, tools: rows, totals };
}

// ---------------------------------------------------------------------------
// The prose budget (M7) — every leaf `.describe()` and every tool description has a ceiling
// ---------------------------------------------------------------------------

/** The M7 ceilings, in chars of the raw string (not JSON-escaped). */
export const PROSE_BUDGET = { leaf: 120, description: 400 } as const;

export interface ProseOffender {
  name: string;
  /** The description's length when it is over budget, else 0. */
  description: number;
  /** Every leaf over budget: its property path inside the schema and its length. */
  leaves: Array<{ path: string; length: number }>;
}

function walkLeaves(
  node: unknown,
  path: string,
  limit: number,
  out: Array<{ path: string; length: number }>
): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      walkLeaves(child, `${path}[${i}]`, limit, out);
    });
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'description' && typeof value === 'string') {
      if (value.length > limit) out.push({ path: path || '.', length: value.length });
    } else if (value && typeof value === 'object') {
      // `properties` is a container, not a path segment: report `.walls.items.id`, not
      // `.properties.walls.items.properties.id`.
      walkLeaves(value, key === 'properties' ? path : `${path}.${key}`, limit, out);
    }
  }
}

/**
 * The tools over the prose budget: a description longer than `budget.description`, or any leaf
 * `"description"` in the schema longer than `budget.leaf`. Empty when every tool is within it.
 */
export function proseOffenders(
  tools: AdvertisedTool[],
  budget: { leaf: number; description: number } = PROSE_BUDGET
): ProseOffender[] {
  const out: ProseOffender[] = [];
  for (const tool of tools) {
    const leaves: ProseOffender['leaves'] = [];
    const { root, members } = splitUnion(tool.inputSchema);
    walkLeaves(root, '', budget.leaf, leaves);
    members.forEach(({ description, ...rest }, i) => {
      // The member description is a tool description (≤ budget.description), reported by its path.
      const d = typeof description === 'string' ? description.length : 0;
      if (d > budget.description) leaves.push({ path: `.anyOf[${i}] (description)`, length: d });
      walkLeaves(rest, `.anyOf[${i}]`, budget.leaf, leaves);
    });
    const description = (tool.description ?? '').length;
    if (leaves.length || description > budget.description) {
      out.push({
        name: tool.name,
        description: description > budget.description ? description : 0,
        leaves,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool names — the per-prompt cost in Claude Code
// ---------------------------------------------------------------------------

export interface NameBytes {
  count: number;
  /** The bare hyphenated names, summed. */
  bareChars: number;
  /** `mcp__<registration>__<name>` for every name, summed, per registration. */
  perRegistration: Record<string, number>;
  /** The sum over every registration given — what every prompt carries (no separators). */
  prefixedChars: number;
}

/**
 * The registration pair the budgets are defined on: a campaign world and a sandbox world, both
 * advertising the full surface — 16- and 15-char names, so the `mcp__<registration>__` prefixes
 * cost 23 + 22 chars per tool. (11,147 at 2.2.0; the M8 target of ≤ 7,000 is on this pair.)
 */
export const DEFAULT_REGISTRATIONS = ['foundry-campaign', 'foundry-sandbox'] as const;

/** The chars of the tool names as Claude Code spells them, once per registration. */
export function measureNames(
  tools: AdvertisedTool[],
  registrations: readonly string[] = DEFAULT_REGISTRATIONS
): NameBytes {
  const names = tools.map(t => t.name);
  const perRegistration: Record<string, number> = {};
  for (const registration of registrations) {
    perRegistration[registration] = names.reduce(
      (sum, name) => sum + `mcp__${registration}__${name}`.length,
      0
    );
  }
  return {
    count: names.length,
    bareChars: names.reduce((sum, name) => sum + name.length, 0),
    perRegistration,
    prefixedChars: Object.values(perRegistration).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// Skill descriptions — the front-matter every Claude Code prompt carries
// ---------------------------------------------------------------------------

/** The tracked skills directory, resolved from this file (works from `src/` and from `dist/`). */
export const SKILLS_DIR = fileURLToPath(new URL('../.claude/skills', import.meta.url));

export interface SkillDescription {
  skill: string;
  /** The front-matter `description`, folded to one line (what the client shows the model). */
  description: string;
  chars: number;
  /** The SKILL.md body after the front matter — loaded only when the skill triggers. */
  bodyChars: number;
}

/**
 * Fold a YAML front-matter `description` to one line: a `>-` / `|` block's lines trimmed and
 * joined with spaces (the review's measure), or a one-liner with its quotes stripped.
 */
function foldDescription(frontMatter: string): string {
  const lines = frontMatter.split(/\r?\n/);
  const at = lines.findIndex(l => /^description:/.test(l));
  if (at < 0) return '';
  const inline = lines[at].replace(/^description:\s*/, '').trim();
  if (inline && !/^[>|]-?$/.test(inline)) return inline.replace(/^(['"])(.*)\1$/, '$2');
  const block: string[] = [];
  for (let i = at + 1; i < lines.length && !/^[A-Za-z_-]+:/.test(lines[i]); i++) {
    block.push(lines[i].trim());
  }
  return block.filter(Boolean).join(' ');
}

/** Every `<skillsDir>/<skill>/SKILL.md` (skipping `_shared`), sorted by name. */
export function readSkillDescriptions(skillsDir: string = SKILLS_DIR): SkillDescription[] {
  return readdirSync(skillsDir)
    .filter(d => !d.startsWith('_') && statSync(join(skillsDir, d)).isDirectory())
    .sort()
    .map(skill => {
      const text = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const description = fm ? foldDescription(fm[1]) : '';
      return {
        skill,
        description,
        chars: description.length,
        bodyChars: text.length - (fm ? fm[0].length : 0),
      };
    });
}

export const totalSkillDescriptionChars = (skills: SkillDescription[]): number =>
  skills.reduce((sum, s) => sum + s.chars, 0);
