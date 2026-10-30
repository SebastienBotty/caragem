import { UserError } from './errors.ts';

export const trialDuration = 14 * 86400000;
export const monthlyPrice = 2500;
export type Billing = {
  trialEndsAt: number;
  paidUntil: number;
  status: string;
  cancelAtPeriodEnd: boolean;
};

export function billingAccess(billing: Billing | undefined, now = Date.now()) {
  if (!billing) return 'unrestricted';
  if (billing.paidUntil > now) return 'paid';
  if (billing.trialEndsAt > now) return 'trial';
  return 'readonly';
}

export type BillingGarage = { id: string; name: string; billing: Billing };
export type BillingInvoice = {
  id: string;
  number: string;
  createdAt: number;
  paidAt: number | null;
  dueAt: number | null;
  status: string;
  total: number;
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
};
export type BillingInfo = {
  billing: Billing;
  configured: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  monthlyPrice: number;
  invoices: BillingInvoice[];
  hasMoreInvoices: boolean;
  lastPayment: BillingInvoice | null;
  detailsError?: string;
  subscription: null | {
    status: string;
    startedAt: number;
    periodStart: number | null;
    periodEnd: number | null;
    nextBillingAt: number | null;
    cancelAt: number | null;
    canceledAt: number | null;
    nextPaymentAttempt: number | null;
  };
};

export function requireWritable(state: { demo: boolean; billing?: Billing }) {
  if (!state.demo && billingAccess(state.billing) === 'readonly')
    throw new UserError(
      'Un abonnement actif est nécessaire : ce garage est en lecture seule. Vos données sont conservées.',
    );
}
