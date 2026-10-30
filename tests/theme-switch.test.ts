import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  defaultAccountPreferences,
  normalizeAccountPreferences,
} from '../src/lib/account-preferences.ts';

test('header switch persists only the new theme over fresh preferences, handles failure and respects training', async () => {
  const require = createRequire(import.meta.url);
  const slots: unknown[] = [];
  let cursor = 0;
  let failed = false;
  let refreshed = 0;
  let saved: typeof defaultAccountPreferences | undefined;
  const notices: string[] = [];
  const latest = {
    ...defaultAccountPreferences,
    graphicsQuality: 'low' as const,
    initialPage: 'tasks' as const,
  };
  const context = {
    account: { preferences: { ...defaultAccountPreferences } },
    training: false,
    request: async (_: string, body?: typeof latest) => {
      if (failed) throw new Error('Connexion indisponible');
      if (body) {
        saved = body;
        return {};
      }
      return { preferences: latest };
    },
    refresh: async () => {
      refreshed++;
    },
    notify: (message: string) => notices.push(message),
  };
  const mocks: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [
          slots[index],
          (value: unknown) => {
            slots[index] = value;
          },
        ];
      },
      useEffect() {},
    },
    './provider': { useGarage: () => context },
    './theme-switch.css': {},
    '@/lib/account-preferences': { normalizeAccountPreferences },
  };
  const exports: { ThemeSwitch?: () => any } = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/theme-switch.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    { exports, require: (name: string) => mocks[name] ?? require(name) },
  );
  const render = () => {
    cursor = 0;
    return exports.ThemeSwitch!();
  };
  assert.equal(render().props.role, 'switch');
  assert.equal(render().props['aria-checked'], false);
  await render().props.onClick();
  assert.equal(saved!.theme, 'dark');
  assert.equal(saved!.graphicsQuality, 'low');
  assert.equal(saved!.initialPage, 'tasks');
  assert.equal(refreshed, 1);
  slots[0] = true;
  await render().props.onClick();
  assert.equal(saved!.theme, 'light');
  failed = true;
  await render().props.onClick();
  assert.deepEqual(notices, ['Connexion indisponible']);
  assert.equal(render().props.disabled, false);
  context.training = true;
  assert.equal(render().props.disabled, true);
});
