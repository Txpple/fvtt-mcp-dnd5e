// Node-side output formatters for the placeable CRUD kernel (src/page/_placeables.ts).
//
// The four string renderers every per-type placeable tool would otherwise duplicate, lifted from the
// hand-written Region/Note handlers so a new type's four handlers become one-liners. Pure string/JSON
// shaping — no I/O. `noun` is the singular placeable name (e.g. "tile"), rendered as "N tile(s)".
// A scene that does not resolve is an ERROR (FormattedToolError → isError on the wire), never a
// prose "not found" inside a success-shaped result.

import { FormattedToolError } from './error-handler.js';

function sceneMiss(notFound: string, tail: string): never {
  throw new FormattedToolError(`Scene not found: "${notFound}". ${tail}`);
}

interface CreateResult {
  notFound?: string | undefined;
  sceneId?: string | undefined;
  sceneName?: string | undefined;
  created?: number | undefined;
  items?: Array<Record<string, any>> | undefined;
  errors?: string[] | undefined;
  warnings?: string[] | undefined;
}

interface ListResult {
  found?: boolean | undefined;
  notFound?: string | undefined;
  sceneId?: string | undefined;
  sceneName?: string | undefined;
  sceneActive?: boolean | undefined;
  items?: Array<Record<string, unknown>> | undefined;
}

interface UpdateResult {
  notFound?: string | undefined;
  sceneId?: string | undefined;
  sceneName?: string | undefined;
  matched?: number | undefined;
  updated?: number | undefined;
  notFoundIds?: string[] | undefined;
  warnings?: string[] | undefined;
}

interface DeleteResult {
  notFound?: string | undefined;
  sceneId?: string | undefined;
  sceneName?: string | undefined;
  deleted?: number | undefined;
  notFoundIds?: string[] | undefined;
  warnings?: string[] | undefined;
}

function warningBlock(warnings?: string[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return '';
  return `\n\n⚠️ ${warnings.length} warning(s):\n${warnings.map(w => `- ${w}`).join('\n')}`;
}

/** "Created N tile(s) on "Scene" (id)" + one line per created id, + per-item errors + warnings. */
export function formatCreatePlaceables(r: CreateResult, noun: string): string {
  if (r?.notFound) sceneMiss(r.notFound, `No ${noun}s created.`);
  // Display label: `name` where the type has one, else `text` (a Note pin's label lives there).
  const lines = Array.isArray(r?.items)
    ? r.items
        .map(it => {
          const label = it.name ?? it.text;
          return `\n  • ${it.id}${label ? ` — ${label}` : ''}`;
        })
        .join('')
    : '';
  const errs = Array.isArray(r?.errors) ? r.errors.map(e => `\n  ⚠ ${e}`).join('') : '';
  return (
    `Created ${r?.created ?? 0} ${noun}(s) on "${r?.sceneName}" (${r?.sceneId})` +
    lines +
    errs +
    warningBlock(r?.warnings)
  );
}

/**
 * List: one line per placeable under a header naming the scene and the column order — the
 * design.md §3 list shape (decision #10: line records are ~40% smaller than the same fields as
 * JSON). Columns are the descriptor's dump fields in its order, `id` first; a field only some
 * records carry (a tile's `name`, a wall's `doorSound`) is a column too, `-` where absent.
 *
 *   3 tile(s) on "Cave" (sc1) [active]: id x y width height rotation …
 *   tileA 100 100 200 200 0 …
 */
export function formatListPlaceableLines(r: ListResult, noun: string): string {
  if (r?.found === false) sceneMiss(r?.notFound ?? '', `No ${noun}s listed.`);
  const items = Array.isArray(r?.items) ? r.items : [];
  const active = r?.sceneActive ? ' [active]' : '';
  const head = `${items.length} ${noun}(s) on "${r?.sceneName}" (${r?.sceneId})${active}`;
  if (items.length === 0) return `${head}.`;
  const columns = ['id'];
  for (const it of items) {
    for (const key of Object.keys(it)) if (!columns.includes(key)) columns.push(key);
  }
  const rows = items.map(it => columns.map(c => cell(it[c])).join(' '));
  return `${head}: ${columns.join(' ')}\n${rows.join('\n')}`;
}

/**
 * Pre-M8 list: the structured result straight through (ids + fields as JSON), or a scene miss.
 * The kinds still on their per-op tools (sounds, tokens, notes, regions) keep this until their
 * family commit moves them to the line shape above; it goes with the last of them.
 */
export function formatListPlaceables(r: ListResult, noun: string): unknown {
  if (r?.found === false) sceneMiss(r?.notFound ?? '', `No ${noun}s listed.`);
  return r;
}

/** One cell of a list line: `-` for a missing value, a bare token where it can be, JSON otherwise. */
function cell(v: unknown): string {
  if (v === undefined || v === null) return '-';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v !== '' && !/\s/.test(v) ? v : JSON.stringify(v);
  if (Array.isArray(v) && v.every(x => typeof x === 'number')) return v.join(',');
  return JSON.stringify(v);
}

/** "Updated N of M matched tile(s) on "Scene" (id)" + unresolved ids + warnings. */
export function formatUpdatePlaceables(r: UpdateResult, noun: string): string {
  if (r?.notFound) sceneMiss(r.notFound, 'Nothing changed.');
  const missing =
    Array.isArray(r?.notFoundIds) && r.notFoundIds.length > 0
      ? `\n  (not found: ${r.notFoundIds.join(', ')})`
      : '';
  if ((r?.matched ?? 0) === 0) {
    return `No ${noun}s matched on "${r?.sceneName}" (${r?.sceneId})${missing}.`;
  }
  return (
    `Updated ${r?.updated ?? 0} of ${r?.matched ?? 0} matched ${noun}(s) on ` +
    `"${r?.sceneName}" (${r?.sceneId})` +
    missing +
    warningBlock(r?.warnings)
  );
}

/** "Deleted N tile(s) from "Scene" (id)" + a not-found-ids tail + integrity warnings. */
export function formatDeletePlaceables(r: DeleteResult, noun: string): string {
  if (r?.notFound) sceneMiss(r.notFound, 'Nothing deleted.');
  const missing =
    Array.isArray(r?.notFoundIds) && r.notFoundIds.length > 0
      ? ` (${r.notFoundIds.length} id(s) not found: ${r.notFoundIds.join(', ')})`
      : '';
  return (
    `Deleted ${r?.deleted ?? 0} ${noun}(s) from "${r?.sceneName}" (${r?.sceneId})${missing}.` +
    warningBlock(r?.warnings)
  );
}
