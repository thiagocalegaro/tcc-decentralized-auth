import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { buildBffApp, MemoryBffStore, type BffOptions } from '../src/app.js';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/store.js';

const ORIGIN = 'http://localhost:5173';
const ISSUER = 'http://localhost:3001';
const ADDRESS = '0x1234567890123456789012345678901234567890';
const CLIENT = 'tcc-demo';
const SECRET = 'test-client-secret-with-at-least-32-characters';
const token = () => randomBytes(32).toString('base64url');
const hash = (input: string) => createHash('sha256').update(input).digest('hex');
let signingKey: CryptoKey;
let publicJwk: Record<string, unknown>;
const apps: Array<Awaited<ReturnType<typeof buildBffApp>>> = [];
beforeAll(async () => {
  const keys = await generateKeyPair('ES256');
  signingKey = keys.privateKey;
  publicJwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function fixture(overrides: Partial<BffOptions> = {}) {
  let clock = 1_800_000_000_000;
  let mutateClaims: (claims: JWTPayload) => JWTPayload = (claims) => claims;
  let upstreamStatus = 200;
  let maliciousSignature = false;
  let exchangeBarrier: Promise<void> | undefined;
  let exchangeStarted: (() => void) | undefined;
  const codes = new Map<string, string>();
  const exchanges: Record<string, string>[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === `${ISSUER}/.well-known/jwks.json`) {
      return Response.json({ keys: [publicJwk] });
    }
    expect(String(url)).toBe(`${ISSUER}/v1/exchanges`);
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    exchanges.push(body);
    if (exchangeBarrier) {
      exchangeStarted?.();
      await exchangeBarrier;
      exchangeBarrier = undefined;
    }
    const { code, codeVerifier, clientId, clientSecret, redirectUri } = body;
    expect(clientId).toBe(CLIENT);
    expect(clientSecret).toBe(SECRET);
    expect(redirectUri).toBe(overrides.redirectUri ?? `${ORIGIN}/`);
    if (upstreamStatus !== 200) return Response.json({ secret: SECRET }, { status: upstreamStatus });
    if (!code || !codeVerifier || codes.get(code) !== createHash('sha256').update(codeVerifier).digest('base64url')) {
      return Response.json({ error: { code: 'INVALID_CODE' } }, { status: 401 });
    }
    codes.delete(code);
    const seconds = Math.floor(clock / 1000);
    const claims = mutateClaims({ iss: ISSUER, aud: CLIENT, sub: `eip155:1:${ADDRESS}`,
      iat: seconds, exp: seconds + 60, jti: token(), auth_time: seconds,
      wallet: { address: ADDRESS, chainId: 1, type: 'eoa' } });
    const key = maliciousSignature ? (await generateKeyPair('ES256')).privateKey : signingKey;
    const assertion = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'JWT' }).sign(key);
    return Response.json({ assertion, expiresIn: 60 });
  });
  const store = overrides.store ?? new MemoryBffStore();
  const app = await buildBffApp({ authApiUrl: ISSUER, issuer: ISSUER, clientId: CLIENT, clientSecret: SECRET,
    origin: ORIGIN, redirectUri: `${ORIGIN}/`, chainIds: [1, 11155111], now: () => clock,
    fetch: fetchMock, store, rateLimit: false, ...overrides });
  apps.push(app);
  const post = (url: string, body: unknown, cookie?: string) => app.inject({ method: 'POST', url,
    headers: { origin: overrides.origin ?? ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    payload: body as Record<string, unknown> });
  async function start(previousCookie?: string) {
    const response = await post('/api/auth/start', {}, previousCookie);
    expect(response.statusCode).toBe(200);
    const data = response.json<{ flowId: string; codeChallenge: string }>();
    const cookie = response.cookies.find((entry) => entry.name.endsWith('tcc_flow'))!;
    const code = token();
    codes.set(code, data.codeChallenge);
    return { ...data, code, cookie: `${cookie.name}=${cookie.value}` };
  }
  async function login(previousCookie?: string) {
    const flow = await start(previousCookie);
    const response = await post('/api/auth/complete', { flowId: flow.flowId, code: flow.code },
      `${flow.cookie}${previousCookie ? `; ${previousCookie}` : ''}`);
    return { response, flow, cookie: response.cookies.filter((entry) => entry.name.endsWith('tcc_session'))
      .map((entry) => `${entry.name}=${entry.value}`).join('; ') };
  }
  return { app, post, start, login, store, exchanges, fetchMock,
    advance: (ms: number) => { clock += ms; },
    claims: (mutator: typeof mutateClaims) => { mutateClaims = mutator; },
    status: (status: number) => { upstreamStatus = status; },
    badSignature: () => { maliciousSignature = true; },
    blockNextExchange: () => {
      let release!: () => void;
      exchangeBarrier = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { exchangeStarted = resolve; });
      return { release, started };
    },
  };
}

