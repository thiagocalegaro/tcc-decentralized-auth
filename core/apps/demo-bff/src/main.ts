import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import fastifyStatic from '@fastify/static';
import { buildBffApp } from './app.js';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
config({ path: resolve(workspace, '.env'), quiet: true });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name} no arquivo .env.`);
  return value;
};
const production = process.env.NODE_ENV === 'production';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
if (production && !origin.startsWith('https://')) throw new Error('WEB_ORIGIN deve usar HTTPS em produção.');

const app = await buildBffApp({
  authApiUrl: process.env.AUTH_API_URL ?? 'http://localhost:3001',
  issuer: process.env.AUTH_ISSUER ?? 'http://localhost:3001',
  clientId: process.env.CLIENT_ID ?? 'demo-web',
  clientSecret: required('CLIENT_SECRET'),
  origin,
  redirectUri: process.env.REDIRECT_URI ?? `${origin}/auth/callback`,
  chainIds: (process.env.CHAIN_IDS ?? '1,11155111').split(',').map(Number),
  secureCookies: production || origin.startsWith('https://'),
  logger: { level: 'info', redact: [
    'req.headers.cookie', 'req.headers.authorization', 'req.body', 'res.headers["set-cookie"]',
    'clientSecret', 'codeVerifier', 'assertion', 'signature', 'code',
  ], serializers: { req: (request: { method?: string; url?: string }) => ({
    method: request.method, path: request.url?.split('?')[0],
  }) } },
});

const webDist = resolve(process.env.WEB_DIST_DIR ?? resolve(workspace, 'frontend/demo-web/dist'));
if (existsSync(resolve(webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: webDist });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
await app.listen({ port: Number(process.env.BFF_PORT ?? 3002), host: process.env.HOST ?? '127.0.0.1' });
