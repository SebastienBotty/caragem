'use client';
import { useEffect, useState } from 'react';
import { billingAccess, type BillingGarage, type BillingInfo } from '@/lib/billing';
import { useGarage } from './provider';
import { Badge, Button } from './ui';
import './billing.css';

const date = (at: number | null | undefined) =>
  at ? new Date(at).toLocaleDateString('fr-FR') : '—';
const money = (amount: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount / 100);
const statuses: Record<string, string> = {
  paid: 'Réglée',
  open: 'À régler',
  draft: 'Brouillon',
  void: 'Annulée',
  uncollectible: 'Impayée',
  active: 'Actif',
  trialing: 'En essai',
  past_due: 'Paiement en retard',
  unpaid: 'Impayé',
  canceled: 'Résilié',
  incomplete: 'Paiement à finaliser',
  incomplete_expired: 'Souscription expirée',
  paused: 'En pause',
};

export function BillingCard({ garage }: { garage: BillingGarage }) {
  const { state, request, refresh, training } = useGarage();
  const [info, setInfo] = useState<BillingInfo>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const endpoint = `billing?garageId=${encodeURIComponent(garage.id)}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    request<BillingInfo>(endpoint)
      .then((value) => {
        if (active) {
          setInfo(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, endpoint, state.revision]);
  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      setInfo(await request<BillingInfo>(endpoint));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const billing = info?.billing ?? garage.billing;
  const access = billingAccess(billing);
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ url?: string }>(`billing/${action}`, { garageId: garage.id });
      if (result.url) {
        const target = new URL(result.url);
        if (
          target.protocol !== 'https:' ||
          !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)
        )
          throw new Error('Lien de paiement inattendu.');
        window.location.assign(target.href);
      } else {
        await refresh();
        await reload();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      className="data-panel settings-card billing-card"
      aria-label={`Abonnement de ${garage.name}`}
      aria-busy={loading}
    >
      <div className="billing-card-heading">
        <h3>{garage.name}</h3>
        <Badge tone={access === 'readonly' ? 'orange' : 'green'}>
          {access === 'trial'
            ? 'Essai gratuit'
            : access === 'paid'
              ? 'Abonnement actif'
              : 'Lecture seule'}
        </Badge>
      </div>
      <p className="billing-price">
        25 € <span>TTC / mois · toute l’équipe</span>
      </p>
      <dl className="billing-dates">
        {billing.trialEndsAt > 0 && (
          <div>
            <dt>Fin de l’essai</dt>
            <dd>{date(billing.trialEndsAt)}</dd>
          </div>
        )}
        {billing.paidUntil > 0 && (
          <div>
            <dt>Accès payé jusqu’au</dt>
            <dd>{date(billing.paidUntil)}</dd>
          </div>
        )}
        {info?.subscription && (
          <>
            <div>
              <dt>Statut Stripe</dt>
              <dd>{statuses[info.subscription.status] ?? 'Indisponible'}</dd>
            </div>
            <div>
              <dt>Début de l’abonnement</dt>
              <dd>{date(info.subscription.startedAt)}</dd>
            </div>
            <div>
              <dt>Période en cours</dt>
              <dd>
                {date(info.subscription.periodStart)} → {date(info.subscription.periodEnd)}
              </dd>
            </div>
            {info.subscription.nextBillingAt && (
              <div>
                <dt>
                  {info.subscription.status === 'trialing'
                    ? 'Premier paiement prévu'
                    : 'Prochaine échéance'}
                </dt>
                <dd>{date(info.subscription.nextBillingAt)}</dd>
              </div>
            )}
            {info.subscription.nextPaymentAttempt && (
              <div>
                <dt>Nouvelle tentative de paiement</dt>
                <dd>{date(info.subscription.nextPaymentAttempt)}</dd>
              </div>
            )}
            {info.subscription.cancelAt && (
              <div>
                <dt>Fin prévue après résiliation</dt>
                <dd>{date(info.subscription.cancelAt)}</dd>
              </div>
            )}
            {info.subscription.canceledAt && (
              <div>
                <dt>Résiliation enregistrée le</dt>
                <dd>{date(info.subscription.canceledAt)}</dd>
              </div>
            )}
          </>
        )}
        {info?.lastPayment && (
          <div>
            <dt>Dernière facture réglée</dt>
            <dd>
              {date(info.lastPayment.paidAt)} ·{' '}
              {money(info.lastPayment.amountPaid, info.lastPayment.currency)}
            </dd>
          </div>
        )}
      </dl>
      {access === 'trial' && !info?.hasSubscription && <p>Aucun prélèvement sans souscription.</p>}
      {access === 'readonly' && (
        <p>
          Un abonnement est nécessaire pour reprendre les modifications. Vos données restent
          consultables.
        </p>
      )}
      {['past_due', 'unpaid', 'incomplete'].includes(
        info?.subscription?.status ?? billing.status,
      ) && <p role="status">Un paiement reste à régulariser dans votre espace de facturation.</p>}
      {info && !info.configured && (
        <p>La souscription sera disponible une fois les paiements configurés.</p>
      )}
      <div className="billing-actions">
        {info && (
          <>
            <Button
              busy={busy}
              disabled={!info.configured || training}
              onClick={() => void run('checkout')}
            >
              {info.hasSubscription ? 'Gérer l’abonnement' : 'Souscrire à 25 € TTC / mois'}
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
          </>
        )}
        <Button disabled={loading || busy} onClick={() => void reload()}>
          Actualiser les informations
        </Button>
      </div>
      {loading && <p role="status">Chargement de la facturation…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {info?.detailsError && (
        <p className="form-error" role="alert">
          {info.detailsError}
        </p>
      )}
      {info && !info.detailsError && (
        <details className="billing-history" open>
          <summary>Dernières factures et paiements</summary>
          {!info.invoices.length ? (
            <p>Aucune facture pour ce garage.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Facture</th>
                    <th>Émise le</th>
                    <th>État</th>
                    <th>Total TTC</th>
                    <th>Réglé le</th>
                    <th>Montant réglé</th>
                    <th>Solde</th>
                    <th>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {info.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.number}</td>
                      <td>{date(invoice.createdAt)}</td>
                      <td>{statuses[invoice.status] ?? 'Indisponible'}</td>
                      <td>{money(invoice.total, invoice.currency)}</td>
                      <td>{date(invoice.paidAt)}</td>
                      <td>{money(invoice.amountPaid, invoice.currency)}</td>
                      <td>
                        {money(invoice.amountRemaining, invoice.currency)}
                        {invoice.dueAt && invoice.amountRemaining > 0 && (
                          <small> · échéance {date(invoice.dueAt)}</small>
                        )}
                      </td>
                      <td>
                        {invoice.pdfUrl && (
                          <a
                            href={invoice.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Télécharger la facture ${invoice.number} en PDF`}
                          >
                            PDF
                          </a>
                        )}
                        {invoice.pdfUrl && invoice.hostedUrl && ' · '}
                        {invoice.hostedUrl && (
                          <a href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer">
                            {invoice.status === 'open' ? 'Voir / payer' : 'Voir la facture'}
                          </a>
                        )}
                        {!invoice.pdfUrl && !invoice.hostedUrl && 'Pas encore disponible'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {info.hasMoreInvoices && (
            <p>
              Les 10 dernières factures sont affichées. Retrouvez les précédentes dans « Factures et
              moyen de paiement ».
            </p>
          )}
        </details>
      )}
      <p>La résiliation conserve l’accès jusqu’à la fin de la période payée.</p>
    </article>
  );
}

