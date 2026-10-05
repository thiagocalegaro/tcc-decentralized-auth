import { randomBytes, randomUUID } from 'node:crypto';
import type { SqliteStore } from '../../packages/node-sdk/src/storage.js';
import { validateUrl, validateLocalPath, type AncoraIdentity } from '../../packages/node-sdk/src/index.js';
import type { RegisteredClient } from '../../config.js';

interface Row { id: string; owner_id: string | null; metadata: string; enabled: number; created_at: number; updated_at: number }
export interface ApplicationInput { name: string; appUrl: string; callbackPath: string; logoutPath: string }
export class RegistryError extends Error { constructor(public status: number, message: string) { super(message); } }
const secret = () => randomBytes(32).toString('base64url');

export class ClientRegistry {
  constructor(private store: SqliteStore) {
    store.db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS developers (
      id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, address TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(issuer,subject));
      CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, owner_id TEXT REFERENCES developers(id), metadata TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS application_owner ON applications(owner_id);`);
  }
  seed(client: RegisteredClient) {
    this.store.db.prepare('INSERT OR IGNORE INTO applications VALUES(?,NULL,?,1,?,?)')
      .run(client.client_id, JSON.stringify(client), Date.now(), Date.now());
  }
  ensurePortal(issuer: string) {
    this.seed({ client_id: 'ancora-portal', client_secret: secret(), client_name: 'Portal de desenvolvedores Âncora',
      redirect_uris: [`${issuer}/portal/auth/callback`], post_logout_redirect_uris: [`${issuer}/portal`],
      response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_post' });
    return this.findEnabled('ancora-portal')!;
  }
  ensureDeveloper(identity: Readonly<AncoraIdentity>) {
    this.store.db.prepare(`INSERT INTO developers VALUES(?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET address=excluded.address`)
      .run(randomUUID(), identity.issuer, identity.sub, identity.address, Date.now());
    return this.store.db.prepare('SELECT id FROM developers WHERE issuer=? AND subject=?').get(identity.issuer, identity.sub) as { id: string };
  }
  findEnabled(id: string): RegisteredClient | undefined {
    const row = this.store.db.prepare('SELECT metadata FROM applications WHERE id=? AND enabled=1').get(id) as { metadata: string } | undefined;
    return row ? JSON.parse(row.metadata) : undefined;
  }
  logoutOrigins() {
    return [...new Set((this.store.db.prepare('SELECT metadata FROM applications WHERE enabled=1').all() as { metadata: string }[])
      .flatMap(row => (JSON.parse(row.metadata) as RegisteredClient).post_logout_redirect_uris.map(uri => new URL(uri).origin)))];
  }
  private owned(id: string, owner: string) {
    const row = this.store.db.prepare('SELECT * FROM applications WHERE id=? AND owner_id=?').get(id, owner) as Row | undefined;
    if (!row) throw new RegistryError(404, 'Aplicação não encontrada.');
    return row;
  }
  private publicView(row: Row) {
    const metadata = JSON.parse(row.metadata) as RegisteredClient;
    return { id: row.id, name: metadata.client_name, appUrl: new URL(metadata.redirect_uris[0]).origin,
      redirectUri: metadata.redirect_uris[0], logoutUri: metadata.post_logout_redirect_uris[0],
      enabled: !!row.enabled, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  list(owner: string) { return (this.store.db.prepare('SELECT * FROM applications WHERE owner_id=? ORDER BY created_at DESC').all(owner) as unknown as Row[]).map(row => this.publicView(row)); }
  get(id: string, owner: string) { return this.publicView(this.owned(id, owner)); }
  private validate(input: ApplicationInput) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\x00-\x1f]/.test(input.name)) throw new RegistryError(400, 'Informe um nome de até 80 caracteres.');
    try {
      if (typeof input.appUrl !== 'string' || input.appUrl.length > 2048 || typeof input.callbackPath !== 'string' || typeof input.logoutPath !== 'string') throw new Error();
      const origin = validateUrl(input.appUrl, true).origin;
      const callbackPath = validateLocalPath(input.callbackPath);
      const logoutPath = validateLocalPath(input.logoutPath);
      if (callbackPath === '/' || !callbackPath.endsWith('/callback')) throw new Error();
      return { name: input.name.trim(), origin, redirectUri: new URL(callbackPath, origin).href, logoutUri: new URL(logoutPath, origin).href };
    } catch { throw new RegistryError(400, 'Use HTTPS (ou HTTP localhost), sem credenciais. O callback deve ser um caminho local terminado em /callback.'); }
  }
  create(owner: string, input: ApplicationInput) {
    const values = this.validate(input);
    const count = this.store.db.prepare('SELECT count(*) AS count FROM applications WHERE owner_id=?').get(owner) as { count: number };
    if (count.count >= 25) throw new RegistryError(409, 'Limite de 25 aplicações por desenvolvedor neste protótipo.');
    const client: RegisteredClient = { client_id: `app_${randomBytes(16).toString('hex')}`, client_secret: secret(), client_name: values.name,
      redirect_uris: [values.redirectUri], post_logout_redirect_uris: [values.logoutUri],
      response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_post' };
    this.store.db.prepare('INSERT INTO applications VALUES(?,?,?,1,?,?)').run(client.client_id, owner, JSON.stringify(client), Date.now(), Date.now());
    return { application: this.get(client.client_id, owner), clientSecret: client.client_secret };
  }
  update(id: string, owner: string, input: ApplicationInput) {
    const row = this.owned(id, owner); const values = this.validate(input);
    const client = JSON.parse(row.metadata) as RegisteredClient;
    client.client_name = values.name; client.redirect_uris = [values.redirectUri]; client.post_logout_redirect_uris = [values.logoutUri];
    this.store.db.prepare('UPDATE applications SET metadata=?,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(client), Date.now(), id, owner);
    return this.get(id, owner);
  }
  setEnabled(id: string, owner: string, enabled: boolean) {
    this.owned(id, owner);
    this.store.db.prepare('UPDATE applications SET enabled=?,updated_at=? WHERE id=? AND owner_id=?').run(enabled ? 1 : 0, Date.now(), id, owner);
    return this.get(id, owner);
  }
  rotate(id: string, owner: string) {
    const client = JSON.parse(this.owned(id, owner).metadata) as RegisteredClient;
    client.client_secret = secret();
    this.store.db.prepare('UPDATE applications SET metadata=?,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(client), Date.now(), id, owner);
    return { application: this.get(id, owner), clientSecret: client.client_secret };
  }
}
