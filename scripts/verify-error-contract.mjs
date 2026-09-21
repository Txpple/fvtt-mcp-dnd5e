// Live proof of the error contract (3.0 M6, F5): a page-side PageError's CODE rides in the
// Error's `name`, survives Playwright's `page.evaluate` as the head of the message, and comes back
// as a BridgeError with `code` / `detail`; the dispatch mapper appends one hint per code and never
// classifies by substring; a lost session is `connection`. Infrastructure proof, read-only — it
// creates nothing in the world.
//
// Build first: npm run build. Run: FOUNDRY_HOST=local node scripts/verify-error-contract.mjs
import { BridgeError, Foundry, Logger } from '../dist/client.js';
import { buildToolRegistry } from '../dist/registry.js';
import { loadEnv } from '../dist/env.js';
import { ErrorHandler, HINTS } from '../dist/utils/error-handler.js';
import { bridgeConfig } from './lib/bridge-config.mjs';

const env = loadEnv();
const cfg = bridgeConfig(env);
const foundry = new Foundry(cfg);
const logger = new Logger({
  level: 'error',
  format: 'simple',
  enableConsole: false,
  enableFile: false,
});

const results = [];
const pass = (n, s) => {
  results.push({ n, ok: true });
  console.log(`PASS  ${n}${s ? ` -> ${s}` : ''}`);
};
const fail = (n, e) => {
  results.push({ n, ok: false });
  console.log(`FAIL  ${n} -> ${e}`);
};
const check = (n, ok, s) => (ok ? pass(n, s) : fail(n, s));
const thrown = async fn => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

try {
  await foundry.connect();

  // ── 1. The channel itself: what Playwright hands Node for a named in-page throw ──
  {
    const raw = await thrown(() =>
      foundry.evaluate(() => {
        const e = new Error('probe not-found');
        e.name = 'PageError:not-found';
        throw e;
      }, null)
    );
    const head = String(raw?.message ?? '').split('\n')[0];
    check(
      'a page-side name reaches Node at the head of the message',
      head === 'page.evaluate: PageError:not-found: probe not-found',
      JSON.stringify(head)
    );
    check(
      'a custom property does NOT cross the seam (the name is the only channel)',
      raw?.code === undefined && raw?.name !== 'PageError:not-found',
      `node-side name=${raw?.name} code=${raw?.code}`
    );
    const te = await thrown(() =>
      foundry.evaluate(() => {
        throw new TypeError('probe type error');
      }, null)
    );
    check(
      "Foundry's own error names arrive the same way (TypeError: …)",
      String(te?.message ?? '').startsWith('page.evaluate: TypeError: probe type error'),
      JSON.stringify(String(te?.message ?? '').split('\n')[0])
    );
  }

  // ── 2. Coded page throws through foundry.call → BridgeError ──
  {
    const e = await thrown(() =>
      foundry.call('getCharacterInfo', { characterName: 'ZZ-nobody-m6' })
    );
    check(
      'not-found: a missing actor is a BridgeError with code + the page words',
      e instanceof BridgeError &&
        e.code === 'not-found' &&
        e.detail === 'Character not found: ZZ-nobody-m6',
      `${e?.name} code=${e?.code} detail=${JSON.stringify(e?.detail)}`
    );
    check(
      'the message keeps the 2.x shape without the plumbing',
      e?.message === "foundry.call('getCharacterInfo') failed: Character not found: ZZ-nobody-m6" &&
        !/page\.evaluate|\n/.test(e?.message ?? ''),
      JSON.stringify(e?.message)
    );
    check(
      'the in-page stack rides on pageStack, not the message',
      /at /.test(e?.pageStack ?? ''),
      `pageStack=${(e?.pageStack ?? '').split('\n')[0]}`
    );
    const inv = await thrown(() => foundry.call('getCharacterInfo', {}));
    check(
      'invalid: a missing argument',
      inv?.code === 'invalid' && inv?.detail === 'characterName or characterId is required',
      `code=${inv?.code} detail=${JSON.stringify(inv?.detail)}`
    );
    const dim = await thrown(() => foundry.call('getSceneDimensions', {}));
    check(
      'invalid: sceneIdentifier is required',
      dim?.code === 'invalid',
      `code=${dim?.code} detail=${JSON.stringify(dim?.detail)}`
    );
    const pack = await thrown(() =>
      foundry.call('getCompendiumDocumentFull', { packId: 'zz.nope', itemId: 'x' })
    );
    check(
      'not-found: a missing pack',
      pack?.code === 'not-found',
      `code=${pack?.code} detail=${JSON.stringify(pack?.detail)}`
    );
    const act = await thrown(() =>
      foundry.call('manageActivity', { itemIdentifier: 'ZZ-no-such-item-m6', action: 'list' })
    );
    check(
      'not-found: a missing world item',
      act?.code === 'not-found',
      `code=${act?.code} detail=${JSON.stringify(act?.detail)}`
    );
    const cal = await thrown(() => foundry.call('manageCalendar', { action: 'bogus' }));
    check(
      'invalid: an unknown action',
      cal?.code === 'invalid',
      `code=${cal?.code} detail=${JSON.stringify(cal?.detail)}`
    );
  }

  // ── 3. Through the MCP dispatch + mapper: what the model reads ──
  {
    const { dispatch } = buildToolRegistry({ foundry, logger, host: cfg.host });
    const eh = new ErrorHandler(logger);
    const e = await thrown(() => dispatch('get-actor', { identifier: 'ZZ-nobody-m6' }));
    const msg = e ? eh.toUserMessage(e, 'get-actor') : '(no error)';
    check(
      'get-actor on a missing actor: the page words, then [not-found] and its hint',
      msg.startsWith('Character not found: ZZ-nobody-m6 [not-found] ') &&
        msg.endsWith(HINTS['not-found']),
      JSON.stringify(msg)
    );
    const e2 = await thrown(() => dispatch('manage-calendar', { action: 'set' }));
    const msg2 = e2 ? eh.toUserMessage(e2, 'manage-calendar') : '(no error)';
    check(
      'manage-calendar set with nothing to set: [invalid] + hint',
      /\[invalid\] /.test(msg2),
      JSON.stringify(msg2)
    );
  }

  await foundry.dispose();

  // ── 4. The connection code: a bridge that never reaches a joinable world ──
  {
    const dead = new Foundry(
      { ...cfg, serverUrl: 'http://127.0.0.1:9', wakeTimeoutMs: 1000, readyTimeoutMs: 5000 },
      { debug() {}, info() {}, warn() {}, error() {} }
    );
    const t0 = Date.now();
    const e = await thrown(() => dead.call('getWorldInfo'));
    await dead.dispose();
    check(
      'a dead URL is a BridgeError with code connection',
      e instanceof BridgeError && e.code === 'connection' && e.fn === undefined,
      `${e?.name} code=${e?.code} in ${Date.now() - t0} ms: ${String(e?.detail).slice(0, 90)}`
    );
    const eh = new ErrorHandler(logger);
    check(
      '…and the model reads the wake / launch hint',
      e && eh.toUserMessage(e, 'get-world-info').endsWith(HINTS.connection)
    );
  }
} finally {
  await foundry.dispose().catch(() => {});
  const ok = results.filter(r => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  process.exitCode = ok === results.length ? 0 : 1;
}
