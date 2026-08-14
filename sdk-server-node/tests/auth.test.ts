import { describe, it, expect, beforeEach } from 'vitest';
import { Wallet } from 'ethers';
import { MemoryNonceStore } from '../src/nonce';
import { SiweVerifier } from '../src/verifier';
import { SiweMessage } from '../src/types';

const TEST_DOMAIN = 'localhost:3000';

describe('MemoryNonceStore', () => {
  let store: MemoryNonceStore;

  beforeEach(() => {
    store = new MemoryNonceStore(5000); // TTL de 5 segundos para testes
  });

  it('deve gerar um nonce hexadecimal de 32 caracteres', async () => {
    const nonce = await store.generate('0xABCD');
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it('deve verificar um nonce válido com sucesso', async () => {
    const address = '0xABCD';
    const nonce = await store.generate(address);
    const isValid = await store.verify(address, nonce);
    expect(isValid).toBe(true);
  });

  it('deve consumir o nonce após a verificação (anti-replay)', async () => {
    const address = '0xABCD';
    const nonce = await store.generate(address);

    // Primeira verificação: sucesso
    expect(await store.verify(address, nonce)).toBe(true);
    // Segunda verificação: falha (nonce já consumido)
    expect(await store.verify(address, nonce)).toBe(false);
  });

  it('deve rejeitar nonce inválido', async () => {
    const address = '0xABCD';
    await store.generate(address);
    expect(await store.verify(address, 'nonce-inexistente')).toBe(false);
  });

  it('deve rejeitar nonce para endereço desconhecido', async () => {
    const nonce = await store.generate('0xABCD');
    expect(await store.verify('0x9999', nonce)).toBe(false);
  });

  it('deve rejeitar nonce expirado', async () => {
    const store = new MemoryNonceStore(1); // TTL = 1ms
    const address = '0xABCD';
    const nonce = await store.generate(address);

    // Aguardar expiração
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(await store.verify(address, nonce)).toBe(false);
  });

  it('deve normalizar endereços para lowercase', async () => {
    const nonce = await store.generate('0xAbCd');
    expect(await store.verify('0xABCD', nonce)).toBe(true);
  });
});

describe('SiweVerifier', () => {
  let store: MemoryNonceStore;
  let verifier: SiweVerifier;
  let wallet: Wallet;

  beforeEach(() => {
    store = new MemoryNonceStore();
    verifier = new SiweVerifier(TEST_DOMAIN, store);
    wallet = Wallet.createRandom();
  });

  async function createAndSignMessage(w: Wallet, overrides?: Partial<SiweMessage>) {
    const nonce = await store.generate(w.address);
    const params: SiweMessage = {
      domain: TEST_DOMAIN,
      address: w.address,
      uri: `http://${TEST_DOMAIN}/login`,
      version: '1',
      chainId: 1,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ...overrides
    };
    const message = SiweVerifier.createMessage(params);
    const signature = await w.signMessage(message);
    return { message, signature, nonce };
  }

  it('deve autenticar uma assinatura ECDSA válida', async () => {
    const { message, signature } = await createAndSignMessage(wallet);
    const result = await verifier.verify(message, signature, wallet.address);

    expect(result.success).toBe(true);
    expect(result.address).toBeDefined();
  });

  it('deve rejeitar assinatura de endereço diferente do declarado', async () => {
    const { message, signature } = await createAndSignMessage(wallet);
    const impostor = Wallet.createRandom();

    const result = await verifier.verify(message, signature, impostor.address);

    expect(result.success).toBe(false);
    expect(result.message).toContain('não coincide');
  });

  it('deve rejeitar replay attack (mesma assinatura usada duas vezes)', async () => {
    const { message, signature } = await createAndSignMessage(wallet);

    // Primeiro login: sucesso
    const result1 = await verifier.verify(message, signature, wallet.address);
    expect(result1.success).toBe(true);

    // Segundo login com mesma assinatura: falha
    const result2 = await verifier.verify(message, signature, wallet.address);
    expect(result2.success).toBe(false);
    expect(result2.message).toContain('Nonce');
  });

  it('deve rejeitar mensagem com domínio diferente', async () => {
    const nonce = await store.generate(wallet.address);
    const params: SiweMessage = {
      domain: 'dominio-malicioso.com',
      address: wallet.address,
      uri: 'http://dominio-malicioso.com/login',
      version: '1',
      chainId: 1,
      nonce,
      issuedAt: new Date().toISOString()
    };
    const message = SiweVerifier.createMessage(params);
    const signature = await wallet.signMessage(message);

    const result = await verifier.verify(message, signature, wallet.address);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Domínio inválido');
  });

  it('deve rejeitar assinatura corrompida', async () => {
    const { message } = await createAndSignMessage(wallet);
    const corruptSignature = '0x' + 'ff'.repeat(65);

    const result = await verifier.verify(message, corruptSignature, wallet.address);

    expect(result.success).toBe(false);
  });

  it('deve parsear corretamente uma mensagem EIP-4361', () => {
    const messageText = `${TEST_DOMAIN} wants you to sign in with your Ethereum account:\n0xABCD\n\nStatement\n\nURI: http://localhost/login\nVersion: 1\nChain ID: 1\nNonce: abc123\nIssued At: 2026-01-01T00:00:00.000Z`;

    const parsed = verifier.parseMessage(messageText);

    expect(parsed.domain).toBe(TEST_DOMAIN);
    expect(parsed.nonce).toBe('abc123');
    expect(parsed.chainId).toBe(1);
    expect(parsed.version).toBe('1');
  });
});
