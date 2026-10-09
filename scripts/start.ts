import { resolve, isAbsolute } from 'node:path';
import { access } from 'node:fs/promises';
import type { Server } from 'node:http';
import { dataDir, projectRoot } from '../core/config.js';
import { initializeSettings } from '../core/settings.js';
import { createProviderApp } from '../core/apps/provider/app.js';

process.umask(0o077);
let server: Server | undefined;
let fixture: ReturnType<typeof createProviderApp> | undefined;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => server?.closeAllConnections(), 10_000);
  timeout.unref();
  if (server?.listening) await new Promise<void>(resolve => {
    server!.close(() => resolve()); server!.closeIdleConnections();
  });
  clearTimeout(timeout);
  fixture?.close();
}
try {
  const port = Number(process.env.PORT ?? 4200);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (process.env.NODE_ENV === 'production' && (!process.env.ANCORA_DATA_DIR || !isAbsolute(dataDir))) {
    throw new Error('Production requires an absolute ANCORA_DATA_DIR');
  }
  const settings = await initializeSettings(dataDir, process.env.ISSUER_URL);
  const trustLoopbackProxy = process.env.TRUST_LOOPBACK_PROXY === 'true';
  if (settings.issuer.startsWith('https:') && !trustLoopbackProxy) {
    throw new Error('HTTPS issuer requires TRUST_LOOPBACK_PROXY=true with a local TLS proxy');
  }
  await access(resolve(projectRoot, 'frontend/hosted-login/dist/main.js'));
  fixture = createProviderApp(settings, resolve(dataDir, 'provider.sqlite'), { trustLoopbackProxy });
  server = await new Promise<Server>((resolve, reject) => {
    const listening = fixture!.app.listen(port, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  console.log(`Âncora: ${settings.issuer} | Portal: ${settings.issuer}/portal`);
} catch {
  console.error('Falha ao iniciar Âncora. Confira build, PORT, ISSUER_URL, proxy HTTPS, permissões e configuração persistida. Nenhuma chave foi sobrescrita.');
  await shutdown(); process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void shutdown(); });
}
