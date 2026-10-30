'use client';
import { useEffect, useState } from 'react';
import { billingAccess, type Billing } from '@/lib/billing';
import { useGarage } from './provider';
import { Badge, Button, Modal } from './ui';
import './billing.css';

const date = (at: number) => new Date(at).toLocaleDateString('fr-FR');
export function BillingCard() {
  const { state, request, refresh, training } = useGarage();
  const [info, setInfo] = useState<{
    billing: Billing;
    configured: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!training && !state.demo)
      request<NonNullable<typeof info>>('billing')
        .then(setInfo)
        .catch((e) => setError(e.message));
  }, [request, state.id, state.revision, state.demo, training]);
  const access = billingAccess(state.billing);
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ url?: string }>(`billing/${action}`, {});
      if (result.url) {
        const target = new URL(result.url);
        if (
          target.protocol !== 'https:' ||
          !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)
        )
          throw new Error('Lien de paiement inattendu.');
        window.location.assign(target.href);
      } else await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="data-panel settings-card billing-card">
      <h3>Abonnement du garage</h3>
      <p className="billing-price">
        25 € <span>TTC / mois</span>
      </p>
      <p>Pour ce garage et toute son équipe. Sans engagement de durée.</p>
      <Badge tone={access === 'readonly' ? 'orange' : 'green'}>
        {access === 'trial'
          ? 'Essai gratuit'
          : access === 'paid'
            ? 'Abonnement actif'
            : 'Lecture seule'}
      </Badge>
      {state.billing && (
        <p>
          {access === 'trial'
            ? `Essai jusqu’au ${date(state.billing.trialEndsAt)}. Aucun prélèvement sans souscription.`
            : access === 'paid'
              ? `${state.billing.cancelAtPeriodEnd ? 'Résiliation prévue. Accès jusqu’au' : 'Période payée jusqu’au'} ${date(state.billing.paidUntil)}.`
              : 'Votre essai ou votre période payée est terminé. Vos données sont conservées et restent consultables.'}
        </p>
      )}
      {['past_due', 'unpaid', 'incomplete'].includes(state.billing?.status ?? '') && (
        <p role="status">Un paiement reste à régulariser dans votre espace de facturation.</p>
      )}
      {info && !info.configured && (
        <p>La souscription sera disponible une fois les paiements configurés.</p>
      )}
      {info && (
        <div className="billing-actions">
          <Button
            busy={busy}
            disabled={!info.configured || training}
            onClick={() => void run('checkout')}
          >
            {info.hasSubscription
              ? 'Gérer ou reprendre l’abonnement'
              : 'Souscrire à 25 € TTC / mois'}
          </Button>
          {info.hasCustomer && (
            <Button busy={busy} disabled={training} onClick={() => void run('portal')}>
              Factures et moyen de paiement
            </Button>
          )}
          {info.hasSubscription && (
            <Button busy={busy} disabled={training} onClick={() => void run('sync')}>
              Actualiser le statut
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p>
        En cas de résiliation, l’accès reste complet jusqu’à la fin de la période payée, puis passe
        en lecture seule. Réabonnez-vous pour reprendre les modifications.
      </p>
    </section>
  );
}

export function BillingNotice() {
  const { state, user, training, request, refresh, notify } = useGarage();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (training || state.demo) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('billing')) return;
    const result = params.get('billing');
    const clean = new URL(window.location.href);
    clean.searchParams.delete('billing');
    window.history.replaceState(null, '', clean);
    if (user.role === 'owner') {
      setOpen(true);
      if (result !== 'cancel')
        void request('billing/sync', {})
          .then(refresh)
          .catch((e) => notify(e.message));
    }
  }, [training, state.demo, user.role, request, refresh, notify]);
  if (training || state.demo || !state.billing) return null;
  const access = billingAccess(state.billing);
  return (
    <>
      {(access === 'trial' || access === 'readonly') && (
        <div className={`billing-notice ${access}`} role="status">
          <span>
            {access === 'trial'
              ? `Essai gratuit : ${Math.max(1, Math.ceil((state.billing.trialEndsAt - Date.now()) / 86400000))} jour(s) restant(s).`
              : 'Garage en lecture seule. Vos données sont conservées.'}
          </span>
          {user.role === 'owner' ? (
            <Button onClick={() => setOpen(true)}>Abonnement</Button>
          ) : (
            access === 'readonly' && (
              <span>Contactez le propriétaire pour réactiver le garage.</span>
            )
          )}
        </div>
      )}
      {open && (
        <Modal title="Abonnement CaRM" close={() => setOpen(false)}>
          <BillingCard />
        </Modal>
      )}
    </>
  );
}
