import { describe, it, expect } from 'vitest';
import { MANAGE_MACROS, MacroTools } from './macros.js';
import { makeFoundry, makeLogger } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new MacroTools({ foundry, logger: makeLogger() });
  const run = (args: unknown) => tools.handle(MANAGE_MACROS, args);
  return { tools, calls, run };
}

describe('manage-macros (the M8 union: action create / list / delete)', () => {
  it('advertises one tool with the three actions as closed members', () => {
    const [def] = build().tools.getToolDefinitions();
    expect(def!.name).toBe(MANAGE_MACROS);
    const schema = def!.inputSchema as any;
    expect(schema.properties.action.enum).toEqual(['create', 'list', 'delete']);
    expect(schema.anyOf.map((m: any) => m.properties.action.const)).toEqual([
      'create',
      'list',
      'delete',
    ]);
    for (const m of schema.anyOf) expect(m.additionalProperties).toBe(false);
  });

  it('refuses an unknown action and an unknown key by name against the selected member', async () => {
    const { run } = build();
    await expect(run({ action: 'update' })).rejects.toThrow(
      'manage-macros: action must be one of "create", "list", "delete" (got "update").'
    );
    await expect(run({ action: 'delete', ids: ['m1'] })).rejects.toThrow(
      'manage-macros (action "delete"): unknown argument "ids" — it takes: action, macros.'
    );
  });
});

describe('manage-macros create', () => {
  it('forwards parsed args and confirms the created macro with its hotbar pin on one line', async () => {
    const { calls, run } = build({
      macro: { id: 'm1', name: 'Graze', type: 'script' },
      hotbar: { userId: 'p1', userName: 'Anthony', slot: 1 },
    });
    const out = await run({
      action: 'create',
      name: 'Graze',
      command: 'dnd5e.documents.macro.rollItem("Graze")',
      hotbarUser: 'Anthony',
    });
    expect(calls[0]![0]).toBe('createMacro');
    expect(calls[0]![1]).toMatchObject({
      name: 'Graze',
      command: 'dnd5e.documents.macro.rollItem("Graze")',
      type: 'script',
      hotbarUser: 'Anthony',
    });
    expect(out).toBe(`Created script macro "Graze" (m1); pinned to Anthony's slot 1`);
  });

  it('confirms a macro created without a hotbar pin', async () => {
    const { run } = build({ macro: { id: 'm1', name: 'Rest', type: 'chat' } });
    const out = await run({ action: 'create', name: 'Rest', command: 'We rest.', type: 'chat' });
    expect(out).toBe('Created chat macro "Rest" (m1)');
  });

  it('appends the page warnings (occupied slot, script permission)', async () => {
    const { run } = build({
      macro: { id: 'm1', name: 'Graze', type: 'script' },
      hotbar: { userId: 'p1', userName: 'Anthony', slot: 3 },
      warnings: ['hotbar slot 3 on "Anthony" held "Old Button" — replaced.'],
    });
    const out = await run({
      action: 'create',
      name: 'Graze',
      command: 'x',
      hotbarUser: 'Anthony',
      hotbarSlot: 3,
    });
    expect(out).toBe(
      `Created script macro "Graze" (m1); pinned to Anthony's slot 3` +
        '\n\n⚠️ 1 warning(s):\n- hotbar slot 3 on "Anthony" held "Old Button" — replaced.'
    );
  });

  it('rejects a missing command (zod)', async () => {
    const { run } = build();
    await expect(run({ action: 'create', name: 'Graze' })).rejects.toThrow();
  });

  it('rejects hotbarSlot without hotbarUser (the member refinement survives dispatch)', async () => {
    const { run } = build();
    await expect(
      run({ action: 'create', name: 'Graze', command: 'x', hotbarSlot: 1 })
    ).rejects.toThrow('hotbarSlot requires hotbarUser');
  });

  it('rejects an out-of-range hotbarSlot (zod)', async () => {
    const { run } = build();
    await expect(
      run({ action: 'create', name: 'Graze', command: 'x', hotbarUser: 'Anthony', hotbarSlot: 51 })
    ).rejects.toThrow();
  });

  it('rejects an unknown type (zod enum)', async () => {
    const { run } = build();
    await expect(
      run({ action: 'create', name: 'Graze', command: 'x', type: 'aura' })
    ).rejects.toThrow();
  });
});

describe('manage-macros list (the §3 line shape)', () => {
  const two = {
    count: 2,
    macros: [
      {
        id: 'm1',
        name: 'Graze',
        type: 'script',
        author: 'Claude',
        commandPreview: 'const t = canvas.tokens.controlled[0];\n  t.actor.rollAbility("str");',
        hotbar: [
          { userId: 'p1', userName: 'Anthony', slot: 1 },
          { userId: 'p2', userName: 'Tom', slot: 3 },
        ],
      },
      { id: 'm2', name: 'Long Rest', type: 'chat', author: null, commandPreview: '', hotbar: [] },
    ],
  };

  it('one line per macro under the column header; a pin COUNT and no command by default', async () => {
    const { calls, run } = build(two);
    const out = await run({ action: 'list' });
    expect(calls[0]![0]).toBe('listMacros');
    expect(calls[0]![1]).toEqual({});
    expect(out).toBe(
      '2 macro(s): id name type author pins\nm1 Graze script Claude 2\nm2 "Long Rest" chat - 0'
    );
  });

  it('forwards the filters; verbose appends the hotbar and command columns (whitespace folded)', async () => {
    const { calls, run } = build(two);
    const out = await run({ action: 'list', nameFilter: 'gra', user: 'Tom', verbose: true });
    expect(calls[0]![1]).toEqual({ nameFilter: 'gra', user: 'Tom' });
    expect(out).toBe(
      '2 macro(s): id name type author pins hotbar command\n' +
        'm1 Graze script Claude 2 "Anthony slot 1, Tom slot 3" ' +
        '"const t = canvas.tokens.controlled[0]; t.actor.rollAbility(\\"str\\");"\n' +
        'm2 "Long Rest" chat - 0 - -'
    );
  });

  it('an empty result is the header alone', async () => {
    const { run } = build({ count: 0, macros: [] });
    expect(await run({ action: 'list' })).toBe('0 macro(s).');
  });
});

describe('manage-macros delete', () => {
  it('forwards the identifiers and confirms the deletions with the scrubbed hotbar slots', async () => {
    const { calls, run } = build({
      deleted: [{ id: 'm1', name: 'Graze', type: 'script' }],
      scrubbedHotbarSlots: [{ userId: 'p1', userName: 'Anthony', slot: 1 }],
    });
    const out = await run({ action: 'delete', macros: ['m1'] });
    expect(calls[0]![0]).toBe('deleteMacros');
    expect(calls[0]![1]).toMatchObject({ macros: ['m1'] });
    expect(out).toBe('Deleted 1 macro(s): "Graze" (m1); hotbar slots scrubbed: Anthony slot 1');
  });

  it('reports the identifiers that matched nothing', async () => {
    const { run } = build({
      deleted: [{ id: 'm1', name: 'Graze', type: 'script' }],
      missing: ['ZZ-nope'],
    });
    const out = await run({ action: 'delete', macros: ['Graze', 'ZZ-nope'] });
    expect(out).toBe('Deleted 1 macro(s): "Graze" (m1) (1 not found: ZZ-nope)');
  });

  it('rejects an empty macros array (zod)', async () => {
    const { run } = build();
    await expect(run({ action: 'delete', macros: [] })).rejects.toThrow();
  });
});
