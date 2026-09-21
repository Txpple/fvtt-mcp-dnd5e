// Shared helper for the perf-schema scratch scripts: build the advertised tool list offline from
// dist/ exactly as index.ts does (buildToolRegistry over a generic host + a fake bridge), so the
// measured payload is the same object the server hands to tools/list.
import { buildToolRegistry } from '../dist/registry.js';
import { createHost, resolveHostConfig } from '../dist/hosts/index.js';

export function makeLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {} };
  l.child = () => l;
  return l;
}
export function makeFoundry() {
  return {
    call: async () => ({}),
    screenshot: async () => {},
    isReady: () => true,
    dispose: async () => {},
  };
}
export function buildTools(toolsets = []) {
  const host = createHost(resolveHostConfig({}, 'generic'), makeLogger());
  const reg = buildToolRegistry({ foundry: makeFoundry(), logger: makeLogger(), host, toolsets });
  return reg;
}
export const bytes = v => JSON.stringify(v).length;
export const tokens = n => Math.round(n / 3.6);
