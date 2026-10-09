import { dataDir } from '../core/config.js';
import { initializeSettings } from '../core/settings.js';

process.umask(0o077);
await initializeSettings(dataDir, process.env.ISSUER_URL);
console.log('Configuração do Âncora pronta. Chaves existentes preservadas.');
