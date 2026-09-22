import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringToHex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { discoverWallets, getSession, signIn, type EIP1193Provider } from './index';

const address = '0x0000000000000000000000000000000000000001';
const otherAddress = '0x0000000000000000000000000000000000000002';
const signature = `0x${'11'.repeat(65)}`;
const start = { flowId: 'flow-1', codeChallenge: 'a'.repeat(43), clientId: 'demo', authApiUrl: 'http://localhost:3001', redirectUri: 'http://localhost:5173/auth/callback', chainIds: [1] };
const session = { authenticated: true, user: { address, chainId: 1, accountId: `eip155:1:${address}` }, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
function message(domain = 'localhost:5173') {
  return createSiweMessage({ domain, address, statement: 'Autentique sua conta nesta aplicação.', uri: start.redirectUri, version: '1', chainId: 1,
    nonce: 'abcdefgh12345678', issuedAt: new Date(), expirationTime: new Date(Date.now() + 60_000) });
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function providerFixture() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let activeAddress = address;
  const provider: EIP1193Provider = {
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [activeAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'personal_sign') return signature;
      throw new Error(`Unexpected method: ${method}`);
    }),
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  return { provider, listeners, changeAccount() { activeAddress = otherAddress; listeners.get('accountsChanged')?.forEach(listener => listener([activeAddress])); } };
}
function setupFetch(siwe = message()) {
  const fetchMock = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path.endsWith('/auth/start')) return json(start);
    if (path.endsWith('/v1/challenges')) return json({ challengeId: 'challenge-1', message: siwe, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    if (path.endsWith('/v1/verifications')) return json({ code: 'single-use-code', expiresIn: 60 });
    if (path.endsWith('/auth/complete')) return json(session);
    if (path.endsWith('/auth/logout')) return json({ authenticated: false });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  const browser = Object.assign(new EventTarget(), { location: new URL('http://localhost:5173') });
  vi.stubGlobal('window', browser);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SIWE browser flow', () => {
  it('signs the exact original message bytes and completes a session with no browser client secret', async () => {
    const siwe = message();
    const fetchMock = setupFetch(siwe);
    const { provider, listeners } = providerFixture();
    const stages: string[] = [];
    await expect(signIn({ provider, onStep: stage => stages.push(stage) })).resolves.toEqual(session);
    expect(provider.request).toHaveBeenCalledWith({ method: 'personal_sign', params: [stringToHex(siwe), address] });
    expect(stages).toEqual(['connecting', 'challenge', 'signing', 'verifying', 'session']);
    const verificationCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/v1/verifications'))!;
    expect(JSON.parse(verificationCall[1]!.body as string)).toEqual({ challengeId: 'challenge-1', message: siwe, signature });
    const completeCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/complete'))!;
    expect(JSON.parse(completeCall[1]!.body as string)).toEqual({ flowId: 'flow-1', code: 'single-use-code' });
    expect(fetchMock.mock.calls.every(([, options]) => options?.credentials === 'same-origin')).toBe(true);
    expect([...listeners.values()].every(value => value.size === 0)).toBe(true);
  });

  it('refuses a challenge for another domain before asking for a signature', async () => {
    setupFetch(message('attacker.example'));
    const { provider } = providerFixture();
    await expect(signIn({ provider })).rejects.toMatchObject({ code: 'invalid_challenge' });
    expect(vi.mocked(provider.request).mock.calls.some(([request]) => request.method === 'personal_sign')).toBe(false);
  });

  it('cancels when an account changes while a signature prompt is pending', async () => {
    const fetchMock = setupFetch();
    const wallet = providerFixture();
    const original = wallet.provider.request;
    wallet.provider.request = vi.fn(async request => {
      if (request.method === 'personal_sign') { wallet.changeAccount(); return signature; }
      return original(request);
    });
    await expect(signIn({ provider: wallet.provider })).rejects.toMatchObject({ code: 'wallet_changed' });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/v1/verifications'))).toBe(false);
    expect([...wallet.listeners.values()].every(value => value.size === 0)).toBe(true);
  });

  it('rejects unsupported networks without requesting a signature', async () => {
    setupFetch();
    const wallet = providerFixture();
    const original = wallet.provider.request;
    wallet.provider.request = vi.fn(async request => request.method === 'eth_chainId' ? '0x89' : original(request));
    await expect(signIn({ provider: wallet.provider })).rejects.toMatchObject({ code: 'unsupported_chain' });
    expect(vi.mocked(wallet.provider.request).mock.calls.some(([request]) => request.method === 'personal_sign')).toBe(false);
  });

  it('cancels immediately even if the old signature prompt never responds', async () => {
    const fetchMock = setupFetch();
    const wallet = providerFixture();
    const original = wallet.provider.request;
    wallet.provider.request = vi.fn(async request => {
      if (request.method === 'personal_sign') {
        queueMicrotask(() => wallet.changeAccount());
        return new Promise(() => undefined);
      }
      return original(request);
    });
    await expect(signIn({ provider: wallet.provider })).rejects.toMatchObject({ code: 'wallet_changed' });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/complete'))).toBe(false);
    expect([...wallet.listeners.values()].every(value => value.size === 0)).toBe(true);
  });

  it('reports deliberate wallet rejection and allows a subsequent attempt', async () => {
    setupFetch();
    const wallet = providerFixture();
    vi.mocked(wallet.provider.request).mockRejectedValueOnce({ code: 4001 });
    await expect(signIn({ provider: wallet.provider })).rejects.toMatchObject({ code: 'user_rejected' });
    await expect(signIn({ provider: wallet.provider })).resolves.toEqual(session);
  });

  it('clears a session if the account changes during completion', async () => {
    const fetchMock = setupFetch();
    const implementation = fetchMock.getMockImplementation()!;
    const wallet = providerFixture();
    fetchMock.mockImplementation(async (path, options) => {
      if (path.endsWith('/auth/complete')) wallet.changeAccount();
      return implementation(path, options);
    });
    await expect(signIn({ provider: wallet.provider })).rejects.toMatchObject({ code: 'wallet_changed' });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/logout'))).toBe(true);
  });

  it('validates session shape instead of trusting arbitrary successful JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ authenticated: true, user: {} })));
    await expect(getSession()).rejects.toMatchObject({ code: 'invalid_session' });
  });
});

describe('wallet discovery', () => {
  it('deduplicates a legacy provider announced through EIP-6963 and cleans up its listener', () => {
    const { provider } = providerFixture();
    (window as unknown as Record<string, unknown>).ethereum = provider;
    const update = vi.fn();
    const stop = discoverWallets(update);
    const event = new Event('eip6963:announceProvider');
    Object.defineProperty(event, 'detail', { value: { info: { uuid: 'wallet-one', name: 'Test wallet', icon: '<svg onload="alert(1)">' }, provider } });
    window.dispatchEvent(event);
    expect(update).toHaveBeenLastCalledWith([{ id: 'wallet-one', name: 'Test wallet', provider }]);
    stop();
    const count = update.mock.calls.length;
    window.dispatchEvent(event);
    expect(update).toHaveBeenCalledTimes(count);
  });
});
