import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MemoryAuthStore, PostgresAuthStore } from '@tcc/storage';
import { buildAuthApp } from './app.js';

const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const issuer = process.env.AUTH_ISSUER ?? 'http://localhost:3001';
const secret = process.env.CLIENT_SECRET;
if (!secret || secret.length < 32) throw new Error('Configure CLIENT_SECRET aleatório via npm run setup.');
const driver = process.env.STORAGE_DRIVER ?? 'memory';
if (!['memory', 'postgres'].includes(driver)) throw new Error('STORAGE_DRIVER inválido.');
if (process.env.NODE_ENV === 'production' && (driver !== 'postgres' || !origin.startsWith('https://') || !issuer.startsWith('https://'))) throw new Error('Produção exige PostgreSQL e URLs HTTPS.');
const store = driver === 'postgres' ? new PostgresAuthStore(process.env.DATABASE_URL!) : new MemoryAuthStore();
const keyFile = resolve(process.env.SIGNING_KEY_FILE ?? '.local/signing-key.json');
const signingKey = JSON.parse(await readFile(keyFile, 'utf8'));
const app = await buildAuthApp({
  store, issuer, signingKey, logger: true,
  clients: [{ id: process.env.CLIENT_ID ?? 'demo-web', secret,
    origins: [origin], redirectUris: [process.env.REDIRECT_URI ?? `${origin}/auth/callback`],
    chainIds: (process.env.CHAIN_IDS ?? '1,11155111').split(',').map(Number),
  }],
});
if (!await store.ready()) throw new Error('Persistência indisponível. Execute npm run db:migrate.');
if (driver === 'memory') app.log.warn({ event: 'development_storage', message: 'Modo memória: desafios e códigos expiram ao reiniciar.' });
await app.listen({ port: Number(process.env.AUTH_PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
