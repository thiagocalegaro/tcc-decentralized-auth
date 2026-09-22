import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { MemoryAuthStore } from '@tcc/storage';
import { buildAuthApp } from './app.js';

const origin = 'http://localhost:5173';
const redirectUri = `${origin}/auth/callback`;
const secret = 'unit-test-secret-with-at-least-32-characters';
const clients = [
  { id: 'demo-web', secret, origins: [origin], redirectUris: [redirectUri], chainIds: [1, 11155111] },
  { id: 'other-app', secret: 'different-client-secret-with-32-characters', origins: [origin], redirectUris: [redirectUri], chainIds: [1] },
];
const apps: Awaited<ReturnType<typeof buildAuthApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function fixture(rateLimit: number | false = false) {
  let timestamp = Date.parse('2026-09-17T20:00:00.000Z');
  const app = await buildAuthApp({ store: new MemoryAuthStore(), clients, issuer: 'http://localhost:3001', now: () => timestamp, rateLimit });
  apps.push(app);
  const account = privateKeyToAccount(generatePrivateKey());
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const headers = { origin };
  const body = { clientId: 'demo-web', address: account.address, chainId: 1, redirectUri, codeChallenge };
  async function challenge() {
    const response = await app.inject({ method: 'POST', url: '/v1/challenges', headers, payload: body });
    expect(response.statusCode).toBe(201);
    return response.json<{ challengeId: string; message: string; expiresAt: string }>();
  }
  async function proof() {
    const created = await challenge();
    const signature = await account.signMessage({ message: created.message });
    return { challengeId: created.challengeId, message: created.message, signature };
  }
  async function authorize() {
    const payload = await proof();
    const response = await app.inject({ method: 'POST', url: '/v1/verifications', headers, payload });
    expect(response.statusCode).toBe(200);
    return response.json<{ code: string }>().code;
  }
  const exchange = (code: string, changes: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/v1/exchanges', payload: { clientId: 'demo-web', clientSecret: secret, code, codeVerifier, redirectUri, ...changes } });
  return { app, account, body, headers, challenge, proof, authorize, exchange, advance: (ms: number) => { timestamp += ms; }, now: () => timestamp };
}

describe('API SIWE com assinaturas reais', () => {
  it('autentica EOA sem RPC, emite asserção verificável e publica apenas chave pública', async () => {
    const f = await fixture();
    const response = await f.exchange(await f.authorize());
    expect(response.statusCode).toBe(200);
    const jwks = (await f.app.inject('/.well-known/jwks.json')).json();
    expect(jwks.keys[0].d).toBeUndefined();
    const { payload } = await jwtVerify(response.json().assertion, createLocalJWKSet(jwks), { issuer: 'http://localhost:3001', audience: 'demo-web', algorithms: ['ES256'], currentDate: new Date(f.now()) });
    expect(payload.sub).toBe(`eip155:1:${f.account.address.toLowerCase()}`);
    expect(payload.wallet).toEqual({ address: f.account.address, chainId: 1, type: 'eoa' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('aceita exatamente uma verificação concorrente do mesmo desafio', async () => {
    const f = await fixture();
    const payload = await f.proof();
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.app.inject({ method: 'POST', url: '/v1/verifications', headers: f.headers, payload })));
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 401)).toHaveLength(7);
  });

  it('aceita exatamente uma troca concorrente do mesmo código', async () => {
    const f = await fixture();
    const code = await f.authorize();
    const responses = await Promise.all(Array.from({ length: 6 }, () => f.exchange(code)));
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 401)).toHaveLength(5);
  });

  it('não consome código diante de cliente, segredo, redirect ou PKCE incorreto', async () => {
    const f = await fixture();
    const code = await f.authorize();
    for (const changes of [
      { codeVerifier: 'x'.repeat(43) },
      { redirectUri: `${origin}/evil` },
      { clientSecret: 'wrong' },
      { clientId: 'other-app', clientSecret: clients[1]!.secret },
    ]) expect((await f.exchange(code, changes)).statusCode).toBe(401);
    expect((await f.exchange(code)).statusCode).toBe(200);
  });

  it('rejeita assinatura válida de outra conta', async () => {
    const f = await fixture();
    const payload = await f.proof();
    const attacker = privateKeyToAccount(generatePrivateKey());
    payload.signature = await attacker.signMessage({ message: payload.message });
    expect((await f.app.inject({ method: 'POST', url: '/v1/verifications', headers: f.headers, payload })).statusCode).toBe(401);
  });

  it('rejeita mensagem alterada mesmo reassinada pela carteira correta', async () => {
    const f = await fixture();
    const payload = await f.proof();
    payload.message = payload.message.replace('localhost:5173', 'evil.example');
    payload.signature = await f.account.signMessage({ message: payload.message });
    expect((await f.app.inject({ method: 'POST', url: '/v1/verifications', headers: f.headers, payload })).statusCode).toBe(401);
  });

  it('rejeita origem ausente ou divergente e não confia em Origin no corpo', async () => {
    const f = await fixture();
    for (const headers of [{}, { origin: 'https://evil.example' }]) expect((await f.app.inject({ method: 'POST', url: '/v1/challenges', headers, payload: f.body })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url: '/v1/challenges', headers: f.headers, payload: { ...f.body, origin } })).statusCode).toBe(400);
    const payload = await f.proof();
    expect((await f.app.inject({ method: 'POST', url: '/v1/verifications', headers: { origin: 'https://evil.example' }, payload })).statusCode).toBe(401);
  });

  it('rejeita rede não permitida, redirect não registrado e propriedades desconhecidas', async () => {
    const f = await fixture();
    for (const [changes, status] of [[{ chainId: 31337 }, 400], [{ redirectUri: `${origin}/other` }, 403], [{ extra: true }, 400], [{ chainId: '1' }, 400]] as const) {
      expect((await f.app.inject({ method: 'POST', url: '/v1/challenges', headers: f.headers, payload: { ...f.body, ...changes } })).statusCode).toBe(status);
    }
  });

  it('expira desafio aos cinco minutos', async () => {
    const f = await fixture();
    const payload = await f.proof();
    f.advance(300_000);
    expect((await f.app.inject({ method: 'POST', url: '/v1/verifications', headers: f.headers, payload })).statusCode).toBe(401);
  });

  it('expira código em sessenta segundos', async () => {
    const f = await fixture();
    const code = await f.authorize();
    f.advance(60_000);
    expect((await f.exchange(code)).statusCode).toBe(401);
  });

  it('bloqueia chamada de troca pelo navegador mesmo com segredo correto', async () => {
    const f = await fixture();
    const response = await f.app.inject({ method: 'POST', url: '/v1/exchanges', headers: f.headers, payload: { clientId: 'demo-web', clientSecret: secret, code: await f.authorize(), codeVerifier: 'x'.repeat(43), redirectUri } });
    expect(response.statusCode).toBe(403);
  });

  it('publica contrato OpenAPI dos endpoints implementados', async () => {
    const f = await fixture();
    const response = await f.app.inject('/openapi.json');
    expect(response.statusCode).toBe(200);
    expect(response.json().paths['/v1/challenges'].post.requestBody).toBeDefined();
  });

  it('aplica limite de tentativas', async () => {
    const f = await fixture(2);
    for (let i = 0; i < 2; i++) await f.app.inject({ method: 'POST', url: '/v1/challenges', headers: f.headers, payload: f.body });
    expect((await f.app.inject({ method: 'POST', url: '/v1/challenges', headers: f.headers, payload: f.body })).statusCode).toBe(429);
  });
});
