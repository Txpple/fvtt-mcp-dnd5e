// A replay driver: run the bridge's built server (dist/index.js) as a FRESH stdio process, call
// one tool, print its text result, exit. The registered bridge server reads .env once at
// start, so a replay that must point elsewhere (a scratch clone of the campaign repo, another
// host) sets the variables in this process's environment and they reach the child; `dotenv`
// never overrides a variable that is already set.
//
//   node scripts/call.mjs <tool> [<json args> | @args.json]
//   FVTT_MCP_ENV=.env.prod FOUNDRY_HOST=generic node scripts/call.mjs get-world-info
//
// Needs `npm run build`. A tool error exits 1. Long jobs (fetch, transcribe) return at once as
// jobs; follow them with scribe-status { date, waitSeconds }.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(repoRoot, 'dist', 'index.js');

const [tool, spec = '{}'] = process.argv.slice(2);
if (!tool) {
  console.error('usage: node scripts/call.mjs <tool> [<json args> | @args.json]');
  process.exit(2);
}
if (!fs.existsSync(server)) {
  console.error(`${server} missing: run npm run build first`);
  process.exit(2);
}
let args;
try {
  args = JSON.parse(spec.startsWith('@') ? fs.readFileSync(spec.slice(1), 'utf8') : spec);
} catch (e) {
  console.error(`the arguments are not JSON: ${e.message}`);
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'bridge-call', version: '0.0.0' });
await client.connect(transport);
try {
  const res = await client.callTool({ name: tool, arguments: args }, undefined, {
    timeout: 1_800_000,
  });
  for (const c of res.content ?? []) {
    if (c.type === 'text') console.log(c.text);
    else console.log(`[${c.type}${c.mimeType ? ` ${c.mimeType}` : ''}]`);
  }
  if (res.isError) process.exitCode = 1;
} finally {
  await client.close();
}
