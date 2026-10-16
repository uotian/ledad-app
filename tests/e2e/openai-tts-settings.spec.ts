import { expect, test } from '@playwright/test';

test('OpenAIの声を保存し、Geminiへ戻せる', async ({ page, context }) => {
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const voice = page.getByRole('combobox', { name: '声の種類', exact: true });
  await expect(voice).toHaveCount(0);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  if (!(await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).isChecked())) {
    await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).click();
  }
  await expect(page.getByRole('checkbox', { name: 'Geminiも使う', exact: true })).toBeChecked();
  await expect(voice).toBeEnabled();
  const provider = page.getByRole('combobox', { name: '音声出力', exact: true });
  await provider.selectOption('openai');
  await expect(voice.locator('option')).toHaveCount(2);
  await expect(page.getByText('次の読み上げから反映します。')).toHaveCount(0);
  await voice.selectOption('marin');
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  if (!(await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).isChecked())) {
    await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).click();
  }
  await expect(page.getByRole('checkbox', { name: 'Geminiも使う', exact: true })).toBeChecked();
  await expect(voice).toHaveValue('marin');
  await voice.selectOption('cedar');
  await expect(voice).toHaveValue('cedar');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page
        .locator('.settings-dialog')
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await provider.selectOption('gemini');
  await expect(voice.locator('option')).toHaveCount(4);
  await expect(voice).toHaveValue('Kore');
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  if (!(await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).isChecked())) {
    await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).click();
  }
  await expect(page.getByRole('checkbox', { name: 'Geminiも使う', exact: true })).toBeChecked();
  await expect(provider).toHaveValue('gemini');
  expect(
    await page
      .locator('.settings-dialog')
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
});
