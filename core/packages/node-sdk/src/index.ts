import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse, serialize } from 'cookie';
import * as oidc from 'openid-client';
import { SqliteStore } from './storage.js';
export { SqliteStore } from './storage.js';

export interface AncoraOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  appUrl: string;
  database: string;
  /** Only for HTTP loopback development; never enabled in production. */
  allowInsecureLocalhost?: boolean;
  /** Same-origin destination after a successful login. Defaults to /. */
  afterLogin?: string;
  afterLogout?: string;
  /** Default /auth; useful when mounting authentication under a portal. */
  authBasePath?: string;
  sessionPath?: string;
  /** Runs on the server after verification and before issuing a new session. Throw to reject login. */
  onLogin?: (identity: Readonly<AncoraIdentity>, context: { request: IncomingMessage }) => Promise<{ userId: string } | void> | { userId: string } | void;
}
export interface AncoraIdentity {
  issuer: string;
  sub: string;
  address: string;
  chainId: number;
}
export interface AncoraSession extends AncoraIdentity {
  userId?: string;
  expiresAt: number;
}
interface StoredSession extends AncoraSession { idleExpiresAt: number }
interface Flow { state: string; nonce: string; verifier: string; binding: string }
const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

export function validateUrl(value: string, allowHttp: boolean) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a base URL without path, query or credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp && loopback && process.env.NODE_ENV !== 'production')) {
    throw new Error('HTTPS is required outside local development');
  }
  return url;
}

/** Only fixed local paths, never a URL supplied by the browser. */
export function validateLocalPath(value: string) {
  if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(value)) throw new Error('Use an absolute local path without query, fragment or encoded characters');
  return value;
}

