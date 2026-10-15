import { expect, test } from '@playwright/test';

for (const entry of ['ロゴ']) {
  test(`${entry}からホームへ戻る前に保存し、失敗したら画面に残る`, async ({
    page,
    context,
    request,
  }) => {
    const created = await request.post('http://127.0.0.1:4320/api/sessions', {
      data: { mode: 'audience' },
    });
    const session = await created.json();
    let failSave = true;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('http://127.0.0.1:4319/**', async (route) => {
      if (route.request().method() === 'PUT') {
        if (failSave) {
          await route.fulfill({ status: 500, json: { error: '検証用の保存失敗' } });
          return;
        }
        await pending;
      }
      await route.continue({ url: route.request().url().replace(':4319', ':4320') });
    });
    try {
      await page.goto(`/session/?id=${session.id}`);
      const title = page.getByLabel('タイトル', { exact: true });
      await title.fill(`${entry}から戻る直前の編集`);
      const home =
        entry === 'ロゴ'
          ? page.getByRole('link', { name: 'ledad ホーム' })
          : entry === 'サイドバー'
            ? page.getByRole('navigation').getByRole('link', { name: 'ホーム', exact: true })
            : page.locator('main').getByRole('link', { name: 'ホーム', exact: true });
      await home.click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'この画面に残りました' }),
      ).toBeVisible();
      await expect(title).toHaveValue(`${entry}から戻る直前の編集`);
      failSave = false;
      await home.click();
      await expect(page.getByRole('dialog', { name: '処理中' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: '処理中' })).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(
        true,
      );
      // 保存応答を保留している間は、編集画面を破棄しません。
      await expect(title).toBeVisible();
      release();
      await expect(page).toHaveURL('/');
      const saved = await (
        await request.get(`http://127.0.0.1:4320/api/sessions/${session.id}`)
      ).json();
      expect(saved.title).toBe(`${entry}から戻る直前の編集`);
    } finally {
      release();
    }
  });
}
