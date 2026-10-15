import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The live integration suite has its own config (vitest.integration.config.ts).
    // Keep the default `npm test` fast and fully offline by excluding it here. `scratch/` is
    // gitignored session scratch: a `*.test.ts` left there on one machine must not change the
    // gate's count on that machine.
    exclude: [...configDefaults.exclude, 'tests/integration/**', 'scratch/**'],
  },
});
