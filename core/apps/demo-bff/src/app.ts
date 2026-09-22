import { createHash, randomBytes } from 'node:crypto';
import fastify, { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose';
import {
  FLOW_LIFETIME_MS, FlowCancelledError, MemoryBffStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, StoreCapacityError,
  type BffStore, type Session, type SessionUser,
} from './store.js';

export { MemoryBffStore } from './store.js';
export type { BffStore, Session, SessionUser } from './store.js';

export interface BffOptions {
  authApiUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  origin: string;
  redirectUri: string;
  chainIds: number[];
  store?: BffStore;
  secureCookies?: boolean;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  logger?: FastifyServerOptions['logger'];
  rateLimit?: boolean;
}

const TOKEN_PATTERN = '^[A-Za-z0-9_-]{43}$';
const tokenRegex = new RegExp(TOKEN_PATTERN);
const emptyBody = { type: 'object', additionalProperties: false, maxProperties: 0 } as const;
const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

export async function buildBffApp(options: BffOptions) {
  validateOptions(options);
  const now = options.now ?? Date.now;
  const store = options.store ?? new MemoryBffStore();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const secure = options.secureCookies ?? new URL(options.origin).protocol === 'https:';
  const sessionCookie = secure ? '__Host-tcc_session' : 'tcc_session';
  const flowCookie = secure ? '__Host-tcc_flow' : 'tcc_flow';
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure };
  const authBase = options.authApiUrl.replace(/\/$/, '');
  const jwks = createRemoteJWKSet(new URL(`${authBase}/.well-known/jwks.json`), {
    [customFetch]: (url, init) => fetchImpl(url, { ...init, redirect: 'error' }),
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  const app = fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        connectSrc: ["'self'", new URL(options.authApiUrl).origin],
        imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], objectSrc: ["'none'"],
        baseUri: ["'self'"], frameAncestors: ["'none'"],
        upgradeInsecureRequests: secure ? [] : null,
      },
    },
    strictTransportSecurity: secure ? { maxAge: 31536000, includeSubDomains: false } : false,
  });
  if (options.rateLimit !== false) {
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (mutationMethods.has(request.method)) {
      if (request.headers.origin !== options.origin) {
        return fail(reply, 403, 'ORIGIN_REJECTED', 'Origem da solicitação não permitida.');
      }
      if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) {
        return fail(reply, 415, 'JSON_REQUIRED', 'Envie a solicitação como JSON.');
      }
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error && typeof error === 'object'
      ? error as { validation?: unknown; statusCode?: number } : {};
    if (error instanceof FlowCancelledError) {
      return fail(reply, 401, 'INVALID_FLOW', 'O fluxo foi cancelado ou expirou. Inicie novamente.');
    }
    if (error instanceof StoreCapacityError) {
      return fail(reply, 503, 'CAPACITY_REACHED', 'Serviço temporariamente ocupado. Tente novamente.');
    }
    if (known.validation || known.statusCode === 400 || known.statusCode === 413 || known.statusCode === 415) {
      return fail(reply, known.statusCode ?? 400, 'INVALID_REQUEST', 'Solicitação inválida.');
    }
    if (known.statusCode === 429) return fail(reply, 429, 'RATE_LIMITED', 'Aguarde antes de tentar novamente.');
    // Do not log upstream exceptions: they may contain credentials or response bodies.
    app.log.error({ code: 'BFF_INTERNAL_ERROR' }, 'Falha interna do BFF');
    return fail(reply, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a solicitação.');
  });
  app.setNotFoundHandler((_request, reply) => fail(reply, 404, 'NOT_FOUND', 'Recurso não encontrado.'));

  const cleanup = setInterval(() => {
    void store.cleanup(now()).catch(() => app.log.error({ code: 'STORE_CLEANUP_FAILED' }, 'Falha de limpeza'));
  }, 60_000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); });

  async function readSession(request: FastifyRequest, reply: FastifyReply): Promise<Session | null> {
    const token = request.cookies[sessionCookie];
    if (!token) return null;
    const session = tokenRegex.test(token) ? await store.getAndTouchSession(sha256(token), now()) : null;
    if (!session) reply.clearCookie(sessionCookie, cookieOptions);
    return session;
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post('/api/auth/start', { schema: { body: emptyBody } }, async (request, reply) => {
    const oldFlow = request.cookies[flowCookie];
    if (oldFlow && tokenRegex.test(oldFlow)) await store.deleteFlowsByCookie(sha256(oldFlow));
    const flowId = randomToken();
    const cookieToken = randomToken();
    const codeVerifier = randomToken();
    await store.createFlow({ id: flowId, cookieHash: sha256(cookieToken), codeVerifier,
      expiresAt: now() + FLOW_LIFETIME_MS }, now());
    reply.setCookie(flowCookie, cookieToken, { ...cookieOptions, maxAge: FLOW_LIFETIME_MS / 1000 });
    return { flowId, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      clientId: options.clientId, authApiUrl: authBase, redirectUri: options.redirectUri,
      chainIds: [...options.chainIds] };
  });

  app.post<{ Body: { flowId: string; code: string } }>('/api/auth/complete', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['flowId', 'code'],
      properties: { flowId: { type: 'string', pattern: TOKEN_PATTERN },
        code: { type: 'string', pattern: TOKEN_PATTERN } } } },
  }, async (request, reply) => {
    const cookieToken = request.cookies[flowCookie];
    if (!cookieToken || !tokenRegex.test(cookieToken)) {
      return fail(reply, 401, 'INVALID_FLOW', 'Inicie uma nova autenticação neste navegador.');
    }
    const flow = await store.consumeFlow(request.body.flowId, sha256(cookieToken), now());
    if (!flow) return fail(reply, 401, 'INVALID_FLOW', 'O fluxo expirou ou já foi utilizado.');

    let assertion: unknown;
    try {
      const response = await fetchImpl(`${authBase}/v1/exchanges`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ clientId: options.clientId, clientSecret: options.clientSecret,
          code: request.body.code, codeVerifier: flow.codeVerifier, redirectUri: options.redirectUri }),
        signal: AbortSignal.timeout(5_000), redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        return fail(reply, response.status >= 500 ? 502 : 401, 'EXCHANGE_FAILED',
          'Não foi possível confirmar a autenticação. Inicie novamente.');
      }
      const body: unknown = await readSmallJson(response);
      if (!body || typeof body !== 'object' || !('assertion' in body)) throw new Error();
      assertion = body.assertion;
    } catch {
      return fail(reply, 502, 'AUTH_UNAVAILABLE', 'O serviço de autenticação não respondeu corretamente.');
    }

    let user: SessionUser;
    let payload: JWTPayload;
    try {
      if (typeof assertion !== 'string' || assertion.length > 12_000) throw new Error();
      const verified = await jwtVerify(assertion, jwks, {
        algorithms: ['ES256'], issuer: options.issuer, audience: options.clientId,
        typ: 'JWT', currentDate: new Date(now()), clockTolerance: 0,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'jti', 'auth_time'],
        maxTokenAge: 90,
      });
      payload = verified.payload;
      user = validateClaims(payload, options.chainIds, now());
    } catch {
      return fail(reply, 401, 'INVALID_ASSERTION', 'A prova de autenticação foi rejeitada.');
    }
    const timestamp = now();
    const token = randomToken();
    const session: Session = { tokenHash: sha256(token), user, createdAt: timestamp,
      lastSeenAt: timestamp, absoluteExpiresAt: timestamp + SESSION_ABSOLUTE_MS };
    const previousToken = request.cookies[sessionCookie];
    const created = await store.createSession(session, `${options.issuer}|${payload.jti as string}`,
      (payload.exp as number) * 1000,
      previousToken && tokenRegex.test(previousToken) ? sha256(previousToken) : null, timestamp, flow.id);
    if (!created) return fail(reply, 401, 'ASSERTION_REPLAYED', 'Esta prova já foi utilizada.');
    // A cancelled older request must not clear the cookie created by a newer /start.
    reply.clearCookie(flowCookie, cookieOptions);
    reply.setCookie(sessionCookie, token, { ...cookieOptions, maxAge: SESSION_ABSOLUTE_MS / 1000 });
    return sessionResponse(session);
  });

  app.get('/api/session', async (request, reply) => {
    const session = await readSession(request, reply);
    return session ? sessionResponse(session) : { authenticated: false };
  });
  app.get('/api/private', async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) return fail(reply, 401, 'UNAUTHENTICATED', 'Autentique-se para acessar este recurso.');
    return { message: 'Acesso autorizado pelo backend à área protegida.', accountId: session.user.accountId };
  });
  app.get('/arearestrita', async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) return reply.redirect('/');
    // @fastify/static decorates reply before the server starts (see main.ts).
    return reply.type('text/html; charset=utf-8').sendFile('index.html');
  });
  app.post('/api/auth/logout', { schema: { body: emptyBody } }, async (request, reply) => {
    const token = request.cookies[sessionCookie];
    const flow = request.cookies[flowCookie];
    if (token && tokenRegex.test(token)) await store.deleteSession(sha256(token));
    if (flow && tokenRegex.test(flow)) await store.deleteFlowsByCookie(sha256(flow));
    reply.clearCookie(sessionCookie, cookieOptions);
    reply.clearCookie(flowCookie, cookieOptions);
    return { authenticated: false };
  });
  return app;
}

