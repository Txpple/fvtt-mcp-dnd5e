// The doctor's readings of Foundry's answers (src/doctor.ts). The live run is `npm run doctor`.
import { describe, expect, it } from 'vitest';
import { legacyNamesLine, readAdminAuth, readApiStatus, roleName } from './doctor.js';

describe('readApiStatus — GET /api/status', () => {
  it('reads a running world', () => {
    expect(
      readApiStatus(
        '{"active":true,"version":"14.369","world":"w","system":"dnd5e","systemVersion":"6.0.6","users":2,"uptime":5}'
      )
    ).toEqual({
      kind: 'active',
      version: '14.369',
      world: 'w',
      system: 'dnd5e',
      systemVersion: '6.0.6',
      users: 2,
    });
  });

  it('reads the Setup screen (no world) and refuses anything that is not Foundry', () => {
    expect(readApiStatus('{"active":false,"version":"14.369"}')).toEqual({
      kind: 'no-world',
      version: '14.369',
    });
    expect(readApiStatus('<html>asleep</html>')).toEqual({ kind: 'not-foundry' });
    expect(readApiStatus('{"status":"ok"}')).toEqual({ kind: 'not-foundry' });
  });
});

describe('readAdminAuth — POST /auth {adminPassword}', () => {
  it('a redirect to /setup is a good key, a re-rendered form a bad one', () => {
    expect(readAdminAuth(302, 'http://localhost:30000/setup')).toBe('accepted');
    expect(readAdminAuth(200, null)).toBe('rejected');
  });

  it('a redirect to /join means a world is running; anything else is unknown', () => {
    expect(readAdminAuth(302, '/join')).toBe('world-active');
    expect(readAdminAuth(405, null)).toBe('unknown');
    expect(readAdminAuth(302, '/license')).toBe('unknown');
  });
});

describe('the doctor’s wording', () => {
  it('names roles the way Foundry does', () => {
    expect(roleName(4)).toBe('Gamemaster');
    expect(roleName(3)).toBe('Assistant GM');
    expect(roleName(1)).toBe('Player');
    expect(roleName(9)).toBe('role 9');
  });

  it('folds the selector’s alias notes into one line', () => {
    expect(legacyNamesLine([])).toBeUndefined();
    expect(
      legacyNamesLine([
        'LOCAL_SERVER_URL is a legacy alias of FOUNDRY_URL — set FOUNDRY_URL instead.',
        'FOUNDRY_PROFILE=local is a legacy alias of FOUNDRY_HOST=local.',
      ])
    ).toBe(
      'legacy .env names still read: LOCAL_SERVER_URL → FOUNDRY_URL, ' +
        'FOUNDRY_PROFILE=local → FOUNDRY_HOST=local (rename when convenient)'
    );
  });
});
