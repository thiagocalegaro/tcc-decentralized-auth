import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { dataDir, projectRoot, readSettings, type ProviderSettings } from '../core/config.js';
import { createProviderApp } from '../core/apps/provider/app.js';
import type { DemoSettings } from '../core/apps/demo/settings.js';
import { createDemoApp } from '../core/apps/demo/app.js';

const servers: Server[] = [];
const closers: Array<() => void> = [];
const bindHost = process.env.ANCORA_BIND_HOST ?? '127.0.0.1';
let closing = false;
let observatory: ChildProcess | undefined;
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
  if (observatory?.pid && observatory.exitCode === null && observatory.signalCode === null) {
    await new Promise<void>(resolve => {
      observatory!.once('exit', () => resolve());
      observatory!.kill();
    });
  }
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
  const demoSettings = readSettings<DemoSettings>('demo-a.json');
  const demo = await createDemoApp(demoSettings, resolve(dataDir, demoSettings.database));
  closers.push(demo.close);
  await listen(demo.app, demoSettings.appUrl);
  console.log(`${demoSettings.name}: ${demoSettings.appUrl}`);
  const pythonSettings = readSettings<DemoSettings>('demo-b.json');
  const venv = resolve(projectRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const python = process.env.ANCORA_PYTHON ?? (existsSync(venv) ? venv : 'python3');
  observatory = spawn(python, [resolve(projectRoot, 'core/apps/observatory/app.py')], {
    env: { ...process.env, ANCORA_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Flask startup timeout')), 30_000);
    observatory!.once('error', error => { clearTimeout(timer); reject(error); });
    observatory!.once('exit', () => { clearTimeout(timer); reject(new Error('Flask stopped')); });
    observatory!.stdout!.once('data', () => { clearTimeout(timer); resolve(); });
  });
  observatory.once('exit', () => {
    if (!closing) { console.error('O Observatório Flask foi encerrado.'); void shutdown().then(() => process.exit(1)); }
  });
  console.log(`${pythonSettings.name} (Python/Flask): ${pythonSettings.appUrl}`);
  console.log(`Login hospedado: ${settings.issuer}\nPortal de desenvolvedores: ${settings.issuer}/portal\nCtrl+C para encerrar.`);
} catch {
  console.error('Falha ao iniciar as demos. Confira o build, portas, ANCORA_BIND_HOST e configurações persistidas.'); await shutdown(); process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
