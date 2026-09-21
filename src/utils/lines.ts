// The design.md §3 result shapes, shared by every consolidated family (M8 of the 3.0 plan):
//
//   - a LIST is one line per record under a header naming the count and the column order
//     (decision #10: line records are ~40% smaller than the same fields as JSON) —
//         3 macro(s): id name type author pins
//         m1 Graze script Claude 1
//     an empty list is the header alone (`0 macro(s).`);
//   - a MUTATION is a one-line confirmation plus a warning block.
//
// Pure string shaping — no I/O.

/** `<head>: col col …` then one row per record; `<head>.` when there are none. */
export function listLines(
  head: string,
  columns: readonly string[],
  records: ReadonlyArray<Record<string, unknown>>
): string {
  if (records.length === 0) return `${head}.`;
  const rows = records.map(r => columns.map(c => cell(r[c])).join(' '));
  return `${head}: ${columns.join(' ')}\n${rows.join('\n')}`;
}

/** One cell of a list line: `-` for a missing value, a bare token where it can be, JSON otherwise. */
export function cell(v: unknown): string {
  if (v === undefined || v === null) return '-';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v !== '' && !/\s/.test(v) ? v : JSON.stringify(v);
  if (Array.isArray(v) && v.every(x => typeof x === 'number')) return v.join(',');
  return JSON.stringify(v);
}

/** The "⚠️ N warning(s):" block a confirmation ends with; '' when there are none. */
export function warningBlock(warnings?: string[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return '';
  return `\n\n⚠️ ${warnings.length} warning(s):\n${warnings.map(w => `- ${w}`).join('\n')}`;
}

/**
 * A deletion as one line — `Deleted N noun(s): "A" (id), "B" (id)` plus the not-found and failed
 * tails — over the page's `deleteByResolver` shape (src/page/organization.ts).
 */
export function deletedLine(
  r: {
    deleted?: Array<{ id: string; name: string }> | undefined;
    notFound?: string[] | undefined;
    failed?: Array<{ id: string; name: string; error: string }> | undefined;
  },
  noun: string
): string {
  const deleted = Array.isArray(r?.deleted) ? r.deleted : [];
  const notFound = Array.isArray(r?.notFound) ? r.notFound : [];
  const failed = Array.isArray(r?.failed) ? r.failed : [];
  return (
    `Deleted ${deleted.length} ${noun}(s)` +
    (deleted.length ? `: ${deleted.map(d => `"${d.name}" (${d.id})`).join(', ')}` : '') +
    (notFound.length ? ` (${notFound.length} not found: ${notFound.join(', ')})` : '') +
    (failed.length ? ` (failed: ${failed.map(f => `"${f.name}" — ${f.error}`).join(', ')})` : '')
  );
}
