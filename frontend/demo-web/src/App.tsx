import { useEffect, useState } from 'react';
import {
  AuthenticationError,
  discoverWallets,
  getPrivateResource,
  getSession,
  logout,
  signIn,
  type AuthenticatedSession,
  type AuthStep,
  type PrivateResource,
  type WalletOption,
} from '@tcc/browser-sdk';

const restrictedPath = '/arearestrita';
const stepLabel: Record<AuthStep, string> = {
  connecting: 'Conectando à carteira…', challenge: 'Criando desafio…', signing: 'Aguardando assinatura…',
  verifying: 'Verificando assinatura…', session: 'Abrindo sessão…',
};

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}
function Mark() {
  return <img className="brand-logo" src="/logo-ancora.png" alt="" aria-hidden="true" />;
}
function Check() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 10 4 4 8-8" /></svg>;
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado. Tente novamente.';
}

function RestrictedArea({ session, onLogout }: { session: AuthenticatedSession; onLogout: () => Promise<void> }) {
  const [resource, setResource] = useState<PrivateResource | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    getPrivateResource().then((value) => { if (active) setResource(value); })
      .catch((failure) => { if (active) setError(messageOf(failure)); });
    return () => { active = false; };
  }, []);

  async function endSession() {
    setLeaving(true); setError('');
    try { await onLogout(); } catch (failure) { setError(messageOf(failure)); setLeaving(false); }
  }

  return <main id="main" className="restricted-layout">
    <section className="restricted-card" aria-labelledby="restricted-title">
      <p className="eyebrow"><span className="live-dot" /> Sessão autenticada</p>
      <div className="success-icon"><Check /></div>
      <h1 id="restricted-title">Área restrita.</h1>
      <p className="lead">Seu acesso foi confirmado pela assinatura da carteira.</p>
      <dl className="account-details">
        <div><dt>Conta autenticada</dt><dd className="full-address">{session.user.address}</dd></div>
        <div><dt>Rede</dt><dd>Chain ID {session.user.chainId}</dd></div>
      </dl>
      {resource && <div className="private-result" role="status"><span>ACESSO AUTORIZADO</span><p>{resource.message}</p><code>{resource.accountId}</code></div>}
      {error && <p className="error-notice" role="alert">{error}</p>}
      <button className="quiet-button" onClick={() => void endSession()} disabled={leaving}>{leaving ? 'Encerrando…' : 'Encerrar sessão'}</button>
    </section>
  </main>;
}

export function App() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState('');
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<AuthStep | null>(null);
  const [consent, setConsent] = useState(false);
  const [walletHelp, setWalletHelp] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState(() => window.location.pathname);
  const selected = wallets.find((wallet) => wallet.id === selectedWallet) ?? wallets[0];
  const busy = step !== null;

  function navigate(nextPath: string, replace = false) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath);
    setPath(nextPath);
  }

  useEffect(() => discoverWallets(setWallets), []);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    let active = true;
    getSession()
      .then((result) => { if (active && result.authenticated) setSession(result); })
      .catch((failure) => { if (active) setError(messageOf(failure)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!checking && path === restrictedPath && !session) navigate('/', true);
    if (!checking && path === '/' && session) navigate(restrictedPath, true);
  }, [checking, path, session]);

  async function authenticate() {
    if (!selected || !consent || busy) return;
    setError('');
    try {
      const result = await signIn({ provider: selected.provider, onStep: setStep });
      if (result.authenticated) { setSession(result); navigate(restrictedPath); }
    } catch (failure) { setError(messageOf(failure)); }
    finally { setStep(null); }
  }

  async function endSession() {
    await logout();
    setSession(null); setConsent(false); setError(''); navigate('/', true);
  }

  const isRestricted = path === restrictedPath;
  return <>
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    <div className="page-shell">
      <header className="header"><a className="brand" href="/" aria-label="Âncora, início"><Mark /><span>âncora.</span></a><span className="prototype">Protótipo acadêmico · TCC II</span></header>
      {isRestricted && checking ? <main id="main" className="route-check" aria-busy="true"><span className="spinner" /> Validando acesso…</main>
        : isRestricted && session ? <RestrictedArea session={session} onLogout={endSession} />
          : <main id="main" className="main-grid">
            <section className="intro" aria-labelledby="page-title">
              <p className="eyebrow">AUTENTICAÇÃO DESCENTRALIZADA</p>
              <h1 id="page-title">Prove que a conta é sua.</h1>
              <p className="intro-copy">Assine uma mensagem da sua carteira Ethereum. Sem senha, transação ou exposição da chave privada.</p>
              <ol className="steps" aria-label="Como funciona"><li><b>01</b><span>Escolha a carteira</span></li><li><b>02</b><span>Assine a mensagem</span></li><li><b>03</b><span>Acesse a área restrita</span></li></ol>
            </section>
            <section className="access-card" aria-labelledby="access-title" aria-busy={busy || checking}>
              <p className="eyebrow">ACESSO À DEMONSTRAÇÃO</p>
              <h2 id="access-title">Conecte sua carteira.</h2>
              <p className="lead">A carteira pedirá uma assinatura temporária para validar seu acesso.</p>
              {checking ? <p className="status" role="status"><span className="spinner" /> Verificando sessão…</p> : <>
                {wallets.length > 0 ? <label className="field-label" htmlFor="wallet">Carteira disponível
                  <select id="wallet" value={selected?.id ?? ''} onChange={(event) => setSelectedWallet(event.target.value)} disabled={busy}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select>
                </label> : <div className="no-wallet"><strong>Nenhuma carteira detectada</strong><p>Abra em um navegador com uma carteira Ethereum instalada e desbloqueada.</p><button className="inline-button" aria-expanded={walletHelp} aria-controls="wallet-help" onClick={() => setWalletHelp((value) => !value)}>{walletHelp ? 'Ocultar orientações' : 'Como preparar uma carteira'}</button>{walletHelp && <p id="wallet-help">Instale uma carteira compatível, como MetaMask ou Rabby, pelo site oficial. Para a demonstração, use uma conta de teste.</p>}</div>}
                <div className="consent-box"><p>O login compartilha seu endereço público e a rede. A assinatura não movimenta ativos.</p><label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} /> Concordo em compartilhar esses dados e solicitar a assinatura.</label></div>
                <button className="primary-button" disabled={!selected || !consent || busy} onClick={() => void authenticate()}>{busy ? <><span className="spinner" /> {step ? stepLabel[step] : 'Autenticando…'}</> : <>Conectar e assinar <Arrow /></>}</button>
              </>}
              {busy && <p className="status" role="status" aria-live="polite">{step ? stepLabel[step] : 'Autenticando…'}</p>}
              {error && <p className="error-notice" role="alert">{error}</p>}
              <p className="security-note">Sua chave privada nunca sai da carteira.</p>
            </section>
          </main>}
      <footer>Âncora · Prova de controle de conta para pesquisa acadêmica.</footer>
    </div>
  </>;
}
