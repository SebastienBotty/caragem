import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as domain from '../src/lib/domain.ts';

test('document forms, previews, invoice statistics and unpaid filter all use the discounted total', async () => {
  const require = createRequire(import.meta.url);
  let state = domain.createSeed('discount-ui', true);
  state.documents = [];
  state.settings.country = 'FR';
  state.reservations = [];
  state.vehicles[0].tasks = [];
  let closed = false;
  function mount(file: string, name: string, props: unknown) {
    const slots: unknown[] = [];
    let cursor = 0;
    const mocks: Record<string, unknown> = {
      react: {
        useState: (initial: unknown) => {
          const slot = cursor++;
          if (!(slot in slots)) slots[slot] = initial;
          return [
            slots[slot],
            (value: unknown) =>
              (slots[slot] = typeof value === 'function' ? value(slots[slot]) : value),
          ];
        },
      },
      '@/lib/domain': domain,
      '../provider': {
        useGarage: () => ({
          state,
          can: () => true,
          act: async (action: domain.Action) => {
            state = domain.applyAction(state, action, state.users[0]);
          },
        }),
      },
      '../ui': {
        Field: 'Field',
        Form: 'Form',
        Modal: 'Modal',
        Badge: 'Badge',
        Button: 'Button',
        Empty: 'Empty',
        formatDate: () => 'date',
      },
    };
    const exports: Record<string, any> = {};
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(new URL(`../src/components/documents/${file}.tsx`, import.meta.url), 'utf8'),
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
        require: (id: string) =>
          mocks[id] ??
          (id === 'react/jsx-runtime'
            ? require(id)
            : new Proxy({}, { get: (_, key) => String(key) })),
      },
    );
    return () => {
      cursor = 0;
      const elements: any[] = [],
        text: string[] = [];
      function visit(node: any) {
        if (Array.isArray(node)) return node.forEach(visit);
        if (typeof node === 'string' || typeof node === 'number') {
          text.push(String(node));
          return;
        }
        if (!node?.props) return;
        elements.push(node);
        visit(node.props.children);
      }
      visit(exports[name](props));
      return { elements, text: text.join(' ') };
    };
  }
  for (const kind of ['estimate', 'invoice'] as const) {
    const form = mount('document-form', 'DocumentForm', {
      kind,
      vehicleId: state.vehicles[0].id,
      close: () => (closed = true),
    });
    const input = form().elements.find(
      (e) => e.props['aria-label'] === 'Ristourne globale en pourcentage',
    );
    assert.equal(input.props.min, 0);
    assert.equal(input.props.max, 100);
    input.props.onChange({ target: { value: '10' } });
    const euros = () =>
      form().elements.find((e) => e.props['aria-label'] === 'Ristourne globale en euros HT');
    const percent = () =>
      form().elements.find((e) => e.props['aria-label'] === 'Ristourne globale en pourcentage');
    assert.ok(percent());
    assert.ok(euros());
    assert.equal(euros().props.value, 6.5);
    assert.equal(euros().props.max, 65);
    euros().props.onChange({ target: { value: '7.50' } });
    assert.equal(percent().props.value, 11.54);
    percent().props.onChange({ target: { value: '10' } });
    if (kind === 'invoice') {
      euros().props.onChange({ target: { value: '6.50' } });
      const price = form().elements.find((e) => e.props['aria-label'] === 'Prix ligne 1');
      price.props.onChange({ target: { value: '70' } });
      assert.equal(euros().props.value, 6.5);
      assert.equal(percent().props.value, 9.29);
      assert.ok(form().text.includes(domain.money(7620)));
      price.props.onChange({ target: { value: '65' } });
    } else {
      const price = form().elements.find((e) => e.props['aria-label'] === 'Prix ligne 1');
      price.props.onChange({ target: { value: '70' } });
      assert.equal(percent().props.value, 10);
      assert.equal(euros().props.value, 7);
      price.props.onChange({ target: { value: '65' } });
    }
    const preview = form();
    assert.ok(preview.text.includes(domain.money(7020)));
    assert.ok(preview.text.includes(domain.money(-650)));
    await preview.elements.find((e) => e.type === 'Form').props.onSubmit();
    assert.equal(closed, true);
    const document = state.documents.at(-1)!;
    if (kind === 'estimate') assert.equal(document.discountRate, 10);
    else {
      assert.equal(document.discountRate, 0);
      assert.equal(document.discountAmount, 650);
    }
    const detail = mount('document-detail', 'DocumentDetail', { document, close() {} })();
    assert.ok(detail.text.includes('Ristourne'));
    assert.ok(detail.text.includes(domain.money(7020)));
    assert.ok(detail.text.includes(domain.money(-650)));
    const price = form().elements.find((e) => e.props['aria-label'] === 'Prix ligne 1');
    price.props.onChange({ target: { value: '0' } });
    euros().props.onChange({ target: { value: '0' } });
    assert.equal(percent().props.value, 0);
    assert.equal(euros().props.value, 0);
  }
  const invoice = state.documents.at(-1)!;
  invoice.validated = true;
  state = domain.applyAction(
    state,
    { type: 'payment', id: invoice.id, amount: 7020 },
    state.users[0],
  );
  const screen = mount('documents-screen', 'DocumentsScreen', {
    kind: 'invoice',
    selectVehicle() {},
  });
  const overview = screen();
  assert.ok(overview.text.includes(domain.money(7020)));
  assert.ok(overview.text.includes('Réglée'));
  const filter = overview.elements.find(
    (e) => e.type === 'button' && e.props.children === 'À régler',
  );
  filter.props.onClick();
  assert.ok(!screen().text.includes(invoice.number));
});
