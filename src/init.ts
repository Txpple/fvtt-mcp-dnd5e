// `npm run init` (scripts/init.mjs; issue #7): from a built clone to a checked registration in one
// command. The script checks Node and dist/ (nothing here loads without a build), then hands over
// to `runInit`, which, in order:
//
//   0. says what it cannot do: the Foundry user the bridge joins as must already exist;
//   1. asks for the connection, or takes it as flags (`--yes` asks nothing); an existing .env
//      supplies the defaults, read as its host reads it;
//   2. writes the .env. A new file gets the minimal block .env.example opens with; an existing one
//      is copied to <file>.bak and changed only where an answer differs, in place on the line that
//      supplies the value (a 2.x alias, when that is what the host reads), every other line kept.
//      Secrets go here and nowhere else;
//   3. writes the registration, `{ command: <this Node>, args: [<repo>/dist/index.js], env }`, into
//      this clone's .mcp.json, another project's, or the mcpServers of ~/.claude.json (backed up
//      first, every other key kept). Its env names the instance (FOUNDRY_HOST, FOUNDRY_URL,
//      FOUNDRY_TOOLSETS, and FVTT_MCP_ENV for a .env that is not the repo's), never a secret;
//   4. runs the doctor (src/doctor.ts) on what it wrote: the doctor's lines are the join report;
//   5. prints the entry as an mcpServers block for any other MCP client.
//
// Claude Code's config is the only one it writes (issue #5): another client takes the block.

import dotenv from 'dotenv';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { type DoctorIO, type Mark, runDoctor } from './doctor.js';
import { repoRoot } from './env.js';
import { type Env, isPlaceholderUrl, legacyNameOf, resolveHostConfig } from './hosts/env.js';
import type { HostKind } from './hosts/types.js';
import { parseToolsetsEnv, resolveRegistration } from './toolsets.js';

const HOSTS: readonly HostKind[] = ['local', 'molten', 'generic'];

/** The answers, asked or taken from the flags. */
export interface Answers {
  host: HostKind;
  /** FOUNDRY_URL: always for molten and generic; for local only with --url. */
  url?: string;
  user: string;
  password?: string;
  adminKey?: string;
  worldId?: string;
  wakeUrl?: string;
  webdavPassword?: string;
  dataDir?: string;
  /** The registration's key under mcpServers. */
  name: string;
  /** FOUNDRY_TOOLSETS, when one was chosen. */
  toolsets?: string;
  /** `project`, `user` or `path:<file>`. */
  target: string;
}

/** What the script passes in: where lines go, the questions, and the doctor's own IO. */
export interface InitIO extends DoctorIO {
  /** One line of init's own output. */
  print(text: string): void;
  /** Ask one question; `undefined` once the input has ended. Never called under --yes. */
  ask(question: string, opts?: { secret?: boolean }): Promise<string | undefined>;
  /** Whether a secret's typing is hidden (stdin and stdout are a terminal). */
  hidesSecrets: boolean;
  /** The script's Node and build lines (scripts/lib/preflight.mjs): the head of the doctor's report. */
  preflight?: ReadonlyArray<{ mark: Mark; text: string }>;
}

/** Where init runs: the paths and the environment it reads (the tests pass their own). */
export interface InitContext {
  /** This clone: dist/index.js, the default .env and .mcp.json. */
  repo: string;
  /** The Node the registration names: the one running init. */
  node: string;
  home: string;
  /** What a relative path in an answer is relative to: where `npm run` was typed. */
  cwd: string;
  platform: NodeJS.Platform;
  env: Env;
  now: Date;
}

function initContext(): InitContext {
  return {
    repo: repoRoot(),
    node: process.execPath,
    home: homedir(),
    cwd: process.env.INIT_CWD || process.cwd(),
    platform: process.platform,
    env: process.env,
    now: new Date(),
  };
}

// --- the flags --------------------------------------------------------------------------------

const VALUE_FLAGS = {
  '--host': 'host',
  '--url': 'url',
  '--user': 'user',
  '--password': 'password',
  '--admin-key': 'adminKey',
  '--wake-url': 'wakeUrl',
  '--webdav-password': 'webdavPassword',
  '--data-dir': 'dataDir',
  '--world-id': 'worldId',
  '--name': 'name',
  '--toolsets': 'toolsets',
  '--target': 'target',
  // Not --env-file: Node reads that flag wherever it stands, script arguments included.
  '--env': 'envFile',
} as const;
type ValueFlag = keyof typeof VALUE_FLAGS;
type ValueKey = (typeof VALUE_FLAGS)[ValueFlag];

