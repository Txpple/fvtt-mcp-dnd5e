import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The live integration suite has its own config (vitest.integration.config.ts).
    // Keep the default `npm test` fast and fully offline by excluding it here. `scratch/` is
    // gitignored session scratch: a `*.test.ts` left there on one machine must not change the
    // gate's count on that machine. `.claude/worktrees/` holds other sessions' checkouts: run
    // from the main clone, their tests ran too (229 files for 115) and an unmerged one gated main.
    exclude: [
      ...configDefaults.exclude,
      'tests/integration/**',
      'scratch/**',
      '.claude/worktrees/**',
    ],
  },
});
