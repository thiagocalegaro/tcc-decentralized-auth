import Fastify, { LogController, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimitPlugin from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import type { AuthStore } from '@tcc/storage';
import { ASSERTION_TTL_SECONDS, CHALLENGE_TTL_MS, CODE_TTL_MS, type ChallengeRequest, type ExchangeRequest, type VerificationRequest } from '@tcc/protocol';

export interface AuthClient {
  id: string;
  secret: string;
  origins: string[];
  redirectUris: string[];
  chainIds: number[];
}
export interface AuthOptions {
  store: AuthStore;
  clients: AuthClient[];
  issuer: string;
  signingKey?: JWK;
  now?: () => number;
  logger?: boolean;
  rateLimit?: number | false;
}
export function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }
function s256(value: string) { return createHash('sha256').update(value).digest('base64url'); }
function opaque() { return randomBytes(32).toString('base64url'); }
class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const authFailure = () => new AuthError(401, 'AUTHENTICATION_FAILED', 'Não foi possível validar esta autenticação. Inicie novamente.');
const str = (maxLength: number, pattern?: string) => ({ type: 'string', minLength: 1, maxLength, ...(pattern ? { pattern } : {}) });
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const challengeBody = object({ clientId: str(100), address: str(42, '^0x[0-9a-fA-F]{40}$'), chainId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, redirectUri: str(2048), codeChallenge: str(43, '^[A-Za-z0-9_-]{43}$') });
const verificationBody = object({ challengeId: str(100), message: str(4096), signature: str(132, '^0x[0-9a-fA-F]{130}$') });
const exchangeBody = object({ clientId: str(100), clientSecret: str(256), code: str(100), codeVerifier: str(128, '^[A-Za-z0-9._~-]{43,128}$'), redirectUri: str(2048) });

