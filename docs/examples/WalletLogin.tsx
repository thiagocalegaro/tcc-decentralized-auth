import { useEffect, useState } from 'react';
import {
  AuthenticationError, discoverWallets, getSession, signIn,
  type AuthStep, type WalletOption,
} from '@tcc/browser-sdk';

const labels: Record<AuthStep, string> = {
  connecting: 'Conectando à carteira…',
  challenge: 'Preparando a mensagem…',
  signing: 'Confirme a assinatura na carteira…',
  verifying: 'Verificando a assinatura…',
  session: 'Abrindo a sessão…',
};

export default function WalletLogin() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [consent, setConsent] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<AuthStep | null>(null);
  const [error, setError] = useState('');
  const selected = wallets.find(w => w.id === selectedId) ?? wallets[0];

  // React calls the returned cleanup when this component unmounts.
  useEffect(() => discoverWallets(setWallets), []);
  useEffect(() => {
    let active = true;
    getSession().then(session => {
      if (active && session.authenticated) {
        window.location.replace('/arearestrita');
      }
    }).catch(() => {
      if (active) setError('Não foi possível consultar a sessão.');
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function login() {
    if (!selected || !consent || busy || checking) return;
    setBusy(true);
    setError('');
    try {
      const session = await signIn({
        provider: selected.provider,
        onStep: setStep,
      });
      if (session.authenticated) window.location.assign('/arearestrita');
      else setError('A sessão não foi criada. Tente de novo.');
    } catch (failure) {
      setError(failure instanceof AuthenticationError
        ? failure.message : 'Não foi possível entrar. Tente de novo.');
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <section aria-labelledby="login-title" aria-busy={busy || checking}>
      <h1 id="login-title">Entre com sua carteira</h1>
      <label htmlFor="wallet-select">Carteira</label>
      <select id="wallet-select" value={selected?.id ?? ''}
        disabled={busy || checking || !wallets.length}
        onChange={event => setSelectedId(event.target.value)}>
        {!wallets.length && <option value="">Nenhuma carteira detectada</option>}
        {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <p>O login compartilha seu endereço público e a rede.</p>
      <label>
        <input type="checkbox" checked={consent} disabled={busy || checking}
          onChange={event => setConsent(event.target.checked)} />
        Concordo em compartilhar esses dados e assinar a mensagem.
      </label>
      <button type="button" disabled={!selected || !consent || busy || checking}
        onClick={() => void login()}>Conectar e assinar</button>
      <p role="status">{checking ? 'Consultando sessão…' : step ? labels[step] : ''}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
