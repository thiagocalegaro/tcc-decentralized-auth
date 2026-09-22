import { getAddress, isAddress, stringToHex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
export interface WalletOption { id: string; name: string; provider: EIP1193Provider }
export type AuthStep = 'connecting' | 'challenge' | 'signing' | 'verifying' | 'session';
export interface AuthenticatedSession {
  authenticated: true;
  user: { accountId: string; address: string; chainId: number };
  expiresAt: string | number;
}
export type SessionResponse = { authenticated: false } | AuthenticatedSession;
export interface PrivateResource { message: string; accountId: string }
interface StartResponse {
  flowId: string; codeChallenge: string; clientId: string; authApiUrl: string;
  redirectUri: string; chainIds: number[];
}

export class AuthenticationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AuthenticationError'; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function assertProvider(value: unknown): value is EIP1193Provider {
  return record(value) && typeof value.request === 'function';
}

/** EIP-6963 discovery. Provider names are plain text; untrusted wallet icons are ignored. */
export function discoverWallets(onUpdate: (wallets: WalletOption[]) => void): () => void {
  const wallets = new Map<string, WalletOption>();
  const update = () => onUpdate([...wallets.values()]);
  const announce = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (!record(detail) || !record(detail.info) || !assertProvider(detail.provider)) return;
    const { uuid, name } = detail.info;
    if (typeof uuid !== 'string' || typeof name !== 'string' || !uuid || !name.trim()) return;
    const legacy = wallets.get('injected');
    if (legacy?.provider === detail.provider) wallets.delete('injected');
    if ([...wallets.values()].some(wallet => wallet.provider === detail.provider)) return;
    wallets.set(uuid.slice(0, 100), { id: uuid.slice(0, 100), name: name.slice(0, 80), provider: detail.provider });
    update();
  };
  window.addEventListener('eip6963:announceProvider', announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const injected: unknown = (window as unknown as Record<string, unknown>).ethereum;
  if (assertProvider(injected) && ![...wallets.values()].some(wallet => wallet.provider === injected)) {
    wallets.set('injected', { id: 'injected', name: 'Carteira do navegador', provider: injected });
  }
  update();
  return () => window.removeEventListener('eip6963:announceProvider', announce);
}

