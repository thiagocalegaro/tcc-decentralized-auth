import { fileURLToPath } from 'node:url';

// Keep the demo environment separate from the standalone provider's .local/ data.
process.env.ANCORA_DATA_DIR ??= fileURLToPath(new URL('../.local/demos/', import.meta.url));
process.umask(0o077);
await import('./demo-setup.js');
await import('./demo-dev.js');
