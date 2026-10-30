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

export function requireWritable(state: { demo: boolean; billing?: Billing }) {
  if (!state.demo && billingAccess(state.billing) === 'readonly')
    throw new UserError(
      'Abonnement expiré : ce garage est en lecture seule. Vos données sont conservées.',
    );
}