async function jsonRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = new AbortController();
  const abort = () => timeout.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store', signal: timeout.signal,
    });
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new AuthenticationError('invalid_response', 'O servidor retornou uma resposta inválida.'); }
    if (!response.ok) {
      const error = record(payload) && record(payload.error) ? payload.error : undefined;
      throw new AuthenticationError(typeof error?.code === 'string' ? error.code : 'request_failed',
        typeof error?.message === 'string' ? error.message : 'Não foi possível concluir a solicitação.');
    }
    return payload;
  } catch (error) {
    if (timeout.signal.aborted) throw new AuthenticationError(signal?.aborted ? 'wallet_changed' : 'timeout',
      signal?.aborted ? 'A conta ou a rede mudou. Inicie uma nova autenticação.' : 'O servidor demorou para responder. Tente novamente.');
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError('network_error', 'Não foi possível acessar o servidor. Verifique se os serviços estão em execução.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseSession(value: unknown): SessionResponse {
  if (!record(value) || typeof value.authenticated !== 'boolean') throw new AuthenticationError('invalid_session', 'Resposta de sessão inválida.');
  if (!value.authenticated) return { authenticated: false };
  if (!record(value.user) || typeof value.user.accountId !== 'string' || typeof value.user.address !== 'string' || !isAddress(value.user.address)
    || !Number.isSafeInteger(value.user.chainId) || (value.user.chainId as number) < 1
    || (typeof value.expiresAt !== 'string' && typeof value.expiresAt !== 'number')) {
    throw new AuthenticationError('invalid_session', 'O servidor retornou uma sessão incompleta.');
  }
  return value as unknown as AuthenticatedSession;
}
export async function getSession(): Promise<SessionResponse> { return parseSession(await jsonRequest('/api/session')); }
export async function logout(): Promise<void> { await jsonRequest('/api/auth/logout', {}); }
export async function getPrivateResource(): Promise<PrivateResource> {
  const value = await jsonRequest('/api/private');
  if (!record(value) || typeof value.message !== 'string' || typeof value.accountId !== 'string') {
    throw new AuthenticationError('invalid_response', 'Resposta da área privada inválida.');
  }
  return { message: value.message, accountId: value.accountId };
}

function parseChain(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new AuthenticationError('invalid_chain', 'A carteira informou uma rede inválida.');
  const chain = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(chain) || chain < 1) throw new AuthenticationError('invalid_chain', 'A carteira informou uma rede inválida.');
  return chain;
}
function firstAccount(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || !isAddress(value[0])) throw new AuthenticationError('no_account', 'Nenhuma conta foi disponibilizada pela carteira.');
  return getAddress(value[0]);
}
function parseStart(value: unknown): StartResponse {
  if (!record(value) || !['flowId', 'codeChallenge', 'clientId', 'authApiUrl', 'redirectUri'].every(key => typeof value[key] === 'string' && value[key])
    || !Array.isArray(value.chainIds) || !value.chainIds.length || !value.chainIds.every(id => Number.isSafeInteger(id) && id > 0)
    || !/^[A-Za-z0-9_-]{43}$/.test(value.codeChallenge as string)) {
    throw new AuthenticationError('invalid_flow', 'O servidor retornou uma configuração de autenticação inválida.');
  }
  const start = value as unknown as StartResponse;
  const authUrl = new URL(start.authApiUrl);
  const redirect = new URL(start.redirectUri);
  const localHttp = authUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(authUrl.hostname)
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if ((authUrl.protocol !== 'https:' && !localHttp) || authUrl.username || authUrl.password || authUrl.search || authUrl.hash
    || redirect.origin !== window.location.origin) throw new AuthenticationError('invalid_flow', 'O endereço do serviço de autenticação não é válido para esta aplicação.');
  return start;
}

