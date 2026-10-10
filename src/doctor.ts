// `npm run doctor` (scripts/doctor.mjs; issue #3): every setup check in order, one actionable line
// each. The script checks Node and dist/ itself (nothing here can load without a build), then
// hands over to `runDoctor`.
//
// It reads the configuration exactly as the server does: the .env (src/env.ts — <repo>/.env, or
// FVTT_MCP_ENV) layered UNDER the process environment, so a registration-style override
// (`FOUNDRY_USER=x npm run doctor`) wins, and FOUNDRY_HOST picks the host the same way.
//
// Safe against prod: it never launches or stops a world and writes nothing. The Foundry checks are
// GET /api/status, at most one POST /auth (only when no world is running, to test the admin key;
// Foundry answers it with a redirect and nothing else), and one login as the bridge user — the
// same join any tool call makes, with the admin key withheld so the bridge cannot launch a
// world — followed by a disconnect.

import { existsSync } from 'node:fs';
import {
  connectFoundry,
  createHost,
  type Env,
  envPath,
  type HostConfig,
  type HostKind,
  hostConfigProblem,
  hostKindFromEnv,
  loadEnv,
  quietLogger,
  resolveHostConfig,
  targetLabel,
} from './client.js';
import { chromiumProblem } from './foundry.js';
import { majorVersion, REQUIRED_DND5E_MAJOR } from './utils/system-detection.js';

export type Mark = 'ok' | 'fail' | 'warn' | 'skip';

/** What the script passes in: where lines go, and the local install probe (scripts/lib). */
export interface DoctorIO {
  say(mark: Mark, text: string): void;
  foundryApp(env: Env): { main: string; tried: string[]; found: boolean };
}

/** What GET /api/status says (core Foundry: `active` plus the world facts once it is ready). */
export type ApiStatus =
  | {
      kind: 'active';
      version: string;
      world: string;
      system: string;
      systemVersion: string;
      users: number;
    }
  | { kind: 'no-world'; version: string }
  | { kind: 'not-foundry' };

export function readApiStatus(body: string): ApiStatus {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { kind: 'not-foundry' };
  }
  if (typeof j !== 'object' || j === null || typeof j.active !== 'boolean') {
    return { kind: 'not-foundry' };
  }
  const version = String(j.version ?? '?');
  if (!j.active) return { kind: 'no-world', version };
  return {
    kind: 'active',
    version,
    world: String(j.world ?? '?'),
    system: String(j.system ?? '?'),
    systemVersion: String(j.systemVersion ?? '?'),
    users: Number(j.users ?? 0),
  };
}

/**
 * POST /auth {adminPassword} with no world running (core Foundry, auth.mjs): a good password is a
 * redirect to /setup; a bad one re-renders the form (200). With a world running every answer is a
 * redirect to /join; a 405 is a server behind external admin auth.
 */
export function readAdminAuth(
  status: number,
  location: string | null
): 'accepted' | 'rejected' | 'world-active' | 'unknown' {
  if (status >= 300 && status < 400) {
    if (/\/setup$/.test(location ?? '')) return 'accepted';
    if (/\/join$/.test(location ?? '')) return 'world-active';
    return 'unknown';
  }
  return status === 200 ? 'rejected' : 'unknown';
}

/** CONST.USER_ROLES by number. */
export function roleName(role: number): string {
  return ['None', 'Player', 'Trusted Player', 'Assistant GM', 'Gamemaster'][role] ?? `role ${role}`;
}

/** The selector's alias notes (`LOCAL_X is a legacy alias of FOUNDRY_X — …`) as one line. */
export function legacyNamesLine(notes: string[]): string | undefined {
  if (!notes.length) return undefined;
  const pairs = notes.map(n => {
    const m = /^(\S+) is a legacy alias of (\S+?)[ .—]/.exec(n);
    return m ? `${m[1]} → ${m[2]}` : n;
  });
  return `legacy .env names still read: ${pairs.join(', ')} (rename when convenient)`;
}

/** The first line of an error's message (a bridge error's detail can carry more). */
function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0] ?? '';
}

/**
 * Run every check after Node and dist/. Returns the number of failures (✗ lines).
 *
 * @public scripts/doctor.mjs loads it from dist/ by a dynamic import, which knip cannot follow.
 */
