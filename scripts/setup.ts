import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { dataDir, type RegisteredClient, type ProviderSettings, type DemoSettings } from '../core/config.js';
import { validateUrl } from '../core/packages/node-sdk/src/index.js';

await mkdir(dataDir, { recursive: true, mode: 0o700 });
const exists = await readFile(resolve(dataDir, 'provider.json'), 'utf8').then(() => true).catch(() => false);
if (exists) {
  for (const file of ['demo-a.json', 'demo-b.json']) await readFile(resolve(dataDir, file), 'utf8');
  console.log('Configuração existente preservada.');
} else {
  const issuer = validateUrl(process.env.ISSUER_URL ?? 'http://localhost:4200', true).origin;
  const urls = [process.env.DEMO_A_URL ?? 'http://localhost:4201', process.env.DEMO_B_URL ?? 'http://localhost:4202']
    .map(value => validateUrl(value, true).origin);
  if (new Set([issuer, ...urls]).size !== 3) throw new Error('Use origens diferentes para o provedor e os dois sites.');
  const names = ['Biblioteca', 'Observatório'];
  const clients: RegisteredClient[] = urls.map((url, i) => ({
    client_id: `demo-${i ? 'b' : 'a'}`, client_name: names[i], client_secret: randomBytes(32).toString('base64url'),
    redirect_uris: [`${url}/auth/callback`], post_logout_redirect_uris: [`${url}/`],
    response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_post',
  }));
  const pair = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const settings: ProviderSettings = {
    issuer, chains: [1, 11155111], cookieKeys: [randomBytes(48).toString('base64url')],
    jwks: { keys: [{ ...await exportJWK(pair.privateKey), kid: randomBytes(12).toString('hex'), alg: 'RS256', use: 'sig' }] }, clients,
  };
  for (const [i, item] of clients.entries()) {
    const demo: DemoSettings = { issuer, clientId: item.client_id, clientSecret: item.client_secret, appUrl: urls[i],
      name: names[i], theme: i ? 'observatory' : 'library', peerUrl: urls[1 - i], database: `demo-${i ? 'b' : 'a'}.sqlite` };
    await writeFile(resolve(dataDir, `demo-${i ? 'b' : 'a'}.json`), JSON.stringify(demo, null, 2), { flag: 'wx', mode: 0o600 });
  }
  await writeFile(resolve(dataDir, 'provider.json'), JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Chaves e credenciais próprias criadas em .local. Nenhum segredo foi exibido.');
}
