import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { channel: 'msedge', headless: true, launchOptions: { args: ['--disable-gpu'] }, reducedMotion: 'reduce', actionTimeout: 15_000, navigationTimeout: 20_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx scripts/test-server.ts', url: 'http://localhost:4402/health', reuseExistingServer: false, timeout: 120_000 },
});
