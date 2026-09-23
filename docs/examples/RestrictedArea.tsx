import { useEffect, useState } from 'react';
import {
  AuthenticationError, getPrivateResource, getSession, logout,
  type AuthenticatedSession, type PrivateResource,
} from '@tcc/browser-sdk';

export default function RestrictedArea() {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [resource, setResource] = useState<PrivateResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const current = await getSession();
        if (!active) return;
        if (!current.authenticated) {
          window.location.replace('/');
          return;
        }
        setSession(current);
        const data = await getPrivateResource();
        if (active) setResource(data);
      } catch (failure) {
        if (!active) return;
        if (failure instanceof AuthenticationError && failure.code === 'UNAUTHENTICATED') {
          window.location.replace('/');
          return;
        }
        setError('Não foi possível carregar os dados. Recarregue para tentar de novo.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    setError('');
    try {
      await logout();
      window.location.replace('/');
    } catch {
      setError('Não foi possível encerrar a sessão. Tente de novo.');
      setLeaving(false);
    }
  }

  if (loading) return <p role="status">Validando acesso…</p>;
  if (!session && !error) return <p role="status">Redirecionando…</p>;
  return (
    <section aria-labelledby="private-title">
      <h1 id="private-title">Área restrita</h1>
      {session && <p>Conta: {session.user.accountId}</p>}
      {resource && <p>{resource.message}</p>}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" onClick={() => window.location.reload()}>Recarregar</button>}
      {session && <button type="button" disabled={leaving} onClick={() => void leave()}>
        {leaving ? 'Encerrando…' : 'Encerrar sessão'}
      </button>}
    </section>
  );
}
