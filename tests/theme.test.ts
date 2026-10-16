import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, saveTheme, themeKey } from '@/lib/theme';

const { setTheme, setBackgroundColor, getCurrentWindow } = vi.hoisted(() => {
  const setTheme = vi.fn().mockResolvedValue(undefined);
  const setBackgroundColor = vi.fn().mockResolvedValue(undefined);
  return {
    setTheme,
    setBackgroundColor,
    getCurrentWindow: vi.fn(() => ({ setTheme, setBackgroundColor })),
  };
});
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('Macのタイトルバーをサイドバー色にし、システム指定では固定外観を解除する', async () => {
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      expect(name).toBe('--bar-bg');
      return ' #4b3022 ';
    },
  }));

  applyTheme();
  expect(setTheme).toHaveBeenCalledWith('dark');
  expect(setBackgroundColor).toHaveBeenCalledWith('#4b3022');

  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, matchMedia: () => ({ matches: false }) });
  applyTheme('system');
  expect(setTheme).toHaveBeenLastCalledWith(null);

  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setBackgroundColor.mockRejectedValueOnce(new Error('native failure'));
  applyTheme();
  await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());

  getCurrentWindow.mockClear();
  vi.stubGlobal('window', {});
  applyTheme();
  expect(getCurrentWindow).not.toHaveBeenCalled();
});

it('保存した外観を復元し、未設定・不正値・保存不可ではライトを使う', () => {
  const getItem = vi.fn().mockReturnValue(null);
  const setItem = vi.fn();
  const root = { dataset: { theme: 'light' } };
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem, setItem });
  expect(readTheme()).toBe('light');
  getItem.mockReturnValue('dark');
  applyTheme();
  expect(root.dataset.theme).toBe('dark');
  expect(getItem).toHaveBeenCalledWith(themeKey);
  saveTheme('light');
  expect(setItem).toHaveBeenCalledWith(themeKey, 'light');
  expect(root.dataset.theme).toBe('light');
  getItem.mockReturnValue('system');
  expect(readTheme()).toBe('system');
  getItem.mockReturnValue('invalid');
  expect(readTheme()).toBe('light');
  getItem.mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readTheme()).toBe('light');
  setItem.mockImplementation(() => {
    throw new Error('blocked');
  });
  saveTheme('dark');
  expect(root.dataset.theme).toBe('dark');
});

it('システム指定ではOSの外観を解決し、手動指定ではOSに依存しない', () => {
  const root = { dataset: { theme: 'light', themePreference: 'light' } };
  const media = { matches: true };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', { matchMedia });
  applyTheme('system');
  expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  expect(root.dataset).toEqual({ theme: 'dark', themePreference: 'system' });
  media.matches = false;
  applyTheme('system');
  expect(root.dataset.theme).toBe('light');
  applyTheme('dark');
  expect(root.dataset).toEqual({ theme: 'dark', themePreference: 'dark' });
  media.matches = true;
  applyTheme('light');
  expect(root.dataset.theme).toBe('light');
});
