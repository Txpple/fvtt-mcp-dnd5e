// Uninstall modules from the Foundry server — the mirror of register-module.mjs.
//
//   FOUNDRY_HOST=molten node scripts/uninstall-modules.mjs --ids some-module,another-module
//
// DISABLE THEM IN THE WORLD FIRST (configure-modules.mjs). Uninstalling a module a world still
// has enabled leaves that world booting against a missing package.
//
// IRREVERSIBLE for hand-patched files: this deletes the module directory, so any local patch to a
// vendored module goes with it. Keep such patches in the notes repo before running this.
//
// Why this exists (learned live 2026-08-07): on this box Foundry scans Data/modules at server
// PROCESS start only — WebDAV-dropping a new module + world shutDown/relaunch never registers
// it (two live attempts). The Molten panel Restart is UI-only. The sanctioned lever is
// Foundry's /setup POST {action:'installPackage'} — what the UI "Install Module" button does —
// which downloads from our GitHub manifest, extracts into Data/modules (overwriting the
// identical WebDAV copy), and updates the live package cache.
//
// HARD-WON HANG LESSON baked in here: do NOT call game.shutDown() through the bridge
// (dist/foundry.js) — its self-healing evaluate wrapper tries to recover the world you are
// deliberately killing and never settles (three multi-hour hangs on 2026-08-07). This script
// is pure Playwright: admin /setup -> shutdownWorld -> installPackage -> launchWorld, every
// remote call raced against a timeout, plus a process-level watchdog. Leaves the world UP.
//
// Run FOREGROUND.
import { chromium } from 'playwright';
import { loadEnv } from '../dist/env.js';
import { hostKindFromEnv, resolveHostConfig } from '../dist/hosts/index.js';

