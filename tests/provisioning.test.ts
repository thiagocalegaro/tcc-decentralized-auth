import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { request } from '@playwright/test';
import { generateKeyPair, exportJWK } from 'jose';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createProviderApp } from '../core/apps/provider/app.js';
import { createAncoraClient } from '../core/packages/node-sdk/src/index.js';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
test('newly provisioned client completes OIDC, invokes verified hook, redirects locally and fails closed when hook rejects', async () => {
  const providerServer = createServer(); const appServer = createServer();
  const issuer = await listen(providerServer); const appUrl = await listen(appServer);
  const pair = await generateKeyPair('RS256', { extractable: true });
  const fixture = createProviderApp({ issuer, chains: [1], cookieKeys: [randomBytes(32).toString('base64url')],
    jwks: { keys: [{ ...await exportJWK(pair.privateKey), kid: 'provisioning', alg: 'RS256', use: 'sig' }] }, clients: [],
  }, ':memory:');
  providerServer.on('request', fixture.app);
  const wallet = privateKeyToAccount(generatePrivateKey());
  const owner = fixture.registry.ensureDeveloper({ issuer, sub: `eip155:1:${wallet.address.toLowerCase()}`, address: wallet.address, chainId: 1 }).id;
  const registered = fixture.registry.create(owner, { name: 'Site novo', appUrl, callbackPath: '/entrar/callback', logoutPath: '/' });
  let reject = false; let hookCalls = 0;
  const auth = await createAncoraClient({ issuer, appUrl, clientId: registered.application.id, clientSecret: registered.clientSecret,
    database: ':memory:', allowInsecureLocalhost: true, authBasePath: '/entrar', afterLogin: '/minha-conta',
    onLogin: identity => {
      hookCalls++; assert.ok(Object.isFrozen(identity)); assert.equal(identity.address, wallet.address); assert.equal(identity.issuer, issuer);
      if (reject) throw new Error('Database rejected login');
      return { userId: 'local-user-42' };
    },
  });
  appServer.on('request', async (req, res) => { if (await auth.handle(req, res)) return;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: auth.session(req) ?? null }));
  });
  const browser = await request.newContext();
  const login = async () => {
    let response = await browser.get(`${appUrl}/entrar/login?reauth=1`);
    for (let n = 0; n < 3 && response.url().startsWith(`${issuer}/interaction/`); n++) {
      const url = response.url(); const details = await (await browser.get(`${url}/details`)).json();
      const headers = { Origin: issuer, 'X-CSRF-Token': details.csrf };
      let completed;
      if (details.prompt === 'login') {
        const challenge = await (await browser.post(`${url}/challenge`, { headers, data: { address: wallet.address, chainId: 1 } })).json();
        completed = await browser.post(`${url}/verify`, { headers, data: { message: challenge.message, signature: await wallet.signMessage({ message: challenge.message }) } });
      } else completed = await browser.post(`${url}/confirm`, { headers, data: {} });
      assert.equal(completed.status(), 200);
      response = await browser.get((await completed.json()).redirectTo);
    }
    return response;
  };
  try {
    let response = await login(); assert.equal(response.status(), 200); assert.equal(response.url(), `${appUrl}/minha-conta`);
    assert.equal((await response.json()).user.userId, 'local-user-42'); assert.equal(hookCalls, 1);
    await browser.post(`${appUrl}/entrar/logout`, { headers: { Origin: appUrl } });
    reject = true; response = await login(); assert.equal(response.status(), 400); assert.equal(hookCalls, 2);
    assert.deepEqual(await (await browser.get(`${appUrl}/api/session`)).json(), { authenticated: false });
    const rotated = fixture.registry.rotate(registered.application.id, owner);
    assert.notEqual(rotated.clientSecret, registered.clientSecret);
    response = await login(); assert.equal(response.status(), 400); assert.equal(hookCalls, 2, 'old secret cannot reach hook');
    fixture.registry.setEnabled(registered.application.id, owner, false);
    response = await login(); assert.equal(response.status(), 400); assert.equal(hookCalls, 2, 'disabled client cannot authenticate');
  } finally { await browser.dispose(); await close(appServer); await close(providerServer); auth.close(); fixture.close(); }
});
