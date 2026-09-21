// Loader hook: redirect dist/utils/schema.js to the capturing shim (read-only research; no tracked file changes).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const target = pathToFileURL(path.resolve('dist/utils/schema.js')).href;
const shim = pathToFileURL(path.resolve('scratch/research-zod-shim.mjs')).href;
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url === target) return { ...r, url: shim, shortCircuit: true };
  return r;
}
