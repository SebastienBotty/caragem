'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { normalizeAccountPreferences, type AccountPreferences } from '@/lib/account-preferences';
import { useGarage } from './provider';
import './theme-switch.css';

export function ThemeSwitch() {
  const { account, request, refresh, notify, training } = useGarage();
  const [dark, setDark] = useState(account?.preferences?.theme === 'dark');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const update = () =>
      setDark(
        account?.preferences?.theme === 'dark' ||
          (account?.preferences?.theme === 'system' && system.matches),
      );
    update();
    system.addEventListener('change', update);
    return () => system.removeEventListener('change', update);
  }, [account?.preferences?.theme]);
  if (!account) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-label="Thème sombre"
      aria-checked={dark}
      title={dark ? 'Activer le thème clair' : 'Activer le thème sombre'}
      className="theme-switch"
      disabled={busy || training}
      onClick={async () => {
        setBusy(true);
        try {
          const latest = await request<{ preferences: AccountPreferences }>('account/preferences');
          await request('account/preferences', {
            ...normalizeAccountPreferences(latest.preferences),
            theme: dark ? 'light' : 'dark',
          });
          await refresh();
        } catch (error) {
          notify((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Sun size={15} aria-hidden="true" />
      <Moon size={15} aria-hidden="true" />
    </button>
  );
}
