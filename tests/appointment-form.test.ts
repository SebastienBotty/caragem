import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import type { ReactElement } from 'react';
import { customerVehicles } from '../src/lib/customer-vehicles.ts';
import { createSeed, applyAction, type Action } from '../src/lib/domain.ts';

test('appointment form selects client cars, supports a new car and selects a newly created client', async () => {
  const require = createRequire(import.meta.url);
  type Element = ReactElement<Record<string, any>>;
  const state = createSeed('appointment-form', true);
  let saved = state;
  const values: unknown[] = [];
  let cursor = 0;
  let manageCustomers = true;
  let submitted: Action | undefined;
  let closed = false;
  const mocks: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const slot = cursor++;
        if (!(slot in values)) values[slot] = initial;
        return [values[slot], (value: unknown) => (values[slot] = value)];
      },
    },
    'lucide-react': { Plus: 'Plus' },
    '../provider': {
      useGarage: () => ({
        state,
        can: () => manageCustomers,
        act: async (action: Action) => {
          saved = applyAction(saved, action, state.users[0]);
          submitted = action;
        },
      }),
    },
    '../ui': {
      Field: 'Field',
      Form: 'Form',
      Modal: 'Modal',
      localDateInput: () => '2026-11-01T10:00',
      value: (data: FormData, key: string) => String(data.get(key) ?? ''),
    },
    './customer-form': { CustomerForm: 'CustomerForm' },
    '@/lib/customer-vehicles': { customerVehicles },
  };
  const exports: { AppointmentForm?: (props: { close: () => void }) => Element } = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../src/components/forms/appointment-form.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => mocks[name] ?? require(name) });
  function render() {
    cursor = 0;
    const elements: Element[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      elements.push(node);
      visit(node.props.children);
    }
    visit(exports.AppointmentForm!({ close: () => (closed = true) }));
    return elements;
  }
  const field = (name: string) => render().find((e) => e.props.name === name)!;
  const chooseClient = (id: string) =>
    field('customerId').props.onChange({ target: { value: id } });
  const carSelect = () =>
    render().find((e) => e.type === 'select' && e.props.name !== 'customerId')!;
  const [client, other] = state.customers;
  chooseClient(client.id);
  const cars = customerVehicles(state, client.id);
  const optionIds = render()
    .filter((e) => e.type === 'option')
    .map((e) => e.props.value);
  for (const car of cars) assert.ok(optionIds.includes(car.id));
  for (const car of customerVehicles(state, other.id)) assert.ok(!optionIds.includes(car.id));
  carSelect().props.onChange({ target: { value: cars[0].id } });
  assert.equal(field('plate').props.defaultValue, cars[0].plate);
  assert.equal(field('model').props.defaultValue, cars[0].model);
  assert.equal(field('plate').props.readOnly, true);
  carSelect().props.onChange({ target: { value: 'new' } });
  assert.equal(field('plate').props.defaultValue, '');
  assert.equal(field('plate').props.readOnly, false);
  chooseClient(other.id);
  assert.equal(carSelect().props.value, '');
  const create = render().find((e) => e.type === 'button' && e.props.type === 'button')!;
  create.props.onClick();
  const customerForm = render().find((e) => (e.type as unknown) === 'CustomerForm')!;
  customerForm.props.onCreated('new-client');
  customerForm.props.close();
  assert.equal(field('customerId').props.value, 'new-client');
  assert.equal(field('plate').props.defaultValue, '');
  assert.ok(!render().some((e) => (e.type as unknown) === 'CustomerForm'));
  manageCustomers = false;
  assert.ok(!render().some((e) => e.type === 'button' && e.props.type === 'button'));
  chooseClient(client.id);
  carSelect().props.onChange({ target: { value: cars[0].id } });
  const data = new FormData();
  for (const [key, value] of Object.entries({
    customerId: client.id,
    plate: cars[0].plate,
    model: cars[0].model,
    reason: 'Entretien',
    at: '2026-11-01T10:00',
  }))
    data.set(key, value);
  const form = render().find((e) => (e.type as unknown) === 'Form')!;
  await form.props.onSubmit(data);
  assert.equal(submitted?.type, 'appointment');
  assert.equal(closed, true);
  assert.equal(saved.appointments.at(-1)!.plate, cars[0].plate);
  assert.equal(saved.vehicles.length, state.vehicles.length);
  carSelect().props.onChange({ target: { value: 'new' } });
  data.set('plate', 'NEW-123');
  data.set('model', 'Renault Clio');
  await render()
    .find((e) => (e.type as unknown) === 'Form')!
    .props.onSubmit(data);
  assert.equal(saved.appointments.at(-1)!.plate, 'NEW-123');
  assert.equal(saved.appointments.at(-1)!.model, 'Renault Clio');
  assert.equal(saved.vehicles.length, state.vehicles.length);
  closed = false;
  data.set('customerId', 'missing');
  await assert.rejects(form.props.onSubmit(data), /introuvable/);
  assert.equal(closed, false);
});
