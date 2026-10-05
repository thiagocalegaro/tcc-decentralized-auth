import type { BrowserContext } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hexToString, type Hex } from 'viem';

export async function wallet(context: BrowserContext, mode: 'sign' | 'reject' = 'sign') {
  const account = privateKeyToAccount(generatePrivateKey());
  const calls = { signatures: 0 };
  await context.exposeBinding('__ancoraTestWallet', async (_source, input: { method: string; params?: string[] }) => {
    if (input.method === 'eth_requestAccounts') return [account.address];
    if (input.method === 'eth_chainId') return '0x1';
    if (input.method === 'personal_sign') {
      calls.signatures++;
      if (mode === 'reject') return { rejected: true };
      return account.signMessage({ message: hexToString(input.params![0] as Hex) });
    }
    throw new Error('Unsupported test method');
  });
  await context.addInitScript(() => {
    const provider = { request: async (input: unknown) => {
      const result = await (window as any).__ancoraTestWallet(input);
      if (result?.rejected) throw Object.assign(new Error('Rejected by test wallet'), { code: 4001 });
      return result;
    } };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'test-wallet', name: 'Carteira de teste', rdns: 'test.ancora', icon: '' }, provider },
    }));
    window.addEventListener('eip6963:requestProvider', announce);
  });
  return { account, calls };
}
