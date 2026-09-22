import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
await mkdir('.local', { recursive: true });
const keyFile = resolve('.local/signing-key.json');
if (!await exists(keyFile)) {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  Object.assign(jwk, { kid: randomBytes(12).toString('hex'), alg: 'ES256', use: 'sig' });
  await writeFile(keyFile, JSON.stringify(jwk, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Chave local ES256 criada em .local/signing-key.json.');
}
if (!await exists('.env')) {
  const example = await readFile('.env.example', 'utf8');
  await writeFile('.env', example.replace('CLIENT_SECRET=\n', `CLIENT_SECRET=${randomBytes(32).toString('hex')}\n`), { flag: 'wx', mode: 0o600 });
  console.log('.env local criado com segredo aleatório.');
}
console.log('Configuração local pronta. Execute npm run dev.');
