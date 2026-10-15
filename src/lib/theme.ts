import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from './desktop';

export function applyTheme() {
  if (isDesktop()) {
    const appWindow = getCurrentWindow();
    const color = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    void Promise.all([
      appWindow.setTheme('dark'),
      appWindow.setBackgroundColor(color),
    ]).catch((error) => console.warn('タイトルバーの配色を変更できませんでした。', error));
  }
}