export async function runDoctor(io: DoctorIO): Promise<number> {
  let failed = 0;
  const fail = (text: string): void => {
    failed++;
    io.say('fail', text);
  };

  // --- configuration: the .env under process.env, as src/config.ts layers it -----------------
  const path = envPath();
  const fileWarnings: string[] = [];
  const warn = console.warn;
  console.warn = (m: unknown) => fileWarnings.push(String(m).replace(/^\[env\] /, ''));
  let fileEnv: Env;
  try {
    fileEnv = loadEnv(path);
  } finally {
    console.warn = warn;
  }
  if (!existsSync(path)) {
    if (process.env.FVTT_MCP_ENV?.trim()) {
      fail(`.env: FVTT_MCP_ENV points at ${path}, which does not exist — fix the path`);
      return failed;
    }
    io.say('warn', `.env: none at ${path} — only the process environment and the defaults apply`);
  }
  const env: Env = { ...fileEnv, ...process.env };
  let kind: HostKind;
  let hostConfig: HostConfig;
  const notes: string[] = [];
  try {
    kind = hostKindFromEnv(env, m => notes.push(m));
    hostConfig = resolveHostConfig(env, kind, { warn: m => notes.push(m) });
  } catch (err) {
    fail(`config: ${firstLine(err)}`);
    return failed;
  }
  const problem = hostConfigProblem(hostConfig);
  if (problem) {
    fail(`config: ${problem}`);
    return failed;
  }
  if (existsSync(path)) {
    io.say('ok', `config: ${path}, host ${targetLabel(kind)}, bridge user "${hostConfig.user}"`);
  }
  for (const w of fileWarnings) io.say('warn', `.env: ${w}`);
  const legacy = legacyNamesLine(notes);
  if (legacy) io.say('warn', legacy);
  const host = createHost(hostConfig, quietLogger());

  // --- this machine ------------------------------------------------------------------------
  const noBrowser = chromiumProblem();
  if (noBrowser) fail(`browser: ${noBrowser}`);
  else io.say('ok', "browser: Playwright's Chromium is installed");

  if (kind === 'local') {
    const app = io.foundryApp(env);
    if (app.found) io.say('ok', `Foundry app: ${app.main}`);
    else {
      fail(
        `Foundry app: not found (tried ${app.tried.join(', ')}) — set FOUNDRY_APP to the ` +
          "install's resources/app/main.js (only scripts/local-foundry.mjs needs it)"
      );
    }
  }

  // --- the instance ------------------------------------------------------------------------
  const base = hostConfig.serverUrl.replace(/\/+$/, '');
  let status: ApiStatus;
  try {
    const res = await fetch(`${base}/api/status`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    status = readApiStatus(await res.text());
    if (status.kind === 'not-foundry') {
      fail(`Foundry: ${base} answered HTTP ${res.status}, not Foundry — ${host.unreachableHint}`);
      return failed;
    }
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? firstLine(err);
    fail(`Foundry: no answer from ${base} (${cause}) — ${host.unreachableHint}`);
    return failed;
  }
  io.say('ok', `Foundry: ${status.version} at ${base}`);

  if (status.kind === 'no-world') {
    if (!hostConfig.adminKey) {
      fail(`world: none running and FOUNDRY_ADMIN_KEY is not set — ${host.launchHint}`);
    } else {
      const res = await fetch(`${base}/auth`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin },
        body: JSON.stringify({ adminPassword: hostConfig.adminKey }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
      const auth = res ? readAdminAuth(res.status, res.headers.get('location')) : 'unknown';
      if (auth === 'accepted') {
        io.say('ok', 'admin key: accepted');
        io.say(
          'warn',
          `world: none running — the first tool call launches ${
            hostConfig.worldId ? `"${hostConfig.worldId}"` : 'the one world on /setup'
          } (the doctor never launches one)`
        );
      } else if (auth === 'rejected') {
        fail(
          "admin key: Foundry rejected FOUNDRY_ADMIN_KEY — it is the Setup screen's " +
            'Administrator Password, not the license key'
        );
      } else {
        io.say('warn', `admin key: could not be checked (HTTP ${res?.status ?? 'no answer'})`);
      }
    }
    io.say('skip', 'login: skipped — no world is running');
    return failed;
  }

  // A world is running.
  io.say(
    'skip',
    hostConfig.adminKey
      ? 'admin key: not checked — a world is running (the key only launches one)'
      : 'admin key: unset — fine while a world is running (the bridge cannot launch one)'
  );
  const major = majorVersion(status.systemVersion);
  if (status.system !== 'dnd5e') {
    fail(`world: "${status.world}" runs ${status.system}, not dnd5e — the tools are dnd5e only`);
  } else if (major !== null && major < REQUIRED_DND5E_MAJOR) {
    fail(
      `world: "${status.world}" runs dnd5e ${status.systemVersion} — the tools need ` +
        `${REQUIRED_DND5E_MAJOR}.0 or later (1.x is the line for 5.3)`
    );
  } else {
    io.say(
      'ok',
      `world: "${status.world}" running, dnd5e ${status.systemVersion}, ${status.users} user(s) connected`
    );
  }
  if (hostConfig.worldId && hostConfig.worldId !== status.world) {
    io.say(
      'warn',
      `world: FOUNDRY_WORLD_ID is "${hostConfig.worldId}" but "${status.world}" is running — the ` +
        'bridge joins the running one'
    );
  }

  // --- the bridge user: the bridge's own join, admin key withheld ------------------------------
  const started = Date.now();
  try {
    const { f, dispose } = await connectFoundry({
      host: kind,
      env: { ...env, FOUNDRY_ADMIN_KEY: '', LOCAL_ADMIN_KEY: '', MOLTEN_ADMIN_KEY: '' },
      identity: 'bridge',
      tag: 'doctor',
      announce: false,
      watchdogMs: 420_000,
    });
    let who: { name: string; role: number };
    try {
      who = await f.evaluate(() => {
        const user = (globalThis as { game?: { user?: { name?: string; role?: number } } }).game
          ?.user;
        return { name: user?.name ?? '?', role: Number(user?.role ?? 0) };
      }, null);
    } finally {
      await dispose();
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (who.role >= 3) {
      io.say(
        'ok',
        `login: "${who.name}" joined as ${roleName(who.role)} in ${secs} s, then disconnected`
      );
    } else {
      fail(
        `login: "${who.name}" joined as ${roleName(who.role)} — every write tool needs Gamemaster ` +
          'or Assistant GM; change its role in Foundry (User Management)'
      );
    }
  } catch (err) {
    fail(`login: ${firstLine(err)}`);
  }
  return failed;
}
