import { expect, test } from '@playwright/test';

test('会話分析後の待機時間を設定して再読込後も保持する', async ({ page, context, request }) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
  session.status = 'active';
  await request.put(`${base}/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  try {
    await page.addInitScript(() => {
      localStorage.setItem('ledad.language', 'ja');
      localStorage.setItem('ledad.insightIntervalSeconds', '60');
    });
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    const interval = page.getByLabel('会話分析後の待機時間');
    await expect(interval).toHaveValue('60');
    await expect(interval.locator('option')).toHaveText([
      'すぐに送信',
      '3秒',
      '15秒',
      '30秒',
      '1分',
    ]);
    await interval.selectOption('3');
    await expect(interval).toHaveValue('3');
    await page.setViewportSize({ width: 980, height: 700 });
    await page.screenshot({ path: 'artifacts/analyze-interval-980.png' });
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    await page.reload();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.getByLabel('会話分析後の待機時間')).toHaveValue('3');
    for (const previous of ['180', '300']) {
      await page.evaluate(
        (value) => localStorage.setItem('ledad.analyzeIntervalSeconds', value),
        previous,
      );
      await page.reload();
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await expect(page.getByLabel('会話分析後の待機時間')).toHaveValue('60');
    }
  } finally {
    await request.delete(`${base}/${session.id}`);
  }
});
