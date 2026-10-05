// Exemplo executável. Requer Node 22.13+ e o pacote local @ancora/node.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createAncoraClient } from '@ancora/node';

for (const key of ['ANCORA_ISSUER', 'ANCORA_CLIENT_ID', 'ANCORA_CLIENT_SECRET', 'APP_URL']) {
  if (!process.env[key]) throw new Error(`Defina ${key} no ambiente privado do backend.`);
}
mkdirSync('./private', { recursive: true, mode: 0o700 });
const db = new DatabaseSync('./private/users.sqlite');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
    address TEXT NOT NULL, chain_id INTEGER NOT NULL, UNIQUE(issuer,subject)
  );`);
const auth = await createAncoraClient({
  issuer: process.env.ANCORA_ISSUER,
  clientId: process.env.ANCORA_CLIENT_ID,
  clientSecret: process.env.ANCORA_CLIENT_SECRET,
  appUrl: process.env.APP_URL,
  database: './private/sessions.sqlite',
  allowInsecureLocalhost: process.env.NODE_ENV !== 'production',
  afterLogin: '/minha-conta',
  onLogin(identity) {
    db.prepare(`INSERT INTO users VALUES(?,?,?,?,?) ON CONFLICT(issuer,subject)
      DO UPDATE SET address=excluded.address, chain_id=excluded.chain_id`)
      .run(randomUUID(), identity.issuer, identity.sub, identity.address, identity.chainId);
    const user = db.prepare('SELECT id FROM users WHERE issuer=? AND subject=?').get(identity.issuer, identity.sub);
    return { userId: user.id };
  },
});
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${new URL(process.env.ANCORA_ISSUER).origin}`);
  try {
    if (await auth.handle(req, res)) return;
    const path = new URL(req.url, process.env.APP_URL).pathname;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (path === '/api/private') {
      const user = auth.session(req);
      res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user ? { user } : { error: 'Autenticação necessária.' })); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (path === '/minha-conta') {
      const user = auth.session(req);
      if (!user) { res.writeHead(303, { Location: '/' }); res.end(); return; }
      res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minha conta</title><h1>Minha conta</h1><p>ID local: ${escape(user.userId)}</p><p>Carteira: ${escape(user.address)}</p><form method="post" action="/auth/logout"><button>Sair deste site</button></form></html>`); return;
    }
    if (path !== '/') { res.writeHead(404); res.end('Página não encontrada.'); return; }
    res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meu site</title><h1>Meu site</h1><a href="/auth/login">Entrar com Âncora</a></html>');
  } catch { if (!res.headersSent) res.writeHead(503); res.end('Serviço indisponível.'); }
});
const appUrl = new URL(process.env.APP_URL);
if (appUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(appUrl.hostname)) throw new Error('Este launcher de exemplo só serve HTTP loopback. Para publicar, configure um servidor HTTPS e rate limits.');
server.listen(Number(appUrl.port || 80), '127.0.0.1', () => console.log(`Exemplo iniciado em ${appUrl.origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { auth.close(); db.close(); process.exit(0); }));