/** Node HTTP integration, independent of React, Express or platform plugins. */
export async function createAncoraClient(options: AncoraOptions) {
  const appUrl = validateUrl(options.appUrl, !!options.allowInsecureLocalhost);
  const issuer = validateUrl(options.issuer, !!options.allowInsecureLocalhost);
  const afterLogin = validateLocalPath(options.afterLogin ?? '/');
  const afterLogout = validateLocalPath(options.afterLogout ?? '/');
  const base = validateLocalPath(options.authBasePath ?? '/auth');
  if (base === '/' || base.endsWith('/')) throw new Error('authBasePath must not end with /');
  const routes = { login: `${base}/login`, callback: `${base}/callback`, logout: `${base}/logout`, providerLogout: `${base}/logout-provider`, session: validateLocalPath(options.sessionPath ?? '/api/session') };
  if (options.clientSecret.length < 32) throw new Error('Client secret must have at least 32 characters');
  const config = await oidc.discovery(issuer, options.clientId, { client_secret: options.clientSecret },
    oidc.ClientSecretPost(options.clientSecret), {
      execute: issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
    });
  oidc.enableNonRepudiationChecks(config);
  const store = new SqliteStore(options.database);
  const secure = appUrl.protocol === 'https:';
  const suffix = hash(options.clientId).slice(0, 12);
  const sessionCookie = `${secure ? '__Host-' : ''}ancora_${suffix}`;
  const flowCookie = `${secure ? '__Host-' : ''}ancora_flow_${suffix}`;
  const redirectUri = new URL(routes.callback, appUrl).href;
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  const sendCookie = (res: ServerResponse, name: string, value: string, maxAge: number) => {
    const previous = res.getHeader('Set-Cookie');
    const cookies = Array.isArray(previous) ? previous.map(String) : previous ? [String(previous)] : [];
    res.setHeader('Set-Cookie', [...cookies, serialize(name, value, { ...cookieOptions, maxAge })]);
  };
  const redirect = (res: ServerResponse, location: string) => { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' }); res.end(); };
  const json = (res: ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  };
  function internalSession(req: IncomingMessage): StoredSession | undefined {
    const sid = parse(req.headers.cookie ?? '')[sessionCookie];
    if (!sid) return;
    const session = store.get<StoredSession>('session', hash(sid));
    if (!session) return;
    if (session.expiresAt <= Date.now() || session.idleExpiresAt <= Date.now()) {
      store.delete('session', hash(sid)); return;
    }
    session.idleExpiresAt = Math.min(Date.now() + 30 * 60_000, session.expiresAt);
    store.put('session', hash(sid), session, (session.expiresAt - Date.now()) / 1000);
    return session;
  }
  function session(req: IncomingMessage): AncoraSession | undefined {
    const data = internalSession(req);
    if (!data) return;
    const { idleExpiresAt: _idle, ...publicSession } = data;
    return publicSession;
  }
  function clearSession(req: IncomingMessage, res: ServerResponse) {
    const sid = parse(req.headers.cookie ?? '')[sessionCookie];
    if (sid) store.delete('session', hash(sid));
    sendCookie(res, sessionCookie, '', 0);
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', appUrl);
    if (!Object.values(routes).includes(url.pathname)) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (url.pathname === routes.login && req.method === 'GET') {
        const state = oidc.randomState();
        const flow: Flow = { state, nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), binding: opaque() };
        // One pending login per application/browser; a new tab invalidates the older binding.
        store.put('flow', hash(state), flow, 300);
        sendCookie(res, flowCookie, flow.binding, 300);
        const target = oidc.buildAuthorizationUrl(config, {
          response_type: 'code', redirect_uri: redirectUri, scope: 'openid wallet',
          state, nonce: flow.nonce, code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
          code_challenge_method: 'S256', ...(url.searchParams.get('reauth') === '1' ? { prompt: 'login' } : {}),
        });
        redirect(res, target.href);
      } else if (url.pathname === routes.callback && req.method === 'GET') {
        const state = url.searchParams.get('state') ?? '';
        const binding = parse(req.headers.cookie ?? '')[flowCookie] ?? '';
        const candidate = store.get<Flow>('flow', hash(state));
        if (!candidate || !safeEqual(candidate.binding, binding)) throw new Error('Invalid login binding');
        const flow = store.take<Flow>('flow', hash(state));
        sendCookie(res, flowCookie, '', 0);
        if (!flow) throw new Error('Login already consumed');
        if (url.searchParams.get('error') === 'access_denied') {
          redirect(res, `${afterLogout}?login=cancelled`); return true;
        }
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims || !tokens.id_token) throw new Error('Missing identity');
        const user = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        if (typeof user.wallet_address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(user.wallet_address)
          || !Number.isSafeInteger(user.chain_id) || Number(user.chain_id) < 1
          || claims.sub !== `eip155:${user.chain_id}:${user.wallet_address.toLowerCase()}`) throw new Error('Invalid wallet identity');
        const identity: Readonly<AncoraIdentity> = Object.freeze({ issuer: claims.iss, sub: claims.sub, address: user.wallet_address, chainId: Number(user.chain_id) });
        const linked = await options.onLogin?.(identity, { request: req });
        if (linked !== undefined && (!linked || typeof linked.userId !== 'string' || linked.userId.length === 0 || linked.userId.length > 200)) throw new Error('onLogin must return a non-empty userId or void');
        clearSession(req, res);
        const sid = opaque();
        const data: StoredSession = {
          ...identity, ...(linked ? { userId: linked.userId } : {}),
          expiresAt: Date.now() + 8 * 60 * 60_000, idleExpiresAt: Date.now() + 30 * 60_000,
        };
        store.put('session', hash(sid), data, 8 * 3600);
        sendCookie(res, sessionCookie, sid, 8 * 3600);
        redirect(res, afterLogin);
      } else if (url.pathname === routes.session && req.method === 'GET') {
        const current = session(req);
        json(res, 200, current ? { authenticated: true, user: current } : { authenticated: false });
      } else if ([routes.logout, routes.providerLogout].includes(url.pathname) && req.method === 'POST') {
        if (req.headers.origin !== appUrl.origin) { json(res, 403, { error: 'Origem não permitida.' }); return true; }
        const current = internalSession(req);
        clearSession(req, res);
        if (url.pathname === routes.providerLogout && current) {
          // The provider confirms logout against its session cookie. No ID Token in browser URLs.
          const logout = oidc.buildEndSessionUrl(config, { client_id: options.clientId, post_logout_redirect_uri: new URL(afterLogout, appUrl).href });
          redirect(res, logout.href);
        } else redirect(res, afterLogout);
      } else json(res, 405, { error: 'Método não permitido.' });
    } catch {
      // Do not log callback URLs, codes, signatures or tokens.
      json(res, 400, { error: 'Não foi possível concluir o login. Volte ao início e tente novamente.', restart: '/' });
    }
    return true;
  }
  return { handle, session, close: () => store.close() };
}
