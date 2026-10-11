// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are script source, where a `${…}` is the case under test
/**
 * run-script's Node half: the static refusal (code only: strings, template text and comments are
 * prose), the argument shaping onto the page op, the receipt line, the dry-run listing and undo —
 * against the fake bridge.
 */
import { describe, expect, it } from 'vitest';
import { blankLiterals, forbiddenWords, ScriptTools } from './script.js';
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
