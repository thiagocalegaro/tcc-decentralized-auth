import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Fresh, isolated keys and databases for each test run. No bypass routes or test accounts on the server.
process.env.ANCORA_DATA_DIR = await mkdtemp(join(tmpdir(), 'ancora-e2e-'));
process.env.ISSUER_URL = 'http://localhost:4400';
await import('./setup.js');
process.env.PORT = '4400';
await import('./start.js');
