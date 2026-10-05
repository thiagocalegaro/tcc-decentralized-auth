import { wallet } from './wallet.js';
import { test, expect, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const A = 'http://localhost:4401';
const B = 'http://localhost:4402';
const OP = 'http://localhost:4400';
async function begin(page: Page, base = A) {
  await page.goto(base);
  await page.getByRole('link', { name: 'Entrar com Âncora', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${OP}/interaction/`));
}
async function login(page: Page) {
  await page.getByRole('button', { name: 'Conectar e assinar' }).click();
  await page.getByRole('button', { name: 'Autorizar acesso' }).click();
  await expect(page).toHaveURL(`${A}/arearestrita`);
  await expect(page.locator('#address')).not.toHaveText('Carregando…');
}

test('signed SIWE → OIDC → protected site; second site SSO; independent local logout and provider logout', async ({ page, context }) => {
  test.setTimeout(120_000);
  const { account, calls } = await wallet(context);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(A);
  await page.screenshot({ path: 'test-results/demo-a.png' });
  await begin(page);
  await page.screenshot({ path: 'test-results/login-hospedado.png' });
  await login(page);
  await expect(page.locator('#address')).toHaveText(account.address);
  expect(calls.signatures).toBe(1);
  const first = await page.request.get(`${A}/api/private`);
  expect(first.status()).toBe(200);
  const firstUser = (await first.json()).user;
  expect(firstUser.userId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.locator('#local-user')).toHaveText(firstUser.userId);
  expect(JSON.stringify(await first.json())).not.toContain('idToken');
  const localCookies = (await context.cookies()).filter(cookie => /^ancora_[a-f0-9]{12}$/.test(cookie.name));
  expect(localCookies).toHaveLength(1);
  expect(localCookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.goto(B);
  await page.getByRole('link', { name: 'Entrar com Âncora', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autorizar acesso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar e assinar' })).toBeHidden();
  await page.screenshot({ path: 'test-results/consentimento-sso.png' });
  await page.getByRole('button', { name: 'Autorizar acesso' }).click();
  await expect(page).toHaveURL(`${B}/arearestrita`);
  await expect(page.locator('#address')).toHaveText(account.address);
  const secondUser = (await (await page.request.get(`${B}/api/private`)).json()).user;
  expect(secondUser.userId).not.toBe(firstUser.userId);
  expect(calls.signatures).toBe(1);
  await page.screenshot({ path: 'test-results/demo-b-autenticado.png' });
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(200);
  await page.getByRole('button', { name: 'Sair apenas deste site', exact: true }).click();
  await expect(page).toHaveURL(`${B}/`);
  expect((await page.request.get(`${B}/api/private`)).status()).toBe(401);
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(200);
  await page.getByRole('link', { name: 'Entrar com Âncora', exact: true }).click();
  await expect(page).toHaveURL(`${B}/arearestrita`);
  expect((await (await page.request.get(`${B}/api/private`)).json()).user.userId).toBe(secondUser.userId);
  expect(calls.signatures).toBe(1);
  await page.getByRole('button', { name: 'Sair deste site e do Âncora', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encerrar sessão no Âncora', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('id_token_hint')).toBe(false);
  await page.getByRole('button', { name: 'Encerrar sessão no Âncora', exact: true }).click();
  await expect(page).toHaveURL(`${B}/`);
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(200);
  await page.getByRole('link', { name: 'Entrar com Âncora', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conectar e assinar' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('unauthenticated HTML and private API are blocked; assets do not expose restricted HTML', async ({ page }) => {
  const route = await page.request.get(`${A}/arearestrita`, { maxRedirects: 0 });
  expect(route.status()).toBe(303); expect(route.headers().location).toBe('/');
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(401);
  expect((await page.request.get(`${B}/api/private`)).status()).toBe(401);
  expect((await page.request.get(`${A}/demo-assets/restricted.html`)).status()).toBe(404);
  expect(await (await page.request.get(`${A}/api/session`)).json()).toEqual({ authenticated: false });
});

test('discovery exposes code flow, S256 and public JWKS; unknown redirect and missing PKCE fail', async ({ request }) => {
  const metadata = await (await request.get(`${OP}/.well-known/openid-configuration`)).json();
  expect(metadata.issuer).toBe(OP);
  expect(metadata.response_types_supported).toEqual(['code']);
  expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  const jwks = await (await request.get(metadata.jwks_uri)).json();
  expect(jwks.keys.length).toBeGreaterThan(0); expect(jwks.keys[0].d).toBeUndefined();
  const start = await request.get(`${A}/auth/login`, { maxRedirects: 0 });
  const authorization = new URL(start.headers().location);
  authorization.searchParams.set('redirect_uri', 'https://evil.example/callback');
  const rejected = await request.get(authorization.href, { maxRedirects: 0 });
  expect(rejected.status()).toBe(400); expect(rejected.headers().location).toBeUndefined();
  authorization.searchParams.set('redirect_uri', `${A}/auth/callback`);
  authorization.searchParams.delete('code_challenge'); authorization.searchParams.delete('code_challenge_method');
  const noPkce = await request.get(authorization.href, { maxRedirects: 0 });
  expect([302, 303]).toContain(noPkce.status());
  expect(new URL(noPkce.headers().location).searchParams.get('error')).toBe('invalid_request');
});

test('callback rejects forged state and missing browser binding; logout rejects foreign origins', async ({ page, browser }) => {
  const start = await page.request.get(`${A}/auth/login`, { maxRedirects: 0 });
  const authorization = new URL(start.headers().location);
  const state = authorization.searchParams.get('state');
  expect((await page.request.get(`${A}/auth/callback?code=forged&state=forged`)).status()).toBe(400);
  const foreign = await browser.newContext();
  expect((await foreign.request.get(`${A}/auth/callback?code=forged&state=${state}`)).status()).toBe(400);
  await foreign.close();
  expect((await page.request.post(`${A}/auth/logout`, { headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await page.request.get(`${A}/auth/logout`)).status()).toBe(405);
});

test('wallet rejection leaves the application unauthenticated and offers retry', async ({ page, context }) => {
  await wallet(context, 'reject'); await begin(page);
  await page.getByRole('button', { name: 'Conectar e assinar' }).click();
  await expect(page.getByRole('status')).toContainText('Você recusou');
  await expect(page.getByRole('button', { name: 'Conectar e assinar' })).toBeEnabled();
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(401);
});

test('origin/CSRF, chain allowlist, altered messages, wrong signer and signature replay are rejected', async ({ page }) => {
  const account = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  await begin(page);
  const interactionUrl = page.url();
  const details = await (await page.request.get(`${interactionUrl}/details`)).json();
  const headers = { Origin: OP, 'X-CSRF-Token': details.csrf };
  const payload = { address: account.address, chainId: 1 };
  expect((await page.request.post(`${interactionUrl}/challenge`, { data: payload })).status()).toBe(400);
  expect((await page.request.post(`${interactionUrl}/challenge`, { headers: { ...headers, 'X-CSRF-Token': 'bad' }, data: payload })).status()).toBe(400);
  expect((await page.request.post(`${interactionUrl}/challenge`, { headers, data: { ...payload, chainId: 9999 } })).status()).toBe(400);
  const challenge = async () => (await page.request.post(`${interactionUrl}/challenge`, { headers, data: payload })).json();
  let issued = await challenge();
  let signature = await other.signMessage({ message: issued.message });
  expect((await page.request.post(`${interactionUrl}/verify`, { headers, data: { message: issued.message, signature } })).status()).toBe(400);
  issued = await challenge();
  signature = await account.signMessage({ message: `${issued.message}altered` });
  expect((await page.request.post(`${interactionUrl}/verify`, { headers, data: { message: `${issued.message}altered`, signature } })).status()).toBe(400);
  issued = await challenge();
  signature = await account.signMessage({ message: issued.message });
  const verify = () => page.request.post(`${interactionUrl}/verify`, { headers, data: { message: issued.message, signature } });
  const results = await Promise.all([verify(), verify()]);
  expect(results.map(result => result.status()).sort()).toEqual([200, 400]);
});

test('cancel returns to the application without creating a session', async ({ page }) => {
  await begin(page);
  await page.getByRole('button', { name: 'Cancelar e voltar' }).click();
  await expect(page).toHaveURL(`${A}/?login=cancelled`);
  await expect(page.getByRole('status')).toContainText('Você cancelou');
  expect((await page.request.get(`${A}/api/private`)).status()).toBe(401);
});

test('desktop and mobile layout, focusable controls and missing-wallet guidance', async ({ page }) => {
  for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(size); await page.goto(A);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (size.width >= 390) expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await begin(page);
  await expect(page.locator('#no-wallet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar e assinar' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/login-mobile.png' });
});
