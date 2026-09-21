/**
 * The union tool builder (src/tools/_union.ts) — the advertised b2 shape and its dispatch, on a
 * two-discriminator toy family. The placeables facade tests cover the real one.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { unionMember, unionTool } from './_union.js';

const target = z
  .string()
  .min(1)
  .optional()
  .describe('Scene id or exact name; omit for the ACTIVE scene.');

function toy() {
  const calls: Array<[string, unknown]> = [];
  const handler = (label: string) => async (parsed: unknown) => {
    calls.push([label, parsed]);
    return `${label} ok`;
  };
  const tool = unionTool({
    name: 'manage-things',
    description: 'Things by kind × action.',
    discriminators: ['kind', 'action'],
    shared: { sceneIdentifier: target },
    members: [
      unionMember({
        select: { kind: 'tiles', action: 'create' },
        description: 'Place tiles.',
        schema: z.object({
          sceneIdentifier: target,
          items: z
            .array(z.object({ src: z.string().min(1) }))
            .min(1)
            .describe('The tiles.'),
        }),
        handler: handler('tiles/create'),
      }),
      unionMember({
        select: { kind: 'tiles', action: 'list' },
        description: 'Every tile.',
        schema: z.object({ sceneIdentifier: target }),
        handler: handler('tiles/list'),
      }),
      unionMember({
        select: { kind: 'walls', action: 'update' },
        description: 'Edit walls.',
        schema: z
          .object({
            sceneIdentifier: target,
            patches: z.array(z.object({ id: z.string(), door: z.number().optional() })).min(1),
          })
          .refine(v => v.patches.every(p => p.door !== undefined), { message: 'door required' }),
        handler: handler('walls/update'),
      }),
    ],
  });
  return { tool, calls };
}

describe('unionTool — the advertised shape', () => {
  it('is a top-level object with the discriminators as enums, the shared leaf once, and one closed member per op', () => {
    const { tool } = toy();
    const s = tool.def.inputSchema as any;
    expect(tool.def.name).toBe('manage-things');
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBeUndefined();
    expect(s.required).toEqual(['kind', 'action']);
    expect(s.properties.kind).toEqual({ type: 'string', enum: ['tiles', 'walls'] });
    expect(s.properties.action).toEqual({ type: 'string', enum: ['create', 'list', 'update'] });
    expect(s.properties.sceneIdentifier).toEqual({
      description: 'Scene id or exact name; omit for the ACTIVE scene.',
      type: 'string',
      minLength: 1,
    });
    expect(s.anyOf).toHaveLength(3);
    expect(s.anyOf[0]).toEqual({
      description: 'Place tiles.',
      type: 'object',
      properties: {
        kind: { const: 'tiles' },
        action: { const: 'create' },
        sceneIdentifier: { type: 'string' },
        items: {
          minItems: 1,
          type: 'array',
          items: {
            type: 'object',
            properties: { src: { type: 'string', minLength: 1 } },
            required: ['src'],
          },
          description: 'The tiles.',
        },
      },
      required: ['kind', 'action', 'items'],
      additionalProperties: false,
    });
    // the member's key order: description first, then the discriminators before its own leaves
    expect(Object.keys(s.anyOf[2])).toEqual([
      'description',
      'type',
      'properties',
      'required',
      'additionalProperties',
    ]);
    expect(Object.keys(s.anyOf[2].properties)).toEqual([
      'kind',
      'action',
      'sceneIdentifier',
      'patches',
    ]);
  });

  it('refuses a malformed family at construction', () => {
    const base = {
      name: 'x',
      description: 'x',
      discriminators: ['kind', 'action'],
    };
    const m = (select: Record<string, string>, shape: z.ZodRawShape = {}) =>
      unionMember({ select, description: 'd', schema: z.object(shape), handler: async () => 1 });
    expect(() => unionTool({ ...base, members: [m({ kind: 'a' })] })).toThrow(
      'x: member selects [kind] but the discriminators are [action,kind]'
    );
    expect(() =>
      unionTool({
        ...base,
        members: [m({ kind: 'a', action: 'b' }), m({ kind: 'a', action: 'b' })],
      })
    ).toThrow('x: two members select a/b');
    expect(() =>
      unionTool({ ...base, members: [m({ kind: 'a', action: 'b' }, { kind: z.string() })] })
    ).toThrow('x a/b: leaf "kind" collides with a discriminator');
    expect(() =>
      unionTool({
        ...base,
        shared: { sceneIdentifier: target },
        members: [m({ kind: 'a', action: 'b' })],
      })
    ).toThrow('x: shared leaf "sceneIdentifier" is taken by no member');
  });
});

describe('unionTool — dispatch', () => {
  it('selects the member, strips the discriminators, parses with the member schema and runs its handler', async () => {
    const { tool, calls } = toy();
    const out = await tool.handle({
      kind: 'tiles',
      action: 'create',
      sceneIdentifier: 'Cave',
      items: [{ src: 'a.png' }],
    });
    expect(out).toBe('tiles/create ok');
    expect(calls).toEqual([
      ['tiles/create', { sceneIdentifier: 'Cave', items: [{ src: 'a.png' }] }],
    ]);
    // the shared leaf is optional: a list with nothing but the discriminators
    expect(await tool.handle({ kind: 'tiles', action: 'list' })).toBe('tiles/list ok');
    expect(calls[1]).toEqual(['tiles/list', {}]);
  });

  it('refuses an unknown discriminator value by name, listing the valid ones for the selection so far', async () => {
    const { tool } = toy();
    await expect(tool.handle({ kind: 'roofs', action: 'list' })).rejects.toThrow(
      'manage-things: kind must be one of "tiles", "walls" (got "roofs").'
    );
    await expect(tool.handle({ kind: 'walls', action: 'list' })).rejects.toThrow(
      'manage-things: action must be one of "update" for kind "walls" (got "list").'
    );
    await expect(tool.handle({})).rejects.toThrow(
      'manage-things: kind must be one of "tiles", "walls" (got nothing).'
    );
    await expect(tool.handle(null)).rejects.toThrow('(got nothing)');
    await expect(tool.handle({ kind: 7 })).rejects.toThrow('(got 7)');
  });

  it('refuses an unknown key by name against the SELECTED member, even one another member takes', async () => {
    const { tool, calls } = toy();
    await expect(
      tool.handle({ kind: 'tiles', action: 'list', items: [], extra: 1 })
    ).rejects.toThrow(
      'manage-things (kind "tiles", action "list"): unknown arguments "items", "extra" — it takes: kind, action, sceneIdentifier. Unknown arguments are refused, not ignored.'
    );
    expect(calls).toEqual([]);
  });

  it('enforces the member schema, refinements included (the advertised member is only its shape)', async () => {
    const { tool, calls } = toy();
    await expect(tool.handle({ kind: 'tiles', action: 'create', items: [] })).rejects.toThrow();
    await expect(
      tool.handle({ kind: 'walls', action: 'update', patches: [{ id: 'w1' }] })
    ).rejects.toThrow('door required');
    expect(calls).toEqual([]);
    await tool.handle({ kind: 'walls', action: 'update', patches: [{ id: 'w1', door: 1 }] });
    expect(calls).toEqual([['walls/update', { patches: [{ id: 'w1', door: 1 }] }]]);
  });

  it('a handler error propagates untouched', async () => {
    const boom = vi.fn(async () => {
      throw new Error('page said no');
    });
    const tool = unionTool({
      name: 'x',
      description: 'x',
      discriminators: ['action'],
      members: [
        unionMember({
          select: { action: 'go' },
          description: 'd',
          schema: z.object({}),
          handler: boom,
        }),
      ],
    });
    await expect(tool.handle({ action: 'go' })).rejects.toThrow('page said no');
    expect(boom).toHaveBeenCalledWith({});
  });
});
