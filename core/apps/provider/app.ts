import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Provider } from 'oidc-provider';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { SqliteStore, validateUrl } from '../../packages/node-sdk/src/index.js';
import { projectRoot, type ProviderSettings } from '../../config.js';
import { sqliteAdapter } from './adapter.js';
import { security, errorHandler } from '../../http.js';
import { ClientRegistry } from './registry.js';
import { createPortal } from './portal.js';

interface Challenge { message: string; address: Hex; chainId: number; nonce: string; expiresAt: number }
const random = () => randomBytes(32).toString('hex');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function createProviderApp(settings: ProviderSettings, database: string) {
  const issuer = validateUrl(settings.issuer, true);
  if (!settings.cookieKeys?.[0] || settings.cookieKeys[0].length < 32 || !settings.jwks.keys[0]?.d) throw new Error('Missing provider keys');
  if (!settings.chains.length || settings.chains.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Invalid chain list');
  for (const client of settings.clients) {
    if (client.client_secret.length < 32) throw new Error('Invalid client secret');
    for (const uri of [...client.redirect_uris, ...client.post_logout_redirect_uris]) {
      const target = new URL(uri); validateUrl(target.origin, true);
      if (target.username || target.password || target.hash) throw new Error('Invalid redirect URI');
    }
  }
  const secure = issuer.protocol === 'https:';
  const store = new SqliteStore(database);
  const registry = new ClientRegistry(store);
  for (const client of settings.clients) registry.seed(client);
  const portal = createPortal(registry, issuer.origin, settings.cookieKeys[0], database === ':memory:' ? ':memory:' : `${database}.portal.sqlite`);
  const pageTemplate = readFileSync(resolve(projectRoot, 'frontend/hosted-login/message.html'), 'utf8');
  const page = (title: string, body: string) => pageTemplate.replaceAll('{{TITLE}}', escapeHtml(title)).replace('{{BODY}}', body);
  const provider = new Provider(issuer.origin, {
    adapter: sqliteAdapter(store, registry), clients: [], jwks: settings.jwks,
    responseTypes: ['code'], scopes: ['openid', 'wallet'], subjectTypes: ['public'],
    clientAuthMethods: ['client_secret_post'],
    claims: { openid: ['sub'], wallet: ['wallet_address', 'chain_id'] },
    pkce: { required: () => true },
    routes: { authorization: '/authorize', token: '/token', userinfo: '/userinfo', jwks: '/jwks', end_session: '/logout' },
    ttl: { AuthorizationCode: 60, AccessToken: 300, IdToken: 300, Interaction: 600, Session: 8 * 3600, Grant: 8 * 3600 },
    cookies: {
      keys: settings.cookieKeys,
      names: { session: secure ? '__Host-ancora_sso' : 'ancora_sso', interaction: secure ? '__Secure-ancora_interaction' : 'ancora_interaction', resume: secure ? '__Secure-ancora_resume' : 'ancora_resume' },
      long: { httpOnly: true, sameSite: 'lax', secure }, short: { httpOnly: true, sameSite: 'lax', secure },
    },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
        logoutSource: async (ctx, form) => { ctx.body = page('Encerrar sessão no Âncora',
          `<p>Ao confirmar, você encerra a sessão de login único. Outros sites podem manter suas sessões locais até você sair deles.</p>${form}
          <button class="primary" type="submit" form="op.logoutForm" name="logout" value="yes">Encerrar sessão no Âncora</button>
          <button class="quiet" type="submit" form="op.logoutForm">Voltar</button>`); },
        postLogoutSuccessSource: async ctx => { ctx.body = page('Sessão encerrada', '<p>Você saiu do Âncora. Feche esta aba ou volte ao site de origem.</p><a href="/">Voltar ao início</a>'); },
      },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (_ctx, id) => {
      const match = /^eip155:(\d+):(0x[0-9a-f]{40})$/.exec(id);
      if (!match || !settings.chains.includes(Number(match[1]))) return undefined;
      return { accountId: id, claims: async () => ({ sub: id, wallet_address: getAddress(match[2]), chain_id: Number(match[1]) }) };
    },
    renderError: async (ctx, output) => { ctx.type = 'html'; ctx.body = page('Não foi possível continuar',
      `<p>O pedido de autenticação é inválido ou expirou. Volte ao site de origem e inicie o login novamente.</p><code>${escapeHtml(String(output.error ?? 'invalid_request'))}</code>`); },
  });
  provider.on('server_error', () => console.error('Falha interna no provedor OIDC. Nenhum dado de autenticação foi registrado.'));
  const app = express();
  security(app, secure, () => registry.logoutOrigins());
  app.use('/interaction', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/token', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/assets', express.static(resolve(projectRoot, 'frontend/shared')));
  app.use('/login-assets', express.static(resolve(projectRoot, 'frontend/hosted-login/dist')));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ancora-oidc' }));
  app.get('/', (_req, res) => res.sendFile(resolve(projectRoot, 'frontend/portal/home.html')));
  app.get('/portal-public/config', (_req, res) => res.json({ demos: settings.clients.slice(0, 2).map(client => ({ name: client.client_name, url: new URL(client.redirect_uris[0]).origin })) }));
  app.use(portal.router);

  async function details(req: Request, res: Response) {
    const interaction = await provider.interactionDetails(req, res);
    if (interaction.uid !== req.params.uid) throw new Error('Interaction mismatch');
    return interaction;
  }
  async function protectedDetails(req: Request, res: Response) {
    if (req.headers.origin !== issuer.origin) throw new Error('Origin mismatch');
    const interaction = await details(req, res);
    const csrf = store.get<string>('csrf', interaction.uid);
    const supplied = req.headers['x-csrf-token'];
    if (!csrf || typeof supplied !== 'string' || supplied.length !== csrf.length
      || !timingSafeEqual(Buffer.from(csrf), Buffer.from(supplied))) throw new Error('Invalid CSRF token');
    return interaction;
  }
  app.get('/interaction/:uid', async (req, res) => {
    await details(req, res);
    res.sendFile(resolve(projectRoot, 'frontend/hosted-login/index.html'));
  });
  app.get('/interaction/:uid/details', async (req, res) => {
    const interaction = await details(req, res);
    let csrf = store.get<string>('csrf', interaction.uid);
    if (!csrf) { csrf = random(); store.put('csrf', interaction.uid, csrf, 600); }
    const client = registry.findEnabled(String(interaction.params.client_id));
    if (!client) throw new Error('Unregistered client');
    res.json({ prompt: interaction.prompt.name, csrf, clientName: client.client_name,
      clientOrigin: new URL(String(interaction.params.redirect_uri)).origin,
      issuer: issuer.origin, chains: settings.chains, accountId: interaction.session?.accountId ?? null });
  });
  const jsonBody = express.json({ limit: '8kb', strict: true });
  app.post('/interaction/:uid/challenge', jsonBody, async (req, res) => {
    const interaction = await protectedDetails(req, res);
    if (interaction.prompt.name !== 'login') throw new Error('Login not requested');
    const { address: rawAddress, chainId } = req.body ?? {};
    if (typeof rawAddress !== 'string' || !Number.isSafeInteger(chainId) || !settings.chains.includes(chainId)) throw new Error('Invalid wallet/network');
    const address = getAddress(rawAddress);
    const nonce = random();
    const expiresAt = Date.now() + 300_000;
    const message = createSiweMessage({
      domain: issuer.host, scheme: issuer.protocol.slice(0, -1), address, chainId, uri: issuer.origin,
      version: '1', nonce, requestId: interaction.uid, issuedAt: new Date(), expirationTime: new Date(expiresAt),
      statement: 'Entrar no Ancora. Esta assinatura nao autoriza transacoes nem movimenta fundos.',
    });
    store.put('challenge', interaction.uid, { message, address, chainId, nonce, expiresAt } satisfies Challenge, 300);
    res.json({ message, expiresAt });
  });
  app.post('/interaction/:uid/verify', jsonBody, async (req, res) => {
    const interaction = await protectedDetails(req, res);
    if (interaction.prompt.name !== 'login') throw new Error('Login not requested');
    const { message, signature } = req.body ?? {};
    if (typeof message !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid signature format');
    const challenge = store.take<Challenge>('challenge', interaction.uid);
    if (!challenge || challenge.expiresAt <= Date.now() || message !== challenge.message) throw new Error('Expired or altered challenge');
    const fields = parseSiweMessage(message);
    if (!validateSiweMessage({ message: fields, address: challenge.address, domain: issuer.host,
      scheme: issuer.protocol.slice(0, -1), nonce: challenge.nonce, time: new Date() })
      || fields.chainId !== challenge.chainId || fields.uri !== issuer.origin || fields.requestId !== interaction.uid) throw new Error('Invalid SIWE binding');
    const signer = await recoverMessageAddress({ message, signature: signature as Hex });
    if (signer.toLowerCase() !== challenge.address.toLowerCase()) throw new Error('Signature does not match wallet');
    const redirectTo = await provider.interactionResult(req, res, {
      login: { accountId: `eip155:${challenge.chainId}:${challenge.address.toLowerCase()}`, amr: ['eth_sign'] },
    }, { mergeWithLastSubmission: false });
    store.delete('csrf', interaction.uid);
    res.json({ redirectTo });
  });
  app.post('/interaction/:uid/confirm', jsonBody, async (req, res) => {
    const interaction = await protectedDetails(req, res);
    if (interaction.prompt.name !== 'consent' || !interaction.session?.accountId) throw new Error('No verified account');
    let grant = interaction.grantId ? await provider.Grant.find(interaction.grantId) : undefined;
    grant ??= new provider.Grant({ accountId: interaction.session.accountId, clientId: String(interaction.params.client_id) });
    const requested = interaction.prompt.details;
    if (requested.missingOIDCScope) grant.addOIDCScope((requested.missingOIDCScope as string[]).join(' '));
    if (requested.missingOIDCClaims) grant.addOIDCClaims(requested.missingOIDCClaims as string[]);
    const grantId = await grant.save();
    const redirectTo = await provider.interactionResult(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
    store.delete('csrf', interaction.uid);
    res.json({ redirectTo });
  });
  app.post('/interaction/:uid/abort', jsonBody, async (req, res) => {
    const interaction = await protectedDetails(req, res);
    const redirectTo = await provider.interactionResult(req, res, { error: 'access_denied', error_description: 'Login cancelado pelo usuário.' }, { mergeWithLastSubmission: false });
    store.delete('csrf', interaction.uid); store.delete('challenge', interaction.uid);
    res.json({ redirectTo });
  });
  // Keep OIDC form parsing in oidc-provider; parsing its request body here breaks token requests.
  app.use(provider.callback());
  app.use(errorHandler);
  return { app, provider, store, registry, close: () => { portal.close(); store.close(); } };
}
