import { uploadedDocument } from './document-fixture';
import { expect, test, type Page } from '@playwright/test';

async function blocked(page: Page) {
  const dialog = page.getByRole('dialog', { name: '処理中' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
}

test('資料登録・削除・会議開始の待機中は操作を止め、失敗後に再試行できる', async ({ page }) => {
  let release = () => {};
  let gate = Promise.resolve();
  function hold() {
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  let uploads = 0;
  let starts = 0;
  let failUpload = true;
  let holdSave = false;
  await page.route('http://127.0.0.1:4319/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith('/documents')) {
      uploads++;
      await gate;
      if (failUpload) {
        await route.fulfill({ status: 500, json: { error: '資料登録失敗テスト' } });
        return;
      }
      await uploadedDocument(route);
      return;
    }
    if (holdSave && request.method() === 'PUT') await gate;
    if (request.method() === 'POST' && request.postData()?.includes('"type":"start"')) {
      starts++;
      await gate;
    }
    await route.continue({ url: request.url().replace(':4319', ':4320') });
  });
  try {
    await page.goto('/');
    await page.getByLabel('タイトル', { exact: true }).fill('Loading検証');
    await page.locator('.home-documents > summary').click();
    const file = {
      name: 'loading.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('会議の参考資料'),
    };
    hold();
    await page.getByLabel('資料ファイル').setInputFiles(file);
    await expect.poll(() => uploads).toBe(1);
    await blocked(page);
    expect(starts).toBe(0);
    release();
    await expect(page.getByRole('alert').filter({ hasText: '資料登録失敗テスト' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('Loading検証');
    failUpload = false;
    await page.getByLabel('資料ファイル').setInputFiles(file);
    await expect(page.getByRole('button', { name: 'loading.txtを取り除く' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    hold();
    holdSave = true;
    await page.getByRole('button', { name: 'loading.txtを取り除く' }).click();
    await blocked(page);
    release();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'loading.txtを取り除く' })).toHaveCount(0);
    holdSave = false;
    hold();
    // 同一イベント内の連打でも、開始リクエストは一度だけです。
    await page
      .getByRole('button', { name: '会議を始める', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect.poll(() => starts).toBe(1);
    await blocked(page);
    expect(uploads).toBe(2);
    expect(starts).toBe(1);
    release();
    await expect(page.getByRole('heading', { name: 'Loading検証' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  } finally {
    release();
  }
});

for (const action of ['開く', '削除']) {
  test(`履歴を${action}前の保存待ち・失敗・再試行`, async ({ page, request }) => {
    const source = await (
      await request.post('http://127.0.0.1:4320/api/sessions', { data: {} })
    ).json();
    const target = await (
      await request.post('http://127.0.0.1:4320/api/sessions', { data: { title: '対象の会議' } })
    ).json();
    let release = () => {};
    let fail = true;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deletes = 0;
    await page.route('http://127.0.0.1:4319/**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET' && req.url().endsWith('/api/sessions')) {
        await route.fulfill({ json: [{ ...target, status: 'ended', hasMinutes: false }] });
        return;
      }
      if (req.method() === 'PUT') {
        await gate;
        if (fail) {
          await route.fulfill({ status: 500, json: { error: '移動前の保存失敗テスト' } });
          return;
        }
      }
      if (req.method() === 'DELETE') deletes++;
      await route.continue({ url: req.url().replace(':4319', ':4320') });
    });
    try {
      await page.goto(`/session/?id=${source.id}`);
      await page.getByLabel('タイトル', { exact: true }).fill('保持する編集');
      const button =
        action === '開く'
          ? page.getByRole('link', { name: '対象の会議', exact: true })
          : page.getByRole('button', { name: '対象の会議を削除', exact: true });
      await button.evaluate((element: HTMLElement) => {
        element.click();
        element.click();
      });
      await blocked(page);
      expect(deletes).toBe(0);
      release();
      await expect(
        page.getByRole('alert').filter({ hasText: '移動前の保存失敗テスト' }).first(),
      ).toBeVisible();
      await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
      await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('保持する編集');
      expect(new URL(page.url()).searchParams.get('id')).toBe(source.id);
      fail = false;
      if (action === '削除') page.once('dialog', (dialog) => dialog.accept());
      await button.click();
      if (action === '開く') await expect(page).toHaveURL(`/session/?id=${target.id}`);
      else {
        await expect(page.getByRole('link', { name: '対象の会議', exact: true })).toHaveCount(0);
        expect(deletes).toBe(1);
      }
    } finally {
      release();
    }
  });
}
