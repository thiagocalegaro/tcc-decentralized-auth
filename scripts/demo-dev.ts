import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { dataDir, readSettings, type ProviderSettings } from '../core/config.js';
import { createProviderApp } from '../core/apps/provider/app.js';
import type { DemoSettings } from '../core/apps/demo/settings.js';
import { createDemoApp } from '../core/apps/demo/app.js';

const servers: Server[] = [];
const closers: Array<() => void> = [];
const bindHost = process.env.ANCORA_BIND_HOST ?? '127.0.0.1';
let closing = false;
async function listen(app: Express, url: string) {
  const port = Number(new URL(url).port || (url.startsWith('https:') ? 443 : 80));
  const server = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, bindHost, () => resolve(server)); server.once('error', reject);
  });
  servers.push(server);
}
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => servers.forEach(server => server.closeAllConnections()), 10_000);
  timeout.unref();
  await Promise.all(servers.map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); })));
  clearTimeout(timeout);
  for (const close of closers) close();
}
try {
  if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) throw new Error('Invalid ANCORA_BIND_HOST');
  if (process.env.NODE_ENV === 'production') throw new Error('Demos are only available in local development');
  const settings = readSettings<ProviderSettings>('provider.json');
  if (new URL(settings.issuer).protocol !== 'http:') throw new Error('O launcher local requer HTTP loopback. Para HTTPS, consulte docs/OPERACAO.md.');
  const provider = createProviderApp(settings, resolve(dataDir, 'provider.sqlite'));
  closers.push(provider.close);
  await listen(provider.app, settings.issuer);
  for (const file of ['demo-a.json', 'demo-b.json']) {
    const demoSettings = readSettings<DemoSettings>(file);
    const demo = await createDemoApp(demoSettings, resolve(dataDir, demoSettings.database));
    closers.push(demo.close);
    await listen(demo.app, demoSettings.appUrl);
    console.log(`${demoSettings.name}: ${demoSettings.appUrl}`);
  }
  console.log(`Login hospedado: ${settings.issuer}\nPortal de desenvolvedores: ${settings.issuer}/portal\nCtrl+C para encerrar.`);
} catch {
  console.error('Falha ao iniciar as demos. Confira o build, portas, ANCORA_BIND_HOST e configurações persistidas.'); await shutdown(); process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
