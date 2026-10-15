import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme } from '@/lib/theme';

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

it('Macのタイトルバーをダークとサイドバー色に固定する', async () => {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      expect(name).toBe('--surface');
      return ' #1c1917 ';
    },
  }));

  applyTheme();
  expect(setTheme).toHaveBeenCalledWith('dark');
  expect(setBackgroundColor).toHaveBeenCalledWith('#1c1917');

  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setBackgroundColor.mockRejectedValueOnce(new Error('native failure'));
  applyTheme();
  await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());

  getCurrentWindow.mockClear();
  vi.stubGlobal('window', {});
  applyTheme();
  expect(getCurrentWindow).not.toHaveBeenCalled();
});
