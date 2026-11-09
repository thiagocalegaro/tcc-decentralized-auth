import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = resolve(root, 'core/packages');
const releases = resolve(packages, 'releases');
mkdirSync(releases, { recursive: true });

if (!process.env.npm_execpath) throw new Error('Execute npm run build para empacotar os SDKs.');
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--workspace', '@ancora/node',
  '--pack-destination', releases], { cwd: root, stdio: 'inherit' });

for (const [source, filename, entries] of [
  ['python-sdk', 'ancora-flask-0.1.0.tar.gz', ['README.md', 'pyproject.toml', 'ancora_flask.py']],
  ['php-sdk', 'ancora-php-0.1.0.tar.gz', ['README.md', 'composer.json', 'src']],
  ['spring-sdk', 'ancora-spring-0.1.0.tar.gz', ['README.md', 'pom.xml', 'src']],
]) {
  execFileSync('tar', ['-czf', resolve(releases, filename), '-C', resolve(packages, source), ...entries],
    { cwd: root, stdio: 'inherit' });
}
