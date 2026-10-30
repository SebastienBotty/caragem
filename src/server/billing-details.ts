import type Stripe from 'stripe';
import type { BillingInfo, BillingInvoice } from '../lib/billing.ts';
import { UserError } from '../lib/errors.ts';

const idOf = (value: string | { id: string } | null) =>
  typeof value === 'string' ? value : value?.id;
const millis = (value: number | null | undefined) => (value ? value * 1000 : null);
function invoiceLink(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['invoice.stripe.com', 'pay.stripe.com'].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function invoiceSummary(invoice: Stripe.Invoice): BillingInvoice {
  return {
    id: invoice.id,
    number: invoice.number ?? invoice.id,
    createdAt: invoice.created * 1000,
    paidAt: millis(invoice.status_transitions.paid_at),
    dueAt: millis(invoice.due_date),
    status: invoice.status ?? 'draft',
    total: invoice.total,
    amountPaid: invoice.amount_paid,
    amountRemaining: invoice.amount_remaining,
    currency: invoice.currency,
    pdfUrl: invoiceLink(invoice.invoice_pdf),
    hostedUrl: invoiceLink(invoice.hosted_invoice_url),
  };
}

export async function billingDetails(
  stripe: Stripe,
  garageId: string,
  customerId: string,
  subscriptionId: string | null,
): Promise<Pick<BillingInfo, 'subscription' | 'invoices' | 'hasMoreInvoices' | 'lastPayment'>> {
  const [history, paid, subscription] = await Promise.all([
    stripe.invoices.list({ customer: customerId, limit: 10 }),
    stripe.invoices.list({ customer: customerId, status: 'paid', limit: 1 }),
    subscriptionId
      ? stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] })
      : null,
  ]);
  // ASVS 8.2.2: invoice history belongs to the customer's garage, never client-supplied Stripe IDs.
  if (
    [...history.data, ...paid.data].some((invoice) => idOf(invoice.customer) !== customerId) ||
    (subscription &&
      (idOf(subscription.customer) !== customerId || subscription.metadata.garageId !== garageId))
  )
    throw new UserError('Les informations Stripe ne correspondent pas à ce garage.');
  const item = subscription?.items.data[0],
    latest = subscription?.latest_invoice;
  const end = millis(item?.current_period_end);
  return {
    invoices: history.data.map(invoiceSummary),
    hasMoreInvoices: history.has_more,
    lastPayment: paid.data[0] ? invoiceSummary(paid.data[0]) : null,
    subscription: subscription
      ? {
          status: subscription.status,
          startedAt: subscription.start_date * 1000,
          periodStart: millis(item?.current_period_start),
          periodEnd: end,
          nextBillingAt:
            !subscription.cancel_at_period_end &&
            !subscription.cancel_at &&
            ['active', 'trialing'].includes(subscription.status)
              ? subscription.trial_end && subscription.trial_end * 1000 > Date.now()
                ? subscription.trial_end * 1000
                : end
              : null,
          cancelAt:
            millis(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? end : null),
          canceledAt: millis(subscription.canceled_at),
          nextPaymentAttempt:
            latest && typeof latest !== 'string' ? millis(latest.next_payment_attempt) : null,
        }
      : null,
  };
}