const SWITCHES = {
  '--yes': 'yes',
  '-y': 'yes',
  '--force': 'force',
  '--no-doctor': 'noDoctor',
  '--help': 'help',
  '-h': 'help',
} as const;
type Switch = keyof typeof SWITCHES;

export type InitFlags = { [K in ValueKey]?: string } & {
  yes: boolean;
  force: boolean;
  noDoctor: boolean;
  help: boolean;
};

const FLAG_OF = Object.fromEntries(
  Object.entries(VALUE_FLAGS).map(([flag, key]) => [key, flag])
) as Record<ValueKey, ValueFlag>;

/** A refusal of the command line or of an answer: exit 2. */
export class UsageError extends Error {}

const isFlag = (s: string): boolean => {
  const name = s.split('=')[0] ?? '';
  return Object.hasOwn(VALUE_FLAGS, name) || Object.hasOwn(SWITCHES, name);
};

/** The command line, strictly: an unknown flag, a missing value or a flag given twice is refused. */
export function parseInitArgs(argv: readonly string[]): InitFlags {
  const flags: InitFlags = { yes: false, force: false, noDoctor: false, help: false };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (Object.hasOwn(SWITCHES, name)) {
      if (eq > 0) throw new UsageError(`${name} takes no value`);
      flags[SWITCHES[name as Switch]] = true;
      continue;
    }
    if (name === '--env-file' || name === '--env-file-if-exists') {
      throw new UsageError(
        `${name} is Node's own flag (Node reads it wherever it stands); the .env to write is --env <file>`
      );
    }
    if (!Object.hasOwn(VALUE_FLAGS, name)) {
      // Never echo a stray word: it may be a password that lost its flag.
      throw new UsageError(
        name.startsWith('-')
          ? `unknown flag ${name}`
          : `unexpected argument (number ${i + 1}): init takes flags only`
      );
    }
    if (seen.has(name)) throw new UsageError(`${name} is given twice`);
    seen.add(name);
    let value: string;
    if (eq > 0) value = arg.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next === undefined || isFlag(next)) {
        throw new UsageError(`${name} needs a value (${name}=<value> for one that starts with -)`);
      }
      value = next;
      i++;
    }
    flags[VALUE_FLAGS[name as ValueFlag]] = value;
  }
  return flags;
}

// --- paths and values -------------------------------------------------------------------------

const slashes = (p: string): string => p.replace(/\\/g, '/');

