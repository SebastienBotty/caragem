import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as billing from '../src/lib/billing.ts';
import { createSeed } from '../src/lib/domain.ts';

test('account billing shows invoices of the selected garage and targets actions without switching the active garage', async () => {
  const require = createRequire(import.meta.url),
    slots: any[] = [],
    effects: (() => void)[] = [],
    calls: any[] = [];
  let cursor = 0,
    managed = 0,
    assigned = '',
    cleaned = '';
  const state = createSeed('active', false);
  state.billing = {
    trialEndsAt: Date.now() + billing.trialDuration,
    paidUntil: 0,
    status: 'none',
    cancelAtPeriodEnd: false,
  };
  const garage = {
    id: 'other-owned',
    name: 'Garage secondaire',
    billing: { trialEndsAt: 0, paidUntil: 0, status: 'none', cancelAtPeriodEnd: false },
  };
  const info: billing.BillingInfo = {
    billing: garage.billing,
    configured: true,
    hasCustomer: true,
    hasSubscription: true,
    monthlyPrice: 2500,
    subscription: {
      status: 'past_due',
      startedAt: 1700000000000,
      periodStart: 1700000000000,
      periodEnd: 1702592000000,
      nextBillingAt: null,
      cancelAt: null,
      canceledAt: null,
      nextPaymentAttempt: 1702600000000,
    },
    invoices: [
      {
        id: 'in_test',
        number: 'FAC-TEST',
        createdAt: 1700000000000,
        paidAt: 1700000010000,
        dueAt: null,
        status: 'paid',
        total: 2500,
        amountPaid: 2500,
        amountRemaining: 0,
        currency: 'eur',
        pdfUrl: 'https://pay.stripe.com/invoice/test/pdf',
        hostedUrl: 'https://invoice.stripe.com/i/test',
      },
    ],
    lastPayment: null,
    hasMoreInvoices: false,
  };
  const mocks: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (value: unknown) => (slots[slot] = value)];
      },
      useEffect: (fn: () => void) => effects.push(fn),
    },
    '@/lib/billing': billing,
    './ui': { Badge: 'Badge', Button: 'Button' },
    './billing.css': {},
    './provider': {
      useGarage: () => ({
        state,
        user: state.users[0],
        training: false,
        request: async (path: string, body: unknown) => {
          calls.push({ path, body });
          return path.endsWith('/portal') || path.endsWith('/checkout')
            ? { url: 'https://billing.stripe.com/p/session/test' }
            : path === 'billing/garages'
              ? { garages: [garage] }
              : info;
        },
        refresh: async () => {},
        notify: () => {},
      }),
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/billing.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      URL,
      URLSearchParams,
      Intl,
      window: {
        location: {
          assign: (url: string) => (assigned = url),
          search: '?billing=success&billingGarage=other-owned',
          href: 'http://localhost:3000/?billing=success&billingGarage=other-owned',
        },
        history: {
          replaceState: (_state: unknown, _title: string, url: string) => (cleaned = String(url)),
        },
      },
      require: (name: string) => mocks[name] ?? require(name),
    },
  );
  function render(component: string, props: any = {}) {
    cursor = 0;
    effects.length = 0;
    const elements: any[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      elements.push(node);
      visit(node.props.children);
    }
    visit(exports[component](props));
    return elements;
  }
  slots[0] = info;
  const elements = render('BillingCard', { garage });
  assert.ok(elements.some((e) => e.type === 'h3' && e.props.children === garage.name));
  assert.ok(
    elements.some(
      (e) =>
        e.props['aria-label'] === 'Télécharger la facture FAC-TEST en PDF' &&
        e.props.href === info.invoices[0].pdfUrl &&
        e.props.rel === 'noopener noreferrer',
    ),
  );
  assert.ok(
    elements.some((e) => e.type === 'dt' && e.props.children === 'Nouvelle tentative de paiement'),
  );
  assert.ok(!elements.some((e) => e.type === 'dt' && e.props.children === 'Fin de l’essai'));
  await elements
    .find((e) => e.type === 'Button' && e.props.children === 'Factures et moyen de paiement')
    .props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].path, 'billing/portal');
  assert.equal(calls[0].body.garageId, garage.id);
  assert.equal(assigned, 'https://billing.stripe.com/p/session/test');
  assert.equal(state.id, 'active');
  slots.length = 0;
  slots[0] = [garage, { ...garage, id: 'third-owned', name: 'Garage tertiaire' }];
  const account = render('AccountBilling');
  assert.equal(account.filter((e) => e.type === exports.BillingCard).length, 2);
  slots.length = 0;
  render('BillingNotice', { visible: false, manage: () => managed++ });
  effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(managed, 1);
  assert.ok(calls.some((c) => c.path === 'billing/sync' && c.body.garageId === garage.id));
  assert.equal(cleaned, 'http://localhost:3000/');
});
