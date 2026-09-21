// foundry.ts — THE quarantine.
//
// This is the ONLY file in the codebase that knows Playwright/CDP exists. It owns the
// entire live bridge: launch headless Chromium, let the host wake a sleeping instance
// (src/hosts — the one host-specific step of connecting), join the world as the dedicated
// passwordless MCP user, wait for game.ready, inject the page-side domain library
// (window.__fvtt), and expose a tiny seam:
//
//     foundry.call(name, args)   ->  window.__fvtt[name](args)   (the tool surface)
//     foundry.evaluate(fn, arg)  ->  page.evaluate(fn, arg)      (escape hatch)
//
// Everything else in the tree calls foundry.call() and never sees a Page. The irreducible
// "Foundry is a live, locked DB" complexity lives here and nowhere else.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { PageApi } from './page/index.js';
import { asCallError, asConnectError } from './bridge-error.js';
import type { Host } from './hosts/types.js';
import { hostConfigProblem } from './hosts/env.js';
import { clearSystemCache } from './utils/system-detection.js';

/**
 * The /join user field. Foundry ≤14.365 renders a <select name="userid"> listing the world's
 * users; 14.367+ renders a free-text <input name="username"> (with suggestions, not a list).
 * The bridge must join either shape — prod and the sandbox can straddle a core patch release.
 */
const JOIN_USER_FIELD = 'select[name="userid"], input[name="username"]';

/**
 * The seam the rest of the codebase depends on. Tools import THIS (a type),
 * never the Playwright-backed `Foundry` class, so nothing outside foundry.ts
 * pulls in Playwright. `call(name, args)` mirrors the legacy
 * foundryClient.query('foundry-mcp-bridge.<name>', data) 1:1.
 */
export interface FoundryBridge {
  /**
   * Invoke a page-side handler by name. `name` is constrained to `keyof PageApi` (the
   * registered window.__fvtt method names), so a typo'd or removed method is a compile
   * error here, not an "Unknown page function" at runtime. `T` stays first so existing
   * `call<ReturnShape>('method', args)` sites are unchanged.
   */
  call<T = any>(name: keyof PageApi, args?: unknown): Promise<T>;
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

  constructor(
    private readonly cfg: FoundryConfig,
    private readonly log: FoundryLogger = consoleLogger
  ) {
    this.pageBundle = loadPageBundle();
  }