/** `~/x` → <home>/x: a shell expands `~` only at the start of a word, never in `path:~/x`. */
function expandHome(p: string, home: string): string {
  return /^~(?=$|[\\/])/.test(p) ? join(home, p.slice(1)) : p;
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string) => slashes(p).replace(/\/+$/, '');
  return platform === 'win32'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function httpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function readIfExists(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const day = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d: Date): string =>
  `${day(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Where Foundry keeps its Data folder by default on each platform (docs/local-sandbox.md). */
export function defaultDataDir(platform: NodeJS.Platform, home: string, env: Env): string {
  if (platform === 'win32') {
    return win32.join(
      env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'),
      'FoundryVTT',
      'Data'
    );
  }
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', 'FoundryVTT', 'Data');
  }
  return posix.join(home, '.local', 'share', 'FoundryVTT', 'Data');
}

/**
 * Where the registration goes: this clone's .mcp.json, ~/.claude.json, or a file (for a folder,
 * its .mcp.json).
 */
export function resolveTarget(
  spec: string,
  at: { repo: string; home: string; cwd: string }
): { kind: 'project' | 'user' | 'path'; file: string } {
  const s = spec.trim();
  if (s === 'project') return { kind: 'project', file: join(at.repo, '.mcp.json') };
  if (s === 'user') return { kind: 'user', file: join(at.home, '.claude.json') };
  const m = /^path:(.*\S.*)$/.exec(s);
  if (m) {
    const file = resolve(at.cwd, expandHome((m[1] as string).trim(), at.home));
    return { kind: 'path', file: isDirectory(file) ? join(file, '.mcp.json') : file };
  }
  throw new UsageError('not project, user or path:<file>');
}

/** What is wrong with an answer, or undefined. The flags and the typed answers share these. */
const CHECKS: Partial<Record<ValueKey, (v: string, ctx: InitContext) => string | undefined>> = {
  host: v =>
    (HOSTS as readonly string[]).includes(v.toLowerCase())
      ? undefined
      : 'not one of local, molten, generic',
  url: v =>
    !httpUrl(v)
      ? 'not an http(s) URL'
      : isPlaceholderUrl(v)
        ? "the placeholder, not your instance's URL"
        : undefined,
  wakeUrl: v => (httpUrl(v) ? undefined : 'not an http(s) URL'),
  dataDir: (v, ctx) =>
    isDirectory(resolve(ctx.cwd, expandHome(v, ctx.home))) ? undefined : 'not an existing folder',
  name: v => (/^[A-Za-z0-9_-]+$/.test(v) ? undefined : 'letters, digits, - and _ only'),
  toolsets: v => {
    try {
      resolveRegistration(parseToolsetsEnv(v));
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  target: (v, ctx) => {
    try {
      resolveTarget(v, ctx);
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
};

function checkFlags(flags: InitFlags, ctx: InitContext): void {
  for (const [key, check] of Object.entries(CHECKS) as Array<[ValueKey, typeof CHECKS.host]>) {
    const v = flags[key]?.trim();
    const problem = v ? check?.(v, ctx) : undefined;
    if (problem) throw new UsageError(`${FLAG_OF[key]}: ${problem}`);
  }
}

/** The extras each host reads (the rest of a host's keys are the same everywhere). */
const EXTRAS: Record<HostKind, Partial<Record<ValueKey, true>>> = {
  local: { dataDir: true },
  molten: { wakeUrl: true, webdavPassword: true },
  generic: { wakeUrl: true, dataDir: true },
};
const NOT_HERE: Record<string, string> = {
  'local wakeUrl': 'a local install does not sleep',
  'local webdavPassword': 'a local install is reached through its Data folder (--data-dir)',
  'molten dataDir': "a hosted box's disk is not this machine's",
  'generic webdavPassword':
    'a generic WebDAV plane needs FOUNDRY_WEBDAV_URL and _USER too; set the three in the .env',
};

// --- the .env ---------------------------------------------------------------------------------

/** What `key` reads as under `host` in a parsed .env: its 2.x alias when set, else itself. */
function suppliedBy(
  env: Env,
  host: HostKind,
  key: string
): { name: string; value: string } | undefined {
  const alias = legacyNameOf(host, key);
  const fromAlias = alias ? env[alias]?.trim() : undefined;
  if (alias && fromAlias) return { name: alias, value: fromAlias };
  const value = env[key]?.trim();
  return value ? { name: key, value } : undefined;
}

/** The .env keys init writes, in the order of .env.example's minimal blocks. */
const ENV_KEYS: ReadonlyArray<readonly [string, keyof Answers]> = [
  ['FOUNDRY_HOST', 'host'],
  ['FOUNDRY_URL', 'url'],
  ['FOUNDRY_USER', 'user'],
  ['FOUNDRY_PASSWORD', 'password'],
  ['FOUNDRY_ADMIN_KEY', 'adminKey'],
  ['FOUNDRY_WORLD_ID', 'worldId'],
  ['FOUNDRY_WAKE_URL', 'wakeUrl'],
  ['FOUNDRY_WEBDAV_PASSWORD', 'webdavPassword'],
  ['FOUNDRY_DATA_DIR', 'dataDir'],
];

/** The .env lines the answers make: only the keys that have a value. */
export function envEntries(a: Answers): Array<[string, string]> {
  return ENV_KEYS.flatMap(([key, field]): Array<[string, string]> => {
    const v = a[field];
    return typeof v === 'string' && v ? [[key, v]] : [];
  });
}

/**
 * `KEY=value`, quoted only where dotenv would read the bare value otherwise (a `#`, edge
 * whitespace, a quote around it); refused when no quoting reads back exactly, or when the value
 * would need more than one line.
 */
export function envLine(key: string, value: string): string {
  if (/[\r\n]/.test(value))
    throw new UsageError(`${key}: a value with a line break cannot go in a .env`);
  for (const candidate of [value, `'${value}'`, `"${value}"`, `\`${value}\``]) {
    const line = `${key}=${candidate}`;
    if (dotenv.parse(line)[key] === value) return line;
  }
  throw new UsageError(
    `${key}: this value cannot be written to a .env line (dotenv reads every quoting of it otherwise)`
  );
}

/** A new .env: the answers' keys under one comment line. */
export function renderEnv(entries: ReadonlyArray<readonly [string, string]>, date: string): string {
  return [
    `# Written by \`npm run init\` on ${date}. .env.example explains every key; never commit this file.`,
    ...entries.map(([k, v]) => envLine(k, v)),
    '',
  ].join('\n');
}