let activeSignIn = false;
/** A deliberate user action must call this function. No secrets or sessions enter localStorage. */
export async function signIn({ provider, onStep }: { provider: EIP1193Provider; onStep?: (step: AuthStep) => void }): Promise<SessionResponse> {
  if (activeSignIn) throw new AuthenticationError('already_running', 'Já existe uma autenticação em andamento.');
  activeSignIn = true;
  const controller = new AbortController();
  let address: string | undefined;
  let chainId: number | undefined;
  let completing = false;
  const changed = () => controller.abort();
  const guard = () => {
    if (controller.signal.aborted) throw new AuthenticationError('wallet_changed', 'A conta ou a rede mudou. Inicie uma nova autenticação.');
  };
  const requestWallet = async (args: Parameters<EIP1193Provider['request']>[0]): Promise<unknown> => {
    guard();
    return new Promise((resolve, reject) => {
      const abort = () => reject(new AuthenticationError('wallet_changed', 'A conta ou a rede mudou. Inicie uma nova autenticação.'));
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => provider.request(args)).then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', abort));
    });
  };
  const snapshot = async () => {
    guard();
    const [accounts, chain] = await Promise.all([requestWallet({ method: 'eth_accounts' }), requestWallet({ method: 'eth_chainId' })]);
    if (firstAccount(accounts) !== address || parseChain(chain) !== chainId) changed();
    guard();
  };
  try {
    onStep?.('connecting');
    const start = parseStart(await jsonRequest('/api/auth/start', {}));
    address = firstAccount(await provider.request({ method: 'eth_requestAccounts' }));
    chainId = parseChain(await provider.request({ method: 'eth_chainId' }));
    if (provider.on && provider.removeListener) {
      provider.on('accountsChanged', changed);
      provider.on('chainChanged', changed);
      provider.on('disconnect', changed);
    }
    if (!start.chainIds.includes(chainId)) throw new AuthenticationError('unsupported_chain', `Rede não habilitada. Selecione na carteira uma destas redes (chain ID): ${start.chainIds.join(', ')} e tente novamente.`);
    await snapshot();
    onStep?.('challenge');
    const challenge = await jsonRequest(`${start.authApiUrl.replace(/\/$/, '')}/v1/challenges`, {
      clientId: start.clientId, address, chainId, redirectUri: start.redirectUri, codeChallenge: start.codeChallenge,
    }, controller.signal);
    if (!record(challenge) || typeof challenge.challengeId !== 'string' || typeof challenge.message !== 'string') throw new AuthenticationError('invalid_challenge', 'O servidor retornou um desafio inválido.');
    const message = parseSiweMessage(challenge.message);
    if (message.domain !== window.location.host || message.uri !== start.redirectUri || message.version !== '1'
      || message.chainId !== chainId || !message.address || message.address.toLowerCase() !== address.toLowerCase()
      || !message.nonce || !/^[a-zA-Z0-9]{8,}$/.test(message.nonce) || !message.expirationTime
      || !Number.isFinite(message.expirationTime.getTime()) || message.expirationTime.getTime() <= Date.now()) {
      throw new AuthenticationError('invalid_challenge', 'O desafio não corresponde à aplicação, conta ou rede selecionada.');
    }
    await snapshot();
    onStep?.('signing');
    const signature = await requestWallet({ method: 'personal_sign', params: [stringToHex(challenge.message), address] });
    if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new AuthenticationError('invalid_signature', 'A carteira retornou uma assinatura inválida.');
    await snapshot();
    onStep?.('verifying');
    const verification = await jsonRequest(`${start.authApiUrl.replace(/\/$/, '')}/v1/verifications`, {
      challengeId: challenge.challengeId, message: challenge.message, signature,
    }, controller.signal);
    if (!record(verification) || typeof verification.code !== 'string' || !verification.code) throw new AuthenticationError('invalid_verification', 'Resposta de verificação inválida.');
    await snapshot();
    onStep?.('session');
    completing = true;
    // Let completion finish before clearing a session if the wallet changes during this last request.
    const session = parseSession(await jsonRequest('/api/auth/complete', { flowId: start.flowId, code: verification.code }));
    await snapshot();
    if (!session.authenticated) throw new AuthenticationError('session_failed', 'A autenticação não criou uma sessão.');
    if (session.user.address.toLowerCase() !== address.toLowerCase() || session.user.chainId !== chainId
      || session.user.accountId !== `eip155:${chainId}:${address.toLowerCase()}`) {
      await logout().catch(() => undefined);
      throw new AuthenticationError('session_mismatch', 'A sessão recebida não corresponde à conta que assinou a mensagem.');
    }
    return session;
  } catch (error) {
    if (completing && controller.signal.aborted) await logout().catch(() => undefined);
    if (controller.signal.aborted) throw new AuthenticationError('wallet_changed', 'A conta ou a rede mudou. Inicie uma nova autenticação.');
    if (error instanceof AuthenticationError) throw error;
    if (record(error) && error.code === 4001) throw new AuthenticationError('user_rejected', 'Solicitação recusada na carteira. Você pode tentar novamente quando quiser.');
    if (record(error) && error.code === -32002) throw new AuthenticationError('wallet_pending', 'Há uma solicitação aberta na carteira. Conclua ou cancele essa solicitação antes de tentar novamente.');
    throw new AuthenticationError('wallet_error', 'Não foi possível concluir a operação com a carteira. Verifique a extensão e tente novamente.');
  } finally {
    provider.removeListener?.('accountsChanged', changed);
    provider.removeListener?.('chainChanged', changed);
    provider.removeListener?.('disconnect', changed);
    activeSignIn = false;
  }
}
