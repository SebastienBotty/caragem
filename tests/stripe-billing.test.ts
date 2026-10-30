import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import Stripe from 'stripe';
import { io as clientIo } from 'socket.io-client';
import { Store } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import { billingAccess } from '../src/lib/billing.ts';

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
};

test('Stripe checkout, signed lifecycle events and reactivation are isolated per garage and never grant access from a return URL', async () => {
  const store = new Store(testDatabase());
  const checkouts = new Map<string, Record<string, unknown>>();
  const subscriptions = new Map<string, Record<string, unknown>>();
  const checkoutInputs: URLSearchParams[] = [];
  let validPrice = true;
  let taxRegistered = true;
  let invoiceServiceDown = false;
  let customers = 0;
  const invoiceCustomers: string[] = [];
  const stripeServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const path = req.url!.split('?')[0];
    let result: unknown;
    if (path === '/v1/prices/price_caragem')
      result = {
        id: 'price_caragem',
        active: true,
        currency: 'eur',
        unit_amount: validPrice ? 2500 : 2000,
        tax_behavior: 'inclusive',
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      };
    else if (path === '/v1/tax/registrations')
      result = {
        object: 'list',
        data: taxRegistered ? [{ id: 'taxreg_test', status: 'active' }] : [],
      };
    else if (path === '/v1/invoices') {
      if (invoiceServiceDown) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'Unavailable' } }));
        return;
      }
      const customer = new URL(req.url!, 'http://localhost').searchParams.get('customer')!;
      invoiceCustomers.push(customer);
      result = {
        data: [
          {
            id: `in_${customer}`,
            customer,
            number: 'FAC-TEST',
            created: 1700000000,
            status: 'paid',
            total: 2500,
            amount_paid: 2500,
            amount_remaining: 0,
            currency: 'eur',
            due_date: null,
            status_transitions: { paid_at: 1700000010 },
            invoice_pdf: `https://pay.stripe.com/invoice/${customer}/pdf`,
            hosted_invoice_url: `https://invoice.stripe.com/i/${customer}`,
          },
        ],
        has_more: false,
      };
    } else if (path === '/v1/customers') result = { id: `cus_${++customers}` };
    else if (path === '/v1/checkout/sessions' && req.method === 'POST') {
      checkoutInputs.push(form);
      const id = `cs_${checkouts.size + 1}`;
      result = {
        id,
        status: 'open',
        customer: form.get('customer'),
        subscription: null,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
      };
      checkouts.set(id, result as Record<string, unknown>);
    } else if (path.startsWith('/v1/checkout/sessions/'))
      result = checkouts.get(path.split('/').at(-1)!);
    else if (path.startsWith('/v1/subscriptions/'))
      result = subscriptions.get(path.split('/').at(-1)!);
    else if (path === '/v1/billing_portal/sessions')
      result = { url: `https://billing.stripe.com/p/session/${form.get('customer')}` };
    if (!result) {
      res.statusCode = 404;
      result = { error: { message: `Unknown fake endpoint ${path}` } };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  const stripePort = await listen(stripeServer);
  const stripe = new Stripe('sk_test_fake', {
    host: '127.0.0.1',
    port: stripePort,
    protocol: 'http',
    maxNetworkRetries: 0,
  });
  const secret = 'whsec_local_only';
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const io = createRealtime(server, store);
  api = createApi(store, io, undefined, {
    stripe,
    price: 'price_caragem',
    webhookSecret: secret,
    taxEnabled: true,
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const previous = process.env.APP_ORIGIN;
  let workerSocket: ReturnType<typeof clientIo> | undefined;
  process.env.APP_ORIGIN = origin;
  const post = (path: string, cookie: string, body: unknown = {}) =>
    fetch(`${origin}/api/${path}`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const hook = async (type: string, object: unknown, signed = true) => {
    const payload = JSON.stringify({ id: 'evt_replayed', object: 'event', type, data: { object } });
    return fetch(`${origin}/api/billing/webhook`, {
      method: 'POST',
      headers: {
        'stripe-signature': signed
          ? stripe.webhooks.generateTestHeaderString({ payload, secret })
          : 'invalid',
      },
      body: payload,
    });
  };
  try {
    const owner = await store.register({
      email: 'owner@example.com',
      hash: 'test',
      name: 'Patron',
      garage: 'Garage principal',
    });
    const state = await store.get(owner.garageId);
    const ownerSession = {
      ...owner,
      email: 'owner@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'test',
    };
    const token = await store.invite(ownerSession, 'employee@example.com', 'mechanic');
    const worker = await store.register({
      email: 'employee@example.com',
      hash: 'test',
      name: 'Employé',
      invitation: token,
    });
    const other = await store.register({
      email: 'other@example.com',
      hash: 'test',
      name: 'Autre',
      garage: 'Garage étranger',
    });
    const cookie = `caragem_session=${await store.newSession(owner.garageId, owner.userId)}`;
    const workerCookie = `caragem_session=${await store.newSession(worker.garageId, worker.userId)}`;
    assert.equal((await post('billing/checkout', workerCookie)).status, 403);
    assert.equal((await post('billing/checkout', '')).status, 401);
    validPrice = false;
    assert.equal((await post('billing/checkout', cookie)).status, 400);
    validPrice = true;
    taxRegistered = false;
    assert.equal((await post('billing/checkout', cookie)).status, 400);
    taxRegistered = true;
    const [a, b] = await Promise.all([
      post('billing/checkout', cookie),
      post('billing/checkout', cookie),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal((await a.json()).url, (await b.json()).url);
    assert.equal(checkoutInputs.length, 1, 'double clicks reuse the same Checkout');
    assert.equal(customers, 1);
    assert.equal(
      checkoutInputs[0].get('subscription_data[trial_end]'),
      String(Math.floor(state.billing!.trialEndsAt / 1000)),
    );
    assert.equal(checkoutInputs[0].get('automatic_tax[enabled]'), 'true');
    assert.equal(checkoutInputs[0].get('line_items[0][quantity]'), '1');
    assert.equal(checkoutInputs[0].has('payment_method_types[0]'), false);
    assert.equal((await hook('customer.subscription.updated', {}, false)).status, 400);
    // End the local trial; neither a success URL nor an unpaid subscription unlocks the garage.
    await store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      state.id,
    ]);
    assert.equal((await post('billing/sync', cookie)).status, 200);
    assert.equal(billingAccess((await store.get(state.id)).billing), 'readonly');
    const sub = {
      id: 'sub_first',
      customer: 'cus_1',
      metadata: { garageId: state.id },
      status: 'active',
      cancel_at_period_end: false,
      latest_invoice: { id: 'in_first', status: 'open', amount_paid: 0, total: 2500 },
      items: {
        data: [
          {
            price: { id: 'price_caragem' },
            quantity: 1,
            current_period_end: Math.floor(Date.now() / 1000) + 2592000,
          },
        ],
      },
    };
    subscriptions.set(sub.id, sub);
    checkouts.get('cs_1')!.status = 'complete';
    checkouts.get('cs_1')!.subscription = sub.id;
    assert.equal((await hook('checkout.session.completed', { subscription: sub.id })).status, 200);
    assert.equal(billingAccess((await store.get(state.id)).billing), 'readonly');
    workerSocket = clientIo(origin, {
      transports: ['websocket'],
      extraHeaders: { Origin: origin, Cookie: workerCookie },
    });
    await new Promise<void>((resolve, reject) => {
      workerSocket!.once('connect', resolve);
      workerSocket!.once('connect_error', reject);
    });
    const livePaid = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Statut payé absent du socket employé')),
        5000,
      );
      workerSocket!.on('garage:state', (state) => {
        if (billingAccess(state.billing) === 'paid') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    // Customer balance can settle the whole bill without a new card debit.
    sub.latest_invoice = { id: 'in_first', status: 'paid', amount_paid: 0, total: 2500 };
    const invoiceEvent = { parent: { subscription_details: { subscription: sub.id } } };
    assert.equal((await hook('invoice.paid', invoiceEvent)).status, 200);
    await livePaid;
    const paidUntil = (await store.get(state.id)).billing!.paidUntil;
    assert.equal(billingAccess((await store.get(state.id)).billing), 'paid');
    assert.equal((await hook('invoice.paid', invoiceEvent)).status, 200);
    assert.equal((await store.get(state.id)).billing!.paidUntil, paidUntil);
    sub.status = 'past_due';
    sub.latest_invoice = { id: 'in_next', status: 'open', amount_paid: 0, total: 2500 };
    assert.equal((await hook('invoice.payment_failed', invoiceEvent)).status, 200);
    assert.equal((await store.get(state.id)).billing!.paidUntil, paidUntil);
    assert.equal((await store.get(state.id)).billing!.status, 'past_due');
    sub.status = 'active';
    sub.cancel_at_period_end = true;
    assert.equal((await hook('customer.subscription.updated', { id: sub.id })).status, 200);
    assert.equal((await store.get(state.id)).billing!.cancelAtPeriodEnd, true);
    const portal = await (await post('billing/portal', cookie)).json();
    assert.match(portal.url, /cus_1$/);
    // Reactivation is a new subscription on the same customer, with no second trial.
    sub.status = 'canceled';
    assert.equal((await hook('customer.subscription.deleted', { id: sub.id })).status, 200);
    await store.db.query('UPDATE garage_billing SET paid_until=0 WHERE garage_id=$1', [state.id]);
    assert.equal((await post('billing/checkout', cookie)).status, 200);
    assert.equal(checkoutInputs.length, 2);
    assert.equal(checkoutInputs[1].has('subscription_data[trial_end]'), false);
    const next = {
      ...sub,
      id: 'sub_next',
      status: 'active',
      cancel_at_period_end: false,
      latest_invoice: { id: 'in_new', status: 'paid', amount_paid: 2500, total: 2500 },
    };
    subscriptions.set(next.id, next);
    checkouts.get('cs_2')!.status = 'complete';
    checkouts.get('cs_2')!.subscription = next.id;
    assert.equal(
      (await hook('invoice.paid', { parent: { subscription_details: { subscription: next.id } } }))
        .status,
      200,
    );
    assert.equal(billingAccess((await store.get(state.id)).billing), 'paid');
    assert.equal((await hook('customer.subscription.deleted', { id: sub.id })).status, 200);
    assert.equal(
      (await store.get(state.id)).billing!.status,
      'active',
      'old events cannot replace the new subscription',
    );
    assert.equal((await store.get(other.garageId)).billing!.paidUntil, 0);
    assert.equal((await post('billing/checkout', cookie)).status, 200);
    assert.equal(checkoutInputs.length, 2, 'an existing subscription opens the portal');
    // The last 48h use a free stub instead of restarting or extending the trial.
    const otherCookie = `caragem_session=${await store.newSession(other.garageId, other.userId)}`;
    const soon = Date.now() + 3600000;
    await store.db.query('UPDATE garage_billing SET trial_ends_at=$2 WHERE garage_id=$1', [
      other.garageId,
      soon,
    ]);
    assert.equal((await post('billing/checkout', otherCookie)).status, 200);
    assert.equal(
      checkoutInputs[2].get('subscription_data[billing_cycle_anchor]'),
      String(Math.floor(soon / 1000)),
    );
    assert.equal(checkoutInputs[2].get('subscription_data[proration_behavior]'), 'none');
    // API mutation guards also cover entry points outside the action reducer.
    await store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      other.garageId,
    ]);
    assert.equal(
      (
        await post('actions', otherCookie, {
          type: 'appointment',
          customer: 'Client',
          model: 'Audi',
          plate: 'AA-123-BB',
          reason: 'Test',
          at: new Date().toISOString(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await post('invite', otherCookie, { email: 'new@example.com', role: 'mechanic' })).status,
      400,
    );
    assert.equal(
      (await fetch(`${origin}/api/session`, { headers: { Cookie: otherCookie } })).status,
      200,
    );
    const additional = await store.createGarage(ownerSession, 'Garage supplémentaire payant');
    const additionalState = await store.get(additional.garageId);
    assert.equal(billingAccess(additionalState.billing), 'readonly');
    const additionalCookie = `caragem_session=${await store.newSession(additional.garageId, additional.userId)}`;
    assert.equal((await post('billing/checkout', additionalCookie)).status, 200);
    const additionalCheckout = checkoutInputs.at(-1)!;
    assert.equal(additionalCheckout.get('line_items[0][price]'), 'price_caragem');
    assert.equal(additionalCheckout.get('line_items[0][quantity]'), '1');
    assert.equal(additionalCheckout.has('subscription_data[trial_end]'), false);
    assert.equal(additionalCheckout.has('subscription_data[billing_cycle_anchor]'), false);
    assert.equal(additionalCheckout.has('subscription_data[proration_behavior]'), false);
    assert.equal(
      billingAccess((await store.get(additional.garageId)).billing),
      'readonly',
      'opening Checkout does not grant access without payment',
    );
    const getBilling = (target: string, withCookie = cookie) =>
      fetch(`${origin}/api/${target}`, { headers: { Cookie: withCookie } });
    const list = await (await getBilling('billing/garages')).json();
    assert.deepEqual(
      new Set(list.garages.map((g: { id: string }) => g.id)),
      new Set([owner.garageId, additional.garageId]),
    );
    const employeeList = await (await getBilling('billing/garages', workerCookie)).json();
    assert.deepEqual(employeeList.garages, []);
    const invoicesBeforeDeniedRequests = invoiceCustomers.length;
    assert.equal((await getBilling(`billing?garageId=${other.garageId}`)).status, 403);
    assert.equal(
      (await getBilling(`billing?garageId=${owner.garageId}`, workerCookie)).status,
      403,
    );
    assert.equal(
      (await post('billing/checkout', cookie, { garageId: other.garageId })).status,
      403,
    );
    assert.equal((await post('billing/portal', cookie, { garageId: other.garageId })).status, 403);
    assert.equal(invoiceCustomers.length, invoicesBeforeDeniedRequests);
    const detailsResponse = await getBilling(`billing?garageId=${additional.garageId}`);
    assert.equal(detailsResponse.status, 200);
    const details = await detailsResponse.json();
    assert.equal(detailsResponse.headers.get('Cache-Control'), 'no-store');
    assert.equal(details.detailsError, undefined);
    const [{ stripe_customer: additionalCustomer }] = (
      await store.db.query('SELECT stripe_customer FROM garage_billing WHERE garage_id=$1', [
        additional.garageId,
      ])
    ).rows;
    assert.equal(details.invoices[0].id, `in_${additionalCustomer}`);
    assert.equal(details.lastPayment.paidAt, 1700000010000);
    const targetPortal = await post('billing/portal', cookie, {
      garageId: additional.garageId,
      customer: 'cus_foreign_injected',
    });
    assert.equal(targetPortal.status, 200);
    assert.equal(
      (await targetPortal.json()).url,
      `https://billing.stripe.com/p/session/${additionalCustomer}`,
    );
    assert.ok(
      invoiceCustomers.slice(invoicesBeforeDeniedRequests).every((id) => id === additionalCustomer),
    );
    assert.equal(
      (await post('billing/checkout', cookie, { garageId: additional.garageId })).status,
      200,
    );
    assert.equal(
      (await store.session(cookie))!.garageId,
      owner.garageId,
      'managing another garage never switches the active garage',
    );
    assert.equal(
      additionalCheckout.get('success_url'),
      `${origin}/?billing=success&billingGarage=${additional.garageId}`,
    );
    const workerOwned = await store.createGarage(
      { ...worker, email: 'employee@example.com', expires: Date.now() + 100000, tokenHash: 'test' },
      'Garage personnel du collaborateur',
    );
    assert.equal(
      (await getBilling(`billing?garageId=${workerOwned.garageId}`, workerCookie)).status,
      200,
      'ownership of the target, not role in the active garage, authorizes billing',
    );
    const demo = await store.createDemo(ownerSession);
    const demoCookie = `caragem_session=${await store.newSession(demo.garageId, demo.userId)}`;
    const fromDemo = await (await getBilling('billing/garages', demoCookie)).json();
    assert.equal(fromDemo.garages.length, 2);
    assert.ok(fromDemo.garages.every((g: { id: string }) => g.id !== demo.garageId));
    invoiceServiceDown = true;
    const unavailable = await (await getBilling(`billing?garageId=${additional.garageId}`)).json();
    assert.match(unavailable.detailsError, /momentanément indisponible/);
    assert.equal(unavailable.hasCustomer, true);
    assert.equal(unavailable.configured, true);
    assert.deepEqual(unavailable.invoices, []);
  } finally {
    workerSocket?.disconnect();
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => stripeServer.close(() => resolve()));
    await store.close();
  }
});
