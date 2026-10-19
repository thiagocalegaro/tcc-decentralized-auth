import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeSettings } from '../core/settings.js';
import { initializeDemoSettings } from '../core/apps/demo/bootstrap.js';
import { createProviderApp } from '../core/apps/provider/app.js';

test('demo setup preserves keys, credentials, developer applications and accounts after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ancora-demo-bootstrap-'));
  try {
    const initial = await initializeSettings(directory);
    const first = await initializeDemoSettings(directory);
    assert.deepEqual(first.settings.jwks, initial.jwks);
    assert.equal(first.demos.length, 2);
    assert.notEqual(first.demos[0].clientSecret, first.demos[1].clientSecret);
    const database = join(directory, 'provider.sqlite');
    let provider = createProviderApp(first.settings, database);
    const owner = provider.registry.ensureDeveloper({ issuer: first.settings.issuer, sub: 'test-owner', address: '0x' + 'a'.repeat(40), chainId: 1 }).id;
    const registered = provider.registry.create(owner, { name: 'Persistent site', appUrl: 'http://localhost:4300', callbackPath: '/auth/callback', logoutPath: '/' });
    provider.close();
    const second = await initializeDemoSettings(directory);
    assert.deepEqual(second, first);
    provider = createProviderApp(second.settings, database);
    try {
      assert.ok(provider.registry.findEnabled(registered.application.id));
      for (const demo of second.demos) assert.equal(provider.registry.findEnabled(demo.clientId)?.client_secret, demo.clientSecret);
      assert.equal(provider.registry.ensureDeveloper({ issuer: first.settings.issuer, sub: 'test-owner', address: '0x' + 'a'.repeat(40), chainId: 1 }).id, owner);
    } finally { provider.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('interrupted setup restores a missing demo file without rotating credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ancora-demo-recover-'));
  try {
    const first = await initializeDemoSettings(directory);
    await rm(join(directory, 'demo-b.json'));
    assert.deepEqual(await initializeDemoSettings(directory), first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('changed URLs and invalid persisted configuration fail without overwriting credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ancora-demo-guard-'));
  try {
    await initializeDemoSettings(directory);
    const original = await readFile(join(directory, 'provider.json'), 'utf8');
    await assert.rejects(initializeDemoSettings(directory, { issuer: 'http://localhost:4500' }), /differs/);
    await assert.rejects(initializeDemoSettings(directory, { demoAUrl: 'http://localhost:4501' }), /persistida/);
    await writeFile(join(directory, 'demo-a.json'), '{invalid');
    await assert.rejects(initializeDemoSettings(directory));
    assert.equal(await readFile(join(directory, 'provider.json'), 'utf8'), original);
    assert.equal(await readFile(join(directory, 'demo-a.json'), 'utf8'), '{invalid');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
