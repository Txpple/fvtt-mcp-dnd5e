// Acceptance for FOUNDRY_TOOLSETS over the REAL stdio server (dist/index.js), no world needed:
// tools/list never touches Foundry, and a call outside the enabled set is refused by the registry
// before the bridge is consulted. Spawns the server three times — unset, a selection, a bad name —
// and speaks JSON-RPC to it.
//
//   node scripts/verify-toolsets.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'dist', 'index.js');

let pass = 0;
let fail = 0;
function check(cond, label, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Spawn the server with extra env, send JSON-RPC requests, collect responses by id. */
function rpc(env, requests, { timeoutMs = 15_000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let stderr = '';
    let buf = '';
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.stdout.on('data', d => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses.set(msg.id, msg);
        } catch {
          /* not JSON — ignore */
        }
      }
    });
    const finish = code => {
      clearTimeout(timer);
      resolve({ responses, stderr, code });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish('timeout');
    }, timeoutMs);
    child.on('exit', finish);
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    // Give the server a moment to answer, then close stdin (the server exits on stdin end).
    setTimeout(() => child.stdin.end(), 4_000);
  });
}

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verify-toolsets', version: '0' },
  },
};
const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const callScene = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'create-scene', arguments: { name: 'ZZ-never' } },
};

console.log('[1] FOUNDRY_TOOLSETS unset → the whole surface');
{
  const { responses } = await rpc({ FOUNDRY_TOOLSETS: '' }, [init, list]);
  const tools = responses.get(2)?.result?.tools ?? [];
  check(tools.length === 151, `tools/list advertises 151 tools`, `got ${tools.length}`);
  const bytes = JSON.stringify(tools).length;
  console.log(`      (tools/list payload: ${bytes} chars ≈ ${Math.round(bytes / 3.6)} tokens)`);
}

console.log(
  '[2] FOUNDRY_TOOLSETS=chat,combat → those + world; an out-of-set call is refused by name'
);
{
  const { responses } = await rpc({ FOUNDRY_TOOLSETS: 'chat,combat' }, [init, list, callScene]);
  const tools = responses.get(2)?.result?.tools ?? [];
  const names = tools.map(t => t.name);
  check(names.includes('get-world-info'), 'world is always advertised');
  check(
    names.includes('send-chat-message') && names.includes('get-combat-stats'),
    'the selected toolsets are advertised'
  );
  check(!names.includes('create-scene') && !names.includes('get-actor'), 'the others are not');
  const bytes = JSON.stringify(tools).length;
  console.log(
    `      (${tools.length} tools; tools/list payload: ${bytes} chars ≈ ${Math.round(bytes / 3.6)} tokens)`
  );
  const call = responses.get(3)?.result;
  const text = call?.content?.[0]?.text ?? '';
  check(
    call?.isError === true && /"create-scene" is in the "scenes" toolset/.test(text),
    'tools/call create-scene → refused by name (no bridge connect)',
    text.slice(0, 160)
  );
  check(
    /FOUNDRY_TOOLSETS=world,chat,combat/.test(text),
    'the refusal names the enabled set',
    text.slice(0, 160)
  );
}

console.log(
  '[3] FOUNDRY_TOOLSETS=sceens (typo) → the server refuses to start, naming the valid sets'
);
{
  const { responses, stderr, code } = await rpc({ FOUNDRY_TOOLSETS: 'sceens' }, [init, list]);
  check(!responses.get(2)?.result, 'no tools/list answer');
  check(
    /"sceens" is not a toolset \(one of: world, actors/.test(stderr),
    'startup error names the valid toolsets',
    stderr.slice(0, 200)
  );
  check(code !== 0, `exit code ${code}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
