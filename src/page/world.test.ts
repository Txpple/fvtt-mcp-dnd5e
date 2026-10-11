/**
 * get-world-info's page read of the bridge's own client (issue #9): the canvas's unmasked WebGL
 * renderer, whether the canvas is ready, the window, and the Open Roll 5e modules. Every read is
 * fenced, so a torn-down canvas or a lost WebGL context costs a field, never the world report.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorldInfo } from './world.js';

const UNMASKED_RENDERER_WEBGL = 0x9246;

/** A WebGL context whose debug extension reports `name`. */
const gl = (name: unknown) => ({
  getExtension: (ext: string) =>
    ext === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL } : null,
  getParameter: (p: number) => (p === UNMASKED_RENDERER_WEBGL ? name : null),
});

/** A non-dnd5e world (no settings or library reads), with the client globals the read touches. */
function stub(client: { canvas?: unknown; modules?: unknown; window?: unknown } = {}) {
  vi.stubGlobal('game', {
    system: { id: 'other', version: '1.0.0' },
    world: { id: 'w', title: 'W' },
    version: '14.369',
    user: { name: 'Bridge', role: 3 },
    users: [],
    modules: client.modules ?? new Map(),
  });
  vi.stubGlobal('CONST', { USER_ROLES: { ASSISTANT: 3 } });
  vi.stubGlobal('canvas', client.canvas);
  vi.stubGlobal('window', client.window ?? { innerWidth: 1920, innerHeight: 1080 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getWorldInfo: the bridge facts', () => {
  it('reads the renderer off the canvas, the canvas state, the window and the family modules', () => {
    stub({
      canvas: { ready: true, app: { renderer: { gl: gl(' ANGLE (Intel, Direct3D11) ') } } },
      modules: new Map([
        ['fvtt-mod-battleflow', { active: true, version: '2.17.0' }],
        ['fvtt-mod-areasounds', { active: false, version: '2.0.1' }],
      ]),
    });
    expect(getWorldInfo().bridge).toEqual({
      renderer: { name: 'ANGLE (Intel, Direct3D11)', gpu: true },
      canvasReady: true,
      viewport: { width: 1920, height: 1080 },
      modules: {
        battleflow: { active: true, version: '2.17.0' },
        areasounds: { active: false, version: '2.0.1' }, // installed, not active
        openserver: { active: false, version: null }, // not installed
      },
    });
  });

  it('a software renderer is not the GPU', () => {
    stub({ canvas: { ready: true, app: { renderer: { gl: gl('Google SwiftShader') } } } });
    expect(getWorldInfo().bridge.renderer).toEqual({ name: 'Google SwiftShader', gpu: false });
  });

  it('never throws: no canvas, no extension, reads that throw, no window size', () => {
    stub({ canvas: undefined, window: {} });
    expect(getWorldInfo().bridge).toMatchObject({
      renderer: { name: null, gpu: null },
      canvasReady: false,
      viewport: null,
    });

    stub({ canvas: { ready: false, app: { renderer: { gl: { getExtension: () => null } } } } });
    expect(getWorldInfo().bridge.renderer).toEqual({ name: null, gpu: null });

    stub({
      canvas: {
        get ready(): boolean {
          throw new Error('canvas torn down');
        },
        app: {
          renderer: {
            get gl(): unknown {
              throw new Error('WebGL context lost');
            },
          },
        },
      },
      modules: {
        get: () => {
          throw new Error('no package registry');
        },
      },
    });
    const b = getWorldInfo().bridge;
    expect(b.renderer).toEqual({ name: null, gpu: null });
    expect(b.canvasReady).toBe(false);
    expect(b.modules.battleflow).toEqual({ active: false, version: null });
  });
});
