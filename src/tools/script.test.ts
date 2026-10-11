// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are script source, where a `${…}` is the case under test
/**
 * run-script's Node half: the static refusal (code only: strings, template text and comments are
 * prose), the argument shaping onto the page op, the run's own lines, the dry-run listing, and undo
 * through the receipt store (src/receipts.ts) — against the fake bridge. The receipt line itself is
 * the registry's, for every write tool alike (src/tools/registry.test.ts).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callContext, loadReceipt, receiptWorldKey, saveReceipt } from '../receipts.js';
import { blankLiterals, forbiddenWords, ScriptTools } from './script.js';
import { makeFoundry, makeLogger } from './test-helpers.js';

const SERVER = 'http://localhost:30000';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fvtt-script-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function build(response: any = {}) {
  const { foundry, calls } = makeFoundry(response);
  const tools = new ScriptTools({
    foundry,
    logger: makeLogger(),
    serverUrl: SERVER,
    receiptsDir: dir,
  });
  return { tools, foundry, calls };
}

const okRun = {
  ok: true,
  result: { tokens: 7 },
  log: ['placed 7'],
  timedOut: false,
  receipt: { created: 14, updated: 0, deleted: 0, calls: 16, writes: 14 },
};

describe('blankLiterals', () => {
  it('blanks string, template and comment text in place and keeps the code', () => {
    const src = 'a("x y"); b(\'z\'); /* c */ d(`t ${e("u")} v`); // w\nf()';
    const out = blankLiterals(src);
    expect(out).toHaveLength(src.length);
    expect(out).toBe('a("   "); b(\' \');         d(`  ${e(" ")}  `);     \nf()');
  });

  it('keeps an escaped quote inside its string and newlines where they were', () => {
    expect(blankLiterals("'it\\'s' + x")).toBe("'     ' + x");
    expect(blankLiterals('/* a\nb */ c')).toBe('    \n     c');
  });
});