  isReady(): boolean {
    return this.ready && !!this.page && !this.page.isClosed();
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
    this.browser ??= await chromium.launch({ headless: this.cfg.headless ?? true });
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
    if (who.role < 3) {
      this.log.warn(
        `bridge user "${this.cfg.user}" has role ${who.role} (below Assistant GM) — every write ` +
          'tool will be refused by Foundry. Give the user the Gamemaster or Assistant GM role.'
      );
    }
    this.warmIndexes();
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
    while (Date.now() < deadline) {
      const state = await this.probeJoinState(page);
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
              if (/authentication failed|found on \/setup|\/setup lists/i.test(msg)) throw err;
              // Otherwise it may be a transient /setup hiccup; keep retrying within the budget.
              this.log.warn(`launch attempt failed (retrying within budget): ${msg}`);
            }
            continue; // re-probe; the world should now be booting (or retry after the grace)
          }
        } else {
          throw new Error(
            'Foundry world is not launched and no admin key is configured to launch it. ' +
              'Launch the world (Setup → Launch World), or set FOUNDRY_ADMIN_KEY (and ' +
              'FOUNDRY_WORLD_ID when /setup lists more than one world).'
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
      throw new Error(
        stillGated
          ? 'Foundry admin authentication failed — check FOUNDRY_ADMIN_KEY'
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
      throw new Error(`world "${world}" not found on /setup — check FOUNDRY_WORLD_ID`);
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
      throw new Error('no world found on /setup — create one, or check FOUNDRY_WORLD_ID');
    }
    throw new Error(
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

    // Two form shapes (see JOIN_USER_FIELD). The <select> exposes the user list, so a wrong
    // FOUNDRY_USER fails fast with the real names; the free-text <input> exposes nothing, so a
    // wrong name surfaces only as the server's join error below.
    const isSelect = (await page.locator('select[name="userid"]').count()) > 0;
    if (isSelect) {
      const users: string[] = await page.evaluate(() => {
        const sel = document.querySelector<HTMLSelectElement>('select[name="userid"]');
        return sel ? [...sel.options].map(o => o.textContent?.trim() ?? '') : [];
      });
      if (!users.includes(this.cfg.user)) {
        throw new Error(
          `User "${this.cfg.user}" not on /join. Available: ${JSON.stringify(users)}`
        );
      }
      // Select the user, force-enabling the option if Foundry disabled it (stale active flag).
      await page.evaluate(label => {
        const sel = document.querySelector('select[name="userid"]') as HTMLSelectElement;
        const opt = [...sel.options].find(o => o.textContent?.trim() === label);
        if (!opt) throw new Error('user option vanished');
        opt.disabled = false;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, this.cfg.user);
    } else {
      await page.fill('input[name="username"]', this.cfg.user);
    }

    if (this.cfg.password) {
      await page.fill('input[name="password"]', this.cfg.password);
    }

    await page.locator('button[name="join"], button[type="submit"]').first().click();

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

  /** Inject the bundled page-side domain library, defining window.__fvtt. */
  private async injectBundle(page: Page): Promise<void> {
    await page.addScriptTag({ content: this.pageBundle });
    const ok = await page.evaluate(
      () => typeof window.__fvtt === 'object' && window.__fvtt !== null
    );
    if (!ok) throw new Error('page bundle injected but window.__fvtt is missing');
  }

  /**
   * The tool seam: invoke a page-side domain function by name.
   * Mirrors the legacy foundryClient.query('foundry-mcp-bridge.X', data) 1:1. A failure is a
   * BridgeError: the page's own words as `detail`, its PageError code (or `connection` when the
   * session was lost under the call) as `code` — see src/bridge-error.ts.
   */
  async call<T = unknown>(name: string, args?: unknown): Promise<T> {
    await this.ensureReady();
    try {
      return await this.invoke<T>(name, args);
    } catch (err) {
      // A world reload / "Return to Setup" can wipe the injected window.__fvtt while the page stays
      // open. Distinguish that (the bridge is gone) from a genuine tool error: if the bridge has
      // vanished, recover once (re-inject in place, or full reconnect if the session itself dropped)
      // and retry — so a mid-session reload self-heals instead of wedging until a process restart.
      if (!(await this.bridgeAlive())) {
        this.log.warn(`page bridge missing on '${name}' — recovering and retrying`);
        await this.recover();
        try {
          return await this.invoke<T>(name, args);
        } catch (err2) {
          throw asCallError(name, err2);
        }
      }
      throw asCallError(name, err);
    }
  }

  /** Single page-side dispatch into the injected window.__fvtt bridge. */
  private async invoke<T>(name: string, args?: unknown): Promise<T> {
    // Capture the page locally: a concurrent call entering recover() can null this.page mid-flight,
    // and `this.page!` would then throw a TypeError on the deref.
    const page = this.page!;
    return (await page.evaluate(
      ({ n, a }) => {
        const fn = window.__fvtt?.[n];
        if (typeof fn !== 'function') throw new Error(`Unknown page function: ${n}`);
        return fn(a);
      },
      { n: name, a: args }
    )) as T;
  }

  /** Is the injected page bridge (window.__fvtt) currently present on a live page? */
  private async bridgeAlive(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    return this.page
      .evaluate(() => typeof window.__fvtt === 'object' && window.__fvtt !== null)
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
    await this.ensureReady();
    const page = this.page!; // capture before any await can null this.page (see invoke()).
    await page.screenshot({ path: outPath, type: 'png' });
  }

  /** Escape hatch for one-off page logic (used sparingly; prefer named page functions). */
  async evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T> {
    await this.ensureReady();
    const page = this.page!; // capture before any await can null this.page (see invoke()).
    // Playwright's PageFunction generic is overly strict here; the escape hatch is rare.
    return page.evaluate(fn as any, arg as any);
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
    this.ready = false;
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = undefined;
    this.browser = undefined;
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
