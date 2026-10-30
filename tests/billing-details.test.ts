import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { billingDetails } from '../src/server/billing-details.ts';

test('billing details return only safe invoice fields, actual payment dates and subscription periods for the garage', async () => {
  const invoice = {
    id: 'in_test',
    number: 'FAC-001',
    customer: 'cus_owner',
    customer_email: 'private@example.com',
    created: 1700000000,
    due_date: null,
    status: 'paid',
    total: 2500,
    amount_paid: 2500,
    amount_remaining: 0,
    currency: 'eur',
    status_transitions: { paid_at: 1700000030 },
    invoice_pdf: 'https://pay.stripe.com/invoice/test/pdf',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test',
  };
  const subscription = {
    customer: 'cus_owner',
    metadata: { garageId: 'garage' },
    status: 'active',
    start_date: 1700000000,
    trial_end: null,
    items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    latest_invoice: { next_payment_attempt: null },
  };
  const calls: any[] = [];
  const stripe = {
    invoices: {
      list: async (input: unknown) => {
        calls.push(input);
        return { data: [invoice], has_more: true };
      },
    },
    subscriptions: { retrieve: async () => subscription },
  } as unknown as Stripe;
  const details = await billingDetails(stripe, 'garage', 'cus_owner', 'sub_owner');
  assert.deepEqual(calls, [
    { customer: 'cus_owner', limit: 10 },
    { customer: 'cus_owner', status: 'paid', limit: 1 },
  ]);
  assert.equal(details.invoices[0].paidAt, 1700000030000);
  assert.equal(details.lastPayment!.amountPaid, 2500);
  assert.equal(details.subscription!.nextBillingAt, 1702592000000);
  assert.equal(details.hasMoreInvoices, true);
  assert.equal('customer_email' in details.invoices[0], false);
  assert.equal(details.invoices[0].pdfUrl, invoice.invoice_pdf);
  subscription.cancel_at_period_end = true;
  const canceled = await billingDetails(stripe, 'garage', 'cus_owner', 'sub_owner');
  assert.equal(canceled.subscription!.nextBillingAt, null);
  assert.equal(canceled.subscription!.cancelAt, 1702592000000);
  invoice.invoice_pdf = 'javascript:alert(1)';
  invoice.hosted_invoice_url = 'https://invoice.stripe.com.attacker.example/invoice';
  const links = await billingDetails(stripe, 'garage', 'cus_owner', null);
  assert.equal(links.invoices[0].pdfUrl, null);
  assert.equal(links.invoices[0].hostedUrl, null);
  assert.equal(links.subscription, null);
  invoice.customer = 'cus_foreign';
  await assert.rejects(billingDetails(stripe, 'garage', 'cus_owner', null), /correspondent pas/);
  invoice.customer = 'cus_owner';
  subscription.metadata.garageId = 'foreign';
  await assert.rejects(
    billingDetails(stripe, 'garage', 'cus_owner', 'sub_owner'),
    /correspondent pas/,
  );
});
