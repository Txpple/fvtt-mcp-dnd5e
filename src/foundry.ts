// foundry.ts — THE quarantine.
//
// This is the ONLY file in the codebase that knows Playwright/CDP exists. It owns the
// entire live bridge: launch headless Chromium, let the host wake a sleeping instance
// (src/hosts — the one host-specific step of connecting), join the world as the dedicated
// passwordless MCP user, wait for game.ready, inject the page-side domain library
// (window.__fvtt), and expose a tiny seam:
//
//     foundry.call(name, args)   ->  window.__fvttCall(name, args)   (the tool surface; a write
//                                     is recorded into the tool call's receipt, src/receipts.ts)
//     foundry.evaluate(fn, arg)  ->  page.evaluate(fn, arg)      (escape hatch)
//
// Everything else in the tree calls foundry.call() and never sees a Page. The irreducible
// "Foundry is a live, locked DB" complexity lives here and nowhere else.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { PageApi, PageArgs, PageResult } from './page/index.js';

// The seam's types, re-exported so a tool (or a sibling) names a handler's argument or result
// without reaching into src/page: `PageArgs<'manageEffect'>[0]`, `PageResult<'listUsers'>`.
export type { PageApi, PageArgs, PageResult };
import { asCallError, asConnectError, BridgeError, ConnectProblem } from './bridge-error.js';
import type { Host } from './hosts/types.js';
import { hostConfigProblem } from './hosts/env.js';
import {
  JOIN_PASSWORD,
  JOIN_SUBMIT,
  JOIN_USER_FIELD,
  JOIN_USER_INPUT,
  JOIN_USER_SELECT,
  missingUserProblem,
  readJoinForm,
} from './join-form.js';
import { clearSystemCache } from './utils/system-detection.js';
import { OpCapError, raceWithCap } from './op-cap.js';
import { opKind } from './page/_ops.js';
import { type CallOutcome, UNRECORDED } from './page/_receipts.js';
import { callContext, noteOps } from './receipts.js';
import {
  describeHolder,
  type Eviction,
  evictHolder,
  exeOf,
  type Holder,
  holderRecord,
  listHolders,
  removeHolder,
  writeHolder,
} from './holders.js';

/**
 * Chromium flags that put the page's WebGL on the GPU. Headless Chromium defaults to software
 * rendering (SwiftShader): Foundry's canvas then draws at ~4 fps, a screenshot takes ~3.3 s and
 * carries Foundry's "hardware acceleration not enabled" banner. On the GPU a screenshot takes
 * ~0.9 s and the banner is gone (measured 2026-10-01, Chromium 149, Intel integrated graphics;
 * issue #2). ANGLE's D3D11 backend exists only on Windows; elsewhere ANGLE picks its own. There
 * is no off switch: when the GPU process fails, Chromium falls back to software rendering itself.
 */
const GPU_ARGS = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
];

/**
 * Why the bridge's browser cannot launch, or `undefined`. A headless launch runs Playwright's
 * headless shell, which `npx playwright install chromium` puts beside the full build under the same
 * revision (`…/chromium-1228/…` and `…/chromium_headless_shell-1228`); a fresh clone has neither,
 * and the first tool call used to be where that surfaced. The server checks at startup, the doctor
 * too. `exists` is injectable for the unit test.
 */
export function chromiumProblem(
  exists: (path: string) => boolean = existsSync
): string | undefined {
  const fix = 'run `npx playwright install chromium` in the fvtt-mcp-dnd5e folder';
  let full: string;
  try {
    full = chromium.executablePath();
  } catch (err) {
    return `Playwright cannot locate its Chromium (${(err as Error).message}) — ${fix}.`;
  }
  const rev = /^(.*[\\/])chromium-(\d+)[\\/]/.exec(full);
  const needed = rev ? `${rev[1]}chromium_headless_shell-${rev[2]}` : full;
  if (exists(needed)) return undefined;
  return `Playwright's Chromium is not installed (${needed} is missing) — ${fix}.`;
}

/**
 * The seam the rest of the codebase depends on. Tools import THIS (a type),
 * never the Playwright-backed `Foundry` class, so nothing outside foundry.ts
 * pulls in Playwright. `call(name, args)` mirrors the legacy
 * foundryClient.query('foundry-mcp-bridge.<name>', data) 1:1.
 */
