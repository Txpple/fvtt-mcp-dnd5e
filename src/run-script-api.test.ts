// The run-script reference is public: every `fvtt.*` function a script may call, generated from the
// page API (src/page/index.ts) by scripts/measure/run-script-api.mjs. A page op added, renamed or
// re-shaped without regenerating it leaves the reference describing a surface that is not there,
// so the gate holds the file to the program: `npm run api-doc` rewrites it.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'measure', 'run-script-api.mjs');

describe('docs/run-script-api.md', () => {
  it('is current with the page API (npm run api-doc regenerates it)', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(run.status, `${run.stderr}${run.stdout}`.trim()).toBe(0);
  }, 120_000);
});
