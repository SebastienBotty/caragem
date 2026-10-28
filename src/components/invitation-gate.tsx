'use client';
import { useEffect, useState } from 'react';
import type { AccountSummary } from '@/lib/account';
import { request } from './provider';
import { Button } from './ui';

export function InvitationGate({
  token,
  account,
  done,
}: {
  token: string;
  account: AccountSummary | null;
  done: () => Promise<void>;
}) {
  const email = new URLSearchParams(window.location.search).get('email') ?? '';
  const [invite, setInvite] = useState<{ email: string; garage: string; role: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<{ email: string; garage: string; role: string }>(
      `invitation?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    )
      .then((value) => {
        if (active) setInvite(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token, email]);
  const matches = account?.email.toLowerCase() === email.toLowerCase();
  return (
    <main className="account-gate">
      <section className="data-panel">
        <span className="eyebrow">INVITATION À REJOINDRE UN GARAGE</span>
        <h1>{invite ? invite.garage : 'Votre invitation'}</h1>
        {invite && (
          <p>
            Invitation pour <strong>{invite.email}</strong> en tant que{' '}
            {invite.role === 'mechanic' ? 'mécanicien' : 'collaborateur à l’accueil'}.
          </p>
        )}
        {account && <p>Compte connecté : {account.email}</p>}
        {invite &&
          (matches ? (
            <Button
              className="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await request('accept-invitation', { token });
                  window.history.replaceState(null, '', '/');
                  await done();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Rejoindre ce garage
            </Button>
          ) : (
            <>
              <p>Connectez-vous avec l’adresse indiquée sur l’invitation pour la rejoindre.</p>
              <Button
                onClick={async () => {
                  await request('logout', {});
                  await done();
                }}
              >
                Utiliser le compte invité
              </Button>
            </>
          ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          onClick={() => {
            window.history.replaceState(null, '', '/');
            void done();
          }}
        >
          Revenir à mon garage
        </Button>
      </section>
    </main>
  );
}
