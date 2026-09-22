import { describe, expect, it } from 'vitest';
import { MemoryAuthStore, StorageCapacityError } from '../src/index.js';
import { authStoreContract, authorizationCode, challenge, NOW } from './contract.js';

describe('MemoryAuthStore', () => {
  authStoreContract(async () => new MemoryAuthStore({ now: () => NOW }));

  it('bounds challenges and preserves every valid authentication when full', async () => {
    const store = new MemoryAuthStore({ maxChallenges: 1, now: () => NOW });
    await store.createChallenge(challenge());
    await expect(store.createChallenge(challenge({ id: 'second' }))).rejects.toBeInstanceOf(StorageCapacityError);
    expect(await store.getChallenge('challenge-1')).toEqual(challenge());
    expect(await store.consumeChallenge('challenge-1', authorizationCode(), NOW)).toBe(true);
  });

  it('bounds codes without consuming a pending valid challenge', async () => {
    const store = new MemoryAuthStore({ maxCodes: 1, now: () => NOW });
    await store.createChallenge(challenge());
    await store.consumeChallenge('challenge-1', authorizationCode(), NOW);
    await store.createChallenge(challenge({ id: 'second' }));
    await expect(store.consumeChallenge('second', authorizationCode({ challengeId: 'second', codeHash: 'second-code' }), NOW)).rejects.toBeInstanceOf(StorageCapacityError);
    expect(await store.getChallenge('second')).not.toBeNull();
    await store.consumeCode('code-sha256', 'demo', 'http://localhost:5173', 'pkce-s256', NOW);
    expect(await store.consumeChallenge('second', authorizationCode({ challengeId: 'second', codeHash: 'second-code' }), NOW)).toBe(true);
  });

  it('reclaims expired capacity before rejecting new challenges', async () => {
    let clock = NOW;
    const store = new MemoryAuthStore({ maxChallenges: 1, now: () => clock });
    await store.createChallenge(challenge({ expiresAt: NOW + 1 }));
    clock += 1;
    await store.createChallenge(challenge({ id: 'second' }));
    expect(await store.getChallenge('challenge-1')).toBeNull();
    expect(await store.getChallenge('second')).not.toBeNull();
  });

  it('marks closed storage unready and prevents further operations', async () => {
    const store = new MemoryAuthStore();
    expect(await store.ready()).toBe(true);
    await store.close();
    expect(await store.ready()).toBe(false);
    await expect(store.createChallenge(challenge())).rejects.toThrow('closed');
    await store.close();
  });
});
