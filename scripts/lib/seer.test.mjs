import { describe, expect, it } from 'vitest';
import { COMPANION_PORT, discountSeer, seerHealthUrls, seerUser } from './seer.mjs';

describe("where the Seer's healthz is looked for", () => {
  it('tries the configured Seer first, then the origin route, then the companion port', () => {
    expect(
      seerHealthUrls('http://10.0.0.5:30000', 'https://foundry.example.com/crystalball/')
    ).toEqual([
      'https://foundry.example.com/crystalball/healthz',
      'http://10.0.0.5:30000/crystalball/healthz',
      `http://10.0.0.5:${COMPANION_PORT}/crystalball/healthz`,
    ]);
  });

  it('derives the sandbox pair from the Foundry URL alone', () => {
    expect(seerHealthUrls('http://localhost:30000/', undefined)).toEqual([
      'http://localhost:30000/crystalball/healthz',
      'http://localhost:30001/crystalball/healthz',
    ]);
  });

  it('adds no companion when Foundry is on that port, and copes with no URL at all', () => {
    expect(seerHealthUrls('http://localhost:30001', '')).toEqual([
      'http://localhost:30001/crystalball/healthz',
    ]);
    expect(seerHealthUrls('not a url', 'http://seer.test/crystalball')).toEqual([
      'http://seer.test/crystalball/healthz',
    ]);
  });
});

describe("the Seer's word", () => {
  const answer = (status, body) => ({ ok: status === 200, json: async () => body });

  it('takes the first healthz that answers and reads its link', async () => {
    const calls = [];
    const fetchFn = async url => {
      calls.push(url);
      if (url.startsWith('http://localhost:30000/')) return answer(404, null);
      return answer(200, {
        version: '1.0.4',
        foundry: { connected: true, worldOpen: true, world: 'w1', ballUser: 'Crystal Ball' },
      });
    };
    const seer = await seerUser('http://localhost:30000', undefined, { fetchFn });
    expect(seer).toEqual({
      connected: true,
      world: 'w1',
      ballUser: 'Crystal Ball',
      at: 'http://localhost:30001/crystalball/healthz',
    });
    expect(calls).toHaveLength(2);
  });

  it('is null when nothing answers, or what answers is not a Seer', async () => {
    expect(
      await seerUser('http://localhost:30000', undefined, {
        fetchFn: async () => {
          throw new Error('ECONNREFUSED');
        },
      })
    ).toBeNull();
    expect(
      await seerUser('http://localhost:30000', undefined, {
        fetchFn: async () => answer(200, { hello: 'world' }),
      })
    ).toBeNull();
  });
});

describe('the discount', () => {
  const seer = { connected: true, world: 'w1', ballUser: 'Crystal Ball' };

  it("takes the Seer's user off the count when it is connected to this world", () => {
    expect(discountSeer({ users: 1, world: 'w1' }, seer)).toMatchObject({
      users: 0,
      counted: 1,
      discounted: 1,
    });
    expect(discountSeer({ users: 3, world: 'w1' }, seer).users).toBe(2);
    expect(discountSeer({ users: 1, world: 'w1' }, seer).note).toBe(
      '1 connected, one of them "Crystal Ball" (Crystal Ball\'s Seer, discounted): 0 to wait for'
    );
  });

  it('discounts nothing without a Seer, with one not connected, or with one on another world', () => {
    expect(discountSeer({ users: 2, world: 'w1' }, null)).toMatchObject({
      users: 2,
      discounted: 0,
    });
    expect(discountSeer({ users: 2, world: 'w1' }, { ...seer, connected: false })).toMatchObject({
      users: 2,
      discounted: 0,
    });
    expect(discountSeer({ users: 2, world: 'w1' }, { ...seer, world: 'w2' }).users).toBe(2);
    expect(discountSeer({ users: 2, world: 'w1' }, null).note).toBe('2 connected');
  });

  it('never goes below zero, and reads a missing count as none', () => {
    expect(discountSeer({ users: 0, world: 'w1' }, seer).users).toBe(0);
    expect(discountSeer(null, seer).users).toBe(0);
    expect(discountSeer({ world: 'w1' }, seer).counted).toBe(0);
  });
});
