import { test, expect, type Page } from '@playwright/test';
import { wallet } from './wallet.js';
const OP = 'http://localhost:4400';
async function enter(page: Page) {
  await page.goto(`${OP}/portal`);
  await page.getByRole('link', { name: 'Entrar com minha carteira' }).click();
  await page.getByRole('button', { name: 'Conectar e assinar' }).click();
  await page.getByRole('button', { name: 'Autorizar acesso' }).click();
  await expect(page).toHaveURL(`${OP}/portal`);
  await expect(page.getByRole('button', { name: '+ Nova aplicação' })).toBeVisible();
}
test('portal provisions through UI, shows secret once, edits, rotates and disables at runtime; owner/CSRF isolation', async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const owner = await wallet(context); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 }); await enter(page);
  await expect(page.locator('#owner')).toHaveText(owner.account.address);
  await page.getByLabel('Nome da aplicação').fill('Acervo acadêmico');
  await page.getByLabel('Endereço do site').fill('http://localhost:4300');
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/portal/api/applications') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar aplicação', exact: true }).click();
  const created = await (await createdResponse).json(); const id = created.application.id;
  await expect(page.getByRole('dialog', { name: 'Guarde seu segredo' })).toBeVisible();
  await expect(page.locator('#new-secret')).toHaveValue(created.clientSecret);
  await page.getByRole('button', { name: 'Já guardei' }).click();
  await expect(page.locator('#new-secret')).toHaveValue('');
  await expect(page.locator('#client-id')).toHaveText(id);
  expect(await page.locator('body').innerText()).not.toContain(created.clientSecret);
  await page.reload(); await expect(page.locator('#detail-title')).toHaveText('Acervo acadêmico');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  const list = await (await page.request.get(`${OP}/portal/api/applications`)).json();
  expect(list.applications).toHaveLength(1); expect(JSON.stringify(list)).not.toContain(created.clientSecret);
  const me = await (await page.request.get(`${OP}/portal/api/me`)).json(); const headers = { Origin: OP, 'X-CSRF-Token': me.csrf };
  const example = await page.request.get(`${OP}/portal/api/example`);
  expect(example.status()).toBe(200); expect(example.headers()['content-disposition']).toContain('server.mjs');
  expect(await example.text()).toContain('onLogin(identity)'); expect(await example.text()).not.toContain(created.clientSecret);
  const path = `${OP}/portal/api/applications/${id}`;
  expect((await page.request.post(`${path}/rotate`, { data: {} })).status()).toBe(403);
  expect((await page.request.post(`${path}/rotate`, { headers: { ...headers, Origin: 'https://evil.example' }, data: {} })).status()).toBe(403);
  expect((await page.request.post(`${path}/rotate`, { headers: { ...headers, 'X-CSRF-Token': 'bad' }, data: {} })).status()).toBe(403);
  const foreign = await browser.newContext();
  try {
    expect((await foreign.request.get(path)).status()).toBe(401);
    await wallet(foreign); const otherPage = await foreign.newPage(); await enter(otherPage);
    const other = await (await foreign.request.get(`${OP}/portal/api/me`)).json();
    const otherHeaders = { Origin: OP, 'X-CSRF-Token': other.csrf };
    expect((await foreign.request.get(path)).status()).toBe(404);
    expect((await foreign.request.patch(path, { headers: otherHeaders, data: { name: 'Hijack' } })).status()).toBe(404);
    for (const action of ['rotate', 'disable', 'enable']) expect((await foreign.request.post(`${path}/${action}`, { headers: otherHeaders, data: {} })).status()).toBe(404);
    expect((await (await foreign.request.get(`${OP}/portal/api/applications`)).json()).applications).toHaveLength(0);
  } finally { await foreign.close(); }
  expect((await page.request.get(`${OP}/portal/api/applications/ancora-portal`)).status()).toBe(404);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Nome da aplicação').fill('Acervo da universidade');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.locator('#detail-title')).toHaveText('Acervo da universidade');
  await page.screenshot({ path: 'test-results/portal-aplicacao.png', fullPage: true });
  await page.locator('#app-detail > .guide summary').click();
  await expect(page.getByRole('link', { name: 'Baixar exemplo completo (Node.js)' })).toBeVisible();
  await page.screenshot({ path: 'test-results/portal-integracao.png', fullPage: true });
  await page.locator('#app-detail > .guide summary').click();
  for (const language of ['Python / Flask', 'PHP', 'Java / Spring Boot']) {
    const guide = page.locator('.language-guide').filter({ has: page.locator('summary', { hasText: language }) });
    await guide.locator('summary').click();
    await expect(guide).toContainText(`ANCORA_CLIENT_ID=${id}`);
    await expect(guide).toContainText('ANCORA_REDIRECT_URI=http://localhost:4300/auth/callback');
    await expect(guide).not.toContainText(created.clientSecret);
    await expect(guide.getByRole('button', { name: 'Copiar código' }).first()).toBeVisible();
    if (language === 'Java / Spring Boot') {
      await expect(guide).toContainText('OAuth2AuthorizationRequestCustomizers.withPkce()');
      await expect(guide).toContainText('client-authentication-method: client_secret_post');
      await expect(guide).toContainText('redirect-uri: ${ANCORA_REDIRECT_URI}');
      await expect(guide).toContainText('users.setRetrieveUserInfo(request -> true)');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guide.locator('summary').click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const authorization = new URL(`${OP}/authorize`); authorization.search = new URLSearchParams({ client_id: id,
    redirect_uri: 'http://localhost:4300/auth/callback', response_type: 'code', scope: 'openid wallet', state: 'test',
    code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' }).toString();
  expect([302, 303]).toContain((await page.request.get(authorization.href, { maxRedirects: 0 })).status());
  await page.getByRole('button', { name: 'Gerar novo segredo' }).click();
  const rotatedResponse = page.waitForResponse(response => response.url().endsWith(`/${id}/rotate`) && response.status() === 200);
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  const rotated = await (await rotatedResponse).json(); expect(rotated.clientSecret).not.toBe(created.clientSecret);
  await expect(page.locator('#new-secret')).toHaveValue(rotated.clientSecret); await page.getByRole('button', { name: 'Já guardei' }).click();
  await page.getByRole('button', { name: 'Desativar aplicação', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.locator('#app-state')).toHaveText('Aplicação desativada');
  expect((await page.request.get(authorization.href, { maxRedirects: 0 })).status()).toBe(400);
  await page.getByRole('button', { name: 'Reativar aplicação' }).click(); await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.locator('#app-state')).toHaveText('Aplicação ativa');
  expect([302, 303]).toContain((await page.request.get(authorization.href, { maxRedirects: 0 })).status());
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(size); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/portal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sair do portal' }).click();
  await expect(page.getByRole('link', { name: 'Entrar com minha carteira' })).toBeVisible();
  expect((await page.request.get(`${OP}/portal/api/applications`)).status()).toBe(401);
  expect(errors).toEqual([]);
});
test('public site and portal entry load on desktop/mobile without exposing private application data', async ({ page }) => {
  for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.goto(OP);
    await expect(page.getByRole('link', { name: 'Abrir portal do desenvolvedor' })).toBeVisible();
    await expect(page.locator('#demos a')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (size.width > 1000) await page.screenshot({ path: 'test-results/ancora-home.png' });
    await page.getByRole('link', { name: 'Abrir portal do desenvolvedor' }).click();
    await expect(page.getByRole('link', { name: 'Entrar com minha carteira' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.request.post(`${OP}/portal/api/applications`, { data: {} })).status()).toBe(401);
  }
});