const env = loadEnv();
const HOST = resolveHostConfig(env, hostKindFromEnv(process.env));

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const IDS = (arg('ids') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
if (!IDS.length) {
  console.error('usage: node scripts/uninstall-modules.mjs --ids <module-id>[,<module-id>…]');
  process.exit(2);
}
if (!HOST.adminKey) {
  console.error('FOUNDRY_ADMIN_KEY is not set — the /setup package installer is admin-gated');
  process.exit(2);
}
const BASE = HOST.serverUrl.replace(/\/$/, '');
console.log(`[uninstall] target: ${HOST.kind} (${BASE})`);
console.log(`[register] uninstalling: ${IDS.join(', ')}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * The world to launch: FOUNDRY_WORLD_ID, else the ONE world the authenticated /setup lists
 * (several = a refusal naming them) — the bridge's own rule (src/foundry.ts discoverWorld).
 */
async function worldToLaunch(page, tag) {
  if (HOST.worldId) return HOST.worldId;
  const ids = await page
    .evaluate(() => {
      const fromApi = globalThis.game?.worlds
        ? [...globalThis.game.worlds].map(w => w.id ?? '').filter(Boolean)
        : [];
      if (fromApi.length) return fromApi;
      return [
        ...document.querySelectorAll(
          '#worlds-list li[data-package-id], [data-package-type="world"] li[data-package-id]'
        ),
      ]
        .map(li => li.dataset.packageId ?? '')
        .filter(Boolean);
    })
    .catch(() => []);
  if (ids.length === 1) {
    console.log(`[${tag}] world discovered on /setup: ${ids[0]}`);
    return ids[0];
  }
  throw new Error(
    ids.length
      ? `/setup lists ${ids.length} worlds (${ids.join(', ')}) — set FOUNDRY_WORLD_ID`
      : 'no world found on /setup — create one, or set FOUNDRY_WORLD_ID'
  );
}

// Nothing in this script may run past 4 minutes, ever.
setTimeout(() => {
  console.error('[register] WATCHDOG: 240s elapsed — hard abort');
  process.exit(3);
}, 240_000);

async function joinState() {
  try {
    const res = await fetch(`${BASE}/join`, { redirect: 'manual' });
    if (res.status >= 300) return 'redirect';
    const text = await res.text();
    if (/no active game session|Critical Failure/i.test(text)) return 'no-world';
    return 'world';
  } catch {
    return 'unreachable';
  }
}

/** Evaluate a Setup post in the page, raced against a timeout so it can never wedge us. */
async function setupPost(page, body, label, timeoutMs = 30_000) {
  const result = await page.evaluate(
    async ({ body, timeoutMs }) => {
      const timeout = new Promise(r =>
        setTimeout(() => r({ ok: false, error: 'in-page timeout' }), timeoutMs)
      );
      const post = (async () => {
        try {
          const res = await globalThis.game.post(body);
          return {
            ok: true,
            res: (() => {
              try {
                return JSON.stringify(res).slice(0, 300);
              } catch {
                return String(res);
              }
            })(),
          };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      })();
      return Promise.race([post, timeout]);
    },
    { body, timeoutMs }
  );
  console.log(`[register] ${label}:`, JSON.stringify(result));
  return result;
}

/**
 * Get to an authenticated /setup page. Two live states (v14.364, probed 2026-08-07):
 *  - world ACTIVE: /setup redirects to /join, which carries a "Return to Setup" admin form
 *    (#join-game-setup: input[name=adminPassword] + unnamed submit button). Submitting it
 *    authenticates AND shuts the world down in one supported step.
 *  - world IDLE: /setup -> /auth with its own adminPassword form.
 */
async function ensureSetup(page) {
  await page.goto(`${BASE}/setup`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector(
    '#join-game-setup input[name="adminPassword"], input[name="adminPassword"]',
    { timeout: 60_000 }
  );
  const viaJoin = await page.$('#join-game-setup input[name="adminPassword"]');
  if (viaJoin) {
    console.log('[register] world active — submitting the join page "Return to Setup" form');
    await viaJoin.fill(HOST.adminKey);
    await page.click('#join-game-setup button[type="submit"]');
    // v14 pops a confirm dialog when other users are connected ("… will be disconnected.
    // Do you wish to proceed? Yes/No") — answer Yes.
    const confirmed = await page
      .waitForFunction(
        () => {
          const btn = [...document.querySelectorAll('dialog button')].find(
            b => b.textContent.trim().toLowerCase() === 'yes'
          );
          if (btn) {
            btn.click();
            return 'clicked';
          }
          return false;
        },
        null,
        { timeout: 15_000 }
      )
      .catch(() => null);
    console.log(
      `[register] disconnect-confirm dialog: ${confirmed ? 'answered Yes' : 'did not appear'}`
    );
  } else {
    console.log('[register] idle auth form — logging in');
    await page.fill('input[name="adminPassword"]', HOST.adminKey);
    await page.click(
      'button[name="action"], form:has(input[name="adminPassword"]) button[type="submit"]'
    );
  }
  await page.waitForURL(/\/setup/, { timeout: 90_000 });
  await page.waitForFunction(() => typeof globalThis.game?.post === 'function', null, {
    timeout: 45_000,
  });
}

const browser = await chromium.launch();
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', msg => {
    const t = msg.text();
    if (/error|install|package|progress|vend/i.test(t)) console.log(`  [page] ${t.slice(0, 200)}`);
  });

  console.log(`[register] initial state: ${await joinState()}`);
  console.log('[register] authenticating to /setup…');
  await ensureSetup(page);
  console.log('[register] on /setup as admin');

  // --- 1. world down: the Return-to-Setup submit in ensureSetup already did it when the world
  // was active; belt-and-suspenders check that we really are idle before posting.
  {
    let state = await joinState();
    for (let i = 0; i < 10 && state === 'world'; i++) {
      await sleep(3000);
      state = await joinState();
    }
    console.log(`[register] pre-install state: ${state}`);
    if (state === 'world') throw new Error('world still active after Return to Setup');
  }

  // --- 2. uninstallPackage ---------------------------------------------------------------------
  for (const id of IDS) {
    const r = await setupPost(
      page,
      { action: 'uninstallPackage', type: 'module', id },
      `uninstallPackage ${id}`,
      60_000
    );
    if (!r.ok) throw new Error(`uninstallPackage ${id} failed: ${r.error}`);
    await sleep(3000);
  }
  await sleep(5000); // let the package cache settle before relaunching

  // --- 3. relaunch the world -------------------------------------------------------------------
  const launch = await setupPost(
    page,
    { action: 'launchWorld', world: await worldToLaunch(page, 'uninstall') },
    'launchWorld'
  );
  if (!launch.ok) throw new Error(`launchWorld failed: ${launch.error}`);

  console.log('[register] waiting for /join form…');
  await page.goto(`${BASE}/join`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('select[name="userid"], input[name="username"]', {
    timeout: 150_000,
  });
  console.log('[register] world is up and joinable');
  ok = true;
} catch (e) {
  console.error('[register] ERROR:', e?.message || e);
} finally {
  await browser.close();
  console.log(ok ? '[register] RESULT: PASS' : '[register] RESULT: FAIL');
  process.exit(ok ? 0 : 1);
}
