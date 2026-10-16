import { expect, test } from '@playwright/test';

test('AIモードの選択肢、モード別設定と音声の復元', async ({ page, context, request }) => {
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await request.put('http://127.0.0.1:4320/api/ai-settings', { data: { mode: 'gemini' } });
  await request.put('http://127.0.0.1:4320/api/live-settings', { data: { provider: 'gemini' } });
  await request.put('http://127.0.0.1:4320/api/config', { data: { provider: 'openai' } });
  await request.put('http://127.0.0.1:4320/api/ai-settings', { data: { mode: 'openai' } });
  await request.put('http://127.0.0.1:4320/api/live-settings', { data: { provider: 'openai' } });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
  const open = async () => {
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
  };
  await page.goto('/');
  await open();
  const mode = page.getByRole('checkbox', { name: 'Geminiも使う', exact: true });
  await expect(page.getByRole('combobox', { name: '利用するAI', exact: true })).toHaveCount(0);
  await expect(page.locator('.settings-models-heading').getByRole('checkbox')).toHaveCount(1);
  const live = page.getByRole('combobox', { name: '聞き取り（Live）', exact: true });
  const fixed = page.getByRole('combobox', { name: '聞き取り（Fixed）', exact: true });
  const speech = page.getByRole('combobox', { name: '音声出力', exact: true });
  const voice = page.getByRole('combobox', { name: '声の種類', exact: true });
  await expect(mode).not.toBeChecked();
  await expect(live.locator('option')).toHaveCount(2);
  await expect(fixed).toHaveCount(0);
  await expect(speech).toHaveCount(0);
  await expect(page.getByLabel('Gemini APIキー', { exact: false })).toHaveCount(0);
  await expect(voice).toHaveValue('marin');
  await voice.selectOption('cedar');
  await mode.click();
  await expect(mode).toBeChecked();
  await expect(live.locator('option')).toHaveCount(3);
  await expect(live).toHaveValue('gemini');
  await expect(fixed).toHaveValue('openai');
  await expect(speech).toHaveValue('gemini');
  await expect(voice).toHaveValue('Kore');
  await expect(voice.locator('option')).toHaveCount(4);
  await voice.selectOption('Aoede');
  await speech.selectOption('openai');
  await expect(voice).toHaveValue('cedar');
  await speech.selectOption('gemini');
  await expect(voice).toHaveValue('Aoede');
  await live.selectOption('openai');
  await expect(live).toBeEnabled();
  await fixed.selectOption('gemini');
  await expect(fixed).toBeEnabled();
  await mode.click();
  await expect(mode).not.toBeChecked();
  await expect(voice).toHaveValue('cedar');
  await mode.click();
  await expect(mode).toBeChecked();
  await expect(live).toHaveValue('openai');
  await expect(fixed).toHaveValue('gemini');
  await expect(voice).toHaveValue('Aoede');
  await page.reload();
  await open();
  await expect(mode).toBeChecked();
  await expect(fixed).toHaveValue('gemini');
  await expect(voice).toHaveValue('Aoede');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.locator('.settings-dialog').evaluate((e) => e.scrollWidth - e.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await request.put('http://127.0.0.1:4320/api/config', { data: { provider: 'openai' } });
});
