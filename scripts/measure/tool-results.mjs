// Measure what a client actually RECEIVES per tool call — the bytes of tools/call results over the
// real stdio server (dist/index.js), after the response cap — for a curated set of read-only tools.
// This is the number that costs context in Claude Code (where tool schemas are deferred and the
// results are the bulk of what an MCP puts into the conversation).
//
//   FOUNDRY_HOST=local node scripts/measure/tool-results.mjs [--json out.json] [--bodies dir]
//
// --bodies writes each call's full result text to <dir>/<tool>[.<n>].txt so the SHAPE of what a
// client receives can be read, not just its size (which fields a list returns, where a cap cuts).
//
// Read-only: nothing is created or changed in the world. The bridge connects once (first call).
// Prints a table (tool · args · chars · ~tokens · truncated?) sorted by size, plus the tools/list
// size for the same registration, so a review can put both numbers side by side.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', '..', 'dist', 'index.js');
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;
const bodiesDir = process.argv.includes('--bodies')
  ? process.argv[process.argv.indexOf('--bodies') + 1]
  : null;
if (bodiesDir) mkdirSync(bodiesDir, { recursive: true });
const bodyNames = new Map();

// The read set. Args are the minimal, typical call a skill would make.
const CALLS = [
  ['get-world-info', {}],
  ['get-current-scene', {}],
  ['manage-scenes', { action: 'list' }],
  ['manage-actors', { action: 'list' }],
  ['manage-actors', { action: 'list', type: 'npc' }],
  ['manage-items', { action: 'list' }],
  ['manage-journals', { action: 'list' }],
  ['manage-rolltables', { action: 'list' }],
  ['manage-playlists', { action: 'list' }],
  ['manage-folders', { action: 'list' }],
  ['list-users', {}],
  ['list-compendium-packs', {}],
  ['search-compendium', { query: 'sword' }],
  ['search-compendium-creatures', { name: 'goblin' }],
  ['search-compendium-spells', { name: 'fire' }],
  ['list-chat-messages', { limit: 50 }],
  ['manage-placeables', { kind: 'tokens', action: 'list' }],
  ['manage-placeables', { kind: 'walls', action: 'list' }],
  ['manage-placeables', { kind: 'lights', action: 'list' }],
  ['manage-placeables', { kind: 'regions', action: 'list' }],
  ['manage-placeables', { kind: 'notes', action: 'list' }],
  ['list-actor-ownership', {}],
  ['manage-cards', { action: 'list' }],
  ['manage-macros', { action: 'list' }],
];

const child = spawn(process.execPath, [SERVER], {
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let buf = '';
child.stdout.on('data', d => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* not JSON */
    }
  }
});
child.stderr.on('data', () => {});
let nextId = 1;
function send(method, params, timeoutMs = 600_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, msg => {
      clearTimeout(t);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
const tokens = n => Math.round(n / 3.6);

try {
  await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'measure/tool-results', version: '0' },
  });
  const list = await send('tools/list', {});
  const tools = list.result?.tools ?? [];
  const listBytes = JSON.stringify(tools).length;
  const byName = new Map(tools.map(t => [t.name, t]));

  const rows = [];
  for (const [name, args] of CALLS) {
    // Fill required args we don't know with the scene when the schema wants one — list-* placeables
    // take the active scene by default, so no arg is the typical call.
    const t0 = Date.now();
    let res;
    try {
      res = await send('tools/call', { name, arguments: args });
    } catch (e) {
      rows.push({ name, args, error: e.message });
      continue;
    }
    const ms = Date.now() - t0;
    const text = res.result?.content?.[0]?.text ?? '';
    const isError = res.result?.isError === true || !!res.error;
    const truncated = /response exceeded toolResponseMaxChars/.test(text);
    const schemaBytes = JSON.stringify(byName.get(name)?.inputSchema ?? {}).length;
    if (bodiesDir) {
      const n = (bodyNames.get(name) ?? 0) + 1;
      bodyNames.set(name, n);
      writeFileSync(join(bodiesDir, `${name}${n > 1 ? `.${n}` : ''}.txt`), text);
    }
    rows.push({
      name,
      args,
      chars: text.length,
      tokens: tokens(text.length),
      truncated,
      isError,
      ms,
      schemaBytes,
    });
  }

  rows.sort((a, b) => (b.chars ?? 0) - (a.chars ?? 0));
  console.log(
    `tools/list for this registration: ${tools.length} tools, ${listBytes} chars ≈ ${tokens(listBytes)} tokens\n`
  );
  console.log(
    'tool                            args                       chars   ~tokens  trunc  err   ms  schema-chars'
  );
  for (const r of rows) {
    if (r.error) {
      console.log(
        `${r.name.padEnd(31)} ${JSON.stringify(r.args).padEnd(26)} ${'—'.padStart(7)}  ${r.error}`
      );
      continue;
    }
    console.log(
      `${r.name.padEnd(31)} ${JSON.stringify(r.args).padEnd(26)} ${String(r.chars).padStart(7)} ${String(r.tokens).padStart(8)}  ${r.truncated ? 'YES' : '   '}   ${r.isError ? 'ERR' : '   '} ${String(r.ms).padStart(5)}  ${String(r.schemaBytes).padStart(6)}`
    );
  }
  const total = rows.reduce((n, r) => n + (r.chars ?? 0), 0);
  console.log(
    `\n${rows.length} calls, ${total} chars ≈ ${tokens(total)} tokens of results in total`
  );
  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          toolsList: { count: tools.length, chars: listBytes },
          rows,
        },
        null,
        2
      )
    );
    console.log(`written ${jsonOut}`);
  }
} finally {
  try {
    await send('tools/call', { name: 'disconnect-bridge', arguments: {} }, 30_000);
  } catch {
    /* best effort */
  }
  child.stdin.end();
  setTimeout(() => child.kill(), 2_000).unref();
}