function sessionResponse(session: Session) {
  return { authenticated: true as const, user: session.user,
    expiresAt: new Date(Math.min(session.absoluteExpiresAt, session.lastSeenAt + SESSION_IDLE_MS)).toISOString() };
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function validateClaims(payload: JWTPayload, chainIds: number[], now: number): SessionUser {
  const seconds = Math.floor(now / 1000);
  if (typeof payload.jti !== 'string' || payload.jti.length < 16 || payload.jti.length > 256 ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      !Number.isSafeInteger(payload.auth_time) || (payload.auth_time as number) > seconds ||
      (payload.auth_time as number) > (payload.iat as number) ||
      seconds - (payload.auth_time as number) > 10 * 60 ||
      (payload.exp as number) - (payload.iat as number) > 90 ||
      (payload.exp as number) <= (payload.iat as number)) throw new Error();
  const wallet = payload.wallet;
  if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet)) throw new Error();
  const { address, chainId, type } = wallet as Record<string, unknown>;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address) ||
      typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || !chainIds.includes(chainId) ||
      type !== 'eoa') throw new Error();
  const accountId = `eip155:${chainId}:${address.toLowerCase()}`;
  if (payload.sub !== accountId) throw new Error();
  return { accountId, address: address.toLowerCase(), chainId };
}

function validateOptions(options: BffOptions): void {
  for (const value of [options.authApiUrl, options.origin, options.redirectUri]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
      throw new Error('URLs devem usar HTTPS, exceto em localhost.');
    }
  }
  if (new URL(options.origin).origin !== options.origin ||
      new URL(options.redirectUri).origin !== options.origin ||
      new URL(options.authApiUrl).search || !options.issuer || !options.clientId ||
      options.clientSecret.length < 32 || options.chainIds.length === 0 ||
      options.chainIds.some((chain) => !Number.isSafeInteger(chain) || chain <= 0)) {
    throw new Error('Configuração inválida do BFF. Confira origem, cliente e redes.');
  }
  if (options.secureCookies === false && new URL(options.origin).protocol === 'https:') {
    throw new Error('Cookies Secure são obrigatórios em HTTPS.');
  }
}

async function readSmallJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error();
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
