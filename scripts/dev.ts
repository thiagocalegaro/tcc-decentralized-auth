import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { dataDir, readSettings, type ProviderSettings, type DemoSettings } from '../core/config.js';
import { createProviderApp } from '../core/apps/provider/app.js';
import { createDemoApp } from '../core/apps/demo/app.js';

const servers: Server[] = [];
const closers: Array<() => void> = [];
async function listen(app: Express, url: string) {
  const port = Number(new URL(url).port || (url.startsWith('https:') ? 443 : 80));
  const server = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server)); server.once('error', reject);
  });
  servers.push(server);
}
async function shutdown() {
  await Promise.all(servers.map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); })));
  for (const close of closers) close();
}
try {
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
  console.log(`Login hospedado: ${settings.issuer}\nPortal de desenvolvedores: ${settings.issuer}/portal\nCtrl+C para encerrar. O projeto original não participa destes serviços.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao iniciar.'); await shutdown(); process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
