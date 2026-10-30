import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as demonstration from '../src/lib/training-demonstration.ts';

test('guided tour advances and rewinds without forms and rejects all real mutations and transports', async () => {
  const require = createRequire(import.meta.url),
    slots: unknown[] = [];
  let cursor = 0,
    closed = 0;
  const mocks: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], (value: unknown) => (slots[slot] = value)];
      },
      useRef: () => ({ current: null }),
      useEffect() {},
    },
    'react-dom': { createPortal: (node: unknown) => node },
    '@/lib/training-demonstration': demonstration,
    './provider': { GarageContext: { Provider: 'Provider' } },
    './app-shell': { AppShell: 'AppShell' },
    './ui': { Button: 'Button', Modal: 'Modal' },
    './vehicle-drawer': { VehicleDrawer: 'VehicleDrawer' },
    './documents': { DocumentDetail: 'DocumentDetail' },
    './permissions-editor': {
      CustomRoleDialog: 'CustomRoleDialog',
      UserPermissionsDialog: 'UserPermissionsDialog',
      AssignRoleDialog: 'AssignRoleDialog',
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/training-tour.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports, require: (name: string) => mocks[name] ?? require(name) },
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
    visit(exports.TrainingTour({ page: 'garage', close: () => closed++ }));
    return elements;
  }
  const button = (label: string) =>
    render().find((e) => e.type === 'Button' && e.props.children === label);
  const context = () => render().find((e) => e.type === 'Provider').props.value;
  const first = context().state;
  assert.equal(first.vehicles[0].stage, 'reception');
  assert.equal(button('Précédent').props.disabled, true);
  button('Suivant').props.onClick();
  assert.equal(context().state.vehicles[0].stage, 'diagnosis');
  button('Précédent').props.onClick();
  assert.equal(context().state, first);
  await assert.rejects(context().act({ type: 'customer' }), /lecture seule/);
  await assert.rejects(context().api('send-mail', {}), /lecture seule/);
  await assert.rejects(context().request('invite', {}), /lecture seule/);
  await assert.rejects(context().request('session'), /lecture seule/);
  assert.equal((await context().request('invitations')).invitations.length, 0);
  let blocked = 0;
  render()[0].props.onClickCapture({
    target: { closest: () => null },
    preventDefault: () => blocked++,
    stopPropagation: () => blocked++,
  });
  assert.equal(blocked, 2);
  for (let i = 0; i < 10; i++) button('Suivant').props.onClick();
  button('Terminer la visite').props.onClick();
  assert.ok(button('Revenir à mon garage'));
  button('Revenir à mon garage').props.onClick();
  assert.equal(closed, 1);
});