export function AccountBilling() {
  const { request, state } = useGarage();
  const [garages, setGarages] = useState<BillingGarage[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    request<{ garages: BillingGarage[] }>('billing/garages')
      .then((result) => {
        if (active) setGarages(result.garages);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request, state.revision, retry]);
  return (
    <section
      className="account-billing"
      id="account-billing"
      aria-label="Abonnements et paiements de mes garages"
    >
      <h2>Abonnements et paiements</h2>
      <p>
        Gérez ici tous les garages dont vous êtes propriétaire, sans changer de garage. Chaque
        abonnement coûte 25 € TTC/mois ; les 14 jours d’essai concernent uniquement votre premier
        garage.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setRetry(retry + 1)}>Réessayer</Button>
        </div>
      )}
      {!garages && !error && <p role="status">Chargement des garages…</p>}
      {garages?.length === 0 && (
        <p>
          Vous n’êtes propriétaire d’aucun garage. Les abonnements des garages que vous rejoignez
          sont gérés par leur propriétaire.
        </p>
      )}
      <div className="billing-garages">
        {garages?.map((garage) => (
          <BillingCard key={garage.id} garage={garage} />
        ))}
      </div>
    </section>
  );
}

export function BillingNotice({
  visible = true,
  manage,
}: {
  visible?: boolean;
  manage: () => void;
}) {
  const { state, user, training, request, refresh, notify } = useGarage();
  useEffect(() => {
    if (training) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('billing')) return;
    const result = params.get('billing'),
      garageId = params.get('billingGarage');
    const clean = new URL(window.location.href);
    clean.searchParams.delete('billing');
    clean.searchParams.delete('billingGarage');
    window.history.replaceState(null, '', clean);
    manage();
    if (result !== 'cancel')
      void request('billing/sync', garageId ? { garageId } : {})
        .then(refresh)
        .catch((e) => notify(e.message));
  }, [training, request, refresh, notify, manage]);
  if (training || state.demo || !state.billing || !visible) return null;
  const access = billingAccess(state.billing);
  return (
    <div className={`billing-notice ${access}`} role="status">
      <span>
        {access === 'trial'
          ? `Essai : ${Math.max(1, Math.ceil((state.billing.trialEndsAt - Date.now()) / 86400000))} jour(s)`
          : access === 'paid'
            ? 'Abonnement actif'
            : 'Lecture seule'}
      </span>
      {user.role === 'owner' ? (
        <Button onClick={manage}>Abonnement</Button>
      ) : (
        access === 'readonly' && <span>Contactez le propriétaire pour réactiver le garage.</span>
      )}
    </div>
  );
}
