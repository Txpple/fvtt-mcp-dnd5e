export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (/dist[\/]utils[\/]schema\.js$/.test(r.url) && !r.url.includes('?real')) {
    return { ...r, url: new URL('./perf-schema-schema-shim.mjs', import.meta.url).href };
  }
  return r;
}
