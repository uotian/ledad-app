import { expect, test } from '@playwright/test';

test('OpenAI Liveを保存し、Fixedの選択は変えない', async ({ page, context, request }) => {
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  const before = await (await request.get('http://127.0.0.1:4320/api/config')).json();
  try {
    await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
    await page.goto('/');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    const live = page.getByRole('combobox', { name: '聞き取り（Live）', exact: true });
    await live.selectOption('openai');
    await expect(live).toHaveValue('openai');
    await page.reload();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    await expect(live).toHaveValue('openai');
    const after = await (await request.get('http://127.0.0.1:4320/api/config')).json();
    expect(after.models.transcription).toBe('gpt-live-transcribe');
    expect(after.refinementProvider).toBe(before.refinementProvider);
  } finally {
    await request.put('http://127.0.0.1:4320/api/live-settings', {
      data: { provider: before.liveProvider },
    });
  }
});
