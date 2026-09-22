import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { runMigrations } from './migrations.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 30_000 });
  try {
    const applied = await runMigrations(pool);
    console.info(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema is up to date.');
  } catch {
    // Connection errors can contain credentials or infrastructure details.
    console.error('Migration failed. Check database access and the migration ledger; no credentials were logged.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
