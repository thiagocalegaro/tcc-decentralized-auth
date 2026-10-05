import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, validateUrl } from '../core/packages/node-sdk/src/index.js';
import { sqliteAdapter } from '../core/apps/provider/adapter.js';

test('one-use state is consumed atomically, expiration and namespaces are respected', () => {
  const store = new SqliteStore(':memory:');
  try {
    store.put('flow', 'id', { state: 1 }, 30);
    store.put('session', 'id', { state: 2 }, 30);
    assert.deepEqual(store.take('flow', 'id'), { state: 1 });
    assert.equal(store.take('flow', 'id'), undefined);
    assert.deepEqual(store.get('session', 'id'), { state: 2 });
    store.put('expired', 'id', { state: 3 }, -1);
    assert.equal(store.get('expired', 'id'), undefined);
    store.prune();
  } finally { store.close(); }
});
test('OIDC adapter persists consumption, locates session uid and revokes grant tokens', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const Adapter = sqliteAdapter(store);
    const code = new Adapter('AuthorizationCode');
    await code.upsert('code', { grantId: 'grant', uid: 'session' }, 30);
    await code.consume('code');
    assert.ok((await code.find('code'))?.consumed);
    await assert.rejects(code.consume('code'));
    assert.ok(await code.findByUid('session'));
    await code.revokeByGrantId('grant');
    assert.equal(await code.find('code'), undefined);
  } finally { store.close(); }
});
test('sessions survive closing and reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ancora-store-test-'));
  const path = join(dir, 'sessions.sqlite');
  let store = new SqliteStore(path);
  try {
    store.put('session', 'id', { sub: 'alice' }, 30); store.close();
    store = new SqliteStore(path);
    assert.deepEqual(store.get('session', 'id'), { sub: 'alice' });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('SDK accepts HTTP only on explicit loopback development and rejects malformed URLs', () => {
  assert.equal(validateUrl('http://localhost:4200', true).origin, 'http://localhost:4200');
  assert.throws(() => validateUrl('http://example.com', true));
  assert.throws(() => validateUrl('http://localhost:4200', false));
  assert.throws(() => validateUrl('https://example.com/other', false));
  assert.throws(() => validateUrl('https://user:secret@example.com', false));
  assert.equal(validateUrl('https://login.example.com', false).origin, 'https://login.example.com');
});