export interface EnvMerge {
  text: string;
  /** Names of the lines rewritten in place (a 2.x alias, where that is what the host reads). */
  set: string[];
  /** Keys appended under the init comment. */
  added: string[];
}

/**
 * An existing .env with the answers in it. A key whose value the host already reads is left
 * alone; otherwise its line is rewritten in place (the 2.x alias's line when the alias is what
 * the host reads, since an alias wins over the canonical name under its host) and a key with no
 * line is appended under one comment. Every other line, comment and the line endings are kept.
 */
export function mergeEnv(
  text: string,
  entries: ReadonlyArray<readonly [string, string]>,
  host: HostKind,
  date: string
): EnvMerge {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const parsed = dotenv.parse(text);
  const set: string[] = [];
  const added: Array<readonly [string, string]> = [];
  for (const [key, value] of entries) {
    const from = suppliedBy(parsed, host, key);
    if (from?.value === value) continue;
    const name = from?.name ?? key;
    const re = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[.]/g, '\\.')}(?:\\s*=|:\\s)`);
    const at = lines.flatMap((line, i) => (re.test(line) ? [i] : []));
    if (!at.length) {
      added.push([key, value]);
      continue;
    }
    for (const i of at) lines[i] = envLine(name, value);
    set.push(name);
  }
  let out = lines.join(eol);
  if (added.length) {
    if (!out.endsWith('\n')) out += eol;
    out += [
      '',
      `# Added by \`npm run init\` on ${date}`,
      ...added.map(([k, v]) => envLine(k, v)),
      '',
    ].join(eol);
  }
  return { text: out, set, added: added.map(([k]) => k) };
}

// --- the registration ---------------------------------------------------------------------------

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The mcpServers entry: this Node and this clone's dist/index.js, absolute with forward slashes
 * (the client that starts the server may not have Node on PATH), and an env block that names the
 * instance and nothing secret.
 */
