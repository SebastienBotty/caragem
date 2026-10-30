import Stripe from 'stripe';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import type { Store, Session } from './store.ts';
import type { Sql } from './database.ts';
import { appOrigin, type Reply } from './http.ts';
import { UserError } from '../lib/errors.ts';
import { monthlyPrice } from '../lib/billing.ts';
import { broadcastGarage } from './realtime.ts';

export type BillingConfig = {
  stripe?: Stripe;
  price: string;
  webhookSecret: string;
  taxEnabled: boolean;
};
export function billingConfiguration(): BillingConfig {
  return {
    stripe: process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 1 })
      : undefined,
    price: process.env.STRIPE_PRICE_ID ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    taxEnabled: process.env.STRIPE_AUTOMATIC_TAX === 'true',
  };
}
type BillingRow = {
  garage_id: string;
  stripe_customer: string | null;
  stripe_subscription: string | null;
  checkout_id: string | null;
  checkout_attempt: number;
  trial_ends_at: string;
};
const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id;
const terminal = (status: string) => ['canceled', 'incomplete_expired'].includes(status);

export function createBillingApi(store: Store, io: Server, configuration = billingConfiguration()) {
  const { stripe, price, webhookSecret, taxEnabled } = configuration;
  const configured = Boolean(stripe && price && webhookSecret && taxEnabled);
  const rowFor = async (sql: Sql, id: string) =>
    (await sql.query('SELECT * FROM garage_billing WHERE garage_id=$1', [id]))
      .rows[0] as BillingRow;
  const subscription = (id: string) =>
    stripe!.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  const sync = async (sql: Sql, row: BillingRow, sub: Stripe.Subscription) => {
    if (objectId(sub.customer) !== row.stripe_customer || sub.metadata.garageId !== row.garage_id)
      throw new UserError('Abonnement associé à un autre garage.');
    if (
      sub.items.data.length !== 1 ||
      sub.items.data[0].price.id !== price ||
      sub.items.data[0].quantity !== 1
    )
      throw new UserError('Offre Stripe inattendue.');
    const invoice = typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    const paidUntil =
      invoice?.status === 'paid' && invoice.total > 0
        ? sub.items.data[0].current_period_end * 1000
        : 0;
    await sql.query(
      'UPDATE garage_billing SET stripe_subscription=$2, status=$3, cancel_at_period_end=$4, paid_until=GREATEST(paid_until,$5) WHERE garage_id=$1',
      [row.garage_id, sub.id, sub.status, sub.cancel_at_period_end, paidUntil],
    );
    // Billing snapshots share the business revision so socket clients accept the update.
    await sql.query(
      "UPDATE garages SET state=jsonb_set(state,'{revision}',to_jsonb((state->>'revision')::int+1)) WHERE id=$1",
      [row.garage_id],
    );
  };
  const portal = async (customer: string) => {
    const result = await stripe!.billingPortal.sessions.create({
      customer,
      return_url: `${appOrigin()}/?billing=return`,
    });
    return result.url;
  };
  const publish = async (id: string) => broadcastGarage(io, await store.get(id));

  return {
    async webhook(req: IncomingMessage, res: ServerResponse, send: Reply) {
      if (!stripe || !webhookSecret) {
        send(503, { error: 'Stripe non configuré.' });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          send(413, { error: 'Événement trop volumineux.' });
          return;
        }
        chunks.push(chunk);
      }
      let event: Stripe.Event;
      try {
        // ASVS 8.3.1: only Stripe's signature authorizes this cookie-free endpoint.
        event = stripe.webhooks.constructEvent(
          Buffer.concat(chunks),
          req.headers['stripe-signature'] ?? '',
          webhookSecret,
        );
      } catch {
        send(400, { error: 'Signature Stripe invalide.' });
        return;
      }
      let subId: string | undefined;
      if (event.type.startsWith('customer.subscription.'))
        subId = (event.data.object as Stripe.Subscription).id;
      if (
        ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
          event.type,
        )
      )
        subId = objectId((event.data.object as Stripe.Checkout.Session).subscription);
      if (['invoice.paid', 'invoice.payment_failed'].includes(event.type))
        subId = objectId(
          (event.data.object as Stripe.Invoice).parent?.subscription_details?.subscription,
        );
      if (subId) {
        // Fetch inside the garage lock: an old event cannot overwrite a more recent state.
        const lookup = await subscription(subId);
        const garageId = lookup.metadata.garageId;
        if (garageId) {
          const { rows } = await store.db.query(
            'SELECT garage_id FROM garage_billing WHERE garage_id=$1 AND stripe_customer=$2',
            [garageId, objectId(lookup.customer)],
          );
          if (rows.length) {
            await store.atomic(async (sql) => {
              await store.get(garageId, sql, true);
              const row = await rowFor(sql, garageId);
              if (row.stripe_subscription && row.stripe_subscription !== subId) {
                if (!row.checkout_id) return;
                const checkout = await stripe.checkout.sessions.retrieve(row.checkout_id);
                if (objectId(checkout.subscription) !== subId) return;
              }
              await sync(sql, row, await subscription(subId));
            });
            await publish(garageId);
          }
        }
      }
      send(200, { received: true });
    },
    async handle(req: IncomingMessage, path: string, session: Session, send: Reply) {
      if (
        ![
          '/api/billing',
          '/api/billing/checkout',
          '/api/billing/portal',
          '/api/billing/sync',
        ].includes(path)
      )
        return false;
      const state = await store.get(session.garageId);
      if (
        state.demo ||
        !session.email ||
        state.users.find((u) => u.id === session.userId)?.role !== 'owner'
      ) {
        send(403, { error: 'Seul le propriétaire de ce garage peut gérer son abonnement.' });
        return true;
      }
      if (path === '/api/billing' && req.method === 'GET') {
        const row = await rowFor(store.db, state.id);
        send(200, {
          billing: state.billing,
          configured,
          hasCustomer: Boolean(row.stripe_customer),
          hasSubscription: Boolean(row.stripe_subscription),
          monthlyPrice,
        });
        return true;
      }
      if (req.method !== 'POST') {
        send(405, { error: 'Méthode non autorisée.' });
        return true;
      }
      if (!stripe || !price || !webhookSecret)
        throw new UserError('Les paiements Stripe ne sont pas encore configurés.');
      const url = await store.atomic(async (sql) => {
        await store.get(state.id, sql, true);
        const row = await rowFor(sql, state.id);
        if (path === '/api/billing/portal') {
          if (!row.stripe_customer)
            throw new UserError('Aucun compte de facturation pour ce garage.');
          return portal(row.stripe_customer);
        }
        let sub: Stripe.Subscription | undefined;
        if (row.checkout_id) {
          const checkout = await stripe.checkout.sessions.retrieve(row.checkout_id);
          if (checkout.status === 'complete' && objectId(checkout.subscription)) {
            row.stripe_subscription = objectId(checkout.subscription)!;
          }
        }
        if (row.stripe_subscription) {
          sub = await subscription(row.stripe_subscription);
          await sync(sql, row, sub);
        }
        if (path === '/api/billing/sync') return undefined;
        if (sub && !terminal(sub.status)) return portal(row.stripe_customer!);
        if (!taxEnabled)
          throw new UserError(
            'La configuration de TVA Stripe doit être terminée avant de souscrire.',
          );
        const offer = await stripe.prices.retrieve(price);
        if (
          !offer.active ||
          offer.currency !== 'eur' ||
          offer.unit_amount !== monthlyPrice ||
          offer.tax_behavior !== 'inclusive' ||
          offer.recurring?.interval !== 'month' ||
          offer.recurring.interval_count !== 1 ||
          offer.recurring.usage_type !== 'licensed'
        )
          throw new UserError('Configurez un tarif Stripe de 25 € TTC par mois en euros.');
        if (!(await stripe.tax.registrations.list({ status: 'active', limit: 1 })).data.length)
          throw new UserError(
            'Aucune immatriculation fiscale active dans Stripe. Terminez la configuration de TVA.',
          );
        if (row.checkout_id) {
          const checkout = await stripe.checkout.sessions.retrieve(row.checkout_id);
          if (checkout.status === 'open' && checkout.url && checkout.expires_at * 1000 > Date.now())
            return checkout.url;
          const completedSub = objectId(checkout.subscription);
          if (checkout.status === 'complete' && completedSub) {
            const current = await subscription(completedSub);
            await sync(sql, row, current);
            if (!terminal(current.status)) return portal(row.stripe_customer!);
          }
        }
        if (!row.stripe_customer) {
          const customer = await stripe.customers.create(
            { email: session.email, metadata: { garageId: state.id } },
            { idempotencyKey: `carm-customer-${state.id}` },
          );
          row.stripe_customer = customer.id;
          await sql.query('UPDATE garage_billing SET stripe_customer=$2 WHERE garage_id=$1', [
            state.id,
            customer.id,
          ]);
        }
        const trialEnd = Math.floor(Number(row.trial_ends_at) / 1000);
        const remaining = trialEnd - Math.floor(Date.now() / 1000);
        const attempt = row.checkout_attempt + 1;
        const checkout = await stripe.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: row.stripe_customer,
            client_reference_id: state.id,
            integration_identifier: 'carm_garage_qmwkzpta',
            line_items: [{ price, quantity: 1 }],
            automatic_tax: { enabled: true },
            billing_address_collection: 'required',
            customer_update: { address: 'auto', name: 'auto' },
            subscription_data: {
              metadata: { garageId: state.id },
              ...(remaining >= 48 * 3600
                ? { trial_end: trialEnd }
                : remaining > 0
                  ? {
                      // Checkout requires 48h for trial_end; a free first stub preserves the exact trial deadline.
                      billing_cycle_anchor: trialEnd,
                      proration_behavior: 'none' as const,
                    }
                  : {}),
            },
            success_url: `${appOrigin()}/?billing=success`,
            cancel_url: `${appOrigin()}/?billing=cancel`,
          },
          { idempotencyKey: `carm-checkout-${state.id}-${attempt}` },
        );
        if (!checkout.url) throw new UserError('Lien de paiement Stripe indisponible.');
        await sql.query(
          'UPDATE garage_billing SET checkout_id=$2,checkout_expires=$3,checkout_attempt=$4 WHERE garage_id=$1',
          [state.id, checkout.id, checkout.expires_at * 1000, attempt],
        );
        return checkout.url;
      });
      await publish(state.id);
      send(200, { url });
      return true;
    },
  };
}
