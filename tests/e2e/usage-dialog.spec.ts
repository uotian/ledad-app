import { expect, test } from '@playwright/test';

test('使わなかった Live 翻訳は成功とトークンを残して不利用と表示する', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
  session.status = 'active';
  await request.put(`${base}/${session.id}`, { data: session });
  await context.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.endsWith(`/api/sessions/${session.id}/cost`))
      return route.fulfill({
        json: {
          pricing: null,
          openai: { yen: 0.35, incomplete: false },
          gemini: { yen: 0.65, incomplete: false },
        },
      });
    if (url.endsWith(`/api/sessions/${session.id}/usage`))
      return route.fulfill({
        json: [
          {
            id: crypto.randomUUID(),
            provider: 'openai',
            operation: 'transcript_preview',
            operationLabel: 'Live翻訳',
            model: 'test-model',
            startedAt: '2026-10-09T00:00:00Z',
            endedAt: '2026-10-09T00:00:01Z',
            status: 'completed',
            inputTokens: 395,
            outputTokens: 17,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            audioInputSeconds: null,
            errorCode: null,
            unused: true,
            yen: 0.35,
          },
        ].flatMap((record) => [
          record,
          {
            ...record,
            id: 'gemini-test',
            provider: 'gemini',
            operation: 'speech',
            operationLabel: '発話',
            model: 'gemini-test',
            yen: 0.65,
          },
        ]),
      });
    if (url.includes(`/api/sessions/${session.id}/usage/`))
      return route.fulfill({
        json: {
          record: { model: 'test-model', startedAt: '2026-10-09T00:00:00Z', status: 'completed' },
          request: {},
          response: {},
          error: null,
        },
      });
    return route.continue({ url: url.replace(':4319', ':4320') });
  });
  try {
    await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
    await page.goto(`/session/?id=${session.id}`);
    const trigger = page.getByRole('button', { name: /API履歴を開く/ });
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toContainText('1.00円');
    await trigger.click();
    const providers = page.getByRole('group', { name: 'API提供元' });
    await expect(providers.getByRole('button', { name: /両方全て/ })).toContainText('2件 / 1.00円');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await providers.getByRole('button', { name: /Gemini全て/ }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('gemini-test');
    await providers.getByRole('button', { name: /両方全て/ }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await providers.getByRole('button', { name: /OpenAI全て/ }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const billing = page.getByRole('link', { name: 'OpenAIのAPI課金画面を開く' });
    await expect(billing).not.toBeFocused();
    await expect(billing).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Tab');
    await billing.focus();
    await expect(billing).toHaveCSS('outline-style', 'none');
    await expect(billing).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const row = page.getByRole('row').filter({ hasText: 'Live翻訳' });
    await expect(page.getByRole('columnheader')).toHaveText([
      '日時',
      '所要時間',
      '処理・モデル',
      '状態',
      'トークン',
      'キャッシュ',
      '備考',
      '詳細',
    ]);
    await expect(row.locator('time')).toHaveCount(1);
    for (const cell of await row.getByRole('cell').all()) {
      await expect(cell).toHaveCSS('vertical-align', 'middle');
    }
    await expect(row.getByRole('cell').first().locator('div')).toHaveCSS('row-gap', '2px');
    for (const metrics of await row.locator('dl').all()) {
      await expect(metrics).toHaveCSS('display', 'inline-grid');
      await expect(metrics).toHaveCSS('column-gap', '8px');
      await expect(metrics).toHaveCSS('row-gap', '2px');
    }
    await expect(row.locator('time')).toHaveAttribute('datetime', '2026-10-09T00:00:00Z');
    await expect(row.getByRole('cell').nth(1)).toHaveText('1秒');
    await expect(row.getByRole('cell').first()).not.toContainText('〜');
    await expect(row).toContainText('成功');
    await expect(row).toContainText('不利用');
    await expect(row).toContainText('395');
    await expect(row).toContainText('17');
    const filters = page.getByRole('group', { name: '処理', exact: true });
    await expect(filters.getByRole('button', { name: /すべての処理/ })).toContainText(
      '1件 / 0.35円',
    );
    await filters.getByRole('button', { name: 'Live翻訳 (1件 / 0.35円)' }).click();
    await expect(filters.getByRole('button', { name: 'Live翻訳 (1件 / 0.35円)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(row).toBeVisible();
    await filters.getByRole('button', { name: /すべての処理/ }).click();
    await expect(filters.getByRole('button', { name: /すべての処理/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await row.getByRole('button', { name: 'APIの詳細を開く' }).click();
    const detail = page.getByRole('dialog', { name: /APIの詳細/ });
    await expect(detail).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(detail).not.toBeVisible();
    await expect(row).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});
