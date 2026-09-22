import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export const migrationsDirectory = fileURLToPath(new URL('../../../infra/migrations/', import.meta.url));

/** Migrations are serialized; each SQL file and ledger entry commit together. */
export async function runMigrations(pool: Pool, directory = migrationsDirectory): Promise<string[]> {
  const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  let lockAcquired = false;
  try {
    // Session-scoped lock protects the ledger across per-migration transactions.
    await client.query("SELECT pg_advisory_lock(hashtext('tcc-auth-schema-migrations'))");
    lockAcquired = true;
    await client.query(`CREATE TABLE IF NOT EXISTS auth_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const name of files) {
      const sql = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM auth_schema_migrations WHERE name = $1', [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Previously applied migration was modified: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO auth_schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    try {
      if (lockAcquired) await client.query("SELECT pg_advisory_unlock(hashtext('tcc-auth-schema-migrations'))");
    } finally {
      client.release();
    }
  }
}
