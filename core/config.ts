import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JWK } from 'jose';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = resolve(process.env.ANCORA_DATA_DIR ?? resolve(projectRoot, '.local'));
export interface RegisteredClient {
  client_id: string; client_secret: string; client_name: string;
  redirect_uris: string[]; post_logout_redirect_uris: string[];
  response_types: ['code']; grant_types: ['authorization_code']; token_endpoint_auth_method: 'client_secret_post';
}
export interface ProviderSettings {
  issuer: string; cookieKeys: string[]; jwks: { keys: JWK[] };
  chains: number[]; clients: RegisteredClient[];
}

export function readSettings<T>(name: string): T {
  try { return JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as T; }
  catch { throw new Error(`Configuração ${name} ausente ou inválida. Execute npm run setup.`); }
}
