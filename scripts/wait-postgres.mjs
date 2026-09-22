import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required.');

const maxAttempts = 30;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log(`PostgreSQL is ready after ${attempt} attempt(s).`);
    await client.end();
    process.exit(0);
  } catch (error) {
    await client.end().catch(() => undefined);
    if (attempt === maxAttempts) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
