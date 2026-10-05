interface WalletProvider { request(input: { method: string; params?: unknown[] }): Promise<unknown> }
interface Wallet { id: string; name: string; provider: WalletProvider }
interface Interaction { prompt: string; csrf: string; clientName: string; clientOrigin: string; issuer: string; chains: number[]; accountId: string | null }
const wallets: Wallet[] = [];
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = element<HTMLSelectElement>('wallet');
const sign = element<HTMLButtonElement>('sign');
const confirm = element<HTMLButtonElement>('confirm');
const abort = element<HTMLButtonElement>('abort');
const status = element('status');
let busy = false;
let interaction: Interaction;
const path = window.location.pathname;
function renderWallets() {
  const current = select.value;
  select.replaceChildren(...wallets.map(wallet => new Option(wallet.name, wallet.id)));
  if (wallets.some(w => w.id === current)) select.value = current;
  sign.disabled = !wallets.length || busy;
  element('no-wallet').hidden = wallets.length > 0;
}
window.addEventListener('eip6963:announceProvider', event => {
  const detail = (event as CustomEvent).detail;
  if (!detail?.provider?.request || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string') return;
  if (wallets.some(wallet => wallet.id === detail.info.uuid || wallet.provider === detail.provider)) return;
  if (wallets.length >= 20) return;
  wallets.push({ id: detail.info.uuid, name: detail.info.name.slice(0, 80), provider: detail.provider });
  renderWallets();
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(() => {
  const ethereum = (window as Window & { ethereum?: WalletProvider }).ethereum;
  if (!wallets.length && ethereum?.request) wallets.push({ id: 'injected', name: 'Carteira do navegador', provider: ethereum });
  renderWallets();
}, 200);
async function post(action: string, body: unknown = {}) {
  const response = await fetch(`${path}/${action}`, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': interaction.csrf }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Solicitação inválida ou expirada. Inicie o login novamente no site de origem.');
  return response.json() as Promise<{ message: string; redirectTo: string }>;
}
function redirect(target: string) {
  const url = new URL(target, location.origin);
  if (url.origin !== location.origin) throw new Error('Retorno de autenticação inválido.');
  window.location.assign(url.href);
}
async function run(work: () => Promise<void>) {
  if (busy) return;
  busy = true; sign.disabled = true; confirm.disabled = true; abort.disabled = true; select.disabled = true;
  status.classList.remove('error');
  try { await work(); }
  catch (error) {
    const rejected = (error as { code?: number }).code === 4001;
    status.textContent = rejected ? 'Você recusou a solicitação na carteira. Pode tentar novamente.' : error instanceof Error ? error.message : 'Falha ao autenticar.';
    status.classList.add('error');
    busy = false; confirm.disabled = false; abort.disabled = false; select.disabled = false; renderWallets();
  }
}
sign.addEventListener('click', () => void run(async () => {
  const wallet = wallets.find(wallet => wallet.id === select.value);
  if (!wallet) throw new Error('Escolha uma carteira para continuar.');
  status.textContent = 'Confirme a conexão na carteira.';
  const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts?.[0]) throw new Error('A carteira não informou um endereço.');
  const chain = await wallet.provider.request({ method: 'eth_chainId' }) as string;
  const chainId = Number.parseInt(chain, 16);
  if (!interaction.chains.includes(chainId)) throw new Error('Selecione Ethereum ou Sepolia na carteira e tente novamente.');
  const challenge = await post('challenge', { address: accounts[0], chainId });
  status.textContent = 'Confira e assine a mensagem na carteira.';
  const hexMessage = `0x${Array.from(new TextEncoder().encode(challenge.message), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const signature = await wallet.provider.request({ method: 'personal_sign', params: [hexMessage, accounts[0]] });
  status.textContent = 'Verificando a assinatura…';
  const result = await post('verify', { message: challenge.message, signature });
  redirect(result.redirectTo);
}));
confirm.addEventListener('click', () => void run(async () => {
  status.textContent = 'Autorizando o site…'; redirect((await post('confirm')).redirectTo);
}));
abort.addEventListener('click', () => void run(async () => { redirect((await post('abort')).redirectTo); }));
try {
  const response = await fetch(`${path}/details`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Esta solicitação expirou. Volte ao site de origem e inicie outro login.');
  interaction = await response.json() as Interaction;
  element('title').textContent = `Entrar em ${interaction.clientName}`;
  element('description').textContent = 'Você voltará para este endereço após autorizar:';
  element('client-origin').textContent = interaction.clientOrigin;
  abort.hidden = false;
  if (interaction.prompt === 'login') element('login').hidden = false;
  else if (interaction.prompt === 'consent') {
    element('phase').textContent = 'Autorizar aplicação'; element('consent').hidden = false;
    element('account').textContent = interaction.accountId;
  } else throw new Error('Solicitação não suportada. Reinicie o login.');
} catch (error) { status.textContent = (error as Error).message; status.classList.add('error'); }
export {};