export interface FoundryBridge {
  /**
   * Invoke a page-side handler by name. Typed end to end from the handler's own signature
   * (src/page/index.ts `PageApi`): a mistyped or removed name, a wrong argument shape and a
   * result field the handler never returns are all compile errors here, not surprises in a live
   * session. The argument is optional exactly when the handler's is.
   */
  call<N extends keyof PageApi>(name: N, ...args: PageArgs<N>): Promise<PageResult<N>>;
  /**
   * Capture a PNG screenshot of the live page (the rendered Foundry canvas + UI) to `outPath`.
   * Playwright-level — the page-side bundle can't reach `page.screenshot`, so this is the one
   * screenshot path. Pair with the page-side `prepareSceneShot` (view + fit + optional marker
   * overlay) to shoot a specific scene. Visual QA for scene/import work.
   */
  screenshot(outPath: string): Promise<void>;
  /**
   * The live world's id (`game.world.id`), read once per connection. Connects if needed. Tools
   * build world-scoped default paths on it (`worlds/<id>/assets/...`) instead of on config.
   */
  worldId(): Promise<string>;
  /** Is the live session currently up (page open + bridge marked ready)? */
  isReady(): boolean;
  /**
   * Tear down the live session: close the headless browser so the bridge user leaves the world
   * (goes inactive). Idempotent and safe while disconnected. The bridge stays usable — the next
   * `call()` reconnects lazily (wake -> join -> game.ready -> inject), which is what lets the
   * disconnect-bridge tool log out without ending the MCP process.
   */
  dispose(): Promise<void>;
  /**
   * Every process on this machine holding this bridge's seat (same server URL and user), this one
   * included — the records src/holders.ts keeps while a session is open. Offline: reads files.
   */
  holders(): Holder[];
  /**
   * End every OTHER holder's browser on this machine (their MCP servers keep running and reconnect
   * lazily on their next call). The cure for "a GM seat is taken by a bridge nobody in this session
   * opened" (issue #12), without a walk through the process table. A browser is ended only while
   * its recorded pid still runs its recorded executable, never when that pid is this bridge's own
   * browser, and a record is dropped only when its browser was ended or is gone (issue #17); each
   * holder's entry says what was ended or why nothing was, and whether its record stays.
   */
  evictOtherHolders(): Promise<Eviction[]>;
  /**
   * The bridge's own facts, without a page call (get-world-info's bridge block): the server URL and
   * the join user it was configured with, when this connection took the seat (the seat record's
   * `since`; null while disconnected), and whether this connect's first `/join` probe found no
   * joinable world (a sleeping box, a world it launched, or one still booting).
   */
  info(): { serverUrl: string; user: string; since: string | null; woken: boolean };
}

export interface FoundryConfig {
  /** Base world URL (FOUNDRY_URL), e.g. https://your-box.moltenhosting.com or http://localhost:30000. */
  serverUrl: string;
  /**
   * Where this Foundry runs (src/hosts). Supplies the optional wake step before /join is probed
   * and secret redaction for logs. Omitted = a host that never sleeps.
   */
  host?: Host;
  /** Dedicated Foundry user to join as (FOUNDRY_USER, default "MCP-Claude"). */
  user: string;
  /** Optional user password (FOUNDRY_PASSWORD); omit for a passwordless user. */
  password?: string;
  /**
   * Foundry admin access key (FOUNDRY_ADMIN_KEY). When set, an instance that is up but has no
   * world launched is recovered by authenticating to /setup and launching the world — Foundry's
   * own admin flow, the same on every host. Omit to keep world-launch a manual step (the bridge
   * then fails with guidance).
   */
  adminKey?: string;
  /**
   * World to launch when the instance is up but no world is active (FOUNDRY_WORLD_ID). Omit and
   * the bridge launches the ONE world it finds on /setup — several worlds need the id.
   */
  worldId?: string;
  /** Run Chromium headless (default true). */
  headless?: boolean;
  /**
   * Ms to wait for game.ready after submitting the join form (default 300000). The heavy dnd5e
   * world has taken 200s+ to reach game.ready over a slow client link (measured live 2026-07-07,
   * airplane wifi on the travel box) — 120s was not enough. The travel box regularly runs on bad
   * networks, so the defaults must absorb link slowness, not just box slowness.
   */
  readyTimeoutMs?: number;
  /** Overall budget to bring a cold box up (wake + optional launch) before joining (default 600000). */
  wakeTimeoutMs?: number;
  /**
   * What to call this holder in the seat record and on the User document (FOUNDRY_BRIDGE_LABEL);
   * default: the Claude Code session that started the server, else the pid (src/holders.ts).
   */
  label?: string;
  /**
   * Log out on our own after this long with no call (FOUNDRY_IDLE_LOGOUT_MIN, default 20 min;
   * 0 disables), so a forgotten session's seat does not block a suite an hour later (issue #12).
   * The next call reconnects, exactly as after disconnect-bridge.
   */
  idleLogoutMs?: number;
  /**
   * Ms a page op runs before the bridge asks the page whether it still answers (default 600000,
   * 10 min; run-script's cap is its own timeout + 30 s). A page that answers keeps waiting, asked
   * again each interval, up to 30 min in all; one that does not is closed, the call fails with
   * its outcome unknown, and the next call reconnects (issue #16; src/op-cap.ts). It never bounds
   * the connect: the wake and ready budgets above are the connect's.
   */
  opCapMs?: number;
  /**
   * The registration is read-only (FOUNDRY_TOOLSETS=readonly): the connect warns when the join
   * user is an Assistant GM or Gamemaster, since that role, not the server's refusals, is the
   * boundary a write would have to cross. Such a user is expected to be a Player or Trusted Player.
   */
  expectReadOnly?: boolean;
}

/** How long a page has to answer "are you there?" once an op outlives its cap. */
const OP_PROBE_MS = 5_000;
/** No page op is waited on longer than this, however responsive the page. */
const OP_CEILING_MS = 30 * 60_000;
/** run-script's own timeout when the call names none (src/page/run-script.ts), and its grace. */
const SCRIPT_TIMEOUT_MS = 60_000;
const SCRIPT_GRACE_MS = 30_000;

/**
 * The cap on one call: run-script's own timeout (clamped as the page clamps it) plus its grace, so
 * the script's own timeout always answers first; any other op, the configured cap (10 min).
 */
function opCapFor(name: string, args: unknown, opCapMs: number | undefined): number {
  if (name !== 'runScript') return opCapMs ?? 600_000;
  const timeout = Number((args as { timeoutMs?: unknown } | null | undefined)?.timeoutMs);
  return (
    (Number.isFinite(timeout) ? Math.max(1_000, Math.floor(timeout)) : SCRIPT_TIMEOUT_MS) +
    SCRIPT_GRACE_MS
  );
}

