import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import type { ProviderSettings } from './config.js';
import { validateUrl } from './packages/node-sdk/src/index.js';

export async function initializeSettings(directory: string, requestedIssuer?: string): Promise<ProviderSettings> {
  if (process.env.NODE_ENV === 'production' && !requestedIssuer) throw new Error('ISSUER_URL is required in production');
  const requested = requestedIssuer ? validateUrl(requestedIssuer, true).origin : undefined;
  const file = resolve(directory, 'provider.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let content: string | undefined;
  try { content = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (content !== undefined) {
    let existing: ProviderSettings;
    try { existing = JSON.parse(content); } catch { throw new Error('Invalid provider.json; restore a backup instead of regenerating keys'); }
    const issuer = validateUrl(existing.issuer, true).origin;
    if (requested && requested !== issuer) throw new Error('ISSUER_URL differs from persisted issuer; migrate configuration explicitly');
    return existing;
  }
  const issuer = requested ?? validateUrl('http://localhost:4200', true).origin;
  const pair = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const settings: ProviderSettings = {
    issuer, chains: [1, 11155111],
    cookieKeys: [randomBytes(48).toString('base64url')],
    jwks: { keys: [{ ...await exportJWK(pair.privateKey), kid: randomBytes(12).toString('hex'), alg: 'RS256', use: 'sig' }] },
    clients: [],
  };
  // Exclusive creation: a concurrent start must never replace existing signing keys.
  await writeFile(file, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
  return settings;
}
