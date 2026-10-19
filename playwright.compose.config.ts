import { defineConfig } from '@playwright/test';
import demos from './playwright.demo.config.js';

// Run the same login/SSO tests against the actual Compose container, not a test server.
process.env.ANCORA_E2E_PROVIDER_URL = 'http://localhost:4200';
process.env.ANCORA_E2E_DEMO_A_URL = 'http://localhost:4201';
process.env.ANCORA_E2E_DEMO_B_URL = 'http://localhost:4202';

export default defineConfig({ ...demos, webServer: undefined, testMatch: '*.spec.ts' });
