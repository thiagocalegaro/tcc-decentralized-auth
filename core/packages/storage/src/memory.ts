import {
  type AuthStore, type AuthorizationCode, type Challenge,
  StorageCapacityError, StorageConflictError, matchesChallenge,
} from './types.js';

export interface MemoryAuthStoreOptions {
  maxChallenges?: number;
  maxCodes?: number;
  now?: () => number;
}

/** Single-process development store. All state transitions complete without yielding. */
export class MemoryAuthStore implements AuthStore {
  readonly kind = 'memory' as const;
  private readonly challenges = new Map<string, Challenge>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly codeByChallenge = new Map<string, string>();
  private readonly maxChallenges: number;
  private readonly maxCodes: number;
  private readonly now: () => number;
  private closed = false;

  constructor(options: MemoryAuthStoreOptions = {}) {
    this.maxChallenges = options.maxChallenges ?? 10_000;
    this.maxCodes = options.maxCodes ?? 10_000;
    this.now = options.now ?? Date.now;
    if (![this.maxChallenges, this.maxCodes].every((limit) => Number.isSafeInteger(limit) && limit > 0)) {
      throw new Error('Storage capacity must be a positive safe integer');
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Authentication storage is closed');
  }

  private removeExpired(now: number): void {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
    for (const [hash, code] of this.codes) {
      if (code.expiresAt <= now) {
        this.codes.delete(hash);
        this.codeByChallenge.delete(code.challengeId);
      }
    }
  }

  async createChallenge(challenge: Challenge): Promise<void> {
    this.assertOpen();
    if (this.challenges.has(challenge.id)) throw new StorageConflictError();
    if (this.challenges.size >= this.maxChallenges) this.removeExpired(this.now());
    if (this.challenges.size >= this.maxChallenges) throw new StorageCapacityError();
    this.challenges.set(challenge.id, { ...challenge });
  }

  async getChallenge(id: string): Promise<Challenge | null> {
    this.assertOpen();
    const challenge = this.challenges.get(id);
    return challenge ? { ...challenge } : null;
  }

  async consumeChallenge(id: string, code: AuthorizationCode, now: number): Promise<boolean> {
    this.assertOpen();
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.expiresAt <= now || code.expiresAt <= now || !matchesChallenge(challenge, code)) return false;
    if (this.codes.has(code.codeHash) || this.codeByChallenge.has(code.challengeId)) return false;
    if (this.codes.size >= this.maxCodes) this.removeExpired(now);
    if (this.codes.size >= this.maxCodes) throw new StorageCapacityError();
    // No await between checking and committing: concurrent callers cannot reuse the row.
    this.codes.set(code.codeHash, { ...code });
    this.codeByChallenge.set(code.challengeId, code.codeHash);
    this.challenges.delete(id);
    return true;
  }

  async consumeCode(codeHash: string, clientId: string, redirectUri: string, codeChallenge: string, now: number): Promise<AuthorizationCode | null> {
    this.assertOpen();
    const code = this.codes.get(codeHash);
    if (!code || code.expiresAt <= now || code.clientId !== clientId || code.redirectUri !== redirectUri || code.codeChallenge !== codeChallenge) return null;
    this.codes.delete(codeHash);
    this.codeByChallenge.delete(code.challengeId);
    return { ...code };
  }

  async cleanup(now: number): Promise<void> {
    this.assertOpen();
    this.removeExpired(now);
  }

  async ready(): Promise<boolean> { return !this.closed; }

  async close(): Promise<void> {
    this.closed = true;
    this.challenges.clear();
    this.codes.clear();
    this.codeByChallenge.clear();
  }
}
