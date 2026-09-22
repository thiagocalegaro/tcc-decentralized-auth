/** All timestamps use Unix milliseconds. Never persist raw nonces or authorization codes. */
export interface Challenge {
  id: string;
  clientId: string;
  address: string;
  chainId: number;
  origin: string;
  redirectUri: string;
  messageHash: string;
  nonceHash: string;
  codeChallenge: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthorizationCode {
  codeHash: string;
  challengeId: string;
  clientId: string;
  accountId: string;
  address: string;
  chainId: number;
  redirectUri: string;
  codeChallenge: string;
  authTime: number;
  expiresAt: number;
}

export interface AuthStore {
  readonly kind: 'memory' | 'postgres';
  createChallenge(challenge: Challenge): Promise<void>;
  getChallenge(id: string): Promise<Challenge | null>;
  consumeChallenge(id: string, code: AuthorizationCode, now: number): Promise<boolean>;
  consumeCode(codeHash: string, clientId: string, redirectUri: string, codeChallenge: string, now: number): Promise<AuthorizationCode | null>;
  cleanup(now: number): Promise<void>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

/** Map to a generic 503 response, without exposing stored values. */
export class StorageCapacityError extends Error {
  constructor() {
    super('Authentication storage capacity reached');
    this.name = 'StorageCapacityError';
  }
}

export class StorageConflictError extends Error {
  constructor() {
    super('Authentication record already exists');
    this.name = 'StorageConflictError';
  }
}

export function matchesChallenge(challenge: Challenge, code: AuthorizationCode): boolean {
  return code.challengeId === challenge.id
    && code.clientId === challenge.clientId
    && code.address === challenge.address
    && code.chainId === challenge.chainId
    && code.accountId === `eip155:${challenge.chainId}:${challenge.address.toLowerCase()}`
    && code.redirectUri === challenge.redirectUri
    && code.codeChallenge === challenge.codeChallenge;
}
