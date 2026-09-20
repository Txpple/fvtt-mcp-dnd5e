/**
 * The response cap — what happens when a tool result is bigger than `toolResponseMaxChars`.
 *
 * A cut must leave the model something it can read AND a true count of what it did not see. The
 * old cap sliced the JSON text at N chars: the last record was torn mid-field and the trailing
 * counts (`totalFound`, `total`, `note`) — the very part that says how much was omitted — were
 * always the part lost. This cap cuts at record boundaries instead:
 *
 *   - an OBJECT result: find its largest array (at any depth), keep the longest prefix that fits,
 *     and stamp `truncation: {path, kept, omitted, of, note}` on the top level, so every other
 *     field survives intact;
 *   - a STRING result: cut at the last newline under the cap and say how many lines follow;
 *   - anything else (a result with no array to cut): the character cut, as before.
 *
 * The marker wording is stable — `response exceeded toolResponseMaxChars (N)` — because scripts
 * grep for it (scripts/measure/tool-results.mjs).
 */

export interface Truncation {
  /** Dot path of the array that was cut (top-level key, or `a.b.c` for a nested one). */
  path: string;
  kept: number;
  omitted: number;
  of: number;
  note: string;
}

const MAX_DEPTH = 4;

/** The largest array reachable from `value` (by JSON size), with its path — or null. */
function largestArray(
  value: unknown,
  path: string[] = [],
  depth = 0
): { path: string[]; size: number; array: unknown[] } | null {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return null;
  let best: { path: string[]; size: number; array: unknown[] } | null = null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      const size = JSON.stringify(child).length;
      if (!best || size > best.size) best = { path: [...path, key], size, array: child };
    } else if (child && typeof child === 'object') {
      const nested = largestArray(child, [...path, key], depth + 1);
      if (nested && (!best || nested.size > best.size)) best = nested;
    }
  }
  return best;
}

/** A shallow copy of `root` with the array at `path` replaced by `replacement`. */
function withArray(root: object, path: string[], replacement: unknown[]): object {
  const [head, ...rest] = path;
  const copy: Record<string, unknown> = { ...(root as Record<string, unknown>) };
  copy[head!] = rest.length ? withArray(copy[head!] as object, rest, replacement) : replacement;
  return copy;
}

function characterCut(text: string, maxChars: number): string {
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n…[${omitted} chars omitted — response exceeded toolResponseMaxChars (${maxChars})]`;
}

/** Cap a tool result to `maxChars` of text at record boundaries; see the module note. */
export function capResult(result: unknown, maxChars: number): string {
  if (typeof result === 'string') {
    if (result.length <= maxChars) return result;
    const head = result.slice(0, maxChars);
    const nl = head.lastIndexOf('\n');
    const kept = nl > 0 ? head.slice(0, nl) : head;
    const omittedLines = result.slice(kept.length).split('\n').length - 1;
    return `${kept}\n…[${omittedLines} more line(s) omitted — response exceeded toolResponseMaxChars (${maxChars})]`;
  }

  const full = JSON.stringify(result);
  if (full.length <= maxChars) return full;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return characterCut(full, maxChars);
  }

  const target = largestArray(result);
  if (!target) return characterCut(full, maxChars);

  const { path, array } = target;
  const dotted = path.join('.');
  const render = (n: number): string => {
    const truncation: Truncation = {
      path: dotted,
      kept: n,
      omitted: array.length - n,
      of: array.length,
      note: `${dotted} cut at ${n} of ${array.length} records — response exceeded toolResponseMaxChars (${maxChars}); narrow the query or raise the limit`,
    };
    return JSON.stringify({ ...withArray(result, path, array.slice(0, n)), truncation });
  };

  // Binary-search the longest prefix that fits (the stamp included).
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (render(mid).length <= maxChars) lo = mid;
    else hi = mid - 1;
  }
  const text = render(lo);
  // Even zero records do not fit (the rest of the result is itself over the cap): character cut.
  return text.length <= maxChars ? text : characterCut(full, maxChars);
}
