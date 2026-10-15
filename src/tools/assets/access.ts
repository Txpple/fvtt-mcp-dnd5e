// Shared Plane-B failures for the tools that reach a host's file plane — the asset file tools
// (./index.ts) and the chat tools (../chat.ts: export-chat-log + image embedding) — so a local file
// they cannot read fails the same way whichever tool met it. A file plane's own failure is a
// FilePlaneError, coded by its status in the central mapper (src/utils/error-handler.ts).

import { readFile } from 'node:fs/promises';
import { ToolError } from '../../utils/error-handler.js';

/**
 * A local path the call cannot use, as an error: one that is not there is `not-found`; any other
 * failure (a permission, a directory where a file was meant) is its own words with no code.
 */
export function localError(what: string, err: unknown): Error {
  const e = err as NodeJS.ErrnoException | undefined;
  const message = `${what}: ${e?.message ?? String(err)}`;
  return e?.code === 'ENOENT' || e?.code === 'ENOTDIR'
    ? new ToolError('not-found', message)
    : new Error(message);
}

/** The bytes of a local file, or the error `localError` gives for it (`what`: "local file"). */
export async function readLocal(path: string, what: string): Promise<Uint8Array> {
  try {
    return await readFile(path);
  } catch (err) {
    throw localError(`Cannot read ${what} "${path}"`, err);
  }
}