describe('BFF de autenticação', () => {
  it('keeps PKCE/client secret server-side and establishes a protected opaque session', async () => {
    const f = await fixture();
    const flow = await f.start();
    expect(flow.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(flow)).not.toContain(SECRET);
    const result = await f.post('/api/auth/complete', { flowId: flow.flowId, code: flow.code }, flow.cookie);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ authenticated: true, user: { accountId: `eip155:1:${ADDRESS}` } });
    expect(result.body).not.toContain('assertion');
    expect(result.body).not.toContain('codeVerifier');
    const session = result.cookies.find((entry) => entry.name === 'tcc_session')!;
    expect(session.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringMatching(/HttpOnly; SameSite=Strict/)]));
    const cookie = `tcc_session=${session.value}`;
    expect((await f.app.inject({ url: '/api/private', headers: { cookie } })).statusCode).toBe(200);
    expect((await f.app.inject({ url: '/api/private' })).statusCode).toBe(401);
    const restricted = await f.app.inject({ url: '/arearestrita' });
    expect(restricted.statusCode).toBe(302);
    expect(restricted.headers.location).toBe('/');
    const active = await f.store.getAndTouchSession(hash(session.value), 1_800_000_000_000);
    expect(active?.tokenHash).not.toBe(session.value);
    expect(await f.store.getAndTouchSession(session.value, 1_800_000_000_000)).toBeNull();
  });

  it('requires exact Origin and JSON, rejects extra properties and wrong types', async () => {
    const f = await fixture();
    for (const origin of [undefined, 'null', 'https://evil.example', `${ORIGIN}.evil.example`]) {
      const response = await f.app.inject({ method: 'POST', url: '/api/auth/start', payload: {},
        headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' } });
      expect(response.statusCode).toBe(403);
    }
    expect((await f.app.inject({ method: 'POST', url: '/api/auth/start', payload: '{}',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' } })).statusCode).toBe(415);
    expect((await f.post('/api/auth/start', { injected: true })).statusCode).toBe(400);
    expect((await f.post('/api/auth/complete', { flowId: 123, code: token() })).statusCode).toBe(400);
    expect((await f.post('/api/auth/logout', { redirect: 'https://evil.example' })).statusCode).toBe(400);
  });

  it('cannot complete another browser flow or mix a valid code with a different PKCE flow', async () => {
    const f = await fixture();
    const victim = await f.start();
    const attacker = await f.start();
    expect((await f.post('/api/auth/complete', { flowId: victim.flowId, code: victim.code }, attacker.cookie)).statusCode).toBe(401);
    expect(f.exchanges).toHaveLength(0);
    expect((await f.post('/api/auth/complete', { flowId: attacker.flowId, code: victim.code }, attacker.cookie)).statusCode).toBe(401);
    expect((await f.post('/api/auth/complete', { flowId: victim.flowId, code: victim.code }, victim.cookie)).statusCode).toBe(200);
    expect((await f.post('/api/auth/complete', { flowId: victim.flowId, code: victim.code }, victim.cookie)).statusCode).toBe(401);
  });

  it('claims a flow once under concurrent completion requests', async () => {
    const f = await fixture();
    const flow = await f.start();
    const responses = await Promise.all(Array.from({ length: 6 }, () =>
      f.post('/api/auth/complete', { flowId: flow.flowId, code: flow.code }, flow.cookie)));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(5);
    expect(f.exchanges).toHaveLength(1);
  });

  it('expires the login flow before contacting the issuer', async () => {
    const f = await fixture();
    const flow = await f.start();
    f.advance(5 * 60_000);
    expect((await f.post('/api/auth/complete', { flowId: flow.flowId, code: flow.code }, flow.cookie)).statusCode).toBe(401);
    expect(f.exchanges).toHaveLength(0);
  });

  it.each(['logout', 'new login'])('does not recreate a session after %s during exchange', async (action) => {
    const f = await fixture();
    const flow = await f.start();
    const barrier = f.blockNextExchange();
    const pending = f.post('/api/auth/complete', { flowId: flow.flowId, code: flow.code }, flow.cookie);
    // Fastify inject starts on await/then. Keep the request running until the exchange is blocked.
    const completion = Promise.resolve(pending);
    await barrier.started;
    if (action === 'logout') await f.post('/api/auth/logout', {}, flow.cookie);
    else await f.start(flow.cookie);
    barrier.release();
    const completed = await completion;
    expect(completed.statusCode).toBe(401);
    expect(completed.json().error.code).toBe('INVALID_FLOW');
    expect(completed.cookies.some((entry) => entry.name.endsWith('tcc_session'))).toBe(false);
    expect(completed.cookies.some((entry) => entry.name.endsWith('tcc_flow'))).toBe(false);
  });

  it('rotates the session and revokes it on logout', async () => {
    const f = await fixture();
    const first = await f.login();
    const second = await f.login(first.cookie);
    expect(second.response.statusCode).toBe(200);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await f.app.inject({ url: '/api/session', headers: { cookie: first.cookie } })).json()).toEqual({ authenticated: false });
    expect((await f.app.inject({ url: '/api/session', headers: { cookie: second.cookie } })).json().authenticated).toBe(true);
    const logout = await f.post('/api/auth/logout', {}, second.cookie);
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ authenticated: false });
    expect((await f.app.inject({ url: '/api/private', headers: { cookie: second.cookie } })).statusCode).toBe(401);
  });

  it('expires idle sessions after 30 minutes and active sessions after eight hours', async () => {
    const f = await fixture();
    const idle = await f.login();
    f.advance(SESSION_IDLE_MS);
    expect((await f.app.inject({ url: '/api/session', headers: { cookie: idle.cookie } })).json()).toEqual({ authenticated: false });
    const active = await f.login();
    for (let elapsed = 20 * 60_000; elapsed < SESSION_ABSOLUTE_MS; elapsed += 20 * 60_000) {
      f.advance(20 * 60_000);
      expect((await f.app.inject({ url: '/api/session', headers: { cookie: active.cookie } })).json().authenticated).toBe(true);
    }
    f.advance(20 * 60_000);
    expect((await f.app.inject({ url: '/api/session', headers: { cookie: active.cookie } })).json()).toEqual({ authenticated: false });
  });

  it.each([
    ['issuer', (p: JWTPayload) => ({ ...p, iss: 'https://evil.example' })],
    ['audience', (p: JWTPayload) => ({ ...p, aud: 'other-client' })],
    ['expired', (p: JWTPayload) => ({ ...p, exp: (p.iat as number) - 1 })],
    ['future issued', (p: JWTPayload) => ({ ...p, iat: (p.iat as number) + 10 })],
    ['missing subject', (p: JWTPayload) => { const { sub: _, ...rest } = p; return rest; }],
    ['missing jti', (p: JWTPayload) => { const { jti: _, ...rest } = p; return rest; }],
    ['wallet mismatch', (p: JWTPayload) => ({ ...p, sub: `eip155:1:0x${'a'.repeat(40)}` })],
    ['unknown chain', (p: JWTPayload) => ({ ...p, wallet: { address: ADDRESS, chainId: 10, type: 'eoa' } })],
    ['unsupported contract wallet', (p: JWTPayload) => ({ ...p, wallet: { address: ADDRESS, chainId: 1, type: 'contract' } })],
    ['future authentication', (p: JWTPayload) => ({ ...p, auth_time: (p.iat as number) + 1 })],
    ['long lifetime', (p: JWTPayload) => ({ ...p, exp: (p.iat as number) + 3600 })],
  ])('rejects an assertion with %s', async (_label, mutator) => {
    const f = await fixture();
    f.claims(mutator);
    const { response, cookie } = await f.login();
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_ASSERTION');
    expect(cookie).toBe('');
  });

  it('rejects a forged signature and an assertion replay', async () => {
    const forged = await fixture();
    forged.badSignature();
    expect((await forged.login()).response.statusCode).toBe(401);
    const f = await fixture();
    f.claims((p) => ({ ...p, jti: 'repeated-assertion-identifier' }));
    expect((await f.login()).response.statusCode).toBe(200);
    const replay = await f.login();
    expect(replay.response.statusCode).toBe(401);
    expect(replay.response.json().error.code).toBe('ASSERTION_REPLAYED');
  });

  it('does not leak upstream error bodies and fails closed on network errors', async () => {
    const f = await fixture();
    f.status(500);
    const failed = await f.login();
    expect(failed.response.statusCode).toBe(502);
    expect(failed.response.body).not.toContain(SECRET);
    const unavailable = await fixture({ fetch: vi.fn().mockRejectedValue(new Error(`secret=${SECRET}`)) });
    const error = await unavailable.login();
    expect(error.response.statusCode).toBe(502);
    expect(error.response.body).not.toContain(SECRET);
  });

  it('bounds flow memory, cleans expired entries, and uses host-only Secure cookies on HTTPS', async () => {
    const f = await fixture({ store: new MemoryBffStore(10, 1) });
    await f.start();
    expect((await f.post('/api/auth/start', {})).statusCode).toBe(503);
    f.advance(5 * 60_000);
    expect((await f.post('/api/auth/start', {})).statusCode).toBe(200);
    const secure = await fixture({ origin: 'https://demo.example', redirectUri: 'https://demo.example/' });
    const response = await secure.post('/api/auth/start', {});
    expect(String(response.headers['set-cookie'])).toContain('__Host-tcc_flow=');
    expect(String(response.headers['set-cookie'])).toContain('Secure');
    expect(String(response.headers['set-cookie'])).not.toContain('Domain=');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['cache-control']).toBe('no-store');
    const authenticated = await secure.login();
    expect(authenticated.response.statusCode).toBe(200);
    expect(String(authenticated.response.headers['set-cookie'])).toMatch(/__Host-tcc_session=.+Secure/);
  });
});
