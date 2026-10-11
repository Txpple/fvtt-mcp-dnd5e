/**
 * disconnect-bridge — the bridge-lifecycle tool (courtesy logout).
 *
 * The handler must drive the seam's OWN lifecycle methods (isReady/dispose) and never
 * foundry.call(): calling into the page would force a reconnect of the very session the tool
 * exists to close. Dispose runs unconditionally (isReady() is false while a connect is still in
 * flight, and dispose() is what tears that half-open session down too); only the message varies.
 */

import { describe, it, expect } from 'vitest';
import { BridgeTools } from './bridge.js';
import { makeFoundry, makeLogger } from './test-helpers.js';

function build(overrides?: (foundry: any) => void) {
  const { foundry, calls } = makeFoundry();
  overrides?.(foundry);
  const tools = new BridgeTools({ foundry, logger: makeLogger() });
  return { tools, foundry, calls };
}

describe('BridgeTools', () => {
  it('advertises disconnect-bridge with one optional argument, `all`', () => {
    const { tools } = build();
    const defs = tools.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe('disconnect-bridge');
    expect(defs[0]!.inputSchema.type).toBe('object');
    expect(Object.keys(defs[0]!.inputSchema.properties)).toEqual(['all']);
    expect(defs[0]!.inputSchema.required).toEqual([]);
  });

  it('names the other holders of the seat on this machine, and does not end them without `all`', async () => {
    const other = {
      pid: 28560,
      ppid: 1,
      host: 'box',
      label: 'Claude Code session s2',
      session: 's2',
      since: '2026-10-10T23:21:01.000Z',
      serverUrl: 'http://localhost:30000',
      user: 'Assistant DM',
      alive: true,
      self: false,
      file: 'x.json',
    };
    const { tools, foundry } = build(f => {
      f.holders = () => [{ ...other, pid: process.pid, self: true }, other];
    });
    const result = await tools.handleDisconnectBridge({});
    expect(foundry.evictOtherHolders).not.toHaveBeenCalled();
    expect(result).toContain('1 other session(s) still hold this seat');
    expect(result).toContain(
      'pid 28560 on box — Claude Code session s2 — since 2026-10-10T23:21:01.000Z'
    );
    expect(result).toContain('"all": true');
  });

  it('with `all`, ends every other holder and reports per holder what it ended or why not', async () => {
    const holder = (pid: number, label: string) => ({
      pid,
      host: 'box',
      label,
      since: '2026-10-10T23:21:01.000Z',
    });
    const { tools, foundry } = build(f => {
      f.evictOtherHolders = async () => [
        { holder: holder(28560, 'Claude Code session s2'), ended: 30680, kept: false },
        {
          holder: holder(31000, 'Claude Code session s3'),
          ended: null,
          skipped: 'left pid 31500 alone (it now runs another program, not the recorded browser)',
          kept: false,
        },
      ];
    });
    const result = await tools.handleDisconnectBridge({ all: true });
    expect(foundry.dispose).toHaveBeenCalledTimes(1);
    expect(result).toContain('Ended 1 of 2 other holder(s) of this seat on this machine:');
    expect(result).toContain('pid 28560 on box — Claude Code session s2');
    expect(result).toContain('browser pid 30680 ended');
    expect(result).toContain(
      'pid 31000 on box — Claude Code session s3 — since 2026-10-10T23:21:01.000Z: left pid 31500 alone'
    );
    expect(result).toContain('Every record above is cleared');
  });

  it('with `all`, says which records it kept: a holder whose browser it could not check stays named', async () => {
    const { tools } = build(f => {
      f.evictOtherHolders = async () => [
        {
          holder: {
            pid: 31000,
            host: 'box',
            label: 'old build',
            since: '2026-10-10T23:21:01.000Z',
          },
          ended: null,
          skipped: 'record kept, nothing ended (it names no browser)',
          kept: true,
        },
      ];
    });
    const result = await tools.handleDisconnectBridge({ all: true });
    expect(result).toContain('Ended 0 of 1 other holder(s)');
    expect(result).toContain('old build — since 2026-10-10T23:21:01.000Z: record kept');
    expect(result).toContain('1 record(s) kept: nothing showed their browser ended or gone');
    expect(result).not.toContain('Every record above is cleared');
  });

  it('with `all` and nobody else, says so', async () => {
    const { tools } = build();
    const result = await tools.handleDisconnectBridge({ all: true });
    expect(result).toContain('No other session holds this seat on this machine.');
  });

  it('disposes a live session and reports the logout + auto-reconnect contract', async () => {
    const { tools, foundry, calls } = build();
    const result = await tools.handleDisconnectBridge({});
    expect(foundry.dispose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]); // never foundry.call() — that would reconnect the session
    expect(result).toContain('✅ Disconnected');
    expect(result).toContain('next tool call reconnects');
  });

  it('still disposes when not connected, but reports the no-op', async () => {
    const { tools, foundry } = build(f => {
      f.isReady = () => false;
    });
    const result = await tools.handleDisconnectBridge({});
    // Unconditional dispose: isReady() is false mid-connect, and dispose() (which awaits the
    // in-flight connect) is the only way to guarantee that session is torn down too.
    expect(foundry.dispose).toHaveBeenCalledTimes(1);
    expect(result).toContain('already disconnected');
  });
});