export interface FoundryLogger {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

const consoleLogger: FoundryLogger = {
  debug: m => console.error(`[foundry] ${m}`),
  info: m => console.error(`[foundry] ${m}`),
  warn: m => console.error(`[foundry] ${m}`),
  error: m => console.error(`[foundry] ${m}`),
};

export class Foundry implements FoundryBridge {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private ready = false;
  private connecting: Promise<void> | undefined;
  private readonly pageBundle: string;
  /** `game.world.id` of the joined world, read after game.ready. */
  private liveWorldId: string | undefined;
  /** The world /setup discovery settled on (kept for the next launch of this process). */
  private discoveredWorldId: string | undefined;
  /** Calls in flight (the idle logout never fires under one) and when the last one ended. */
  private inflight = 0;
  private lastUsed = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  /** The pid of the browser this bridge launched, from markSeat; null once that browser is dropped. */
  private ownBrowserPid: number | null = null;
  /** When this connection took the seat (the seat record's `since`); null while disconnected. */
  private seatSince: string | null = null;
  /** This connect's first /join probe found no joinable world: asleep, launched, or booting. */
  private woken = false;

  constructor(
    private readonly cfg: FoundryConfig,
    private readonly log: FoundryLogger = consoleLogger
  ) {
    this.pageBundle = loadPageBundle();
  }

  isReady(): boolean {
    return this.ready && !!this.page && !this.page.isClosed();
  }

  info(): { serverUrl: string; user: string; since: string | null; woken: boolean } {
    return {
      serverUrl: this.cfg.serverUrl,
      user: this.cfg.user,
      since: this.seatSince,
      woken: this.woken,
    };
  }

  /**
   * Idempotent connect (wake -> join -> game.ready -> inject). Safe to await concurrently. Whatever
   * fails on the way — the wake, /setup, /join, game.ready, Playwright itself — surfaces as a
   * `connection` BridgeError: the bridge never reached a joinable world, and that is the code, not
   * a word in the message.
   */
  async connect(): Promise<void> {
    if (this.isReady()) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect()
      .catch(err => {
        throw asConnectError(err);
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    // A placeholder URL can never connect — refuse in milliseconds, naming the variable, instead
    // of spending the cold-boot budget on "booting" (the server refuses it at startup too; this
    // covers a script or test that built the config by hand).
    const problem = hostConfigProblem({
      kind: 'generic',
      serverUrl: this.cfg.serverUrl,
      user: this.cfg.user,
    });
    if (problem) throw new Error(problem);
    this.ready = false;
    // A reconnect (after a "Return to Setup" / box relaunch) could in principle bring up a different
    // world, so drop the process-lifetime system-detection cache — it must re-detect, not trust a stale
    // answer (harmless no-op on the first connect).
    clearSystemCache();
    // A browser that died under us (ended by another session's disconnect-bridge { all }, or a
    // crash) is dropped, so this connect launches a new one instead of asking a dead context for a
    // page, which fails on every call after.
    if (this.browser && !this.browser.isConnected()) {
      this.browser = undefined;
      this.context = undefined;
      this.ownBrowserPid = null;
    }
    this.browser ??= await chromium.launch({
      headless: this.cfg.headless ?? true,
      args: GPU_ARGS,
    });
    this.context ??= await this.browser.newContext({ viewport: { width: 1920, height: 1080 } });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.readyTimeout);

    await this.wake();
    await this.ensureWorldReady(this.page);
    await this.joinWorld(this.page);
    await this.injectBundle(this.page);
    const who = await this.page.evaluate(() => {
      const g = (globalThis as { game?: { world?: { id?: string }; user?: { role?: number } } })
        .game;
      return { worldId: g?.world?.id ?? '', role: Number(g?.user?.role ?? 0) };
    });
    this.liveWorldId = who.worldId;
    this.ready = true;
    this.log.info(`connected as "${this.cfg.user}" — game.ready (world "${this.liveWorldId}")`);
    // Nearly every tool writes as a GM; a lower role fails call by call with Foundry's own
    // permission errors, so say it once here (CONST.USER_ROLES: ASSISTANT = 3, GAMEMASTER = 4).
    // A read-only registration is the reverse: it wants a Player or Trusted Player, because the
    // server's refusals stop the calls it is asked to make and the role stops everything else.
    if (this.cfg.expectReadOnly && who.role >= 3) {
      this.log.warn(
        `bridge user "${this.cfg.user}" has role ${who.role} (${who.role >= 4 ? 'Gamemaster' : 'Assistant GM'}) ` +
          'on a read-only registration (FOUNDRY_TOOLSETS=readonly) — the server refuses writes, but ' +
          'this user could make them: the role of the join user is the real boundary. Give it the ' +
          'Player or Trusted Player role.'
      );
    } else if (!this.cfg.expectReadOnly && who.role < 3) {
      this.log.warn(
        `bridge user "${this.cfg.user}" has role ${who.role} (below Assistant GM) — every write ` +
          'tool will be refused by Foundry. Give the user the Gamemaster or Assistant GM role.'
      );
    }
    await this.markSeat();
    this.warmIndexes();
    this.lastUsed = Date.now();
    this.armIdle();
  }

  /**
   * Leave the record of who holds this seat: a file on this machine (src/holders.ts) and the same
   * facts on the User document (`flags.world.fvttMcpBridge`, readable from any client — the suites'
   * preflight prints it). Other live holders of the seat on this machine are named here, once, so a
   * second bridge never joins silently as the same user. Best effort: a seat record is a courtesy.
   */
  private async markSeat(): Promise<void> {
    const rec = holderRecord(this.cfg.serverUrl, this.cfg.user);
    if (this.cfg.label) rec.label = this.cfg.label;
    // The browser by pid and path, so another session's disconnect-bridge { all } can end it and
    // nothing else (issue #17). The path lookup is asynchronous: on Windows it is a PowerShell
    // start, which a synchronous spawn made every connect wait out with the event loop held.
    rec.browserPid = await this.browserPid();
    rec.browserExe = rec.browserPid === null ? null : await exeOf(rec.browserPid);
    this.ownBrowserPid = rec.browserPid;
    this.seatSince = rec.since;
    const others = listHolders(this.cfg.serverUrl, this.cfg.user).filter(h => !h.self);
    for (const h of others) {
      this.log.warn(
        `the seat "${this.cfg.user}" is also held on this machine by ${describeHolder(h)} — two ` +
          'sessions joined as one user; disconnect-bridge { all: true } ends every other holder'
      );
    }
    writeHolder(rec);
    // The marker is the bridge's own bookkeeping: written UNRECORDED, so a tool call in flight
    // never finds it in its receipt (src/page/_receipts.ts).
    await this.page
      ?.evaluate(
        async ({ marker, unrecorded }) => {
          const user = (globalThis as any).game?.user;
          await user?.update({ 'flags.world.fvttMcpBridge': marker }, { [unrecorded]: true });
        },
        {
          marker: {
            pid: rec.pid,
            host: rec.host,
            label: rec.label,
            session: rec.session,
            since: rec.since,
          },
          unrecorded: UNRECORDED,
        }
      )
      .catch((err: Error) => this.log.debug(`seat marker not written — ${err.message}`));
  }

  /**
   * The pid of the browser this bridge launched. A launched Playwright Browser has no `process()`,
   * so it is read from a browser CDP session (`SystemInfo.getProcessInfo`, the entry of type
   * `browser`). Best effort: null on any failure.
   */
  private async browserPid(): Promise<number | null> {
    if (!this.browser) return null;
    try {
      const cdp = await this.browser.newBrowserCDPSession();
      try {
        const info = await cdp.send('SystemInfo.getProcessInfo');
        return info.processInfo.find(p => p.type === 'browser')?.id ?? null;
      } finally {
        await cdp.detach().catch(() => {});
      }
    } catch {
      return null;
    }
  }

  /** Clear what markSeat left, under a short ceiling: a dispose must not wait on a dead page. */
  private async clearSeat(): Promise<void> {
    removeHolder({ serverUrl: this.cfg.serverUrl, user: this.cfg.user, pid: process.pid });
    this.seatSince = null;
    const page = this.page;
    if (!page || page.isClosed()) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      page
        .evaluate(async unrecorded => {
          const user = (globalThis as any).game?.user;
          await user?.update({ 'flags.world.-=fvttMcpBridge': null }, { [unrecorded]: true });
        }, UNRECORDED)
        .catch(() => {}),
      new Promise<void>(r => {
        timer = setTimeout(r, 3_000);
      }),
    ]);
    clearTimeout(timer);
  }