export function registrationEntry(
  a: Answers,
  at: { node: string; repo: string; envFile: string; platform: NodeJS.Platform }
): ServerEntry {
  const env: Record<string, string> = { FOUNDRY_HOST: a.host };
  if (a.url) env.FOUNDRY_URL = a.url;
  if (a.toolsets) env.FOUNDRY_TOOLSETS = a.toolsets;
  // The server reads <repo>/.env unless told otherwise; any other file has to be named.
  if (!samePath(at.envFile, join(at.repo, '.env'), at.platform)) {
    env.FVTT_MCP_ENV = slashes(at.envFile);
  }
  return { command: slashes(at.node), args: [slashes(join(at.repo, 'dist', 'index.js'))], env };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A registration file's text (`undefined`: no file yet) with `mcpServers[name]` set to `entry` and
 * every other key as it was: 2-space JSON, the file's line endings and trailing newline kept.
 * Throws for a file that is not a JSON object or whose mcpServers is not one.
 */
export function setServer(
  text: string | undefined,
  name: string,
  entry: ServerEntry
): { text: string; replaced: boolean } {
  let doc: unknown = {};
  if (text?.trim()) {
    try {
      doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (err) {
      throw new Error(`is not JSON (${(err as Error).message})`);
    }
  }
  if (!isRecord(doc)) throw new Error('is not a JSON object');
  const servers = doc.mcpServers ?? {};
  if (!isRecord(servers)) throw new Error('has an "mcpServers" that is not an object');
  const replaced = Object.hasOwn(servers, name);
  servers[name] = entry;
  doc.mcpServers = servers;
  const eol = text?.includes('\r\n') ? '\r\n' : '\n';
  let out = JSON.stringify(doc, null, 2).replace(/\n/g, eol);
  if (text === undefined || text.endsWith('\n')) out += eol;
  return { text: out, replaced };
}

// --- the questions ------------------------------------------------------------------------------

interface Question {
  key: ValueKey;
  text: string;
  /** What Enter (and --yes) takes. Never shown for a secret. */
  fallback?: string | undefined;
  secret?: boolean;
  required?: boolean;
  /** A secret the .env already holds: Enter keeps it. */
  kept?: boolean;
}

function promptText(q: Question, hidden: boolean): string {
  if (!q.secret) return `${q.text}${q.fallback ? ` [${q.fallback}]` : ''}: `;
  const typing = hidden ? 'typing hidden' : 'the typing will show';
  return `${q.text} (${typing}; Enter ${q.kept ? 'keeps the one in the .env' : 'for none'}): `;
}

/** A flag, else --yes's default, else the question; `undefined` = no value (nothing written). */
async function answer(
  q: Question,
  flags: InitFlags,
  io: InitIO,
  ctx: InitContext
): Promise<string | undefined> {
  const flag = FLAG_OF[q.key];
  const given = flags[q.key]?.trim();
  if (given !== undefined) {
    if (given) return given;
    if (q.required) throw new UsageError(`${flag} needs a value`);
    return undefined;
  }
  const fallback = (why: string): string | undefined => {
    if (q.fallback) return q.fallback;
    if (q.required) throw new UsageError(`${flag} is required ${why}`);
    return undefined;
  };
  if (flags.yes) return fallback('with --yes, which asks nothing');
  const check = CHECKS[q.key];
  for (;;) {
    const typed = await io.ask(promptText(q, io.hidesSecrets), q.secret ? { secret: true } : {});
    if (typed === undefined) return fallback('(the input ended before it was answered)');
    const v = typed.trim();
    if (!v) {
      if (q.fallback || !q.required) return q.fallback || undefined;
      io.print('  an answer is needed here');
      continue;
    }
    const problem = check?.(v, ctx);
    if (!problem) return v;
    io.print(`  ${problem}`);
  }
}

/**
 * The questions on stdin and stdout, one line per answer, for scripts/init.mjs. On a terminal (both
 * ends TTYs) a secret's typing is not echoed: readline echoes into an output that is muted while
 * one is typed, and keeps no history, since Up would recall a secret in clear. The question is
 * readline's own prompt, so a redraw on Backspace repaints it, and the output reports the
 * terminal's width for a prompt that wraps. Piped answers are read line by line through the async
 * iterator, which buffers lines that arrive before their question. Readline starts at the first
 * question, so a run under --yes never touches stdin.
 *
 * @public scripts/init.mjs loads it from dist/ by a dynamic import, which knip cannot follow.
 */
export function terminalAsker(
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  stdout: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number }
): { ask: InitIO['ask']; hidesSecrets: boolean; close(): void } {
  const terminal = Boolean(input.isTTY && stdout.isTTY);
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) stdout.write(chunk, encoding);
      done();
    },
  });
  Object.defineProperties(output, {
    columns: { get: () => stdout.columns },
    rows: { get: () => stdout.rows },
  });
  let rl: Interface | undefined;
  let lines: AsyncIterator<string> | undefined;
  let closed = false;
  return {
    hidesSecrets: terminal,
    async ask(question, opts = {}) {
      if (!rl) {
        rl = createInterface({ input, output, terminal, historySize: 0 });
        // Raw mode turns Ctrl+C into an event; without a listener readline would only pause.
        rl.on('SIGINT', () => {
          stdout.write('\n');
          process.exit(130);
        });
        rl.on('close', () => {
          closed = true;
        });
        lines = rl[Symbol.asyncIterator]();
      }
      // A pipe that has ended may still hold buffered answers; it just takes no more prompts.
      if (closed) stdout.write(question);
      else {
        rl.setPrompt(question);
        rl.prompt();
      }
      muted = Boolean(opts.secret) && terminal;
      try {
        const next = await (lines as AsyncIterator<string>).next();
        return next.done ? undefined : next.value;
      } finally {
        // A muted or piped answer never echoed its line end: end the prompt's line here.
        if (muted || !terminal) stdout.write('\n');
        muted = false;
      }
    },
    close() {
      rl?.close();
    },
  };
}

async function yesNo(io: InitIO, question: string, fallback: boolean): Promise<boolean> {
  for (;;) {
    const typed = (await io.ask(question))?.trim().toLowerCase();
    if (!typed) return fallback;
    if (typed === 'y' || typed === 'yes') return true;
    if (typed === 'n' || typed === 'no') return false;
    io.print('  y or n');
  }
}

