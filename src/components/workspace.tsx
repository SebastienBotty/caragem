'use client';
import { useCallback, useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import { type GarageState } from '@/lib/domain';
import { Auth } from './auth';
import { GarageProvider, request } from './provider';
import { Button } from './ui';
import { AppShell } from './app-shell';
type SessionData = { state: GarageState | null; userId: string; smtp: boolean };

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
  return (
    <GarageProvider
      key={`${session.state.id}-${session.userId}`}
      initial={{
        state: session.state,
        userId: session.userId,
        smtp: session.smtp,
      }}
      onSessionChange={refresh}
    >
      <AppShell />
    </GarageProvider>
  );
}
