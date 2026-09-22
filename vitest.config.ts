import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'frontend/**/*.test.ts'],
    exclude: ['frontend/tests/e2e/**', '**/node_modules/**'],
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
