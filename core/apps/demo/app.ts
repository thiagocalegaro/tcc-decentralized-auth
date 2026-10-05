import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolve } from 'node:path';
import { createAncoraClient } from '../../packages/node-sdk/src/index.js';
import { projectRoot, type DemoSettings } from '../../config.js';
import { security, errorHandler } from '../../http.js';
import { LocalUsers } from './users.js';

export async function createDemoApp(settings: DemoSettings, database: string) {
  const users = new LocalUsers(database);
  const auth = await createAncoraClient({ ...settings, database, allowInsecureLocalhost: true,
    afterLogin: '/arearestrita',
    onLogin: identity => ({ userId: users.findOrCreate(identity).id }),
  }).catch(error => { users.close(); throw error; });
  const app = express();
  // Browsers apply form-action to the redirect from local POST logout to the OIDC provider.
  security(app, settings.appUrl.startsWith('https:'), [new URL(settings.issuer).origin]);
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(async (req, res, next) => { if (!await auth.handle(req, res)) next(); });
  app.use('/assets', express.static(resolve(projectRoot, 'frontend/shared')));
  app.get('/demo-assets/main.js', (_req, res) => res.sendFile(resolve(projectRoot, 'frontend/demo/main.js')));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: settings.clientId }));
  app.get('/api/config', (_req, res) => res.json({ name: settings.name, theme: settings.theme, peerUrl: settings.peerUrl, issuer: settings.issuer }));
  app.get('/', (_req, res) => res.sendFile(resolve(projectRoot, 'frontend/demo/index.html')));
  app.get('/arearestrita', (req, res) => {
    if (!auth.session(req)) return res.redirect(303, '/');
    res.sendFile(resolve(projectRoot, 'frontend/demo/restricted.html'));
  });
  app.get('/api/private', (req, res) => {
    const user = auth.session(req);
    if (!user) return res.status(401).json({ error: 'Autenticação necessária.' });
    res.json({ message: `Você acessou o conteúdo protegido de ${settings.name}.`, user, application: settings.clientId });
  });
  app.use(errorHandler);
  return { app, auth, close: () => { auth.close(); users.close(); } };
}
