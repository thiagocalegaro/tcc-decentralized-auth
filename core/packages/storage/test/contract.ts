import { beforeEach, describe, expect, it } from 'vitest';
import { type AuthStore, type AuthorizationCode, type Challenge, StorageConflictError } from '../src/index.js';

export const NOW = 1_750_000_000_000;
export function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'challenge-1', clientId: 'demo', address: '0x1111111111111111111111111111111111111111',
    chainId: 1, origin: 'http://localhost:5173', redirectUri: 'http://localhost:5173',
    messageHash: 'message-sha256', nonceHash: 'nonce-sha256', codeChallenge: 'pkce-s256',
    createdAt: NOW, expiresAt: NOW + 300_000, ...overrides,
  };
}
export function authorizationCode(overrides: Partial<AuthorizationCode> = {}): AuthorizationCode {
  return {
    codeHash: 'code-sha256', challengeId: 'challenge-1', clientId: 'demo',
    accountId: 'eip155:1:0x1111111111111111111111111111111111111111',
    address: '0x1111111111111111111111111111111111111111', chainId: 1,
    redirectUri: 'http://localhost:5173', codeChallenge: 'pkce-s256', authTime: NOW,
    expiresAt: NOW + 60_000, ...overrides,
  };
}

/** Identical behavioral tests run on memory and, when configured, real PostgreSQL. */
export function authStoreContract(create: () => Promise<AuthStore>): void {
  let store: AuthStore;
  beforeEach(async () => { store = await create(); });

  describe('challenge and authorization code contract', () => {
    it('round trips timestamps in milliseconds and returns independent values', async () => {
      const source = challenge();
      await store.createChallenge(source);
      source.address = 'changed-after-write';
      const loaded = await store.getChallenge('challenge-1');
      expect(loaded).toEqual(challenge());
      loaded!.codeChallenge = 'changed-after-read';
      expect(await store.getChallenge('challenge-1')).toEqual(challenge());
      expect(await store.getChallenge('unknown')).toBeNull();
    });

    it('rejects duplicate identifiers without overwriting the original challenge', async () => {
      await store.createChallenge(challenge());
      await expect(store.createChallenge(challenge({ codeChallenge: 'attacker-pkce' }))).rejects.toBeInstanceOf(StorageConflictError);
      expect((await store.getChallenge('challenge-1'))?.codeChallenge).toBe('pkce-s256');
    });

    it('issues only one code when verification races across 20 callers', async () => {
      await store.createChallenge(challenge());
      const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        store.consumeChallenge('challenge-1', authorizationCode({ codeHash: `code-${index}` }), NOW)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.getChallenge('challenge-1')).toBeNull();
      expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW)).toBe(false);
    });

    it('redeems a code only once when exchanges race across 20 callers', async () => {
      await store.createChallenge(challenge());
      expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW)).toBe(true);
      const results = await Promise.all(Array.from({ length: 20 }, () =>
        store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW)));
      expect(results.filter(Boolean)).toEqual([authorizationCode()]);
      expect(await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW)).toBeNull();
    });

    it.each([
      ['other-client', 'http://localhost:5173', 'pkce-s256'],
      ['demo', 'https://attacker.example', 'pkce-s256'],
      ['demo', 'http://localhost:5173', 'wrong-pkce'],
    ])('does not burn a code for wrong exchange binding %s / %s / %s', async (clientId, redirectUri, pkce) => {
      await store.createChallenge(challenge());
      await store.consumeChallenge('challenge-1', authorizationCode(), NOW);
      expect(await store.consumeCode('code-sha256', clientId, redirectUri, pkce, NOW)).toBeNull();
      expect(await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW)).toEqual(authorizationCode());
    });

    it.each<Partial<AuthorizationCode>>([
      { challengeId: 'other-challenge' }, { clientId: 'other-client' }, { redirectUri: 'https://attacker.example' },
      { codeChallenge: 'wrong-pkce' }, { address: '0x2222222222222222222222222222222222222222' },
      { chainId: 2 }, { accountId: 'eip155:2:0x1111111111111111111111111111111111111111' },
    ])('rejects code/challenge mismatches without consuming the challenge: %j', async (override) => {
      await store.createChallenge(challenge());
      expect(await store.consumeChallenge('challenge-1', authorizationCode(override), NOW)).toBe(false);
      expect(await store.getChallenge('challenge-1')).toEqual(challenge());
      expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW)).toBe(true);
    });

    it('rejects challenges at the exact expiration boundary', async () => {
      await store.createChallenge(challenge({ expiresAt: NOW + 1 }));
      expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW + 1)).toBe(false);
      expect(await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW + 1)).toBeNull();
    });

    it('rejects expired codes at the exact expiration boundary', async () => {
      await store.createChallenge(challenge());
      await store.consumeChallenge('challenge-1', authorizationCode({ expiresAt: NOW + 1 }), NOW);
      expect(await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW + 1)).toBeNull();
    });

    it('does not consume a valid challenge when asked to issue an expired code', async () => {
      await store.createChallenge(challenge());
      expect(await store.consumeChallenge('challenge-1', authorizationCode({ expiresAt: NOW + 1 }), NOW + 1)).toBe(false);
      expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW + 1)).toBe(true);
    });

    it('rolls back challenge consumption if the authorization code hash collides', async () => {
      await store.createChallenge(challenge());
      await store.consumeChallenge('challenge-1', authorizationCode(), NOW);
      await store.createChallenge(challenge({ id: 'challenge-2' }));
      expect(await store.consumeChallenge('challenge-2', authorizationCode({ challengeId: 'challenge-2' }), NOW)).toBe(false);
      expect(await store.getChallenge('challenge-2')).not.toBeNull();
      expect(await store.consumeChallenge('challenge-2', authorizationCode({ challengeId: 'challenge-2', codeHash: 'second-code' }), NOW)).toBe(true);
    });

    it('cleanup removes only expired records', async () => {
      await store.createChallenge(challenge({ id: 'expired-challenge', expiresAt: NOW + 1 }));
      await store.createChallenge(challenge({ id: 'live-challenge' }));
      await store.createChallenge(challenge());
      await store.consumeChallenge('challenge-1', authorizationCode({ expiresAt: NOW + 1 }), NOW);
      await store.cleanup(NOW + 1);
      expect(await store.getChallenge('expired-challenge')).toBeNull();
      expect(await store.getChallenge('live-challenge')).not.toBeNull();
      expect(await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW + 1)).toBeNull();
    });
  });
}
