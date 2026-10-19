import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { RegisteredClient } from '../../config.js';
import { initializeSettings } from '../../settings.js';
import { validateUrl } from '../../packages/node-sdk/src/index.js';
import type { DemoSettings } from './settings.js';

interface DemoOrigins { issuer?: string; demoAUrl?: string; demoBUrl?: string }

/** Reuses existing keys and credentials, including after an interrupted first setup. */
export async function initializeDemoSettings(directory: string, origins: DemoOrigins = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('As demos usam HTTP local; não execute com NODE_ENV=production.');
  const urls = [origins.demoAUrl ?? 'http://localhost:4201', origins.demoBUrl ?? 'http://localhost:4202']
    .map(value => validateUrl(value, true).origin);
  const settings = await initializeSettings(directory, origins.issuer);
  if (new Set([settings.issuer, ...urls]).size !== 3 || [settings.issuer, ...urls].some(url => new URL(url).protocol !== 'http:')) {
    throw new Error('Use três origens HTTP loopback diferentes para o ambiente de demonstração.');
  }
  const demos: DemoSettings[] = [];
  const missing: number[] = [];
  let changed = false;
  for (const [i, appUrl] of urls.entries()) {
    const id = i === 0 ? 'demo-a' : 'demo-b';
    const name = i === 0 ? 'Biblioteca' : 'Observatório';
    let client = settings.clients.find(item => item.client_id === id);
    if (client && (client.redirect_uris[0] !== `${appUrl}/auth/callback` || client.post_logout_redirect_uris[0] !== `${appUrl}/`)) {
      throw new Error('As origens das demos diferem da configuração persistida. Preserve as URLs já usadas.');
    }
    let existing: DemoSettings | undefined;
    try { existing = JSON.parse(await readFile(resolve(directory, `${id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing && (!client || existing.issuer !== settings.issuer || existing.appUrl !== appUrl
      || existing.peerUrl !== urls[1 - i] || existing.clientId !== id || existing.clientSecret !== client.client_secret
      || existing.database !== `${id}.sqlite`)) {
      throw new Error('Configuração da demo inconsistente; restaure a configuração em vez de regenerar credenciais.');
    }
    if (!client) {
      client = {
        client_id: id, client_name: name, client_secret: randomBytes(32).toString('base64url'),
        redirect_uris: [`${appUrl}/auth/callback`], post_logout_redirect_uris: [`${appUrl}/`],
        response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_post',
      } satisfies RegisteredClient;
      settings.clients.push(client);
      changed = true;
    }
    demos.push(existing ?? {
      issuer: settings.issuer, clientId: id, clientSecret: client.client_secret, appUrl, name,
      theme: i === 0 ? 'library' : 'observatory', peerUrl: urls[1 - i], database: `${id}.sqlite`,
    });
    if (!existing) missing.push(i);
  }
  if (changed) {
    const temporary = resolve(directory, `provider-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, resolve(directory, 'provider.json'));
  }
  // Save provider credentials first; a retry recovers missing demo files with the same secrets.
  for (const i of missing) {
    await writeFile(resolve(directory, `${demos[i].clientId}.json`), JSON.stringify(demos[i], null, 2), { flag: 'wx', mode: 0o600 });
  }
  return { settings, demos };
}
