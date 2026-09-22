import { Pool, type PoolConfig } from 'pg';
import { type AuthStore, type AuthorizationCode, type Challenge, StorageConflictError } from './types.js';

type ChallengeRow = {
  id: string; client_id: string; address: string; chain_id: string;
  origin: string; redirect_uri: string; message_hash: string; nonce_hash: string;
  code_challenge: string; created_at: string; expires_at: string;
};
type CodeRow = {
  code_hash: string; challenge_id: string; client_id: string; account_id: string;
  address: string; chain_id: string; redirect_uri: string; code_challenge: string;
  auth_time: string; expires_at: string;
};

function safeNumber(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid integer in authentication storage');
  return result;
}

function fromChallengeRow(row: ChallengeRow): Challenge {
  return {
    id: row.id, clientId: row.client_id, address: row.address, chainId: safeNumber(row.chain_id),
    origin: row.origin, redirectUri: row.redirect_uri, messageHash: row.message_hash, nonceHash: row.nonce_hash,
    codeChallenge: row.code_challenge, createdAt: safeNumber(row.created_at), expiresAt: safeNumber(row.expires_at),
  };
}

function fromCodeRow(row: CodeRow): AuthorizationCode {
  return {
    codeHash: row.code_hash, challengeId: row.challenge_id, clientId: row.client_id, accountId: row.account_id,
    address: row.address, chainId: safeNumber(row.chain_id), redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge, authTime: safeNumber(row.auth_time), expiresAt: safeNumber(row.expires_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Production-capable atomic repository. Run migrations before creating the application. */
export class PostgresAuthStore implements AuthStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private closed = false;

  constructor(connection: string | Pool | PoolConfig) {
    this.ownsPool = !(connection instanceof Pool);
    this.pool = connection instanceof Pool ? connection : new Pool({
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      ...(typeof connection === 'string' ? { connectionString: connection } : connection),
    });
    // pg removes failed idle connections itself. Keep an idle socket error from
    // becoming an uncaught process exception; readiness still probes the database.
    if (this.ownsPool) this.pool.on('error', () => undefined);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Authentication storage is closed');
  }

  async createChallenge(challenge: Challenge): Promise<void> {
    this.assertOpen();
    try {
      await this.pool.query(`
        INSERT INTO auth_challenges
          (id, client_id, address, chain_id, origin, redirect_uri, message_hash, nonce_hash, code_challenge, created_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [challenge.id, challenge.clientId, challenge.address, challenge.chainId, challenge.origin,
        challenge.redirectUri, challenge.messageHash, challenge.nonceHash, challenge.codeChallenge,
        challenge.createdAt, challenge.expiresAt]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new StorageConflictError();
      throw error;
    }
  }

  async getChallenge(id: string): Promise<Challenge | null> {
    this.assertOpen();
    const { rows } = await this.pool.query<ChallengeRow>('SELECT * FROM auth_challenges WHERE id = $1', [id]);
    return rows[0] ? fromChallengeRow(rows[0]) : null;
  }

  async consumeChallenge(id: string, code: AuthorizationCode, now: number): Promise<boolean> {
    this.assertOpen();
    if (code.challengeId !== id || code.expiresAt <= now) return false;
    try {
      // A single statement is one PostgreSQL transaction. An insert failure rolls back
      // the delete as well. Do not add ON CONFLICT DO NOTHING, which would burn the challenge.
      const result = await this.pool.query(`
        WITH consumed AS (
          DELETE FROM auth_challenges
          WHERE id = $1 AND expires_at > $2 AND $11::bigint > $2
            AND client_id = $4 AND address = $6 AND chain_id = $7
            AND redirect_uri = $8 AND code_challenge = $9
            AND ('eip155:' || chain_id::text || ':' || lower(address)) = $5
          RETURNING id, client_id, address, chain_id, redirect_uri, code_challenge
        )
        INSERT INTO auth_authorization_codes
          (code_hash, challenge_id, client_id, account_id, address, chain_id, redirect_uri, code_challenge, auth_time, expires_at)
        SELECT $3, id, client_id, $5, address, chain_id, redirect_uri, code_challenge, $10, $11
        FROM consumed
        RETURNING code_hash
      `, [id, now, code.codeHash, code.clientId, code.accountId, code.address, code.chainId,
        code.redirectUri, code.codeChallenge, code.authTime, code.expiresAt]);
      return result.rowCount === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async consumeCode(codeHash: string, clientId: string, redirectUri: string, codeChallenge: string, now: number): Promise<AuthorizationCode | null> {
    this.assertOpen();
    const { rows } = await this.pool.query<CodeRow>(`
      DELETE FROM auth_authorization_codes
      WHERE code_hash = $1 AND client_id = $2 AND redirect_uri = $3 AND code_challenge = $4 AND expires_at > $5
      RETURNING *
    `, [codeHash, clientId, redirectUri, codeChallenge, now]);
    return rows[0] ? fromCodeRow(rows[0]) : null;
  }

  async cleanup(now: number): Promise<void> {
    this.assertOpen();
    await this.pool.query(`
      WITH expired_challenges AS (DELETE FROM auth_challenges WHERE expires_at <= $1)
      DELETE FROM auth_authorization_codes WHERE expires_at <= $1
    `, [now]);
  }

  async ready(): Promise<boolean> {
    if (this.closed) return false;
    try {
      // Probe actual tables, so a reachable but unmigrated database is not ready.
      await this.pool.query('SELECT id FROM auth_challenges LIMIT 0');
      await this.pool.query('SELECT code_hash FROM auth_authorization_codes LIMIT 0');
      return true;
    } catch { return false; }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsPool) await this.pool.end();
  }
}
