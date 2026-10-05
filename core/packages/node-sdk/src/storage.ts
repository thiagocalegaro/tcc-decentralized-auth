import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Single-host persistent store. Store one database per application. */
export class SqliteStore {
  readonly db: DatabaseSync;
  private cleanup: NodeJS.Timeout;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        namespace TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        expires INTEGER NOT NULL, PRIMARY KEY (namespace,id)
      );
      CREATE INDEX IF NOT EXISTS record_expiry ON records(expires);
      CREATE INDEX IF NOT EXISTS record_grants ON records(json_extract(payload,'$.grantId'));
      CREATE INDEX IF NOT EXISTS record_uid ON records(namespace,json_extract(payload,'$.uid'));`);
    this.prune();
    this.cleanup = setInterval(() => this.prune(), 60_000);
    this.cleanup.unref();
  }
  put(namespace: string, id: string, payload: unknown, ttlSeconds: number) {
    this.db.prepare(`INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(namespace,id)
      DO UPDATE SET payload=excluded.payload, expires=excluded.expires`)
      .run(namespace, id, JSON.stringify(payload), Date.now() + ttlSeconds * 1000);
  }
  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT payload FROM records WHERE namespace=? AND id=? AND expires>?')
      .get(namespace, id, Date.now()) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }
  /** DELETE RETURNING makes one-use state consumption atomic before any await. */
  take<T>(namespace: string, id: string): T | undefined {
    const row = this.db.prepare('DELETE FROM records WHERE namespace=? AND id=? AND expires>? RETURNING payload')
      .get(namespace, id, Date.now()) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }
  delete(namespace: string, id: string) {
    this.db.prepare('DELETE FROM records WHERE namespace=? AND id=?').run(namespace, id);
  }
  findBy<T>(namespace: string, field: 'uid' | 'userCode', value: string): T | undefined {
    const row = this.db.prepare(`SELECT payload FROM records WHERE namespace=?
      AND json_extract(payload,'$.${field}')=? AND expires>? LIMIT 1`).get(namespace, value, Date.now()) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }
  consume(namespace: string, id: string) {
    const result = this.db.prepare(`UPDATE records SET payload=json_set(payload,'$.consumed',?)
      WHERE namespace=? AND id=? AND expires>? AND json_extract(payload,'$.consumed') IS NULL`)
      .run(Math.floor(Date.now() / 1000), namespace, id, Date.now());
    if (result.changes !== 1) throw new Error('Object expired or already consumed');
  }
  revokeGrant(grantId: string) {
    this.db.prepare("DELETE FROM records WHERE json_extract(payload,'$.grantId')=?").run(grantId);
  }
  prune() { this.db.prepare('DELETE FROM records WHERE expires<=?').run(Date.now()); }
  close() { clearInterval(this.cleanup); this.db.close(); }
}
