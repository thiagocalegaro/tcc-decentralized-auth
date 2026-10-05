import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { request } from '@playwright/test';
import { generateKeyPair, exportJWK } from 'jose';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createProviderApp } from '../core/apps/provider/app.js';

test('real OIDC token exchange binds PKCE/client, consumes codes, and rejects expired SIWE challenges', async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const issuer = `http://127.0.0.1:${address.port}`;
  const pair = await generateKeyPair('RS256', { extractable: true });
  const secret = randomBytes(32).toString('base64url');
  const redirectUri = 'http://localhost:4900/auth/callback';
  const fixture = createProviderApp({
    issuer, chains: [1], cookieKeys: [randomBytes(32).toString('base64url')],
    jwks: { keys: [{ ...await exportJWK(pair.privateKey), kid: 'protocol-test', alg: 'RS256', use: 'sig' }] },
    clients: [{ client_id: 'protocol-test', client_name: 'Teste', client_secret: secret,
      redirect_uris: [redirectUri], post_logout_redirect_uris: ['http://localhost:4900/'],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_post' }],
  }, ':memory:');
  server.on('request', fixture.app);
  const browser = await request.newContext();
  const wallet = privateKeyToAccount(generatePrivateKey());
  const authorize = async (expired = false) => {
    const verifier = randomPKCECodeVerifier();
    const params = new URLSearchParams({ client_id: 'protocol-test', redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid wallet', prompt: 'login consent', state: randomBytes(16).toString('hex'), nonce: randomBytes(16).toString('hex'),
      code_challenge: await calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
    const page = await browser.get(`${issuer}/authorize?${params}`);
    const loginUrl = page.url();
    const details = await (await browser.get(`${loginUrl}/details`)).json();
    const headers = { Origin: issuer, 'X-CSRF-Token': details.csrf };
    const challenge = await (await browser.post(`${loginUrl}/challenge`, { headers, data: { address: wallet.address, chainId: 1 } })).json();
    const signature = await wallet.signMessage({ message: challenge.message });
    if (expired) fixture.store.db.prepare("UPDATE records SET expires=0 WHERE namespace='challenge'").run();
    const result = await browser.post(`${loginUrl}/verify`, { headers, data: { message: challenge.message, signature } });
    if (expired) { assert.equal(result.status(), 400); return undefined; }
    assert.equal(result.status(), 200);
    const resume = (await result.json()).redirectTo;
    const consent = await browser.get(resume);
    const consentUrl = consent.url();
    const consentDetails = await (await browser.get(`${consentUrl}/details`)).json();
    const confirmed = await browser.post(`${consentUrl}/confirm`, { headers: { Origin: issuer, 'X-CSRF-Token': consentDetails.csrf }, data: {} });
    assert.equal(confirmed.status(), 200);
    const response = await browser.get((await confirmed.json()).redirectTo, { maxRedirects: 0 });
    const code = new URL(response.headers().location).searchParams.get('code');
    assert.ok(code);
    return { code, verifier };
  };
  const exchange = (code: string, verifier: string, clientSecret = secret) => browser.post(`${issuer}/token`, { form: {
    grant_type: 'authorization_code', code, code_verifier: verifier,
    client_id: 'protocol-test', client_secret: clientSecret, redirect_uri: redirectUri,
  } });
  try {
    await authorize(true);
    const wrongPkce = (await authorize())!;
    assert.equal((await exchange(wrongPkce.code, randomPKCECodeVerifier())).status(), 400);
    const wrongClient = (await authorize())!;
    assert.equal((await exchange(wrongClient.code, wrongClient.verifier, 'wrong-secret')).status(), 401);
    const valid = (await authorize())!;
    const first = await exchange(valid.code, valid.verifier);
    assert.equal(first.status(), 200);
    const tokens = await first.json();
    assert.ok(tokens.id_token); assert.ok(tokens.access_token);
    const identity = await browser.get(`${issuer}/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(identity.status(), 200);
    assert.equal((await identity.json()).wallet_address, wallet.address);
    assert.equal((await exchange(valid.code, valid.verifier)).status(), 400);
  } finally {
    await browser.dispose();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    fixture.close();
  }
});
