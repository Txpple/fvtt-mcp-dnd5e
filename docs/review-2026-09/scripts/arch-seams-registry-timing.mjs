// arch-seams: how much does buildToolRegistry cost (schema generation for 151 tools), and is it
// per-session? Also: tools/list payload size from the derived list; dispatch overhead per call.
import { performance } from 'node:perf_hooks';
import { buildToolRegistry } from '../dist/registry.js';
import { createHost, resolveHostConfig } from '../dist/hosts/index.js';
import { Logger } from '../dist/logger.js';

const logger = new Logger({ level: 'error', format: 'simple', enableConsole: false, enableFile: false });
const host = createHost(resolveHostConfig({}, 'generic'), logger);
const calls = [];
const foundry = {
  call: async (name, args) => { calls.push([name, args]); return { system: 'dnd5e', ok: true }; },
  screenshot: async () => {},
  isReady: () => true,
  dispose: async () => {},
};

const t0 = performance.now();
const reg = buildToolRegistry({ foundry, logger, host });
const t1 = performance.now();
console.log(`buildToolRegistry: ${reg.tools.length} tools in ${(t1 - t0).toFixed(1)} ms (once per process; tools/list returns the same array each time)`);
const json = JSON.stringify(reg.tools);
console.log(`tools/list JSON: ${json.length} chars`);
// is the same array object returned? (index.ts:80 closes over `tools`)
console.log('tools array identity stable across builds within one registry:', reg.tools === reg.tools);
// dispatch overhead for an enabled tool with a trivial mock
const N = 2000;
const t2 = performance.now();
for (let i = 0; i < N; i++) await reg.dispatch('get-world-info', {});
const t3 = performance.now();
console.log(`dispatch('get-world-info') x${N}: ${((t3 - t2) / N * 1000).toFixed(1)} us/call incl. zod parse + mock seam`);
// generic host: what do the plane tools answer?
for (const tool of ['list-assets', 'upload-asset', 'asset-url']) {
  const args = tool === 'upload-asset' ? { localPath: 'x.png', remotePath: 'assets/x.png' } : { remotePath: 'assets/x.png' };
  try { console.log(`${tool} on generic →`, String(await reg.dispatch(tool, args)).slice(0, 160)); }
  catch (e) { console.log(`${tool} on generic → threw:`, e.message.slice(0, 160)); }
}
