import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../../packages/node-sdk/src/storage.js';
import type { AncoraIdentity } from '../../packages/node-sdk/src/index.js';

/** This is the application's user database, not an Âncora-global user id. */
export class LocalUsers {
  private store: SqliteStore;
  constructor(path: string) {
    this.store = new SqliteStore(path);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
      address TEXT NOT NULL, chain_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(issuer,subject)
    )`);
  }
  findOrCreate(identity: Readonly<AncoraIdentity>) {
    this.store.db.prepare(`INSERT INTO app_users VALUES(?,?,?,?,?,?) ON CONFLICT(issuer,subject)
      DO UPDATE SET address=excluded.address,chain_id=excluded.chain_id`)
      .run(randomUUID(), identity.issuer, identity.sub, identity.address, identity.chainId, Date.now());
    return this.store.db.prepare('SELECT id FROM app_users WHERE issuer=? AND subject=?')
      .get(identity.issuer, identity.sub) as { id: string };
  }
  close() { this.store.close(); }
}
