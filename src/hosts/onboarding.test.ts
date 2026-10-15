/**
 * The host presets' onboarding facts (src/hosts/onboarding.ts), and the hosts rule they serve
 * (CONTRIBUTING): init and the doctor read every host fact from here, so no file under src/
 * outside src/hosts names a host kind or a host's label in its code.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostLabel } from './host.js';
import { HOST_ONBOARDING, type HostExtra, onboardingOf } from './onboarding.js';
import type { HostKind } from './types.js';

const KINDS: readonly HostKind[] = ['local', 'molten', 'generic'];
const EXTRAS: readonly HostExtra[] = ['wakeUrl', 'webdavPassword', 'dataDir'];

describe('the host presets init and the doctor read', () => {
  it('one preset per kind, in the order init offers them', () => {
    expect(HOST_ONBOARDING.map(p => p.kind)).toEqual(KINDS);
    for (const kind of KINDS) expect(onboardingOf(kind).kind).toBe(kind);
  });

  it('a preset that names its host says its own label', () => {
    expect(onboardingOf('molten').says).toBe(hostLabel('molten'));
  });

  it('every extra is read by a preset or refused with its reason', () => {
    for (const p of HOST_ONBOARDING) {
      for (const extra of EXTRAS) {
        const read = p.extras[extra] !== undefined;
        const refused = typeof p.notHere[extra] === 'string';
        expect(read !== refused, `${p.kind} ${extra}`).toBe(true);
      }
    }
  });

  it('a host on this machine is offered its default URL; one off it, an example to replace', () => {
    expect(HOST_ONBOARDING.filter(p => p.onThisMachine).map(p => p.url)).toEqual([
      'http://localhost:30000',
    ]);
  });
});

describe('the hosts rule', () => {
  it('no file under src/ outside src/hosts names a host kind or a label in its code', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const kind = /(['"`])(local|molten|generic)\1/;
    // a label that is not also its kind's name ("generic" is a plain word)
    const labels = KINDS.map(hostLabel).filter(l => !(KINDS as readonly string[]).includes(l));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name);
        const rel = relative(src, path).split(sep).join('/');
        if (e.isDirectory()) {
          if (rel !== 'hosts') walk(path);
        } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          readFileSync(path, 'utf8')
            .split(/\r?\n/)
            .forEach((line, i) => {
              const t = line.trim();
              // comments may show an example (a URL, a call); the rule is about the code
              if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
              if (kind.test(line) || labels.some(l => line.includes(l)))
                offenders.push(`${rel}:${i + 1}`);
            });
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