  holders(): Holder[] {
    return listHolders(this.cfg.serverUrl, this.cfg.user);
  }

  async evictOtherHolders(): Promise<Eviction[]> {
    // Another record is told from ours by its server pid, but its browser pid may since have been
    // reused by our own headless shell, which passes the path check: our browser, while it is
    // connected, is never ended (issue #17's review).
    const own = this.browser?.isConnected() ? this.ownBrowserPid : null;
    return Promise.all(
      this.holders()
        .filter(h => !h.self)
        .map(h => evictHolder(h, { ownBrowserPid: own }))
    );
  }

  /** (Re)arm the idle logout from the last call's end; a call in flight pushes it out. */
  private armIdle(): void {
    const ms = this.cfg.idleLogoutMs ?? 0;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (!(ms > 0)) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (!this.isReady()) return;
      if (this.inflight > 0 || Date.now() - this.lastUsed < ms) {
        this.armIdle();
        return;
      }
      const idle = ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
      this.log.info(`idle for ${idle} — logging the bridge out (the next call reconnects)`);
      void this.dispose();
    }, ms);
    this.idleTimer.unref();
  }

  /** Every seam call rides this: counts the call for the idle logout and stamps its end. */
  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.inflight++;
    try {
      return await work();
    } finally {
      this.inflight--;
      this.lastUsed = Date.now();
      this.armIdle();
    }
  }

  async worldId(): Promise<string> {
    await this.ensureReady();
    return this.liveWorldId ?? '';
  }

  /**
   * Fire the page's compendium index warm-up and move on: the first search of a session paid
   * ~11 s of cold getIndex (one premium pack is 91% of it) before this; now that build overlaps
   * whatever the session does first. A search that lands mid-warm-up awaits the same build.
   */
  private warmIndexes(): void {
    void this.invoke<{ packs: number; built: number; ms: number }>('warmCompendiumIndexes')
      .then(r =>
        this.log.info(`compendium indexes warm: ${r.built} built of ${r.packs} in ${r.ms} ms`)
      )
      .catch(err => {
        // A script that connects, does one thing and disposes closes the page mid-warm-up: that
        // is not a failure worth a line (every sibling harness printed it on every run).
        if (this.isReady())
          this.log.warn(`compendium index warm-up failed: ${(err as Error).message}`);
      });
  }

  /**
   * Let the host bring a sleeping instance up (best-effort). The host gets the real page to
   * navigate — a wake GET rides the browser exactly as it always has — but never a Playwright
   * type. A host with no wake step (local, generic) makes this a no-op.
   */
  private async wake(): Promise<void> {
    const page = this.page;
    if (!this.cfg.host?.wake || !page) return;
    await this.cfg.host.wake({
      goto: async url => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      },
      log: { debug: m => this.log.debug(m), warn: m => this.log.warn(m) },
    });
  }

  /**
   * Bring a cold box to a joinable world. The Magic URL only wakes the VM; if the VM is up
   * but no world is launched, Foundry serves a "no active game session" page indefinitely. So
   * poll /join and, by what we find, either wait out a slow boot (re-pinging the Magic URL) or
   * — when an admin key + world id are configured — launch the world ourselves via /setup.
   */
  private async ensureWorldReady(page: Page): Promise<void> {
    const budget = this.cfg.wakeTimeoutMs ?? 600_000;
    const deadline = Date.now() + budget;
    let lastLaunchAt = 0;
    let lastMagicAt = Date.now(); // wake() just ran
    let first = true;
    while (Date.now() < deadline) {
      const state = await this.probeJoinState(page);
      if (first) {
        // The bridge block's `woken`: the world was not there to join at first sight.
        this.woken = state !== 'joinable';
        first = false;
      }
      if (state === 'joinable') return;
      if (state === 'no-world') {
        if (this.cfg.adminKey) {
          // Launch once; retry only if still 'no-world' after a grace period. Stamp the
          // attempt time BEFORE launching so a throwing attempt still honors the grace.
          if (Date.now() - lastLaunchAt > 60_000) {
            lastLaunchAt = Date.now();
            try {
              await this.launchWorld(page);
            } catch (err) {
              const msg = (err as Error).message;
              // Misconfiguration (bad admin key / wrong or ambiguous world id) won't self-heal —
              // fail fast.
              if (err instanceof ConnectProblem) throw err;
              // Otherwise it may be a transient /setup hiccup; keep retrying within the budget.
              this.log.warn(`launch attempt failed (retrying within budget): ${msg}`);
            }
            continue; // re-probe; the world should now be booting (or retry after the grace)
          }
        } else {
          // The one missing thing first, then this host's fix (issue #3, item 7).
          throw new ConnectProblem(
            `No world is running at ${this.base} and FOUNDRY_ADMIN_KEY is not set, so the ` +
              `bridge cannot launch one. ${
                this.cfg.host?.launchHint ??
                `Set FOUNDRY_ADMIN_KEY, or click Launch World on ${this.base}/setup.`
              }`
          );
        }
      }
      // booting / transient: nudge a still-sleeping box again every ~90s, then wait.
      if (Date.now() - lastMagicAt > 90_000) {
        await this.wake();
        lastMagicAt = Date.now();
      }
      await page.waitForTimeout(5_000);
    }
    throw new Error(
      `Foundry world never became joinable within ${Math.round(budget / 1000)}s ` +
        '(the instance failed to come up, or the world failed to launch). ' +
        (this.cfg.host?.unreachableHint ?? 'Check FOUNDRY_URL and that the world is launched.')
    );
  }

  /** Classify the box by loading /join: ready to join, up-but-no-world, or still booting. */
  private async probeJoinState(page: Page): Promise<'joinable' | 'no-world' | 'booting'> {
    try {
      await page.goto(`${this.base}/join`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch {
      return 'booting'; // connection refused / nav error -> VM still coming up
    }
    // The user field is client-rendered once world data arrives over the socket — over a
    // slow client link that render takes 9s+ after domcontentloaded (measured live 2026-07-07,
    // airplane wifi), so poll a real window rather than one short wait. Each pass also checks for the
    // "VM up, no world active" page (Foundry's themed "Critical Failure!" / "no active game
    // session"), which needs no world data and is therefore detected fast. Check BOTH body
    // text and title, so detection doesn't hinge on body innerText being populated.
    const probeDeadline = Date.now() + 30_000;
    while (Date.now() < probeDeadline) {
      const hasForm = await page
        .locator(JOIN_USER_FIELD)
        .count()
        .catch(() => 0);
      if (hasForm > 0) return 'joinable';
      const { bodyText, title } = await page
        .evaluate(() => ({ bodyText: document.body?.innerText ?? '', title: document.title ?? '' }))
        .catch(() => ({ bodyText: '', title: '' }));
      if (
        /no active game session|configure the world/i.test(bodyText) ||
        /critical failure/i.test(title)
      )
        return 'no-world';
      await page.waitForTimeout(1_000);
    }
    return 'booting';
  }

  /**
   * Authenticate to /setup with the admin key and launch the configured world — or, with no
   * FOUNDRY_WORLD_ID, the one world /setup lists (several = a refusal naming them).
   */
  private async launchWorld(page: Page): Promise<void> {
    const want = this.cfg.worldId ? `"${this.cfg.worldId}"` : 'the world on /setup';
    this.log.info(`world not active — launching ${want} via admin /setup`);
    await page
      .goto(`${this.base}/setup`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => {});
    await page.waitForSelector('input[name="adminPassword"]', { timeout: 30_000 });
    await page.fill('input[name="adminPassword"]', this.cfg.adminKey ?? '');
    await page.locator('button[name="action"], button[type="submit"]').first().click();
    // Foundry returns to /setup with the world tiles once authenticated. If no tile appears,
    // disambiguate the cause so the operator gets an actionable error (not a raw selector
    // timeout): a persistent password gate = rejected admin key; otherwise there is no world.
    // ensureWorldReady fails fast on both (neither self-heals).
    const appeared = await page
      .waitForSelector('li[data-package-id]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      const stillGated = await page
        .locator('input[name="adminPassword"]')
        .count()
        .catch(() => 0);
      throw new ConnectProblem(
        stillGated
          ? "Foundry admin authentication failed — check FOUNDRY_ADMIN_KEY (the Setup screen's " +
              'Administrator Password, not the license key)'
          : 'no world found on /setup — create one, or check FOUNDRY_WORLD_ID'
      );
    }
    const world = this.cfg.worldId ?? this.discoveredWorldId ?? (await this.discoverWorld(page));
    const tile = `li[data-package-id="${world}"]`;
    if (
      (await page
        .locator(tile)
        .count()
        .catch(() => 0)) === 0
    ) {
      throw new ConnectProblem(`world "${world}" not found on /setup — check FOUNDRY_WORLD_ID`);
    }
    // Prefer Foundry's own setup POST helper: the "Launch World" button calls
    // game.post({action:'launchWorld', world}) internally. It's robust (no hover/visibility
    // games) but only valid while no world is active. A successful launch navigates away,
    // destroying the eval context — treat that as success. Fall back to clicking the
    // hover-reveal launch control if game.post is unavailable or rejects.
    const outcome = await page
      .evaluate(async w => {
        const g = (globalThis as { game?: { post?: (d: unknown) => Promise<unknown> } }).game;
        if (typeof g?.post !== 'function') return 'no-api';
        await g.post({ action: 'launchWorld', world: w });
        return 'ok';
      }, world)
      .catch((e: Error) => (/context|destroyed|navigat/i.test(e.message) ? 'ok' : 'error'));
    if (outcome !== 'ok') {
      this.log.warn(`launch via game.post unavailable (${outcome}) — using the UI control`);
      await page
        .locator(tile)
        .hover()
        .catch(() => {});
      const clicked = await page
        .locator(`${tile} [data-action="worldLaunch"]`)
        .click({ force: true, timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        await page.evaluate(w => {
          document
            .querySelector<HTMLElement>(`li[data-package-id="${w}"] [data-action="worldLaunch"]`)
            ?.click();
        }, world);
      }
    }
    this.log.info(`worldLaunch dispatched for "${world}" — waiting for the world to boot`);
  }

  /**
   * No FOUNDRY_WORLD_ID: the authenticated /setup page knows every installed world
   * (`game.worlds` on the Setup client; the world tiles as a fallback). One world = the answer;
   * more = the operator has to say which.
   */
  private async discoverWorld(page: Page): Promise<string> {
    const ids: string[] = await page
      .evaluate(() => {
        const g = (globalThis as { game?: { worlds?: Iterable<{ id?: string }> } }).game;
        const fromApi = g?.worlds ? [...g.worlds].map(w => w.id ?? '').filter(Boolean) : [];
        if (fromApi.length) return fromApi;
        // The tiles: worlds sit in their own list; systems and modules have their own lists.
        return [
          ...document.querySelectorAll<HTMLElement>(
            '#worlds-list li[data-package-id], [data-package-type="world"] li[data-package-id]'
          ),
        ]
          .map(li => li.dataset.packageId ?? '')
          .filter(Boolean);
      })
      .catch(() => [] as string[]);
    if (ids.length === 1) {
      this.discoveredWorldId = ids[0];
      this.log.info(`FOUNDRY_WORLD_ID unset — /setup has one world: "${ids[0]}"`);
      return ids[0] as string;
    }
    if (ids.length === 0) {
      throw new ConnectProblem('no world found on /setup — create one, or check FOUNDRY_WORLD_ID');
    }
    throw new ConnectProblem(
      `/setup lists ${ids.length} worlds (${ids.join(', ')}) — set FOUNDRY_WORLD_ID to the one to launch`
    );
  }

  private get base(): string {
    return this.cfg.serverUrl.replace(/\/$/, '');
  }

  private get readyTimeout(): number {
    return this.cfg.readyTimeoutMs ?? 300_000;
  }

  /** Navigate to /join, select the user (force-enabling a stale-active option), submit, await ready. */
  private async joinWorld(page: Page): Promise<void> {
    // The user field is rendered by Foundry's client JS AFTER it finishes loading the
    // world (the page first shows a "<world> Version 14 Build NNN" splash). So navigate ONCE
    // and WAIT for the form — do NOT re-goto in a tight loop, which restarts the client-side
    // load and leaves the box perpetually on the splash. Reload only between long waits, to
    // ride out a cold managed-host boot where the first hit lands on the "starting" interstitial.
    const perTryMs = 45_000;
    const tries = 6; // up to ~4.5 min total for a cold boot
    let formReady = false;
    for (let attempt = 1; attempt <= tries && !formReady; attempt++) {
      await page.goto(`${this.base}/join`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      try {
        await page.waitForSelector(JOIN_USER_FIELD, { timeout: perTryMs });
        formReady = true;
      } catch {
        const title = await page.title().catch(() => '?');
        this.log.debug(
          `/join form not ready (attempt ${attempt}/${tries}; title="${title}") — reloading`
        );
      }
    }
    if (!formReady) {
      throw new Error(
        'Foundry /join form never appeared — world may be inactive (check /setup) or box asleep.'
      );
    }

    // Two form shapes (src/join-form.ts). The <select> exposes the user list, so a wrong
    // FOUNDRY_USER fails fast with the real names; the free-text <input> exposes nothing, so a
    // wrong name surfaces only as the server's join error below.
    // The refusal is thrown out of connect(), so the tool call that asked gets it at once; the
    // next call tries again (the user may have been created meanwhile), never a retry loop.
    const form = await page.evaluate(readJoinForm, JOIN_USER_SELECT);
    const missing = missingUserProblem(this.cfg.user, form);
    if (missing) throw new ConnectProblem(missing);
    if (form.users) {
      // Select the user, force-enabling the option if Foundry disabled it (stale active flag).
      await page.evaluate(
        ({ selector, label }) => {
          const sel = document.querySelector(selector) as HTMLSelectElement;
          const opt = [...sel.options].find(o => o.textContent?.trim() === label);
          if (!opt) throw new Error('user option vanished');
          opt.disabled = false;
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { selector: JOIN_USER_SELECT, label: this.cfg.user }
      );
    } else {
      await page.fill(JOIN_USER_INPUT, this.cfg.user);
    }

    if (this.cfg.password) {
      await page.fill(JOIN_PASSWORD, this.cfg.password);
    }

    await page.locator(JOIN_SUBMIT).first().click();

    const timeout = this.readyTimeout;
    const outcome = await Promise.race([
      page
        .waitForFunction(
          () => (globalThis as { game?: { ready?: boolean } }).game?.ready === true,
          null,
          { timeout }
        )
        .then(() => 'ready' as const),
      (async () => {
        for (let i = 0; i < Math.ceil(timeout / 2000); i++) {
          const errs = await page
            .evaluate(() =>
              [...document.querySelectorAll('.notification.error, p.error')]
                .map(e => e.textContent?.trim())
                .filter(Boolean)
            )
            .catch(() => [] as string[]);
          if (errs.length) return `error: ${errs.join(' | ')}`;
          await page.waitForTimeout(2000);
        }
        return 'timeout';
      })(),
    ]);
    if (outcome !== 'ready') throw new Error(`Join did not reach game.ready (${outcome}).`);
  }

  /** Inject the bundled page-side domain library, defining window.__fvtt and window.__fvttCall. */
  private async injectBundle(page: Page): Promise<void> {
    await page.addScriptTag({ content: this.pageBundle });
    const ok = await page.evaluate(
      () =>
        typeof window.__fvtt === 'object' &&
        window.__fvtt !== null &&
        typeof window.__fvttCall === 'function'
    );
    if (!ok) throw new Error('page bundle injected but window.__fvtt is missing');
  }

  /**
   * The tool seam: invoke a page-side domain function by name.
   * Mirrors the legacy foundryClient.query('foundry-mcp-bridge.X', data) 1:1. A failure is a
   * BridgeError: the page's own words as `detail`, its PageError code (or `connection` when the
   * session was lost under the call) as `code` — see src/bridge-error.ts.
   */
  async call<N extends keyof PageApi>(name: N, ...args: PageArgs<N>): Promise<PageResult<N>> {
    return this.track(async () => {
      await this.ensureReady();
      try {
        return await this.invoke<PageResult<N>>(name, args[0]);
      } catch (err) {
        // The op outlived its cap and its page was closed: its outcome is unknown, so it is never
        // run a second time (a retried write could land twice). The next call reconnects.
        if (err instanceof OpCapError) throw asCallError(name, err);
        // A world reload / "Return to Setup" can wipe the injected window.__fvtt while the page
        // stays open. Distinguish that (the bridge is gone) from a genuine tool error: if the bridge
        // has vanished, recover once (re-inject in place, or full reconnect if the session itself
        // dropped), so a mid-session reload self-heals instead of wedging until a process restart.
        // Only a read is run again: a write may have landed before the page went (a reload under
        // it, or a page the op cap closed under another call), and a second run could land it
        // twice, so it fails with its outcome unknown (issue #16's review).
        if (!(await this.bridgeAlive())) {
          if (opKind(name, args[0]) !== 'read') {
            this.log.warn(
              `page bridge missing under '${name}' — recovering; a write is not run again`
            );
            await this.recover().catch((e: Error) =>
              this.log.warn(`recovery after '${name}' failed — ${e.message}`)
            );
            throw new BridgeError({
              code: 'connection',
              fn: name,
              detail:
                `the page went away under '${name}' (a world reload, or a page closed under the call), ` +
                'so the bridge did not run it again: its outcome is unknown, a write may or may not ' +
                'have landed. Read the world before running it again; the next call reconnects.',
              explained: true,
              cause: err,
            });
          }
          this.log.warn(`page bridge missing on '${name}' — recovering and retrying`);
          await this.recover();
          try {
            return await this.invoke<PageResult<N>>(name, args[0]);
          } catch (err2) {
            throw asCallError(name, err2);
          }
        }
        throw asCallError(name, err);
      }
    });
  }

  /**
   * Single page-side dispatch through window.__fvttCall, the page's choke point
   * (src/page/_receipts.ts), under the op cap (issue #16, src/op-cap.ts): past its cap the page is
   * asked whether it still answers; a page that does not is closed (the browser and context stay,
   * so the next call only re-joins) and the op fails with its outcome unknown. Only the evaluate is
   * capped, never the connect in front of it. Inside a tool call (src/receipts.ts `callContext`)
   * the page records a write under its write lock, and the writes it reports join the call's
   * receipt, a failed write's included; outside one (a sibling harness) nothing is recorded.
   */
  private async invoke<T>(name: string, args?: unknown): Promise<T> {
    // Capture the page locally: a concurrent call entering recover() can null this.page mid-flight,
    // and `this.page!` would then throw a TypeError on the deref.
    const page = this.page!;
    const record = callContext.getStore() !== undefined;
    const work = page.evaluate(
      ({ n, a, r }) => {
        const call = window.__fvttCall;
        if (typeof call !== 'function') throw new Error(`Unknown page function: ${n}`);
        return call(n, a, { record: r });
      },
      { n: name, a: args, r: record }
    ) as Promise<CallOutcome>;
    let out: CallOutcome;
    try {
      out = await raceWithCap(work, () => page.evaluate(() => 1), {
        capMs: opCapFor(name, args, this.cfg.opCapMs),
        probeMs: OP_PROBE_MS,
        hardMs: OP_CEILING_MS,
        onSlow: ms =>
          this.log.warn(
            `'${name}' still running after ${Math.round(ms / 1000)} s; the page answers, so it keeps its time`
          ),
      });
    } catch (err) {
      if (!(err instanceof OpCapError)) throw err;
      const why =
        err.reason === 'unresponsive'
          ? 'the page stopped answering'
          : `it ran into the ${OP_CEILING_MS / 60_000}-minute ceiling`;
      const message =
        `'${name}' did not finish within ${Math.round(err.elapsedMs / 1000)} s and ${why}, so ` +
        'the bridge closed its page; the next call reconnects. The outcome of this op is unknown: ' +
        'a write may or may not have landed.';
      this.log.warn(message);
      if (this.page === page) {
        this.ready = false;
        this.page = undefined;
      }
      // A page wedged in a synchronous loop still closes (the browser ends its renderer); the
      // ceiling keeps a close that never returns from holding the call.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        page.close().catch(() => {}),
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, 10_000);
        }),
      ]);
      clearTimeout(timer);
      throw new OpCapError(message, err.elapsedMs, err.reason, { cause: err });
    }
    if (out.ops?.length) noteOps(out.ops);
    if (out.error) {
      // The op threw after it had written: its writes are in the receipt; its words are thrown as
      // Chromium would have reported them (`<name>: <message>` and the in-page frames), so the
      // seam reads the same code and detail out of them (src/bridge-error.ts parsePageThrow).
      const frames = /\n\s+at [\s\S]*$/.exec(out.error.stack ?? '')?.[0] ?? '';
      throw new Error(`${out.error.name}: ${out.error.message}${frames}`);
    }
    return out.result as T;
  }

  /** Is the injected page bridge (window.__fvtt, window.__fvttCall) present on a live page? */
  private async bridgeAlive(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    return this.page
      .evaluate(
        () =>
          typeof window.__fvtt === 'object' &&
          window.__fvtt !== null &&
          typeof window.__fvttCall === 'function'
      )
      .catch(() => false);
  }

  /** Is the Foundry world ready in the current page (game.ready === true)? */
  private async gameReady(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    return this.page
      .evaluate(() => (globalThis as { game?: { ready?: boolean } }).game?.ready === true)
      .catch(() => false);
  }

  /**
   * Recover a lost page bridge. If the page is still alive and the world is ready (a navigation
   * wiped window.__fvtt but the session survived), re-inject the bundle in place — cheap. Otherwise
   * the session itself is gone, so do a full reconnect (wake -> join -> game.ready -> inject).
   */
  private async recover(): Promise<void> {
    if (this.page && !this.page.isClosed() && (await this.gameReady())) {
      await this.injectBundle(this.page).catch(() => {});
      if (await this.bridgeAlive()) return;
    }
    this.ready = false;
    this.page = undefined;
    await this.connect();
  }

  /**
   * Capture a PNG screenshot of the live page to `outPath`. The only screenshot path (the page-side
   * bundle can't reach Playwright's page.screenshot). Pair with the page-side `prepareSceneShot`
   * (view + fit + optional marker overlay) to shoot a specific scene for visual QA.
   */
  async screenshot(outPath: string): Promise<void> {
    return this.track(async () => {
      await this.ensureReady();
      const page = this.page!; // capture before any await can null this.page (see invoke()).
      await page.screenshot({ path: outPath, type: 'png' });
    });
  }

  /** Escape hatch for one-off page logic (used sparingly; prefer named page functions). */
  async evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T> {
    return this.track(async () => {
      await this.ensureReady();
      const page = this.page!; // capture before any await can null this.page (see invoke()).
      // Playwright's PageFunction generic is overly strict here; the escape hatch is rare.
      return page.evaluate(fn as any, arg as any);
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.isReady()) return;
    this.log.warn('page not ready — reconnecting');
    this.ready = false;
    this.page = undefined;
    await this.connect();
  }

  async dispose(): Promise<void> {
    // A dispose racing an in-flight connect (e.g. disconnect-bridge fired while the first tool
    // call is still joining) must not tear down half a session and leave a freshly-opened browser
    // orphaned: let the connect settle either way, then close everything it opened.
    await this.connecting?.catch(() => {});
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    await this.clearSeat();
    this.ready = false;
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = undefined;
    this.browser = undefined;
    this.ownBrowserPid = null;
    this.page = undefined;
  }

  /**
   * `dispose()` under the name the sibling harnesses call. Sixteen battleflow suites ended with
   * `await f.disconnect?.()` — an optional chain on a method that did not exist, so nothing ever
   * hung up (found 2026-08-23 by the hook ledger, which needed a teardown seam). One teardown,
   * both names.
   */
  async disconnect(): Promise<void> {
    return this.dispose();
  }
}

function loadPageBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, 'page.bundle.js');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Page bundle not found at ${path}. Run \`node esbuild.page.mjs\` (or the build) before starting.`
    );
  }
}
