import { expect, test } from '@playwright/test';

test('APIキーの応答を待っている間も保存済み会議を表示する', async ({ page, context, request }) => {
  const created = await request.post('http://127.0.0.1:4320/api/sessions', {
    data: { mode: 'audience', title: '起動待ちから独立した会議一覧' },
  });
  const session = await created.json();
  session.status = 'active';
  await request.put(`http://127.0.0.1:4320/api/sessions/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('http://127.0.0.1:4319/api/config', async (route) => {
    await delayed;
    await route.fulfill({ json: { openai: false, gemini: false } });
  });
  try {
    await page.goto('/');
    await expect(page.locator(`a[href="/session/?id=${session.id}"]`).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI接続設定を開く' })).toContainText(
      '設定を確認中',
    );
    release();
    await expect(page.getByRole('button', { name: 'AI接続設定を開く' })).toContainText(
      'APIキーの設定が必要',
    );
  } finally {
    release();
    await request.delete(`http://127.0.0.1:4320/api/sessions/${session.id}`);
  }
});
