// `npm run init` (src/init.ts): the strict flags, the .env it writes or merges, the registration
// entry and the JSON merge, where the registration goes, and whole runs against temp folders with
// --no-doctor (nothing here reads or writes the clone's own .env, .mcp.json or ~/.claude.json). The
// live run, with the doctor's join, is `npm run init` against a sandbox.
import dotenv from 'dotenv';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from './doctor.js';
import { resolveHostConfig } from './hosts/env.js';
import {
  type Answers,
  defaultDataDir,
  envEntries,
  envLine,
  type InitContext,
  type InitIO,
  mergeEnv,
  parseInitArgs,
  registrationEntry,
  renderEnv,
  resolveTarget,
  runInit,
  type ServerEntry,
  setServer,
  terminalAsker,
  UsageError,
} from './init.js';

// The doctor joins a live world; here it is a stand-in that says what a run tells it.
vi.mock('./doctor.js', () => ({ runDoctor: vi.fn() }));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'fvtt-init-'));
  dirs.push(d);
  return d;
}

/** A clone, a home and a working folder, all under one temp folder. */
function context(root: string): InitContext {
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(join(repo, 'dist'), { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    repo,
    node: process.execPath,
    home,
    cwd: root,
    platform: process.platform,
    env: {},
    now: new Date(2026, 9, 11, 14, 5, 9),
  };
}

/** Records every line; answers the questions from a script (`undefined` = the input ended). */
function recorder(script: Array<string | undefined> = []) {
  const out: string[] = [];
  const asked: Array<{ question: string; secret: boolean }> = [];
  const io: InitIO = {
    print: text => out.push(text),
    say: (mark, text) => out.push(`${mark} ${text}`),
    foundryApp: () => ({ main: '', tried: [], found: false }),
    ask: async (question, opts) => {
      asked.push({ question, secret: Boolean(opts?.secret) });
      return script.shift();
    },
    hidesSecrets: true,
  };
  return { io, out, asked };
}

const read = (file: string): string => readFileSync(file, 'utf8');
const SECRETS = ['join-pw', 'admin-pw', 'https://box.moltenhosting.com/?s=wake-token', 'dav-pw'];

describe('parseInitArgs — strict flags', () => {
  it('reads `--flag value`, `--flag=value` and the switches', () => {
    expect(
      parseInitArgs([
        '--host',
        'local',
        '--user=Assistant DM',
        '--password=',
        '-y',
        '--no-doctor',
        '--target',
        'path:x.json',
      ])
    ).toEqual({
      host: 'local',
      user: 'Assistant DM',
      password: '',
      target: 'path:x.json',
      yes: true,
      force: false,
      noDoctor: true,
      help: false,
    });
  });

  it('refuses an unknown flag, a missing value, a repeat and a stray word, by name', () => {
    expect(() => parseInitArgs(['--hots', 'local'])).toThrow(/unknown flag --hots/);
    expect(() => parseInitArgs(['--host'])).toThrow(/--host needs a value/);
    expect(() => parseInitArgs(['--password', '--yes'])).toThrow(/--password needs a value/);
    expect(() => parseInitArgs(['--host', 'local', '--host=molten'])).toThrow(/given twice/);
    expect(() => parseInitArgs(['--yes=1'])).toThrow(/--yes takes no value/);
    // Node reads --env-file wherever it stands (a new file: exit 9; an old one: loaded into the
    // environment), so the .env to write is --env, and --env-file is refused naming it.
    expect(() => parseInitArgs(['--env-file', 'x.env'])).toThrow(/Node's own flag.*--env <file>/);
    expect(parseInitArgs(['--env', 'x.env']).envFile).toBe('x.env');
    // A stray word may be a password that lost its flag: refused, never echoed.
    expect(() => parseInitArgs(['hunter2'])).toThrow(UsageError);
    expect(() => parseInitArgs(['hunter2'])).not.toThrow(/hunter2/);
  });
});

describe('runInit — refusals (exit 2, nothing written)', () => {
  it('--yes with a missing required answer names the flag', async () => {
    const ctx = context(tmp());
    const run = recorder();
    expect(await runInit(['--yes', '--no-doctor'], run.io, ctx)).toBe(2);
    expect(run.out).toContain(
      'fail --host is required with --yes, which asks nothing — nothing written'
    );
    const molten = recorder();
    expect(await runInit(['--yes', '--host', 'molten', '--no-doctor'], molten.io, ctx)).toBe(2);
    expect(molten.out.join('\n')).toContain('fail --url is required with --yes');
    expect(existsSync(join(ctx.repo, '.env'))).toBe(false);
    expect(existsSync(join(ctx.repo, '.mcp.json'))).toBe(false);
  });

  it('checks every flag before asking anything; an unknown flag prints the usage', async () => {
    const ctx = context(tmp());
    const cases: Array<[string[], RegExp]> = [
      [['--host', 'forge'], /--host: not one of local, molten, generic/],
      [['--url', 'https://your-foundry.example.com'], /--url: the placeholder/],
      [['--toolsets', 'readonly,chat'], /"readonly" stands alone/],
      [['--target', 'elsewhere'], /--target: not project, user or path:<file>/],
      [['--data-dir', join(ctx.home, 'no-such-folder')], /--data-dir: not an existing folder/],
      [['--host', 'molten', '--data-dir', ctx.home], /--data-dir does not apply to --host molten/],
      [['--host', 'local', '--wake-url', 'https://x.example/'], /does not apply to --host local/],
    ];
    for (const [argv, message] of cases) {
      const run = recorder(['local']);
      expect(await runInit([...argv, '--no-doctor'], run.io, ctx)).toBe(2);
      expect(run.out.join('\n')).toMatch(message);
    }
    const unknown = recorder();
    expect(await runInit(['--hots', 'local'], unknown.io, ctx)).toBe(2);
    expect(unknown.out.join('\n')).toContain('Usage: npm run init');
    expect(unknown.asked).toEqual([]);
    expect(existsSync(join(ctx.repo, '.env'))).toBe(false);
  });
});

describe('the .env', () => {
  const base = { name: 'foundry', target: 'project' } as const;

  it('a new file holds only the answered keys, in the minimal block’s order, per host', () => {
    const local: Answers = {
      ...base,
      host: 'local',
      user: 'MCP-Claude',
      adminKey: 'admin#pw',
      dataDir: 'C:\\Foundry\\Data',
    };
    const text = renderEnv(envEntries(local), '2026-10-11');
    expect(text.split('\n')[0]).toMatch(/^# Written by `npm run init` on 2026-10-11/);
    expect(dotenv.parse(text)).toEqual({
      FOUNDRY_HOST: 'local',
      FOUNDRY_USER: 'MCP-Claude',
      FOUNDRY_ADMIN_KEY: 'admin#pw',
      FOUNDRY_DATA_DIR: 'C:\\Foundry\\Data',
    });

    const molten: Answers = {
      ...base,
      host: 'molten',
      url: 'https://box.moltenhosting.com',
      user: 'MCP-Claude',
      password: 'join-pw',
      adminKey: 'admin-pw',
      wakeUrl: 'https://box.moltenhosting.com/?s=wake-token',
      webdavPassword: 'dav-pw',
    };
    expect(envEntries(molten).map(([k]) => k)).toEqual([
      'FOUNDRY_HOST',
      'FOUNDRY_URL',
      'FOUNDRY_USER',
      'FOUNDRY_PASSWORD',
      'FOUNDRY_ADMIN_KEY',
      'FOUNDRY_WAKE_URL',
      'FOUNDRY_WEBDAV_PASSWORD',
    ]);
    expect(dotenv.parse(renderEnv(envEntries(molten), '2026-10-11')).FOUNDRY_WAKE_URL).toBe(
      'https://box.moltenhosting.com/?s=wake-token'
    );

    const generic: Answers = {
      ...base,
      host: 'generic',
      url: 'https://vtt.example.org',
      user: 'GM',
    };
    expect(envEntries(generic)).toEqual([
      ['FOUNDRY_HOST', 'generic'],
      ['FOUNDRY_URL', 'https://vtt.example.org'],
      ['FOUNDRY_USER', 'GM'],
    ]);
  });

  it('quotes a value only where dotenv would read it otherwise, and refuses one no line can hold', () => {
    expect(envLine('FOUNDRY_USER', 'Assistant DM')).toBe('FOUNDRY_USER=Assistant DM');
    expect(envLine('FOUNDRY_DATA_DIR', 'C:\\Users\\you\\Data')).toBe(
      'FOUNDRY_DATA_DIR=C:\\Users\\you\\Data'
    );
    for (const value of ['a#b', ' edge ', "'quoted'", 'it\'s "both"', 'x\\ny']) {
      expect(dotenv.parse(envLine('K', value)).K).toBe(value);
    }
    expect(envLine('K', 'a#b')).toBe("K='a#b'");
    expect(() => envLine('K', 'a\nb')).toThrow(/a value with a line break/);
  });

  it('merges in place: other lines, comments and line endings kept, new keys appended', () => {
    const text = [
      '# my sandbox',
      'FOUNDRY_USER=Old',
      'LOG_LEVEL=info',
      '',
      '# FOUNDRY_ADMIN_KEY=',
      'LOCAL_FOUNDRY_DATA=C:\\old\\Data',
      '',
    ].join('\r\n');
    const entries: Array<[string, string]> = [
      ['FOUNDRY_HOST', 'local'],
      ['FOUNDRY_USER', 'Assistant DM'],
      ['FOUNDRY_ADMIN_KEY', 'k'],
      ['FOUNDRY_DATA_DIR', 'C:\\new\\Data'],
    ];
    const merged = mergeEnv(text, entries, 'local', '2026-10-11');
    // Under local the 2.x alias is what the host reads, so its own line takes the answer.
    expect(merged.set).toEqual(['FOUNDRY_USER', 'LOCAL_FOUNDRY_DATA']);
    expect(merged.added).toEqual(['FOUNDRY_HOST', 'FOUNDRY_ADMIN_KEY']);
    expect(merged.text).toBe(
      [
        '# my sandbox',
        'FOUNDRY_USER=Assistant DM',
        'LOG_LEVEL=info',
        '',
        '# FOUNDRY_ADMIN_KEY=',
        'LOCAL_FOUNDRY_DATA=C:\\new\\Data',
        '',
        '# Added by `npm run init` on 2026-10-11',
        'FOUNDRY_HOST=local',
        'FOUNDRY_ADMIN_KEY=k',
        '',
      ].join('\r\n')
    );
    expect(resolveHostConfig(dotenv.parse(merged.text), 'local')).toMatchObject({
      user: 'Assistant DM',
      adminKey: 'k',
      dataDir: 'C:\\new\\Data',
    });

    // Under generic no LOCAL_* name is read: the canonical key is appended, the alias left alone.
    const generic = mergeEnv(
      text,
      [['FOUNDRY_DATA_DIR', 'C:\\new\\Data']],
      'generic',
      '2026-10-11'
    );
    expect(generic.added).toEqual(['FOUNDRY_DATA_DIR']);
    expect(generic.text).toContain('LOCAL_FOUNDRY_DATA=C:\\old\\Data');

    // What the host already reads is left alone, alias or not.
    const same = mergeEnv(text, [['FOUNDRY_DATA_DIR', 'C:\\old\\Data']], 'local', '2026-10-11');
    expect(same).toEqual({ text, set: [], added: [] });
  });
});

describe('the registration', () => {
  const answers: Answers = {
    host: 'molten',
    url: 'https://box.moltenhosting.com',
    user: 'MCP-Claude',
    password: 'join-pw',
    adminKey: 'admin-pw',
    wakeUrl: 'https://box.moltenhosting.com/?s=wake-token',
    webdavPassword: 'dav-pw',
    name: 'foundry',
    target: 'project',
  };

  it('is this Node and dist/index.js, absolute with forward slashes, and no secret', () => {
    const repo = join(tmp(), 'fvtt-mcp-dnd5e');
    const at = { node: process.execPath, repo, envFile: join(repo, '.env') };
    const entry = registrationEntry(answers, { ...at, platform: process.platform });
    expect(entry.command).toBe(process.execPath.replace(/\\/g, '/'));
    expect(entry.args).toEqual([join(repo, 'dist', 'index.js').replace(/\\/g, '/')]);
    for (const p of [entry.command, ...entry.args]) {
      expect(isAbsolute(p)).toBe(true);
      expect(p).not.toContain('\\');
    }
    // The repo's own .env needs no naming; nothing secret rides along.
    expect(entry.env).toEqual({
      FOUNDRY_HOST: 'molten',
      FOUNDRY_URL: 'https://box.moltenhosting.com',
    });
    const json = JSON.stringify(entry);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    // A Windows path is written the way the registration examples show it.
    expect(
      registrationEntry(answers, {
        ...at,
        node: 'C:\\Program Files\\nodejs\\node.exe',
        platform: process.platform,
      }).command
    ).toBe('C:/Program Files/nodejs/node.exe');
  });

  it('names a .env that is not the repo’s, the toolsets when chosen, and a local URL only when given', () => {
    const root = tmp();
    const repo = join(root, 'repo');
    const local = registrationEntry(
      {
        host: 'local',
        user: 'MCP-Claude',
        name: 'foundry-local5e',
        target: 'project',
        toolsets: 'readonly',
      },
      {
        node: process.execPath,
        repo,
        envFile: join(root, 'cfg', '.env.sandbox'),
        platform: process.platform,
      }
    );
    expect(local.env).toEqual({
      FOUNDRY_HOST: 'local',
      FOUNDRY_TOOLSETS: 'readonly',
      FVTT_MCP_ENV: join(root, 'cfg', '.env.sandbox').replace(/\\/g, '/'),
    });
  });

  const entry: ServerEntry = {
    command: 'node',
    args: ['index.js'],
    env: { FOUNDRY_HOST: 'local' },
  };

  it('the JSON merge sets one entry and keeps every other key, its place and the file’s ending', () => {
    // ~/.claude.json as Claude Code writes it: 2-space JSON, no trailing newline.
    const before = {
      numStartups: 3,
      mcpServers: { imagegen: { command: 'x' }, foundry: { old: true } },
      projects: { p: { allowedTools: [] } },
    };
    const text = JSON.stringify(before, null, 2);
    const merged = setServer(text, 'foundry', entry);
    expect(merged.replaced).toBe(true);
    expect(merged.text.endsWith('\n')).toBe(false);
    const after = JSON.parse(merged.text);
    expect(after).toEqual({
      ...before,
      mcpServers: { imagegen: { command: 'x' }, foundry: entry },
    });
    expect(Object.keys(after)).toEqual(['numStartups', 'mcpServers', 'projects']);
    expect(merged.text).toBe(JSON.stringify(after, null, 2));

    const added = setServer('{\r\n  "a": 1\r\n}\r\n', 'foundry-local5e', entry);
    expect(added.replaced).toBe(false);
    const crlf = JSON.stringify({ a: 1, mcpServers: { 'foundry-local5e': entry } }, null, 2);
    expect(added.text).toBe(`${crlf.replace(/\n/g, '\r\n')}\r\n`);
    expect(setServer(undefined, 'x', entry).text).toBe(
      `${JSON.stringify({ mcpServers: { x: entry } }, null, 2)}\n`
    );
  });

  it('refuses a file it cannot merge into', () => {
    expect(() => setServer('{ nope', 'x', entry)).toThrow(/is not JSON/);
    expect(() => setServer('[1]', 'x', entry)).toThrow(/is not a JSON object/);
    expect(() => setServer('{ "mcpServers": [] }', 'x', entry)).toThrow(/"mcpServers" that is not/);
  });

  it('the target: this clone, ~/.claude.json, or a file (a folder means its .mcp.json)', () => {
    const root = tmp();
    const at = { repo: join(root, 'repo'), home: join(root, 'home'), cwd: root };
    mkdirSync(join(root, 'campaign'));
    expect(resolveTarget('project', at)).toEqual({
      kind: 'project',
      file: join(at.repo, '.mcp.json'),
    });
    expect(resolveTarget(' user ', at)).toEqual({
      kind: 'user',
      file: join(at.home, '.claude.json'),
    });
    expect(resolveTarget('path:out/mcp.json', at)).toEqual({
      kind: 'path',
      file: join(root, 'out', 'mcp.json'),
    });
    expect(resolveTarget('path:campaign', at).file).toBe(join(root, 'campaign', '.mcp.json'));
    expect(resolveTarget('path:~/x.json', at).file).toBe(join(at.home, 'x.json'));
    expect(() => resolveTarget('path:', at)).toThrow(UsageError);
    expect(() => resolveTarget('global', at)).toThrow(/not project, user or path:<file>/);
  });

  it('offers the platform’s Data folder (docs/local-sandbox.md)', () => {
    expect(
      defaultDataDir('win32', 'C:\\Users\\you', { LOCALAPPDATA: 'C:\\Users\\you\\AppData\\Local' })
    ).toBe('C:\\Users\\you\\AppData\\Local\\FoundryVTT\\Data');
    expect(defaultDataDir('linux', '/home/you', {})).toBe('/home/you/.local/share/FoundryVTT/Data');
    expect(defaultDataDir('darwin', '/Users/you', {})).toBe(
      '/Users/you/Library/Application Support/FoundryVTT/Data'
    );
  });
});

describe('runInit — whole runs against temp folders (--no-doctor)', () => {
  it('writes a new .env and a registration, says step zero first and prints the block', async () => {
    const root = tmp();
    const ctx = context(root);
    const data = join(root, 'Data');
    mkdirSync(data);
    mkdirSync(join(root, 'campaign'));
    const argv = [
      '--yes',
      '--host=local',
      '--user',
      'Assistant DM',
      '--password',
      'join-pw',
      '--admin-key',
      'admin-pw',
      '--data-dir',
      'Data',
      '--env',
      'cfg/.env',
      '--target',
      'path:campaign',
      '--no-doctor',
    ];
    const run = recorder();
    expect(await runInit(argv, run.io, ctx)).toBe(0);
    expect(run.out[0]).toMatch(/^Step zero, in Foundry: the user the bridge joins as must exist/);

    const envFile = join(root, 'cfg', '.env');
    expect(dotenv.parse(read(envFile))).toEqual({
      FOUNDRY_HOST: 'local',
      FOUNDRY_USER: 'Assistant DM',
      FOUNDRY_PASSWORD: 'join-pw',
      FOUNDRY_ADMIN_KEY: 'admin-pw',
      FOUNDRY_DATA_DIR: data,
    });
    const regFile = join(root, 'campaign', '.mcp.json');
    const reg = read(regFile);
    for (const secret of SECRETS) expect(reg).not.toContain(secret);
    const written = JSON.parse(reg).mcpServers['foundry-local5e'];
    expect(written).toEqual({
      command: process.execPath.replace(/\\/g, '/'),
      args: [join(ctx.repo, 'dist', 'index.js').replace(/\\/g, '/')],
      env: { FOUNDRY_HOST: 'local', FVTT_MCP_ENV: envFile.replace(/\\/g, '/') },
    });
    const text = run.out.join('\n');
    expect(text).toContain(`ok registration: added "foundry-local5e" in ${regFile}`);
    expect(text).toContain('skip doctor: skipped (--no-doctor)');
    // The generic block is the entry it wrote, as a pasteable mcpServers object.
    expect(text).toContain(JSON.stringify({ mcpServers: { 'foundry-local5e': written } }, null, 2));

    // Again with --toolsets readonly: refused under --yes without --force, replaced with it; the
    // .env already holds every answer and is left as it was.
    const again = [...argv, '--toolsets', 'readonly'];
    const refused = recorder();
    expect(await runInit(again, refused.io, ctx)).toBe(2);
    expect(refused.out.join('\n')).toContain('--force replaces it, --name picks another');
    expect(read(regFile)).toBe(reg);
    const forced = recorder();
    expect(await runInit([...again, '--force'], forced.io, ctx)).toBe(0);
    expect(forced.out.join('\n')).toContain(
      'ok registration: replaced the entry "foundry-local5e"'
    );
    expect(forced.out.join('\n')).toContain('already holds these answers (unchanged)');
    expect(existsSync(`${envFile}.bak`)).toBe(false);
    expect(JSON.parse(read(regFile)).mcpServers['foundry-local5e'].env.FOUNDRY_TOOLSETS).toBe(
      'readonly'
    );
  });

  it('an existing .env is backed up, then changed in place', async () => {
    const root = tmp();
    const ctx = context(root);
    const envFile = join(ctx.repo, '.env');
    const original = '# mine\nFOUNDRY_USER=Old\nLOG_LEVEL=info\n';
    writeFileSync(envFile, original);
    const argv = ['--yes', '--host', 'generic', '--url', 'https://vtt.example.org', '--no-doctor'];
    const run = recorder();
    expect(await runInit([...argv, '--user', 'GM'], run.io, ctx)).toBe(0);
    expect(read(`${envFile}.bak`)).toBe(original);
    expect(read(envFile)).toMatch(/^# mine\nFOUNDRY_USER=GM\nLOG_LEVEL=info\n\n# Added by/);
    expect(dotenv.parse(read(envFile))).toMatchObject({
      FOUNDRY_HOST: 'generic',
      FOUNDRY_URL: 'https://vtt.example.org',
      FOUNDRY_USER: 'GM',
    });
    // The repo's own .env: the registration does not need to name it.
    expect(JSON.parse(read(join(ctx.repo, '.mcp.json'))).mcpServers.foundry.env).toEqual({
      FOUNDRY_HOST: 'generic',
      FOUNDRY_URL: 'https://vtt.example.org',
    });
  });

  it('runs the doctor on what it wrote; a failing doctor keeps the files and exits 1', async () => {
    const root = tmp();
    const ctx = context(root);
    const doctor = vi.mocked(runDoctor).mockImplementationOnce(async io => {
      io.say('fail', 'login: wrong password');
      return 1;
    });
    const run = recorder();
    run.io.preflight = [{ mark: 'ok', text: 'Node 24 (needs >=22.0.0)' }];
    const argv = ['-y', '--host', 'local', '--toolsets', 'readonly', '--env', 'x.env'];
    expect(await runInit([...argv, '--target', 'path:reg.json'], run.io, ctx)).toBe(1);
    // The registration's env over the file it wrote, as the server will start.
    const envFile = join(root, 'x.env');
    expect(doctor).toHaveBeenCalledOnce();
    expect(doctor.mock.calls[0]?.[1]).toMatchObject({
      FOUNDRY_HOST: 'local',
      FOUNDRY_TOOLSETS: 'readonly',
      FVTT_MCP_ENV: envFile,
    });
    expect(existsSync(envFile)).toBe(true);
    expect(existsSync(join(root, 'reg.json'))).toBe(true);
    const text = run.out.join('\n');
    expect(text.indexOf('ok Node 24')).toBeLessThan(text.indexOf('fail login: wrong password'));
    expect(text).toContain('"mcpServers"');
    expect(run.out.at(-1)).toMatch(
      /^1 problem: fix the ✗ lines above, then run `npm run init` again or `FVTT_MCP_ENV=.+ FOUNDRY_TOOLSETS=readonly npm run doctor`$/
    );
  });

  it('the user target backs up ~/.claude.json and changes only its mcpServers entry', async () => {
    const root = tmp();
    const ctx = context(root);
    const file = join(ctx.home, '.claude.json');
    const original = JSON.stringify(
      { numStartups: 7, mcpServers: { other: { command: 'x' } } },
      null,
      2
    );
    writeFileSync(file, original);
    const run = recorder();
    const argv = ['-y', '--host', 'local', '--target', 'user', '--env', 'x.env', '--no-doctor'];
    expect(await runInit(argv, run.io, ctx)).toBe(0);
    expect(read(`${file}.bak-20261011-140509`)).toBe(original);
    const after = JSON.parse(read(file));
    expect(after.numStartups).toBe(7);
    expect(Object.keys(after.mcpServers)).toEqual(['other', 'foundry-local5e']);
    expect(read(file).endsWith('\n')).toBe(false);
  });

  it('asks, in order, with the defaults shown, secrets hidden, and a bad answer asked again', async () => {
    const root = tmp();
    const ctx = context(root);
    // host (a bad one first), user, password, admin key, Data folder, name, read-only, target
    const run = recorder(['forge', 'local', '', 'join-pw', '', '', '', 'y', '']);
    expect(await runInit(['--no-doctor'], run.io, ctx)).toBe(0);
    expect(run.asked.map(q => q.secret)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(run.asked[2]?.question).toContain('[MCP-Claude]');
    expect(run.asked[3]?.question).toContain('typing hidden; Enter for none');
    expect(run.asked[6]?.question).toContain('[foundry-local5e]');
    expect(run.asked[8]?.question).toContain('[project]');
    expect(run.out).toContain('  not one of local, molten, generic');
    expect(dotenv.parse(read(join(ctx.repo, '.env')))).toEqual({
      FOUNDRY_HOST: 'local',
      FOUNDRY_USER: 'MCP-Claude',
      FOUNDRY_PASSWORD: 'join-pw',
    });
    expect(JSON.parse(read(join(ctx.repo, '.mcp.json'))).mcpServers['foundry-local5e'].env).toEqual(
      {
        FOUNDRY_HOST: 'local',
        FOUNDRY_TOOLSETS: 'readonly',
      }
    );

    // A second run reads its defaults from that .env; Enter keeps the password it holds.
    const again = recorder(['', '', '', '', '', '', 'n', '']);
    expect(await runInit(['--no-doctor'], again.io, ctx)).toBe(0);
    expect(again.asked[0]?.question).toContain('[local]');
    expect(again.asked[2]?.question).toContain('Enter keeps the one in the .env');
    expect(again.asked[8]?.question).toContain('Replace it? [Y/n]');
    expect(dotenv.parse(read(join(ctx.repo, '.env'))).FOUNDRY_PASSWORD).toBe('join-pw');
  });
});

describe('terminalAsker — the questions on a terminal, or on a pipe', () => {
  /** A screen: every byte written to it. */
  function screen(tty: boolean) {
    let shown = '';
    const out = new Writable({
      write(chunk, _encoding, done) {
        shown += String(chunk);
        done();
      },
    });
    return {
      stdout: Object.assign(out, tty ? { isTTY: true, columns: 80, rows: 24 } : {}),
      shown: () => shown,
    };
  }

  it('on a terminal, a secret is not echoed while typed and no history can recall it', async () => {
    const keyboard = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode() {
        return this;
      },
    });
    const view = screen(true);
    const asker = terminalAsker(keyboard, view.stdout);
    expect(asker.hidesSecrets).toBe(true);
    const secret = asker.ask('Password: ', { secret: true });
    keyboard.write('hunter2\r');
    expect(await secret).toBe('hunter2');
    const up = asker.ask('Name: ');
    keyboard.write(`${String.fromCharCode(27)}[A\r`); // Up, then Enter
    expect(await up).toBe('');
    const name = asker.ask('Name: ');
    keyboard.write('bob\r');
    expect(await name).toBe('bob');
    asker.close();
    expect(view.shown()).toContain('Password: ');
    expect(view.shown()).toContain('bob');
    expect(view.shown()).not.toContain('hunter2');
  });

  it('on a pipe, answers that came before their question are read in turn, then the end', async () => {
    const pipe = new PassThrough();
    const view = screen(false);
    const asker = terminalAsker(pipe, view.stdout);
    expect(asker.hidesSecrets).toBe(false);
    pipe.end('local\njoin-pw\n');
    expect(await asker.ask('Host: ')).toBe('local');
    expect(await asker.ask('Password: ', { secret: true })).toBe('join-pw');
    expect(await asker.ask('Name: ')).toBeUndefined();
    asker.close();
    expect(view.shown()).toBe('Host: \nPassword: \nName: \n');
  });
});
