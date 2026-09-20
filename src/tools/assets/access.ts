// Shared Plane-B messaging for the tools that reach a host's file plane — the asset file tools
// (./index.ts) and the chat tools (../chat.ts: export-chat-log + image embedding) — so a failed
// plane operation reads the same whichever tool, and whichever plane, raised it.

import { Logger } from '../../logger.js';
import { FilePlaneError } from '../../hosts/types.js';

/** Friendly one-line message for a failed file-plane op (logs the detail). */
export function fileErrorMessage(tool: string, err: unknown, logger: Logger): string {
  if (err instanceof FilePlaneError) {
    logger.warn(`${tool} file-plane error`, { status: err.status, message: err.message });
    return `${tool} failed: ${err.message}`;
  }
  logger.error(`${tool} unexpected error`, { error: (err as Error).message });
  return `${tool} failed: ${(err as Error).message}`;
}
