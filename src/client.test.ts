import { describe, expect, it } from 'vitest';
import { connectFoundry, Foundry, resolveHostConfig, resolveIdentity } from './client.js';

const LOCAL = resolveHostConfig(
  {
    FOUNDRY_URL: 'http://localhost:30000',
    FOUNDRY_USER: 'MCP-Claude',
    FOUNDRY_PASSWORD: 'bridge-pw',
  },
  'local'
);

describe('client — the sibling contract', () => {
  it('resolveIdentity: bridge = the host user; suite / player from their own keys; explicit as given', () => {
    expect(resolveIdentity('bridge', {}, LOCAL)).toEqual({
      user: 'MCP-Claude',
      password: 'bridge-pw',
    });
    expect(
      resolveIdentity(
        'suite',
        { FOUNDRY_SUITE_USER: 'Tester Assistant', FOUNDRY_SUITE_PASSWORD: 'suite-pw' },
        LOCAL
      )
    ).toEqual({ user: 'Tester Assistant', password: 'suite-pw' });
    expect(resolveIdentity('player', { FOUNDRY_PLAYER_USER: 'Test Player' }, LOCAL)).toEqual({
      user: 'Test Player',
    });
    expect(resolveIdentity({ user: 'Someone' }, {}, LOCAL)).toEqual({ user: 'Someone' });
  });

  it('honours the 2.x sibling names as aliases, canonical first', () => {
    expect(
      resolveIdentity('suite', { BF_SUITE_USER: 'Tester Assistant', BF_SUITE_PASSWORD: 'x' }, LOCAL)
    ).toEqual({ user: 'Tester Assistant', password: 'x' });
    expect(
      resolveIdentity(
        'player',
        { MOLTEN_TEST_USER: 'Old Player', FOUNDRY_PLAYER_USER: 'New' },
        LOCAL
      )
    ).toEqual({ user: 'New' });
  });

  it('an unset suite / player user is a refusal naming the variable', () => {
    expect(() => resolveIdentity('suite', {}, LOCAL)).toThrow(/FOUNDRY_SUITE_USER/);
    expect(() => resolveIdentity('player', { FOUNDRY_PLAYER_USER: '  ' }, LOCAL)).toThrow(
      /FOUNDRY_PLAYER_USER/
    );
  });

  it('the bridge password never leaks into a suite identity', () => {
    const who = resolveIdentity('suite', { FOUNDRY_SUITE_USER: 'Tester Assistant' }, LOCAL);
    expect(who).toEqual({ user: 'Tester Assistant' });
  });

  it('connectFoundry refuses a placeholder URL before touching a browser', async () => {
    await expect(
      connectFoundry({ host: 'generic', env: {}, tag: 't', announce: false })
    ).rejects.toThrow(/FOUNDRY_URL is not set/);
  });

  it('disconnect() is dispose() under the sibling name', () => {
    expect(typeof Foundry.prototype.disconnect).toBe('function');
    expect(typeof Foundry.prototype.dispose).toBe('function');
  });
});
