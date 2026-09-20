// Registers a resolve hook that swaps dist/utils/schema.js for our recording shim.
import { register } from 'node:module';
register('./perf-schema-hook.mjs', import.meta.url);