async function collect(
  flags: InitFlags,
  io: InitIO,
  ctx: InitContext,
  current: Env
): Promise<Answers> {
  const was = current.FOUNDRY_HOST?.trim().toLowerCase();
  const host = (
    (await answer(
      {
        key: 'host',
        text: 'Where Foundry runs: local (an install on this machine), molten (Molten Hosting) or generic (any URL)',
        fallback: (HOSTS as readonly string[]).includes(was ?? '') ? was : undefined,
        required: true,
      },
      flags,
      io,
      ctx
    )) as string
  ).toLowerCase() as HostKind;
  for (const key of ['wakeUrl', 'webdavPassword', 'dataDir'] as const) {
    if (flags[key] !== undefined && !EXTRAS[host][key]) {
      const why = NOT_HERE[`${host} ${key}`];
      throw new UsageError(
        `${FLAG_OF[key]} does not apply to --host ${host}${why ? ` (${why})` : ''}`
      );
    }
  }
  const now = (key: string) => suppliedBy(current, host, key);
  const ask = (q: Question) => answer(q, flags, io, ctx);
  const nowUrl = now('FOUNDRY_URL')?.value;

  const a: Answers = {
    host,
    user: '',
    name: '',
    target: '',
  };
  const url =
    host === 'local'
      ? flags.url?.trim() || undefined // localhost:30000 unless told
      : await ask({
          key: 'url',
          text: `FOUNDRY_URL, the instance's address (${host === 'molten' ? 'https://<your-box>.moltenhosting.com' : 'https://…'})`,
          fallback: nowUrl && httpUrl(nowUrl) && !isPlaceholderUrl(nowUrl) ? nowUrl : undefined,
          required: true,
        });
  if (url) a.url = url;
  a.user = (await ask({
    key: 'user',
    text: 'The Foundry user the bridge joins as',
    fallback: now('FOUNDRY_USER')?.value ?? resolveHostConfig({}, host).user,
    required: true,
  })) as string;
  const password = await ask({
    key: 'password',
    text: "That user's password",
    secret: true,
    kept: Boolean(now('FOUNDRY_PASSWORD')),
  });
  if (password) a.password = password;
  const adminKey = await ask({
    key: 'adminKey',
    text: "FOUNDRY_ADMIN_KEY, the Setup screen's Administrator Password (not the license key)",
    secret: true,
    kept: Boolean(now('FOUNDRY_ADMIN_KEY')),
  });
  if (adminKey) a.adminKey = adminKey;
  const worldId = flags.worldId?.trim();
  if (worldId) a.worldId = worldId;

  if (host === 'molten') {
    const wakeUrl = await ask({
      key: 'wakeUrl',
      text: "FOUNDRY_WAKE_URL, the panel's Server Startup / Magic URL",
      secret: true,
      kept: Boolean(now('FOUNDRY_WAKE_URL')),
    });
    if (wakeUrl) a.wakeUrl = wakeUrl;
    const webdavPassword = await ask({
      key: 'webdavPassword',
      text: "FOUNDRY_WEBDAV_PASSWORD, the panel's File Manager password",
      secret: true,
      kept: Boolean(now('FOUNDRY_WEBDAV_PASSWORD')),
    });
    if (webdavPassword) a.webdavPassword = webdavPassword;
  } else if (flags.wakeUrl?.trim()) {
    a.wakeUrl = flags.wakeUrl.trim(); // generic: taken, never asked
  }
  if (host === 'local' || flags.dataDir !== undefined) {
    const platformDir = defaultDataDir(ctx.platform, ctx.home, ctx.env);
    const offered =
      now('FOUNDRY_DATA_DIR')?.value ?? (isDirectory(platformDir) ? platformDir : undefined);
    const dataDir = await ask({
      key: 'dataDir',
      text: `FOUNDRY_DATA_DIR, the install's Data folder${offered ? '' : ' (Enter for none: no direct file plane)'}`,
      fallback: offered,
    });
    if (dataDir) a.dataDir = resolve(ctx.cwd, expandHome(dataDir, ctx.home));
  }

  a.name = (await ask({
    key: 'name',
    text: 'The registration name',
    fallback: host === 'local' ? 'foundry-local5e' : 'foundry',
    required: true,
  })) as string;
  if (flags.toolsets !== undefined) {
    const list = parseToolsetsEnv(flags.toolsets).join(',');
    if (list) a.toolsets = list;
  } else if (
    !flags.yes &&
    (await yesNo(
      io,
      'Read-only first run? Every read, every write refused; join as a Player or Trusted Player [y/N]: ',
      false
    ))
  ) {
    a.toolsets = 'readonly';
  }
  a.target = (await ask({
    key: 'target',
    text: "Register it in project (this clone's .mcp.json), user (~/.claude.json, every project) or path:<file>",
    fallback: 'project',
    required: true,
  })) as string;
  return a;
}

// --- the run ------------------------------------------------------------------------------------

const STEP_ZERO = [
  'Step zero, in Foundry: the user the bridge joins as must exist in the world (Users → Create User).',
  'A full registration joins as a Gamemaster or Assistant GM, a read-only one as a Player or Trusted',
  'Player. init cannot create it; the doctor at the end logs in as it.',
];

