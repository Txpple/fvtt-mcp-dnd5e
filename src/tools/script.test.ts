/**
 * run-script's Node half: the static refusal, the argument shaping onto the page op, the receipt
 * line, the dry-run listing and undo — against the fake bridge.
 */
import { describe, expect, it } from 'vitest';
import { forbiddenWords, ScriptTools } from './script.js';
import { makeFoundry, makeLogger } from './test-helpers.js';

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new ScriptTools({ foundry, logger: makeLogger() });
  return { tools, foundry, calls };
}

const okRun = {
  ok: true,
  result: { tokens: 7 },
  log: ['placed 7'],
  timedOut: false,
  receipt: { id: 'rcpt_8f3a', created: 14, updated: 0, deleted: 0, calls: 16, writes: 14 },
};

describe('forbiddenWords', () => {
  it('finds the doors out, once each, and ignores property access and object keys', () => {
    expect(forbiddenWords('const x = await import("y"); eval("1"); fetch(u); fetch(v)')).toEqual([
      'import',
      'eval',
      'fetch',
    ]);
    expect(
      forbiddenWords('const a = r.fetch; const b = { fetch: 1, import: 2 }; x.eval()')
    ).toEqual([]);
    expect(forbiddenWords('const n = await fvtt.listActors({}); return n.length')).toEqual([]);
  });
});

describe('ScriptTools', () => {
  it('advertises run-script with script | undo and the caps', () => {
    const { tools } = build();
    const [def] = tools.getToolDefinitions();
    expect(def!.name).toBe('run-script');
    expect(Object.keys(def!.inputSchema.properties).sort()).toEqual(
      ['dryRun', 'maxDeletes', 'maxWrites', 'script', 'timeoutSeconds', 'undo'].sort()
    );
  });

  it('refuses a script that reaches outside the facade before anything travels', async () => {
    const { tools, calls } = build();
    await expect(tools.handleRunScript({ script: 'await import("x")' })).rejects.toThrow(
      /refused: the script uses `import`/
    );
    expect(calls).toEqual([]);
  });

  it('needs exactly one of script or undo', async () => {
    const { tools } = build();
    await expect(tools.handleRunScript({})).rejects.toThrow(/exactly one of script or undo/);
    await expect(tools.handleRunScript({ script: 'return 1', undo: 'rcpt_1' })).rejects.toThrow();
  });

  it('shapes the page call and prints the receipt, the log and the result', async () => {
    const { tools, calls } = build(okRun);
    const out = await tools.handleRunScript({
      script: 'return 1',
      maxWrites: 20,
      maxDeletes: 2,
      timeoutSeconds: 30,
    });
    expect(calls).toEqual([
      ['runScript', { src: 'return 1', maxWrites: 20, maxDeletes: 2, timeoutMs: 30_000 }],
    ]);
    expect(out).toContain(
      '✅ Done — receipt rcpt_8f3a: 14 created, 0 updated, 0 deleted (16 call(s), 14 write(s))'
    );
    expect(out).toContain('Undo with { "undo": "rcpt_8f3a" }');
    expect(out).toContain('  · placed 7');
    expect(out).toContain('"tokens": 7');
  });

  it('a failed run prints the error and still the receipt', async () => {
    const { tools } = build({
      ...okRun,
      ok: false,
      error: 'TypeError: x is undefined',
      result: undefined,
    });
    const out = await tools.handleRunScript({ script: 'return x.y' });
    expect(out).toContain('❌ Failed — receipt rcpt_8f3a');
    expect(out).toContain('Error: TypeError: x is undefined');
    expect(out).not.toContain('Result:');
  });

  it('a dry run lists the writes it would make', async () => {
    const { tools, calls } = build({
      ...okRun,
      receipt: { ...okRun.receipt, id: '' },
      dryRun: [{ fn: 'createActorFromCompendium', args: { name: 'Goblin' } }],
    });
    const out = await tools.handleRunScript({ script: 'return 1', dryRun: true });
    expect(calls[0]![1]).toEqual({ src: 'return 1', dryRun: true });
    expect(out).toContain('🧪 Dry run — 1 write(s) the script would make');
    expect(out).toContain('fvtt.createActorFromCompendium({"name":"Goblin"})');
  });

  it('undo reverses a receipt and names what could not be', async () => {
    const { tools, calls } = build({
      id: 'rcpt_8f3a',
      undone: 13,
      failed: [{ op: 'create Actor', uuid: 'Actor.x', error: 'gone' }],
    });
    const out = await tools.handleRunScript({ undo: 'rcpt_8f3a' });
    expect(calls).toEqual([['undoScript', { id: 'rcpt_8f3a' }]]);
    expect(out).toContain('↩️ Receipt rcpt_8f3a: 13 write(s) reversed.');
    expect(out).toContain('1 could not be reversed');
    expect(out).toContain('create Actor Actor.x: gone');
  });
});
