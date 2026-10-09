import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { initializeSettings } from '../core/settings.js';
import { createProviderApp } from '../core/apps/provider/app.js';

test('setup creates only provider settings, preserves keys, refuses issuer changes and corrupt files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ancora-settings-'));
  try {
    const first = await initializeSettings(directory, 'https://auth.example.test');
    assert.deepEqual(first.clients, []);
    assert.deepEqual(await readdir(directory), ['provider.json']);
    const original = await readFile(join(directory, 'provider.json'), 'utf8');
    const second = await initializeSettings(directory, 'https://auth.example.test');
    assert.deepEqual(second.jwks, first.jwks);
    assert.deepEqual(second.cookieKeys, first.cookieKeys);
    await assert.rejects(initializeSettings(directory, 'https://changed.example.test'), /differs/);
    assert.equal(await readFile(join(directory, 'provider.json'), 'utf8'), original);
    await writeFile(join(directory, 'provider.json'), '{broken');
    await assert.rejects(initializeSettings(directory, 'https://auth.example.test'), /Invalid provider.json/);
    assert.equal(await readFile(join(directory, 'provider.json'), 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('production setup requires an explicit HTTPS issuer', async () => {
  const previous = process.env.NODE_ENV;
  const directory = await mkdtemp(join(tmpdir(), 'ancora-production-'));
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(initializeSettings(directory), /ISSUER_URL/);
    await assert.rejects(initializeSettings(directory, 'http://localhost:4200'), /HTTPS/);
    const settings = await initializeSettings(directory, 'https://auth.example.test');
    assert.equal(settings.issuer, 'https://auth.example.test');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('local HTTPS proxy yields secure OIDC cookies and canonical HTTPS redirects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ancora-proxy-'));
  let fixture: ReturnType<typeof createProviderApp> | undefined;
  const server = createServer();
  try {
    const settings = await initializeSettings(directory, 'https://auth.example.test');
    fixture = createProviderApp(settings, ':memory:', { trustLoopbackProxy: true });
    const owner = fixture.registry.ensureDeveloper({ issuer: settings.issuer, sub: 'test-owner', address: '0x' + 'a'.repeat(40), chainId: 1 }).id;
    const client = fixture.registry.create(owner, { name: 'Integration test', appUrl: 'https://client.example.test', callbackPath: '/auth/callback', logoutPath: '/' });
    server.on('request', fixture.app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Host: 'auth.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'auth.example.test', 'X-Forwarded-For': '203.0.113.1' };
    const discovery = await (await fetch(base + '/.well-known/openid-configuration', { headers })).json();
    assert.equal(discovery.issuer, settings.issuer);
    assert.equal(discovery.authorization_endpoint, settings.issuer + '/authorize');
    const params = new URLSearchParams({ client_id: client.application.id, redirect_uri: 'https://client.example.test/auth/callback',
      response_type: 'code', scope: 'openid wallet', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: 'test-state' });
    const response = await fetch(base + '/authorize?' + params, { headers, redirect: 'manual' });
    assert.ok([302, 303].includes(response.status), `Unexpected authorization status ${response.status}`);
    const redirect = response.headers.get('location')!;
    assert.equal(new URL(redirect, settings.issuer).origin, settings.issuer);
    assert.match(redirect, /\/interaction\//);
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length > 0);
    for (const cookie of cookies) { assert.match(cookie, /; secure/i); assert.match(cookie, /; httponly/i); }
    assert.equal((await fetch(base + '/', { headers })).status, 200);
    assert.equal((await fetch(base + '/portal-public/config', { headers })).status, 404);
  } finally {
    if (server.listening) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    fixture?.close(); await rm(directory, { recursive: true, force: true });
  }
});
