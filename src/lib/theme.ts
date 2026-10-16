import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from './desktop';

export type Theme = 'light' | 'dark' | 'system';
export const themeKey = 'ledad.theme';

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(themeKey);
    return value === 'dark' || value === 'system' ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme = readTheme()) {
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.theme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  if (isDesktop()) {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--bar-bg').trim();
    const appWindow = getCurrentWindow();
    void Promise.all([
      // Release the native appearance override so system media queries can follow macOS.
      appWindow.setTheme(theme === 'system' ? null : 'dark'),
      appWindow.setBackgroundColor(color),
    ]).catch((error) => console.warn('タイトルバーの配色を変更できませんでした。', error));
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // Apply for this window even when persistence is unavailable.
  }
  applyTheme(theme);
}
