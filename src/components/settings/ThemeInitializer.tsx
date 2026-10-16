'use client';
import { useEffect } from 'react';
import { applyTheme } from '@/lib/theme';
export default function ThemeInitializer() {
  useEffect(() => {
    const restore = () => applyTheme();
    restore();
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => {
      if (document.documentElement.dataset.themePreference === 'system') applyTheme('system');
    };
    window.addEventListener('storage', restore);
    systemTheme.addEventListener('change', followSystem);
    return () => {
      window.removeEventListener('storage', restore);
      systemTheme.removeEventListener('change', followSystem);
    };
  }, []);
  return null;
}
