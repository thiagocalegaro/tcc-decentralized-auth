import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

async function verifyBrand(page: Page) {
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('href', '/assets/logo-ancora.png?v=ac594dec1ba0');
  const response = await page.request.get(new URL((await icon.getAttribute('href'))!, page.url()).href);
  expect(response.status()).toBe(200);
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe('ac594dec1ba065791d0334370b472cebe0cfd8a5614ddda577408b8d581291c3');
  for (const logo of await page.locator('img[src*="logo-ancora"]').all()) {
    await expect(logo).toBeVisible();
    await expect(logo).toHaveCSS('object-fit', 'contain');
    await expect(logo).toHaveCSS('border-radius', '0px');
    expect(await logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1254);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('new emblem is served unchanged as logo and favicon across all public surfaces', async ({ page }) => {
  for (const url of ['http://localhost:4400/', 'http://localhost:4400/portal']) {
    await page.goto(url); await verifyBrand(page);
  }
  await page.getByRole('link', { name: 'Entrar com minha carteira', exact: true }).click();
  await expect(page).toHaveURL(/localhost:4400\/interaction\//);
  await verifyBrand(page);
  await page.goto('http://localhost:4400/authorize?client_id=unknown');
  await expect(page.getByRole('heading', { name: 'Não foi possível continuar' })).toBeVisible();
  await verifyBrand(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:4400/portal'); await verifyBrand(page);
  await page.screenshot({ path: 'test-results/nova-logo-portal-mobile.png' });
});
