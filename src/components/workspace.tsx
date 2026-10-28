'use client';
import { useCallback, useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import type { SessionData } from '@/lib/account';
import { Auth } from './auth';
import { GarageProvider, request } from './provider';
import { Button } from './ui';
import { AppShell } from './app-shell';
import { InvitationGate } from './invitation-gate';

export function Workspace() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState('');
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
  if (!session.state) return <Auth done={refresh} />;
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
      }}
      onSessionChange={refresh}
    >
      <AppShell />
    </GarageProvider>
  );
}
