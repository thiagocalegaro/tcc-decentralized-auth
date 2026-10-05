import { readSettings, type ProviderSettings } from '../core/config.js';
const settings = readSettings<ProviderSettings>('provider.json');
console.log(`O cadastro agora é feito pelo portal: ${settings.issuer}/portal`);
console.log('Entre com sua carteira e escolha Nova aplicação. Não é necessário reiniciar o servidor.');