const USAGE = `Usage: npm run init [-- <flags>]

Writes the .env and the MCP registration for one Foundry instance, then runs the doctor. With no
flags it asks; every answer is also a flag.

  --host local|molten|generic  where Foundry runs: an install on this machine, Molten Hosting,
                               any URL (required with --yes)
  --url <url>                  FOUNDRY_URL (required with --yes for molten and generic; local is
                               http://localhost:30000 unless given)
  --user <name>                the Foundry user the bridge joins as (default MCP-Claude)
  --password <pw>              its password (default: none)
  --admin-key <key>            FOUNDRY_ADMIN_KEY, the Setup screen's Administrator Password (not
                               the license key): the bridge then launches the world itself
  --wake-url <url>             molten or generic: the URL that wakes a sleeping instance
  --webdav-password <pw>       molten: the panel's File Manager password
  --data-dir <dir>             local or generic: the install's Data folder (local's default: the
                               platform's, when it exists)
  --world-id <id>              FOUNDRY_WORLD_ID, when /setup lists several worlds
  --name <name>                the registration's name (default foundry; local: foundry-local5e)
  --toolsets <list>            FOUNDRY_TOOLSETS; readonly for a read-only first run
  --target <where>             project (this clone's .mcp.json; the default), user (~/.claude.json,
                               every project) or path:<file> (another project's .mcp.json)
  --env <file>                 the .env to write (default: this clone's, or FVTT_MCP_ENV's); any
                               other file goes into the registration as FVTT_MCP_ENV
  --force                      replace a registration of the same name under --yes
  --no-doctor                  write the files, skip the doctor
  --yes, -y                    ask nothing: the flags, then the defaults
  --help, -h                   this text

Secrets go only into the .env (an existing one is copied to <file>.bak first, then changed in
place); the registration holds the Node path, dist/index.js and the env that names the instance.
Exit 0 when the doctor passes, 1 when it finds a problem, 2 for a refused flag or answer.`;

/** A path as a command line takes it: relative to the clone when inside it, quoted when spaced. */
function shellPath(p: string, repo: string): string {
  const r = relative(repo, p);
  const shown = slashes(r && !r.startsWith('..') && !isAbsolute(r) ? r : p);
  return /\s/.test(shown) ? `"${shown}"` : shown;
}

/**
 * Ask, write the .env and the registration, run the doctor, print the block. Returns the exit
 * code: 0 when the doctor passes (or is skipped), 1 when it finds a problem or a file cannot be
 * written, 2 for a refused flag or answer (nothing written).
 *
 * @public scripts/init.mjs loads it from dist/ by a dynamic import, which knip cannot follow.
 */
