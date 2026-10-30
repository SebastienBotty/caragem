import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('account theme follows system changes only when requested and cleans shared browser state on logout', () => {
  const root = { dataset: {} as Record<string, string> };
  let color = '#f5f6f8';
  let cleanup: (() => void) | undefined;
  let listener: (() => void) | undefined;
  const media = {
    matches: false,
    addEventListener: (_: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: (_: string, callback: () => void) => {
      assert.equal(callback, listener);
      listener = undefined;
    },
  };
  const exports: { AccountTheme?: (props: { theme: string }) => null } = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/account-theme.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText,
    {
      exports,
      require: () => ({
        useEffect: (effect: () => () => void) => {
          cleanup = effect();
        },
      }),
      window: { matchMedia: () => media },
      document: {
        documentElement: root,
        querySelector: () => ({
          getAttribute: () => color,
          setAttribute: (_: string, value: string) => {
            color = value;
          },
        }),
      },
    },
  );
  exports.AccountTheme!({ theme: 'dark' });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(color, '#101722');
  listener!();
  assert.equal(root.dataset.theme, 'dark');
  cleanup!();
  assert.equal(root.dataset.theme, undefined);
  assert.equal(color, '#f5f6f8');
  assert.equal(listener, undefined);
  exports.AccountTheme!({ theme: 'system' });
  assert.equal(root.dataset.theme, 'light');
  media.matches = true;
  listener!();
  assert.equal(root.dataset.theme, 'dark');
  media.matches = false;
  listener!();
  assert.equal(root.dataset.theme, 'light');
  cleanup!();
  media.matches = true;
  exports.AccountTheme!({ theme: 'light' });
  assert.equal(root.dataset.theme, 'light');
  cleanup!();
  assert.equal(root.dataset.theme, undefined);
});
