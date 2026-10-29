import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as transfer from '../src/lib/data-transfer.ts';
import * as csv from '../src/lib/csv.ts';
import { createSeed } from '../src/lib/domain.ts';
import { readSpreadsheet, writeSpreadsheet } from '../src/server/spreadsheet-transfer.ts';

test('CSV dialog maps external columns, previews before confirmation, downloads templates and protects other roles and training', async () => {
  const require = createRequire(import.meta.url);
  let state = createSeed('transfer-ui', false),
    role = 'owner',
    training = false;
  const slots: unknown[] = [],
    calls: string[] = [],
    notifications: string[] = [];
  let cursor = 0,
    downloaded = '',
    blob: Blob | undefined;
  const mocks: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [
          slots[index],
          (value: unknown) =>
            (slots[index] = typeof value === 'function' ? value(slots[index]) : value),
        ];
      },
    },
    '@/lib/data-transfer': transfer,
    '@/lib/csv': csv,
    '@/lib/spreadsheet-export': { writeSpreadsheet },
    './ui': { Modal: 'Modal', Field: 'Field', Button: 'Button' },
    './provider': {
      useGarage: () => ({
        user: { role },
        training,
        notify: (message: string) => notifications.push(message),
        request: async (path: string, body: any) => {
          calls.push(path);
          if (path.endsWith('export')) {
            const data = body.example
              ? transfer.exampleDataCsv(body.kind)
              : transfer.exportDataCsv(state, body.kind, body.template);
            return {
              // Reproduce the old running API: it ignores format and always responds with CSV.
              filename: `clients${body.example ? '-exemple' : ''}.csv`,
              csv: data,
            };
          }
          if (path.endsWith('read')) return readSpreadsheet(body.base64);
          return {
            ...transfer.prepareCsvImport(state, body.kind, body.csv, body.mapping).report,
            revision: state.revision,
          };
        },
        api: async (path: string, body: any) => {
          calls.push(path);
          assert.equal(body.revision, state.revision);
          state = transfer.prepareCsvImport(state, body.kind, body.csv, body.mapping).state;
          state.revision++;
        },
      }),
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/csv-transfer.tsx', import.meta.url), 'utf8'),
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
      Blob,
      TextDecoder,
      atob,
      btoa,
      require: (name: string) =>
        mocks[name] ??
        (name === 'react/jsx-runtime'
          ? require(name)
          : new Proxy({}, { get: (_, key) => String(key) })),
      URL: {
        createObjectURL: (value: Blob) => {
          blob = value;
          return 'blob:test';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {} },
        createElement: () => ({
          download: '',
          click() {
            downloaded = this.download;
          },
          remove() {},
        }),
      },
      setTimeout: (fn: () => void) => fn(),
    },
  );
  function render() {
    cursor = 0;
    const elements: any[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      elements.push(node);
      visit(node.props.children);
    }
    visit(exports.CsvTransfer({ close() {} }));
    return elements;
  }
  const button = (label: string) =>
    render().find((e) => e.type === 'Button' && JSON.stringify(e.props.children).includes(label));
  await button('modèle').props.onClick();
  assert.equal(downloaded, 'clients.csv');
  assert.equal(csv.parseCsv(await blob!.text()).rows.length, 0);
  const file = {
    name: 'contacts.csv',
    size: 100,
    arrayBuffer: async () =>
      new TextEncoder().encode('Nom complet;Courriel;GSM\nCSV Alice;csv@example.com;+32412345678')
        .buffer,
  };
  await render()
    .find((e) => e.props.type === 'file')
    .props.onChange({ currentTarget: { files: [file], value: 'contacts.csv' } });
  for (const [label, index] of [
    ['Nom', 0],
    ['Email', 1],
    ['Téléphone', 2],
  ] as const)
    render()
      .find((e) => e.props['aria-label'] === `Colonne ${label}`)
      .props.onChange({ target: { value: String(index) } });
  assert.equal(button('Confirmer'), undefined);
  assert.equal(state.customers.length, 0);
  await button('Analyser avant import').props.onClick();
  assert.equal(state.customers.length, 0);
  assert.ok(button('Confirmer'));
  await button('Confirmer').props.onClick();
  assert.equal(state.customers.length, 1);
  assert.equal(state.customers[0].phone, '+32412345678');
  assert.deepEqual(calls, [
    'data-transfer/export',
    'data-transfer/preview',
    'data-transfer/import',
  ]);
  assert.equal(notifications.length, 1);
  assert.equal(button('Confirmer'), undefined);
  const formatField = render().find(
    (e) => e.type === 'Field' && e.props.label === 'Format de téléchargement',
  );
  for (const format of ['xls', 'xlsx'] as const) {
    formatField.props.children.props.onChange({ target: { value: format } });
    await button('modèle').props.onClick();
    assert.equal(downloaded, `clients.${format}`);
    assert.equal(
      blob!.type,
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.ms-excel',
    );
    const bytes = Buffer.from(await blob!.arrayBuffer());
    assert.equal(
      bytes.subarray(0, format === 'xlsx' ? 4 : 8).toString('hex'),
      format === 'xlsx' ? '504b0304' : 'd0cf11e0a1b11ae1',
    );
    assert.equal(csv.parseCsv(readSpreadsheet(bytes.toString('base64')).csv).rows.length, 0);
  }
  formatField.props.children.props.onChange({ target: { value: 'xlsx' } });
  await button('exemple rempli').props.onClick();
  assert.equal(downloaded, 'clients-exemple.xlsx');
  const excelBuffer = await blob!.arrayBuffer();
  assert.equal(parseInt(Buffer.from(excelBuffer).subarray(0, 2).toString('hex'), 16), 0x504b);
  await render()
    .find((e) => e.props.type === 'file')
    .props.onChange({
      currentTarget: {
        files: [
          {
            name: 'contacts.xlsx',
            size: excelBuffer.byteLength,
            arrayBuffer: async () => excelBuffer,
          },
        ],
        value: 'file',
      },
    });
  assert.ok(calls.includes('data-transfer/read'));
  assert.equal(state.customers.length, 1);
  await button('Analyser avant import').props.onClick();
  assert.ok(button('Confirmer'));
  await button('Confirmer').props.onClick();
  assert.equal(state.customers.length, 2);
  role = 'mechanic';
  assert.equal(render().length, 0);
  role = 'owner';
  training = true;
  assert.equal(render().length, 0);
});