describe('forbiddenWords', () => {
  it('finds the refused words, once each, and ignores property access and object keys', () => {
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

  it('reads code only: a word in a string, in template text or in a comment is prose', () => {
    // the four content jobs issue #15 found refused
    expect(
      forbiddenWords(
        "await fvtt.createJournal({ name: 'Ritual', content: 'The ritual process takes an hour.' });"
      )
    ).toEqual([]);
    expect(forbiddenWords("log('Go fetch the relic'); return 1;")).toEqual([]);
    expect(forbiddenWords("const html = '<p>Trade goods import duties</p>';")).toEqual([]);
    expect(forbiddenWords("const html = '<p>They require an escort.</p>';")).toEqual([]);
    expect(forbiddenWords('// import the goblins, then fetch water\nreturn 1;')).toEqual([]);
    expect(forbiddenWords('/* eval, process */ return `fetch ${1 + 1} import`;')).toEqual([]);
    expect(forbiddenWords("const s = 'it\\'s a fetch quest'; return s;")).toEqual([]);
    expect(forbiddenWords('const s = "the constructor\'s Reflect"; return s;')).toEqual([]);
  });

  it('a template-literal expression is code, nested braces and templates included', () => {
    expect(forbiddenWords('return `${fetch("x")}`;')).toEqual(['fetch']);
    expect(forbiddenWords('return `a ${ { k: `b ${ eval(1) }` }.k } c`;')).toEqual(['eval']);
    expect(forbiddenWords('return `${ { a: 1 }.a } fetch`;')).toEqual([]);
  });

  it('refuses the ways back to the real globals, as code tokens and as computed keys', () => {
    expect(forbiddenWords("const G = [].constructor.constructor('return this')();")).toEqual([
      'constructor',
    ]);
    expect(forbiddenWords("(async () => {}).constructor('x')")).toEqual(['constructor']);
    expect(forbiddenWords('return fvtt.listActors.constructor;')).toEqual(['constructor']);
    expect(forbiddenWords("x['constructor']")).toEqual(['constructor']);
    expect(forbiddenWords('x["__proto__"]')).toEqual(['__proto__']);
    expect(forbiddenWords('x[ `Reflect` ]')).toEqual(['Reflect']);
    expect(forbiddenWords("Reflect.get(a, 'b')")).toEqual(['Reflect']);
    expect(forbiddenWords('Object.getPrototypeOf(x)')).toEqual(['getPrototypeOf']);
    expect(forbiddenWords('a.__proto__')).toEqual(['__proto__']);
    expect(forbiddenWords("x['__proto__']; fetch(u); x.constructor; x['__proto__'];")).toEqual([
      '__proto__',
      'fetch',
      'constructor',
    ]);
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

  it('refuses a script that steps around the facade before anything travels', async () => {
    const { tools, calls } = build();
    await expect(tools.handleRunScript({ script: 'await import("x")' })).rejects.toThrow(
      /refused: the script uses `import`/
    );
    await expect(
      tools.handleRunScript({
        script: "const G = [].constructor.constructor('return this')(); return G.game.actors.size;",
      })
    ).rejects.toThrow(/refused: the script uses `constructor` as code/);
    expect(calls).toEqual([]);
  });

  it('the refusal and the description do not claim a boundary the facade is not', async () => {
    const { tools } = build();
    const [def] = tools.getToolDefinitions();
    expect(def!.description).not.toMatch(/shadow|by design|no way out/i);
    expect(def!.description).toContain('bridge user’s rights');
    const refusal = await tools.handleRunScript({ script: 'eval("1")' }).catch(e => e.message);
    expect(refusal).not.toMatch(/no way out|by design|whole surface/);
    expect(refusal).toContain('not a security boundary');
  });

  it('lets prose through: a refused word inside a string travels to the page', async () => {
    const { tools, calls } = build(okRun);
    await tools.handleRunScript({
      script: "await fvtt.postChatMessage({ content: 'Go fetch the relic' }); return 1;",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('runScript');
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
    expect(out).toContain('✅ Done — 16 call(s), 14 write(s).');
    // the receipt (its id, what changed, the undo) is the line every write answers with, not the run's
    expect(out).not.toContain('rcpt_');
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
    expect(out).toContain('❌ Failed — 16 call(s), 14 write(s).');
    expect(out).toContain('Error: TypeError: x is undefined');
    expect(out).not.toContain('Result:');
  });

  it('a dry run lists the writes it would make', async () => {
    const { tools, calls } = build({
      ...okRun,
      dryRun: [{ fn: 'createActorFromCompendium', args: { name: 'Goblin' } }],
    });
    const out = await tools.handleRunScript({ script: 'return 1', dryRun: true });
    expect(calls[0]![1]).toEqual({ src: 'return 1', dryRun: true });
    expect(out).toContain('🧪 Dry run — 1 write(s) the script would make');
    expect(out).toContain('fvtt.createActorFromCompendium({"name":"Goblin"})');
  });

  it("undo sends the stored receipt's writes to the page, names what could not be, and leaves the receipt undoable", async () => {
    const ops = [
      { kind: 'create' as const, documentName: 'Actor', uuid: 'Actor.x', label: 'X' },
      { kind: 'create' as const, documentName: 'Actor', uuid: 'Actor.y', label: 'Y' },
    ];
    // makeFoundry's world is "w"
    const kept = saveReceipt(
      { at: 'now', serverUrl: SERVER, worldId: 'w', tool: 'run-script', ops },
      dir
    );
    const { tools, calls } = build({
      undone: 1,
      failed: [{ op: 'create Actor', uuid: 'Actor.x', error: 'gone' }],
    });
    const ctx = { ops: [] };
    const out = await callContext.run(ctx, () => tools.handleRunScript({ undo: kept.id }));
    expect(calls).toEqual([['undoOps', { ops }]]);
    expect(out).toContain(`↩️ Receipt ${kept.id}: 1 write(s) reversed.`);
    expect(out).toContain(`1 could not be reversed; receipt ${kept.id} stays undoable:`);
    expect(out).toContain('create Actor Actor.x: gone');
    // not every write was reversed: the call reverses the receipt only in part (src/registry.ts)
    expect(ctx).toEqual({ ops: [], reverses: kept.id, reversesPartial: true });
  });

  it('an undo that reversed every write reverses the receipt whole; one the page never answered, in part', async () => {
    const ops = [{ kind: 'create' as const, documentName: 'Actor', uuid: 'Actor.x', label: 'X' }];
    const kept = saveReceipt(
      { at: 'now', serverUrl: SERVER, worldId: 'w', tool: 'run-script', ops },
      dir
    );
    const { tools } = build({ undone: 1, failed: [] });
    const ctx = { ops: [] };
    const out = await callContext.run(ctx, () => tools.handleRunScript({ undo: kept.id }));
    expect(out).toBe(`↩️ Receipt ${kept.id}: 1 write(s) reversed.`);
    expect(ctx).toEqual({ ops: [], reverses: kept.id });
    const broken = build(async () => {
      throw new Error('the page went away');
    });
    const lost = { ops: [] };
    await expect(
      callContext.run(lost, () => broken.tools.handleRunScript({ undo: kept.id }))
    ).rejects.toThrow('the page went away');
    expect(lost).toEqual({ ops: [], reverses: kept.id, reversesPartial: true });
  });

  it('undo refuses an id the store does not have for this world, and one already undone', async () => {
    const { tools, calls } = build();
    await expect(tools.handleRunScript({ undo: 'rcpt_zzzzzz' })).rejects.toThrow(
      'run-script: receipt rcpt_zzzzzz is not in the store: receipts belong to the world they were written in'
    );
    const other = saveReceipt(
      { at: 'now', serverUrl: SERVER, worldId: 'elsewhere', tool: 'x', ops: [] },
      dir
    );
    await expect(tools.handleRunScript({ undo: other.id })).rejects.toThrow(
      `receipt ${other.id} was written in another world`
    );
    const done = saveReceipt(
      { at: 'now', serverUrl: SERVER, worldId: 'w', tool: 'x', ops: [], undoneBy: 'rcpt_r00001' },
      dir
    );
    await expect(tools.handleRunScript({ undo: done.id })).rejects.toThrow(
      `run-script: receipt ${done.id} was already undone by rcpt_r00001; undo rcpt_r00001 to put it back.`
    );
    expect(calls).toEqual([]);
    expect(loadReceipt(done.id, receiptWorldKey(SERVER, 'w'), dir).undoneBy).toBe('rcpt_r00001');
  });
});
