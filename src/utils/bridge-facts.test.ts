/**
 * The bridge's own facts as they read in a report (issue #9): the renderer classification, the
 * labels get-world-info's bridge block uses, the doctor's and the smoke's line, the module warnings.
 */
import { describe, expect, it } from 'vitest';
import {
  type BridgeFacts,
  bridgeLine,
  moduleLabel,
  moduleWarnings,
  rendererLabel,
  rendererOnGpu,
} from './bridge-facts.js';

const GPU = 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SWIFTSHADER =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

const facts = (over: Partial<BridgeFacts> = {}): BridgeFacts => ({
  renderer: { name: GPU, gpu: true },
  canvasReady: true,
  viewport: { width: 1920, height: 1080 },
  modules: {
    battleflow: { active: true, version: '2.17.0' },
    areasounds: { active: true, version: '2.0.1' },
    openserver: { active: true, version: '1.2.0' },
  },
  ...over,
});

describe('rendererOnGpu', () => {
  it('a hardware renderer is the GPU; SwiftShader, llvmpipe or a software rasterizer is not', () => {
    expect(rendererOnGpu(GPU)).toBe(true);
    expect(rendererOnGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)')).toBe(
      true
    );
    expect(rendererOnGpu('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe(true);
    expect(rendererOnGpu(SWIFTSHADER)).toBe(false);
    expect(rendererOnGpu('Google SwiftShader')).toBe(false);
    expect(rendererOnGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(false);
    expect(rendererOnGpu('Microsoft Basic Render Driver (software)')).toBe(false);
  });

  it('no name is no answer', () => {
    expect(rendererOnGpu(null)).toBeNull();
    expect(rendererOnGpu(undefined)).toBeNull();
    expect(rendererOnGpu('  ')).toBeNull();
  });
});

describe('the labels', () => {
  it('names the renderer with where it runs, or says unknown', () => {
    expect(rendererLabel({ name: GPU, gpu: true })).toBe(`GPU: ${GPU}`);
    expect(rendererLabel({ name: 'Google SwiftShader', gpu: false })).toBe(
      'software: Google SwiftShader'
    );
    expect(rendererLabel({ name: null, gpu: null })).toBe('unknown');
    expect(rendererLabel(undefined)).toBe('unknown');
  });

  it('a family module reads as its version when active, else "not active"', () => {
    expect(moduleLabel({ active: true, version: '2.17.0' })).toBe('2.17.0');
    expect(moduleLabel({ active: false, version: '2.0.1' })).toBe('not active'); // installed, off
    expect(moduleLabel({ active: false, version: null })).toBe('not active'); // not installed
    expect(moduleLabel(undefined)).toBe('not active');
  });
});

describe('bridgeLine (the doctor and the smoke)', () => {
  it('is one line, and green when the renderer is the GPU and every family module is active', () => {
    expect(bridgeLine(facts())).toEqual({
      text: `renderer GPU: ${GPU}; Battle Flow 2.17.0, Area Sounds 2.0.1, Open Server 1.2.0`,
      amber: false,
    });
  });

  it('is amber on a software renderer, or a family module that is not active', () => {
    expect(bridgeLine(facts({ renderer: { name: SWIFTSHADER, gpu: false } }))).toEqual({
      text: `renderer software: ${SWIFTSHADER}; Battle Flow 2.17.0, Area Sounds 2.0.1, Open Server 1.2.0`,
      amber: true,
    });
    const modules = { ...facts().modules, openserver: { active: false, version: null } };
    expect(bridgeLine(facts({ modules }))).toEqual({
      text: `renderer GPU: ${GPU}; Battle Flow 2.17.0, Area Sounds 2.0.1, Open Server not active`,
      amber: true,
    });
  });

  it('says what it could not read rather than throwing', () => {
    expect(bridgeLine(undefined).text).toBe(
      'renderer unknown; Battle Flow not active, Area Sounds not active, Open Server not active'
    );
  });
});

describe('moduleWarnings', () => {
  it('names each family module that is not active and what needs it, in a fixed order', () => {
    expect(moduleWarnings(facts())).toEqual([]);
    const modules = {
      battleflow: { active: false, version: '2.17.0' },
      areasounds: { active: false, version: null },
      openserver: { active: false, version: null },
    };
    expect(moduleWarnings(facts({ modules }))).toEqual([
      'Battle Flow is not active in this world: the combat report needs it',
      'Area Sounds is not active in this world: configure-area-sounds needs it',
      'Open Server is not active in this world: set-landing-scene needs it',
    ]);
  });

  it('warns about nothing it cannot know: no facts, no module warnings', () => {
    expect(moduleWarnings(undefined)).toEqual([]);
  });
});
