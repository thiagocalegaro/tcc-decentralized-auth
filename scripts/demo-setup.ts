import { dataDir } from '../core/config.js';
import { initializeDemoSettings } from '../core/apps/demo/bootstrap.js';

await initializeDemoSettings(dataDir, {
  issuer: process.env.ISSUER_URL,
  demoAUrl: process.env.DEMO_A_URL,
  demoBUrl: process.env.DEMO_B_URL,
});
console.log('Ambiente de demonstração preparado. Chaves e credenciais existentes preservadas.');
