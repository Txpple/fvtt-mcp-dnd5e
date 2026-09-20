// Shared by the offline measurement scripts: build the advertised tool list from dist/ exactly as
// the server does (buildToolRegistry over a generic host + a bridge that is never called), so the
// measured payload is the same object the server hands to tools/list. The measurement primitives
// themselves live in src/measure.ts (one implementation for these scripts and src/measure.test.ts).
//
// Run `npm run build` first — everything here imports from dist/.
import { createHost, resolveHostConfig } from '../../dist/hosts/index.js';
import { buildToolRegistry } from '../../dist/registry.js';

export * from '../../dist/measure.js';

function makeLogger() {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  logger.child = () => logger;
  return logger;
}

const offlineBridge = {
  call: async () => {
    throw new Error('offline: the measurement scripts never call the bridge');
  },
  screenshot: async () => {},
  isReady: () => false,
  dispose: async () => {},
};

/** The registry for a registration advertising `toolsets` (empty = the whole surface). */
export function buildRegistry(toolsets = []) {
  const host = createHost(resolveHostConfig({}, 'generic'), makeLogger());
  return buildToolRegistry({ foundry: offlineBridge, logger: makeLogger(), host, toolsets });
}

/** `--flag value` from argv, or `fallback`. */
export function argValue(flag, fallback = null) {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

export const fmt = n => n.toLocaleString('en-US');
export const pct = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;
