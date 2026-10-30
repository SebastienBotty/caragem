'use client';
import { useEffect } from 'react';
import type { AccountPreferences } from '@/lib/account-preferences';

export function AccountTheme({ theme = 'light' }: { theme?: AccountPreferences['theme'] }) {
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousColor = meta?.getAttribute('content');
    const update = () => {
      const dark = theme === 'dark' || (theme === 'system' && system.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      meta?.setAttribute('content', dark ? '#101722' : '#f5f6f8');
    };
    update();
    system.addEventListener('change', update);
    return () => {
      system.removeEventListener('change', update);
      delete root.dataset.theme;
      if (previousColor) meta?.setAttribute('content', previousColor);
    };
  }, [theme]);
  return null;
}
