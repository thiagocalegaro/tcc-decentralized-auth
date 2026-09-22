import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (!existsSync('.env')) {
  console.error('Execute npm run setup antes de iniciar.');
  process.exit(1);
}
const tsx = fileURLToPath(import.meta.resolve('tsx/cli'));
const vite = resolve('node_modules/vite/bin/vite.js');
const specs = [
  ['API', [tsx, 'core/apps/auth-api/src/main.ts']],
  ['BFF', [tsx, 'core/apps/demo-bff/src/main.ts']],
  ['Web', [vite, '--config', 'frontend/demo-web/vite.config.ts', '--host', '127.0.0.1']],
] as const;
let stopping = false;
const children = specs.map(([name, args]) => {
  const child = spawn(process.execPath, [...args], { stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', (code) => { if (!stopping) { console.error(`${name} encerrou (${code}).`); stop(code ?? 1); } });
  return child;
});
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
