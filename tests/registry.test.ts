import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, validateLocalPath } from '../core/packages/node-sdk/src/index.js';
import { ClientRegistry, RegistryError } from '../core/apps/provider/registry.js';


const identity = { issuer: 'http://localhost:4400', sub: 'eip155:1:0x' + 'a'.repeat(40), address: '0x' + 'a'.repeat(40), chainId: 1 };
const input = { name: 'Meu site', appUrl: 'http://localhost:4500', callbackPath: '/auth/callback', logoutPath: '/' };
test('registry persists owners and clients, never lists secrets, isolates owners and applies rotation/disable immediately', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ancora-registry-')); const file = join(directory, 'registry.sqlite');
  let store = new SqliteStore(file); let registry = new ClientRegistry(store);
  try {
    const owner = registry.ensureDeveloper(identity).id;
    assert.equal(registry.ensureDeveloper(identity).id, owner);
    const other = registry.ensureDeveloper({ ...identity, sub: 'other' }).id;
    const created = registry.create(owner, input); const id = created.application.id;
    assert.equal(created.clientSecret.length, 43);
    assert.equal(registry.list(other).length, 0);
    assert.ok(!JSON.stringify(registry.list(owner)).includes(created.clientSecret));
    assert.throws(() => registry.get(id, other), (error: unknown) => error instanceof RegistryError && error.status === 404);
    assert.throws(() => registry.update(id, other, input)); assert.throws(() => registry.rotate(id, other)); assert.throws(() => registry.setEnabled(id, other, false));
    const rotated = registry.rotate(id, owner); assert.notEqual(rotated.clientSecret, created.clientSecret);
    assert.equal(registry.findEnabled(id)?.client_secret, rotated.clientSecret);
    registry.setEnabled(id, owner, false); assert.equal(registry.findEnabled(id), undefined);
    store.close(); store = new SqliteStore(file); registry = new ClientRegistry(store);
    assert.equal(registry.list(owner).length, 1); assert.equal(registry.get(id, owner).enabled, false);
    registry.setEnabled(id, owner, true); assert.equal(registry.findEnabled(id)?.client_secret, rotated.clientSecret);
    registry.ensurePortal(identity.issuer); assert.throws(() => registry.rotate('ancora-portal', owner));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('registration rejects open redirects, public HTTP, credentials and excessive application counts', () => {
  const store = new SqliteStore(':memory:'); const registry = new ClientRegistry(store); const owner = registry.ensureDeveloper(identity).id;
  try {
    for (const values of [{ appUrl: 'http://example.com' }, { appUrl: 'https://user:secret@example.com' }, { appUrl: 'https://example.com/path' }, { callbackPath: '//evil.example/callback' }, { callbackPath: '/auth/%2f/callback' }, { callbackPath: '/auth/../callback' }, { logoutPath: '//evil.example' }, { name: '' }]) {
      assert.throws(() => registry.create(owner, { ...input, ...values }));
    }
    for (let i = 0; i < 25; i++) registry.create(owner, input);
    assert.throws(() => registry.create(owner, input), (error: unknown) => error instanceof RegistryError && error.status === 409);
  } finally { store.close(); }
});
test('SDK destinations accept local paths only', () => {
  assert.equal(validateLocalPath('/minha-conta'), '/minha-conta');
  for (const path of ['https://evil.example', '//evil.example', '/%2f/evil', '/a/../b', '/x?next=evil', '/x#y', '/back\\slash']) assert.throws(() => validateLocalPath(path));
});