export async function buildAuthApp(options: AuthOptions) {
  const now = options.now ?? Date.now;
  if (options.clients.length === 0) throw new Error('Configure pelo menos um cliente.');
  const clients = new Map(options.clients.map((client) => [client.id, { ...client, secretHash: sha256(client.secret) }]));
  for (const client of options.clients) {
    if (client.secret.length < 32) throw new Error('CLIENT_SECRET deve conter pelo menos 32 caracteres.');
    for (const uri of client.redirectUris) if (!client.origins.includes(new URL(uri).origin)) throw new Error('A origem do redirect precisa constar nas origens permitidas.');
  }
  let key = options.signingKey;
  if (!key) {
    const pair = await generateKeyPair('ES256', { extractable: true });
    key = { ...await exportJWK(pair.privateKey), kid: opaque(), alg: 'ES256', use: 'sig' };
  }
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.d || !key.kid) throw new Error('A chave deve ser JWK privada ES256 com kid.');
  const signingKey = await importJWK(key, 'ES256');
  const publicKey: JWK = { kty: key.kty, crv: key.crv, x: key.x, y: key.y, kid: key.kid, alg: 'ES256', use: 'sig' };
  const app = Fastify({
    bodyLimit: 8192,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers["set-cookie"]'] } : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(helmet);
  await app.register(cors, {
    origin(origin, cb) { cb(null, !!origin && options.clients.some((client) => client.origins.includes(origin))); },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  await app.register(swagger, { openapi: { info: { title: 'Âncora - autenticação SIWE', version: '0.1.0', description: 'Protótipo acadêmico EOA; contrato próprio de integração, não é um provedor OAuth/OIDC.' } } });
  if (options.rateLimit !== false) await app.register(rateLimitPlugin, { max: options.rateLimit ?? 60, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AuthError) {
      app.log.info({ event: 'authentication_rejected', requestId: request.id, code: error.code });
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation || error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415) return reply.code(error.statusCode ?? 400).send({ error: { code: 'INVALID_REQUEST', message: 'Solicitação inválida.' } });
    if (error.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um minuto.' } });
    if (error.name === 'StorageCapacityError') return reply.code(503).send({ error: { code: 'BUSY', message: 'Serviço ocupado. Tente novamente.' } });
    // Database errors may contain request data. Log only the class, never the message or body.
    app.log.error({ event: 'internal_failure', requestId: request.id, errorType: error.name });
    return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Serviço indisponível. Tente novamente.' } });
  });
  const audit = (event: string, clientId: string, account: string, requestId: string) => app.log.info({ event, clientId, accountHash: sha256(account), requestId });
  const cleanup = setInterval(() => { void options.store.cleanup(now()).catch(() => app.log.error({ event: 'cleanup_failed' })); }, 60_000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); await options.store.close(); });

  app.get('/health/live', async () => ({ status: 'ok', version: '0.1.0', walletSupport: 'eoa' }));
  app.get('/health/ready', async (_request, reply) => {
    const ready = await options.store.ready();
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable', storage: options.store.kind });
  });
  app.get('/.well-known/jwks.json', async () => ({ keys: [publicKey] }));
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.post<{ Body: ChallengeRequest }>('/v1/challenges', { schema: { tags: ['Autenticação'], summary: 'Criar desafio SIWE vinculado a origem e PKCE S256', body: challengeBody } }, async (request, reply) => {
    const body = request.body;
    const client = clients.get(body.clientId);
    const origin = request.headers.origin;
    if (!client || !origin || !client.origins.includes(origin) || !client.redirectUris.includes(body.redirectUri) || new URL(body.redirectUri).origin !== origin) throw new AuthError(403, 'ORIGIN_NOT_ALLOWED', 'Aplicação ou origem não permitida.');
    if (!client.chainIds.includes(body.chainId)) throw new AuthError(400, 'CHAIN_NOT_ALLOWED', 'Selecione uma rede permitida pela aplicação.');
    let address: Hex;
    try { address = getAddress(body.address); } catch { throw new AuthError(400, 'INVALID_REQUEST', 'Endereço de carteira inválido.'); }
    const createdAt = now();
    const expiresAt = createdAt + CHALLENGE_TTL_MS;
    const nonce = randomBytes(32).toString('hex');
    const challengeId = opaque();
    const url = new URL(origin);
    const message = createSiweMessage({
      scheme: url.protocol.slice(0, -1), domain: url.host, address, chainId: body.chainId,
      uri: body.redirectUri, version: '1', nonce,
      statement: 'Entrar no Ancora. Esta assinatura nao autoriza transacoes nem movimenta fundos.',
      issuedAt: new Date(createdAt), expirationTime: new Date(expiresAt), requestId: challengeId,
    });
    await options.store.createChallenge({
      id: challengeId, clientId: client.id, address, chainId: body.chainId, origin, redirectUri: body.redirectUri,
      messageHash: sha256(message), nonceHash: sha256(nonce), codeChallenge: body.codeChallenge, createdAt, expiresAt,
    });
    audit('challenge_created', client.id, address, request.id);
    return reply.code(201).send({ challengeId, message, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.post<{ Body: VerificationRequest }>('/v1/verifications', { schema: { tags: ['Autenticação'], summary: 'Validar assinatura EOA e consumir desafio uma vez', body: verificationBody } }, async (request) => {
    const body = request.body;
    const challenge = await options.store.getChallenge(body.challengeId);
    const timestamp = now();
    if (!challenge || challenge.expiresAt <= timestamp || challenge.origin !== request.headers.origin || challenge.messageHash !== sha256(body.message)) throw authFailure();
    const expectedOrigin = new URL(challenge.origin);
    try {
      const fields = parseSiweMessage(body.message);
      if (!fields.nonce || sha256(fields.nonce) !== challenge.nonceHash || fields.chainId !== challenge.chainId || fields.uri !== challenge.redirectUri || fields.version !== '1' || fields.requestId !== challenge.id || fields.issuedAt?.getTime() !== challenge.createdAt || fields.expirationTime?.getTime() !== challenge.expiresAt) throw authFailure();
      if (!validateSiweMessage({ message: fields, address: challenge.address as Hex, domain: expectedOrigin.host, scheme: expectedOrigin.protocol.slice(0, -1), nonce: fields.nonce, time: new Date(timestamp) })) throw authFailure();
      const recovered = await recoverMessageAddress({ message: body.message, signature: body.signature as Hex });
      if (recovered.toLowerCase() !== challenge.address.toLowerCase()) throw authFailure();
    } catch { throw authFailure(); }
    const code = opaque();
    const accountId = `eip155:${challenge.chainId}:${challenge.address.toLowerCase()}`;
    const consumed = await options.store.consumeChallenge(challenge.id, {
      codeHash: sha256(code), challengeId: challenge.id, clientId: challenge.clientId, accountId,
      address: challenge.address, chainId: challenge.chainId, redirectUri: challenge.redirectUri,
      codeChallenge: challenge.codeChallenge, authTime: timestamp, expiresAt: timestamp + CODE_TTL_MS,
    }, now());
    if (!consumed) throw authFailure();
    audit('signature_verified', challenge.clientId, accountId, request.id);
    return { code, expiresIn: CODE_TTL_MS / 1000 };
  });

  app.post<{ Body: ExchangeRequest }>('/v1/exchanges', { schema: { tags: ['Integração servidor'], summary: 'Trocar código com segredo do cliente e verificador PKCE', body: exchangeBody } }, async (request) => {
    // Browser code must never receive the client secret or identity assertion.
    if (request.headers.origin) throw new AuthError(403, 'SERVER_ONLY', 'Esta operação requer comunicação entre servidores.');
    const body = request.body;
    const client = clients.get(body.clientId);
    const actualSecret = Buffer.from(sha256(body.clientSecret), 'hex');
    const expectedSecret = Buffer.from(client?.secretHash ?? sha256('invalid-client'), 'hex');
    if (!timingSafeEqual(actualSecret, expectedSecret) || !client) throw authFailure();
    const authorization = await options.store.consumeCode(sha256(body.code), client.id, body.redirectUri, s256(body.codeVerifier), now());
    if (!authorization) throw authFailure();
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({
      wallet: { address: authorization.address, chainId: authorization.chainId, type: 'eoa' },
      auth_time: Math.floor(authorization.authTime / 1000),
    }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: publicKey.kid })
      .setIssuer(options.issuer).setAudience(client.id).setSubject(authorization.accountId)
      .setIssuedAt(issuedAt).setExpirationTime(issuedAt + ASSERTION_TTL_SECONDS).setJti(opaque()).sign(signingKey);
    audit('code_exchanged', client.id, authorization.accountId, request.id);
    return { assertion, expiresIn: ASSERTION_TTL_SECONDS };
  });
  return app;
}
