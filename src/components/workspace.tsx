'use client';
import { useCallback, useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import type { SessionData } from '@/lib/account';
import { Auth } from './auth';
import { GarageProvider, request } from './provider';
import { Button } from './ui';
import { AppShell } from './app-shell';
import { InvitationGate } from './invitation-gate';
import { googleAuthMessage } from '@/lib/google-auth';

export function Workspace() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const refresh = useCallback(async () => {
    try {
      const s = await request<SessionData>('session');
      setSession(s);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('google_result') || params.has('google_error')) {
      setAuthNotice(googleAuthMessage(params.get('google_error')));
      if (params.get('google_result') === 'success') {
        sessionStorage.removeItem('carm-demo-user');
        try {
          localStorage.setItem('carm-session-change', crypto.randomUUID());
        } catch {
          /* Other tabs can still refresh manually. */
        }
      }
      params.delete('google_result');
      params.delete('google_error');
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (params.size ? '?' + params.toString() : ''),
      );
    }
    void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === 'carm-session-change') void refresh();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [refresh]);
  if (!session)
    return (
      <div className="app-loading">
        <span className="brand">
          <span className="brand-mark">
            <Layers3 />
          </span>
          CaRM.
        </span>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={refresh}>Réessayer</Button>
          </>
        ) : (
          <p>Ouverture du garage…</p>
        )}
      </div>
    );
  if (!session.state) return <Auth done={refresh} notice={authNotice} />;
  const invitation = new URLSearchParams(window.location.search).get('invitation');
  if (invitation)
    return <InvitationGate token={invitation} account={session.account} done={refresh} />;
  return (
    <GarageProvider
      key={`${session.state.id}-${session.userId}-${session.expires}`}
      initial={{
        state: session.state,
        userId: session.userId,
        smtp: session.smtp,
        account: session.account,
        garages: session.garages,
        onboardingSeen: session.onboardingSeen,
      }}
      onSessionChange={refresh}
    >
      {authNotice && (
        <div className="toast" role="alert">
          {authNotice}
          <button className="text-button" onClick={() => setAuthNotice('')}>
            Fermer
          </button>
        </div>
      )}
      <AppShell />
    </GarageProvider>
  );
}
