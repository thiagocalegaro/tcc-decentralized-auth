import express from 'express';
import rateLimit from 'express-rate-limit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { createAncoraClient, type AncoraSession } from '../../packages/node-sdk/src/index.js';
import { projectRoot } from '../../config.js';
import { ClientRegistry, RegistryError } from './registry.js';

export function createPortal(registry: ClientRegistry, issuer: string, csrfKey: string, database: string) {
  const client = registry.ensurePortal(issuer);
  const router = express.Router();
  type Auth = Awaited<ReturnType<typeof createAncoraClient>>;
  let auth: Auth | undefined;
  let initializing: Promise<Auth> | undefined;
  // Discovery must wait until the provider is listening (the portal is also an OIDC client).
  const getAuth = () => initializing ??= createAncoraClient({ issuer, appUrl: issuer,
    clientId: client.client_id, clientSecret: client.client_secret, database,
    allowInsecureLocalhost: true, authBasePath: '/portal/auth', sessionPath: '/portal/api/session',
    afterLogin: '/portal', afterLogout: '/portal',
    onLogin: identity => ({ userId: registry.ensureDeveloper(identity).id }),
  }).then(value => { auth = value; return value; }).catch(error => { initializing = undefined; throw error; });
  const csrf = (session: AncoraSession) => createHmac('sha256', csrfKey)
    .update(JSON.stringify(['ancora-portal', session.issuer, session.sub, session.expiresAt])).digest('hex');
  router.get('/portal', (_req, res) => res.sendFile(resolve(projectRoot, 'frontend/portal/index.html')));
  router.use('/portal-assets', express.static(resolve(projectRoot, 'frontend/portal/assets'), { index: false }));
  router.use('/portal', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(async (req, res, next) => {
    if (!req.path.startsWith('/portal/')) return next();
    const authentication = await getAuth();
    if (await authentication.handle(req, res)) return;
    next();
  });
  router.use('/portal/api', express.json({ limit: '8kb', strict: true }));
  router.use('/portal/api', async (req, res, next) => {
    const current = (await getAuth()).session(req);
    if (!current?.userId) return res.status(401).json({ error: 'Entre com sua carteira para acessar o portal.' });
    res.locals.developer = current;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const supplied = req.headers['x-csrf-token']; const expected = csrf(current);
      if (req.headers.origin !== issuer || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.status(403).json({ error: 'Sessão inválida. Atualize a página e tente novamente.' });
      }
    }
    next();
  });
  router.get('/portal/api/me', (_req, res) => res.json({ user: res.locals.developer, csrf: csrf(res.locals.developer), issuer }));
  router.get('/portal/api/example', (_req, res) => res.download(resolve(projectRoot, 'docs/exemplo-node.mjs'), 'server.mjs'));
  router.get('/portal/api/applications', (_req, res) => res.json({ applications: registry.list(res.locals.developer.userId) }));
  router.get('/portal/api/applications/:id', (req, res) => res.json({ application: registry.get(String(req.params.id), res.locals.developer.userId) }));
  router.post('/portal/api/applications', (req, res) => res.status(201).json(registry.create(res.locals.developer.userId, req.body)));
  router.patch('/portal/api/applications/:id', (req, res) => res.json({ application: registry.update(String(req.params.id), res.locals.developer.userId, req.body) }));
  router.post('/portal/api/applications/:id/rotate', (req, res) => res.json(registry.rotate(String(req.params.id), res.locals.developer.userId)));
  for (const [action, enabled] of [['enable', true], ['disable', false]] as const) {
    router.post(`/portal/api/applications/:id/${action}`, (req, res) => res.json({ application: registry.setEnabled(String(req.params.id), res.locals.developer.userId, enabled) }));
  }
  router.use('/portal/api', (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }));
  router.use(((error, _req, res, next) => {
    if (error instanceof RegistryError) return res.status(error.status).json({ error: error.message });
    next(error);
  }) as express.ErrorRequestHandler);
  return { router, close: () => auth?.close() };
}
