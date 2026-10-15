// What `npm run init` (src/init.ts) and the doctor (src/doctor.ts) know about each host preset,
// so neither tells one host from another (CONTRIBUTING's hosts rule): the kinds init offers and
// the words its question and help use for each, whether Foundry runs on this machine, the URL init
// shows, the registration name it offers, and the extras each preset reads (asked, or taken from a
// flag only) with why one it does not read is refused.

import { hostLabel } from './host.js';
import type { HostKind } from './types.js';

/** A key only some hosts read: the wake URL, the WebDAV password, the Data folder. */
export type HostExtra = 'wakeUrl' | 'webdavPassword' | 'dataDir';

/** How a host takes an extra: asked (in the host's own words for it, when it has them), or only from its flag. */
export interface ExtraUse {
  readonly asked: boolean;
  readonly words?: string;
}

export interface HostOnboarding {
  readonly kind: HostKind;
  /** The host in init's question and help: `an install on this machine`, its preset's label. */
  readonly says: string;
  /**
   * Foundry runs on this machine: init does not ask for FOUNDRY_URL (`url` is its default), and the
   * doctor looks for the Foundry app.
   */
  readonly onThisMachine: boolean;
  /** The URL init shows: the default on this machine, an example otherwise. */
  readonly url: string;
  /** The registration name init offers. */
  readonly registrationName: string;
  /** The extras this host reads. */
  readonly extras: Readonly<Partial<Record<HostExtra, ExtraUse>>>;
  /** Why an extra this host does not read is refused as a flag. */
  readonly notHere: Readonly<Partial<Record<HostExtra, string>>>;
}

/** Every host preset, in the order init offers them. */
export const HOST_ONBOARDING: readonly HostOnboarding[] = [
  {
    kind: 'local',
    says: 'an install on this machine',
    onThisMachine: true,
    url: 'http://localhost:30000',
    registrationName: 'foundry-local5e',
    extras: { dataDir: { asked: true } },
    notHere: {
      wakeUrl: 'a local install does not sleep',
      webdavPassword: 'a local install is reached through its Data folder (--data-dir)',
    },
  },
  {
    kind: 'molten',
    says: hostLabel('molten'),
    onThisMachine: false,
    url: 'https://<your-box>.moltenhosting.com',
    registrationName: 'foundry',
    extras: {
      wakeUrl: { asked: true, words: "the panel's Server Startup / Magic URL" },
      webdavPassword: { asked: true, words: "the panel's File Manager password" },
    },
    notHere: { dataDir: "a hosted box's disk is not this machine's" },
  },
  {
    kind: 'generic',
    says: 'any URL',
    onThisMachine: false,
    url: 'https://…',
    registrationName: 'foundry',
    extras: { wakeUrl: { asked: false }, dataDir: { asked: false } },
    notHere: {
      webdavPassword:
        'a generic WebDAV plane needs FOUNDRY_WEBDAV_URL and _USER too; set the three in the .env',
    },
  },
];

/** The onboarding facts of one host kind. */
export function onboardingOf(kind: HostKind): HostOnboarding {
  const preset = HOST_ONBOARDING.find(p => p.kind === kind);
  if (!preset) throw new Error(`no host preset "${kind}"`);
  return preset;
}
