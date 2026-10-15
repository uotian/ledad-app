import { expect, test } from '@playwright/test';

test('設定の文字サイズがS/M/Lに連動し、閉じるボタンに枠を表示しない', async ({ page, context }) => {
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const dialog = page.locator('.settings-dialog');
  const close = page.getByRole('button', { name: '設定を閉じる' });
  await expect(close).toHaveCSS('border-top-style', 'none');
  await expect(close).toHaveCSS('outline-style', 'none');
  const textSizes = () =>
    dialog
      .locator('h2, .settings-tabs button, .field input, .theme-option')
      .evaluateAll((elements) =>
        elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
      );
  const small = await textSizes();
  for (const [size, scale] of [
    ['M', 1.15],
    ['L', 1.3],
  ] as const) {
    await page.getByRole('radio', { name: size, exact: true }).check();
    await expect.poll(textSizes).toEqual(small.map((value) => Number((value * scale).toFixed(2))));
  }
  await page.getByRole('tab', { name: 'APIキー', exact: true }).click();
  await expect(dialog.locator('.settings-description')).toHaveCSS('font-size', '14.3px');
  await expect(dialog.locator('input').first()).toHaveCSS('font-size', '15.6px');
  for (const tab of ['APIキー', '一般']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 700 });
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `artifacts/settings-${tab}-L-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('radio', { name: 'S', exact: true }).check();
  await expect.poll(textSizes).toEqual(small);
  await page.getByRole('radio', { name: 'L', exact: true }).check();
  await close.click();
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'L', exact: true })).toBeChecked();
  await expect.poll(textSizes).toEqual(small.map((value) => Number((value * 1.3).toFixed(2))));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS('outline-style', 'none');
  await expect(close).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
});
