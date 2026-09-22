import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAuthStore } from '../src/index.js';
import { runMigrations } from '../src/migrations.js';
import { authStoreContract } from './contract.js';

// Real PostgreSQL only. The suite creates/drops a uniquely named test schema,
// never public/application tables. Supply a dedicated local test database URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgresAuthStore (real PostgreSQL)', () => {
  const schema = `tcc_test_${randomUUID().replaceAll('-', '')}`;
  let administration: Pool;
  let pool: Pool;
  let store: PostgresAuthStore;

  beforeAll(async () => {
    administration = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await administration.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10, options: `-c search_path=${schema}` });
    await runMigrations(pool);
  });

  authStoreContract(async () => {
    await pool.query('DELETE FROM auth_authorization_codes');
    await pool.query('DELETE FROM auth_challenges');
    store = new PostgresAuthStore(pool);
    return store;
  });

  it('is ready after migrations and migration reruns are idempotent', async () => {
    expect(await store.ready()).toBe(true);
    expect(await runMigrations(pool)).toEqual([]);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (administration) {
      try { await administration.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await administration.end(); }
    }
  });
});
