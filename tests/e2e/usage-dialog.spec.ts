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
          gemini: { yen: 2.5, incomplete: false },
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
            operationLabel: 'TTS',
            model: 'gemini-test',
            yen: 2.5,
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
    await expect(trigger).toContainText('2.9円');
    await trigger.click();
    const providers = page.getByRole('group', { name: 'API提供元' });
    await expect(providers.getByRole('button')).toHaveCount(2);
    await expect(providers.getByRole('button')).toHaveText([
      'OpenAI (1件/0.4円)',
      'Gemini (1件/2.5円)',
    ]);
    await expect(
      providers.getByRole('button', { name: 'OpenAI (1件/0.4円)', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('test-model');
    await page.getByRole('button', { name: 'Live翻訳 (1件/0.4円)', exact: true }).click();
    await providers.getByRole('button', { name: 'Gemini (1件/2.5円)', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('gemini-test');
    await expect(page.getByRole('button', { name: /^全て/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('link', { name: 'GeminiのAPI課金画面を開く' })).toHaveAttribute(
      'href',
      'https://aistudio.google.com/billing',
    );
    await expect(page.getByRole('link', { name: 'OpenAIのAPI課金画面を開く' })).toHaveCount(0);
    await providers.getByRole('button', { name: 'OpenAI (1件/0.4円)', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const billing = page.getByRole('link', { name: 'OpenAIのAPI課金画面を開く' });
    await expect(billing).toHaveAttribute(
      'href',
      'https://platform.openai.com/settings/organization/billing/overview',
    );
    await expect(page.locator('footer').getByRole('link')).toHaveCount(1);
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
    await expect(filters.getByRole('button', { name: /^全て/ })).toContainText('1件/0.4円');
    await filters.getByRole('button', { name: 'Live翻訳 (1件/0.4円)' }).click();
    await expect(filters.getByRole('button', { name: 'Live翻訳 (1件/0.4円)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(row).toBeVisible();
    await filters.getByRole('button', { name: /^全て/ }).click();
    await expect(filters.getByRole('button', { name: /^全て/ })).toHaveAttribute(
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
    await trigger.click();
    await providers.getByRole('button', { name: 'Gemini (1件/2.5円)', exact: true }).click();
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await trigger.click();
    await expect(
      providers.getByRole('button', { name: 'OpenAI (1件/0.4円)', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    for (const width of [1440, 980, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(billing).toBeInViewport();
      await expect(
        providers.getByRole('button', { name: 'Gemini (1件/2.5円)', exact: true }),
      ).toBeInViewport();
      await page.screenshot({ path: `artifacts/usage-provider-${width}.png` });
    }
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});
