import { expect, test, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

// Only the wallet transport is simulated. A new ephemeral account really signs;
// the browser talks to the actual API/BFF and PostgreSQL or memory configured locally.
async function installTestWallet(page: Page, mode: 'accept' | 'reject' | 'change' = 'accept') {
  const account = privateKeyToAccount(generatePrivateKey());
  await page.exposeFunction('__tccSignForTest', (hex: Hex) => account.signMessage({ message: { raw: hex } }));
  await page.addInitScript(({ address, mode }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let currentAccount = address;
    const provider = {
      async request({ method, params }: { method: string; params?: string[] }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [currentAccount];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'personal_sign') {
          if (mode === 'reject') throw { code: 4001, message: 'Rejected in test wallet' };
          if (mode === 'change') {
            currentAccount = '0x0000000000000000000000000000000000000001';
            listeners.get('accountsChanged')?.forEach((listener) => listener([currentAccount]));
          }
          return (window as unknown as { __tccSignForTest: (hex: string) => Promise<string> }).__tccSignForTest(params![0]!);
        }
        throw new Error(`Unsupported test method: ${method}`);
      },
      on(event: string, callback: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(callback);
      },
      removeListener(event: string, callback: (...args: unknown[]) => void) { listeners.get(event)?.delete(callback); },
    };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'tcc-e2e-wallet', name: 'Carteira E2E descartável', rdns: 'test.tcc' }, provider },
    }));
    window.addEventListener('eip6963:requestProvider', announce);
  }, { address: account.address, mode });
  return account;
}

async function authenticate(page: Page) {
  await page.getByRole('checkbox', { name: 'Concordo em compartilhar esses dados e solicitar a assinatura.' }).check();
  await page.getByRole('button', { name: 'Conectar e assinar' }).click();
}

test('informa ausência de carteira sem inventar autenticação; layout desktop e mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Nenhuma carteira detectada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar e assinar' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await page.getByRole('button', { name: 'Como preparar uma carteira' }).click();
  await expect(page.locator('#wallet-help')).toBeVisible();
  await page.screenshot({ path: 'test-results/ancora-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ancora-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('redireciona após o login, protege /arearestrita e revoga no logout', async ({ page, context }) => {
  const account = await installTestWallet(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const tokens: string[] = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/auth/complete')) tokens.push(await response.text());
  });
  await page.goto('/');
  await authenticate(page);
  await expect(page).toHaveURL(/\/arearestrita$/);
  await expect(page.getByRole('heading', { name: 'Área restrita.' })).toBeVisible();
  await expect(page.locator('.full-address')).toHaveText(account.address.toLowerCase());
  const cookie = (await context.cookies()).find((value) => value.name === 'tcc_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('tcc_session');
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  expect(tokens.join(' ')).not.toContain('assertion');
  await expect(page.getByText('ACESSO AUTORIZADO', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/ancora-authenticated.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Área restrita.' })).toBeVisible();
  await page.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Conecte sua carteira.' })).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/private')).status);
  expect(status).toBe(401);
  expect((await context.cookies()).find((value) => value.name === 'tcc_session')).toBeUndefined();
  expect(errors).toEqual([]);
});

test('redireciona visitante sem sessão ao acessar a área restrita', async ({ page }) => {
  await page.goto('/arearestrita');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Conecte sua carteira.' })).toBeVisible();
});

test('recusa de assinatura não cria sessão', async ({ page, context }) => {
  await installTestWallet(page, 'reject');
  await page.goto('/');
  await authenticate(page);
  await expect(page.getByRole('alert')).toContainText('Solicitação recusada');
  expect((await context.cookies()).find((value) => value.name === 'tcc_session')).toBeUndefined();
});

test('mudança de conta durante assinatura cancela login', async ({ page, context }) => {
  await installTestWallet(page, 'change');
  await page.goto('/');
  await authenticate(page);
  await expect(page.getByRole('alert')).toContainText('A conta ou a rede mudou');
  expect((await context.cookies()).find((value) => value.name === 'tcc_session')).toBeUndefined();
});

test('login e logout aceitam apenas Origin esperado e corpo JSON', async ({ request }) => {
  const bad = await request.post('/api/auth/start', { headers: { origin: 'https://attacker.example' }, data: {} });
  expect(bad.status()).toBe(403);
  const missing = await request.post('/api/auth/start', { data: {} });
  expect(missing.status()).toBe(403);
  const crossLogout = await request.post('/api/auth/logout', { headers: { origin: 'https://attacker.example' }, data: {} });
  expect(crossLogout.status()).toBe(403);
});