export async function runInit(
  argv: readonly string[],
  io: InitIO,
  ctx: InitContext = initContext()
): Promise<number> {
  const refuse = (err: unknown, usage: boolean): number => {
    if (!(err instanceof UsageError)) throw err;
    io.say('fail', `${err.message} — nothing written`);
    io.print(usage ? `\n${USAGE}` : 'Every flag: npm run init -- --help');
    return 2;
  };
  let flags: InitFlags;
  try {
    flags = parseInitArgs(argv);
    if (!flags.help) checkFlags(flags, ctx);
  } catch (err) {
    return refuse(err, true);
  }
  if (flags.help) {
    io.print(USAGE);
    return 0;
  }
  for (const line of STEP_ZERO) io.print(line);
  io.print('');

  // The .env as envPath() finds it (FVTT_MCP_ENV, else <repo>/.env; npm runs a script in the
  // clone, so a relative FVTT_MCP_ENV is the clone's), unless --env names another.
  const override = ctx.env.FVTT_MCP_ENV?.trim();
  const envFile = flags.envFile?.trim()
    ? resolve(ctx.cwd, expandHome(flags.envFile.trim(), ctx.home))
    : override
      ? resolve(ctx.repo, override)
      : join(ctx.repo, '.env');
  const envText = readIfExists(envFile);
  const current: Env = envText === undefined ? {} : dotenv.parse(envText);

  // Every answer, then every refusal that needs no write, before anything is written.
  let a: Answers;
  let target: ReturnType<typeof resolveTarget>;
  let entry: ServerEntry;
  let reg: { text: string; replaced: boolean };
  let entries: Array<[string, string]>;
  try {
    a = await collect(flags, io, ctx, current);
    entries = envEntries(a);
    for (const [k, v] of entries) envLine(k, v); // a value no .env line can hold
    target = resolveTarget(a.target, ctx);
    entry = registrationEntry(a, {
      node: ctx.node,
      repo: ctx.repo,
      envFile,
      platform: ctx.platform,
    });
    const before = readIfExists(target.file);
    try {
      reg = setServer(before, a.name, entry);
    } catch (err) {
      io.say('fail', `registration: ${target.file} ${(err as Error).message} — nothing written`);
      return 1;
    }
    while (reg.replaced && !flags.force) {
      if (flags.yes) {
        throw new UsageError(
          `"${a.name}" is already registered in ${target.file}: --force replaces it, --name picks another`
        );
      }
      if (await yesNo(io, `"${a.name}" is already in ${target.file}. Replace it? [Y/n]: `, true)) {
        break;
      }
      const asked: InitFlags = { yes: false, force: false, noDoctor: false, help: false };
      a.name = (await answer(
        { key: 'name', text: 'Another name for it', required: true },
        asked,
        io,
        ctx
      )) as string;
      reg = setServer(before, a.name, entry);
    }
  } catch (err) {
    return refuse(err, false);
  }

  // --- the .env ---
  const date = day(ctx.now);
  const wasHost = current.FOUNDRY_HOST?.trim().toLowerCase();
  if (wasHost && wasHost !== a.host) {
    io.say(
      'warn',
      `.env: ${envFile} was set up for FOUNDRY_HOST=${wasHost}; these answers replace its keys ` +
        '(a second instance wants its own file: --env .env.<name>)'
    );
  }
  if (!envText?.trim()) {
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, renderEnv(entries, date), { mode: 0o600 });
    io.say('ok', `.env: wrote ${envFile} (${entries.map(([k]) => k).join(', ')})`);
  } else {
    const merged = mergeEnv(envText, entries, a.host, date);
    if (!merged.set.length && !merged.added.length) {
      io.say('ok', `.env: ${envFile} already holds these answers (unchanged)`);
    } else {
      copyFileSync(envFile, `${envFile}.bak`);
      writeFileSync(envFile, merged.text);
      const what = [
        merged.set.length ? `set ${merged.set.join(', ')} in place` : '',
        merged.added.length ? `added ${merged.added.join(', ')}` : '',
      ].filter(Boolean);
      io.say('ok', `.env: updated ${envFile}: ${what.join('; ')} (the old file is ${envFile}.bak)`);
    }
  }

  // --- the registration ---
  mkdirSync(dirname(target.file), { recursive: true });
  let backup = '';
  if (target.kind === 'user' && existsSync(target.file)) {
    backup = `${target.file}.bak-${stamp(ctx.now)}`;
    copyFileSync(target.file, backup);
  }
  writeFileSync(target.file, reg.text);
  io.say(
    'ok',
    `registration: ${reg.replaced ? 'replaced the entry' : 'added'} "${a.name}" in ${target.file}` +
      (backup ? ` (the old file is ${backup})` : '')
  );

  // --- the doctor, on what was written: the registration's env over the .env, as the server ---
  const doctor = [
    ...(entry.env.FVTT_MCP_ENV ? [`FVTT_MCP_ENV=${shellPath(envFile, ctx.repo)}`] : []),
    ...(entry.env.FOUNDRY_TOOLSETS ? [`FOUNDRY_TOOLSETS=${entry.env.FOUNDRY_TOOLSETS}`] : []),
    'npm run doctor',
  ].join(' ');
  let failed = 0;
  io.print('');
  if (flags.noDoctor) io.say('skip', `doctor: skipped (--no-doctor); check it with \`${doctor}\``);
  else {
    io.print(`doctor (\`${doctor}\`):`);
    for (const line of io.preflight ?? []) io.say(line.mark, line.text);
    failed = await runDoctor(io, { ...ctx.env, ...entry.env, FVTT_MCP_ENV: envFile });
  }

  // --- the block for any other client ---
  io.print('');
  io.print('For any other MCP client (stdio), the same server; the secrets stay in the .env:');
  io.print(JSON.stringify({ mcpServers: { [a.name]: entry } }, null, 2));
  io.print('');
  if (failed) {
    io.print(
      `${failed} problem${failed === 1 ? '' : 's'}: fix the ✗ lines above, then run ` +
        `\`npm run init\` again or \`${doctor}\``
    );
    return 1;
  }
  const where =
    target.kind === 'user'
      ? `restart Claude Code (every project has "${a.name}")`
      : target.kind === 'project'
        ? 'start Claude Code in this clone'
        : `start Claude Code in the project that reads ${target.file}`;
  io.print(
    `${flags.noDoctor ? 'Written' : 'All checks passed'}. Next: ${where}, then say "start the world".`
  );
  return 0;
}
