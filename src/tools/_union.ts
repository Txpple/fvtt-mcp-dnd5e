// The union tool — one advertised tool per CRUD family, built from the family's per-op zod schemas
// (M8 of docs/plan-3.0-consolidation.md; decision #1: the lossless b2 union, member descriptions
// kept, measured in docs/architecture-review-2026-09.md §4).
//
// The advertised shape is a top-level `type:"object"` (the SDK's ToolSchema requires it) whose
// `properties` carry the discriminators as enums and the SHARED leaves described once, and whose
// `anyOf` holds one CLOSED member per op: `const` discriminators, the op's own leaves, and the
// description the op's tool used to carry. The root is not closed itself — a root
// `additionalProperties:false` would refuse every member key — each member is; a member that
// takes a shared leaf lists it bare (`{type}`) so it stays closed while the prose lives at the root.
//
// Dispatch selects the member by its discriminators (an unknown value is refused by name with the
// valid ones), refuses an unknown key by name against THAT member (the registry's closed-top-level
// check skips union tools for exactly this: the keys the selected kind × action takes, not the
// union of every member's), then parses with the member's own zod object — refinements included,
// since the advertised member is only its shape.

import { z } from 'zod';
import { FormattedToolError } from '../utils/error-handler.js';
import { toInputSchema } from '../utils/schema.js';

export interface UnionMember {
  /** One value per discriminator, e.g. `{ kind: 'tiles', action: 'create' }`. */
  select: Record<string, string>;
  /** The op's description — what its tool advertised before the family was consolidated. */
  description: string;
  /** The op's own zod object, WITHOUT the discriminators; parsed as-is at dispatch. */
  schema: z.ZodObject<any>;
  handler: (parsed: any) => Promise<unknown>;
}

/** Declare a member with the handler typed by its schema's output. */
export function unionMember<S extends z.ZodObject<any>>(m: {
  select: Record<string, string>;
  description: string;
  schema: S;
  handler: (parsed: z.output<S>) => Promise<unknown>;
}): UnionMember {
  return m;
}

export interface UnionToolSpec {
  name: string;
  /** The family description: what every member has in common (target rules, refusals, GM-only). */
  description: string;
  /** The discriminator keys in advertised order; every member selects one value per key. */
  discriminators: readonly string[];
  /**
   * Leaves described ONCE at the root (`sceneIdentifier` on the placeables). A member that takes
   * one keeps it in its own schema for parsing and advertises it bare.
   */
  shared?: Record<string, z.ZodType>;
  members: UnionMember[];
}

export interface AdvertisedUnionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface UnionTool {
  def: AdvertisedUnionTool;
  members: UnionMember[];
  /** The registry-facing handler: select, refuse unknown keys, parse, run. */
  handle(args: unknown): Promise<unknown>;
}

const quote = (v: unknown): string => JSON.stringify(v);
const list = (values: readonly string[]): string => values.map(quote).join(', ');

export function unionTool(spec: UnionToolSpec): UnionTool {
  const { name, discriminators, members } = spec;
  const shared = spec.shared ?? {};

  // Construction-time invariants: a member selects every discriminator and nothing else; no two
  // members select the same tuple; no member leaf is named like a discriminator; a shared leaf is
  // taken by at least one member (else it is dead prose at the root).
  const seen = new Set<string>();
  for (const m of members) {
    const keys = Object.keys(m.select).sort().join(',');
    const want = [...discriminators].sort().join(',');
    if (keys !== want) {
      throw new Error(`${name}: member selects [${keys}] but the discriminators are [${want}]`);
    }
    const tuple = discriminators.map(k => m.select[k]).join('/');
    if (seen.has(tuple)) throw new Error(`${name}: two members select ${tuple}`);
    seen.add(tuple);
    for (const key of discriminators) {
      if (key in m.schema.shape) {
        throw new Error(`${name} ${tuple}: leaf "${key}" collides with a discriminator`);
      }
    }
  }
  for (const key of Object.keys(shared)) {
    if (!members.some(m => key in m.schema.shape)) {
      throw new Error(`${name}: shared leaf "${key}" is taken by no member`);
    }
  }

  const valuesOf = (key: string, among: UnionMember[] = members): string[] => [
    ...new Set(among.map(m => m.select[key]!)),
  ];

  // --- the advertised schema -------------------------------------------------------------------
  const rootProperties: Record<string, unknown> = {};
  for (const key of discriminators) rootProperties[key] = { type: 'string', enum: valuesOf(key) };
  // The shared leaves through the same generator as every other leaf (io:'input', 2020-12).
  const sharedJson = Object.keys(shared).length
    ? (toInputSchema(z.object(shared)).properties as Record<string, Record<string, unknown>>)
    : {};
  Object.assign(rootProperties, sharedJson);

  const anyOf = members.map(m => {
    const own = toInputSchema(m.schema) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    const properties: Record<string, unknown> = {};
    for (const key of discriminators) properties[key] = { const: m.select[key] };
    for (const [key, leaf] of Object.entries(own.properties)) {
      properties[key] = key in shared ? bare(leaf) : leaf;
    }
    return {
      description: m.description,
      type: 'object',
      properties,
      required: [...discriminators, ...own.required],
      additionalProperties: false,
    };
  });

  const def: AdvertisedUnionTool = {
    name,
    description: spec.description,
    inputSchema: {
      type: 'object',
      properties: rootProperties,
      required: [...discriminators],
      anyOf,
    },
  };

  // --- dispatch ----------------------------------------------------------------------------------
  const handle = async (args: unknown): Promise<unknown> => {
    const a =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
    let candidates = members;
    const chosen: string[] = [];
    for (const key of discriminators) {
      const value = a[key];
      const valid = valuesOf(key, candidates);
      if (typeof value !== 'string' || !valid.includes(value)) {
        const scope = chosen.length ? ` for ${chosen.join(', ')}` : '';
        const got = value === undefined ? 'nothing' : quote(value);
        throw new FormattedToolError(
          `${name}: ${key} must be one of ${list(valid)}${scope} (got ${got}).`
        );
      }
      candidates = candidates.filter(m => m.select[key] === value);
      chosen.push(`${key} ${quote(value)}`);
    }
    const m = candidates[0]!;
    const known = [...discriminators, ...Object.keys(m.schema.shape)];
    const unknown = Object.keys(a).filter(k => !known.includes(k));
    if (unknown.length) {
      throw new FormattedToolError(
        `${name} (${chosen.join(', ')}): unknown argument${unknown.length > 1 ? 's' : ''} ` +
          `${list(unknown)} — it takes: ${known.join(', ')}. Unknown arguments are refused, not ignored.`
      );
    }
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) if (!discriminators.includes(k)) rest[k] = v;
    return m.handler(m.schema.parse(rest));
  };

  return { def, members, handle };
}

/** A shared leaf as a member advertises it: the type only — the root carries the prose. */
function bare(leaf: Record<string, unknown>): Record<string, unknown> {
  return typeof leaf.type === 'string' ? { type: leaf.type } : {};
}
