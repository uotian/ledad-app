import { preparedDocument, uploadedDocument } from './document-fixture';
import { expect, test, type Page } from '@playwright/test';

async function files(page: Page, names = ['参考資料.txt', '議題.md']) {
  return page.evaluateHandle((names) => {
    const transfer = new DataTransfer();
    for (const name of names) {
      transfer.items.add(new File(['会議の参考資料です。'], name, { type: 'text/plain' }));
    }
    return transfer;
  }, names);
}

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.route('**/api/sessions/*/documents', uploadedDocument);
  await page.route('**/api/sessions/*/document-reference', preparedDocument);
  await page.goto('/');
  await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
});

test('資料モーダルで下書きと聞き取りを保持する', async ({ page }, testInfo) => {
  await page.route('**/api/sessions/*/minutes', (route) =>
    route.fulfill({
      json: { summary: [], decisions: [], actions: [], questions: [], caveats: [] },
    }),
  );
  await page.getByRole('button', { name: '会議を始める', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '資料', exact: true });
  const docs = page.getByRole('button', { name: '資料', exact: true });
  await expect(docs).toHaveText('0ファイル');
  await expect(docs).toHaveCSS('border-top-style', 'none');
  const apiTrigger = page.locator('.provider-cost').first();
  for (const property of ['padding', 'font-size', 'border-radius', 'gap', 'color']) {
    const value = await apiTrigger.evaluate(
      (element, key) => getComputedStyle(element).getPropertyValue(key),
      property,
    );
    await expect(docs).toHaveCSS(property, value);
  }
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('AIへの相談').fill('相談の下書き');
  await page.getByRole('tab', { name: 'Ask', exact: true }).click();
  await page.getByLabel('Askへの依頼').fill('質問の下書き');
  await docs.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.meeting-grid')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await expect(page.locator('.audio-state')).toHaveAttribute('data-state', 'listening');
  for (const width of [1440, 980, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.locator('body').evaluate((e) => e.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(dialog).toBeInViewport();
    expect(await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.session-controls')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`docs-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(docs).toBeFocused();
  await expect(page.getByLabel('Askへの依頼')).toHaveValue('質問の下書き');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('AIへの相談')).toHaveValue('相談の下書き');
  await expect(page.locator('.audio-state')).toHaveAttribute('data-state', 'listening');
  const transfer = await files(page, ['モーダル.txt']);
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(docs).toHaveText('1ファイル');
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await expect(dialog).not.toBeVisible();
  await docs.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('group', { name: 'モーダル.txt', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  const more = await files(page, ['追加.txt']);
  await dialog.dispatchEvent('dragenter', { dataTransfer: more });
  await expect(dialog.locator('.document-drop-overlay')).toBeVisible();
  await dialog.dispatchEvent('drop', { dataTransfer: more });
  await expect(docs).toHaveText('2ファイル');
  await expect(dialog).not.toBeVisible();
  await docs.click();
  await expect(dialog.getByRole('group', { name: '追加.txt', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page
    .locator('.session-controls')
    .getByRole('button', { name: '停止', exact: true })
    .click();
  await page
    .locator('.session-controls')
    .getByRole('button', { name: '終了', exact: true })
    .click();
  await page.getByRole('button', { name: /「.*」に戻る/ }).click();
  await expect(docs).toBeEnabled();
  await expect(dialog).not.toBeVisible();
  await docs.click();
  await expect(dialog.getByRole('group', { name: 'モーダル.txt', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('資料ファイル')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'ファイルを選んで登録' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'モーダル.txtを取り除く' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '要約・用語集を作成' })).toHaveCount(0);
  await expect(dialog.getByText('会議の参考資料です。', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Ledad', { exact: true })).toBeVisible();
  let uploads = 0;
  await page.route('**/api/sessions/*/documents', async (route) => {
    uploads++;
    await uploadedDocument(route);
  });
  const blocked = await files(page, ['終了後.txt']);
  await dialog.dispatchEvent('drop', { dataTransfer: blocked });
  await dialog.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(['image'], '終了後.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.locator('body').dispatchEvent('drop', { dataTransfer: blocked });
  await expect(docs).toHaveText('2ファイル');
  expect(uploads).toBe(0);
});

test('資料欄を閉じたまま画面全体でドロップし、複数資料を保存する', async ({ page }, testInfo) => {
  const title = page.getByLabel('タイトル', { exact: true });
  await title.fill('ドロップの会議');
  const details = page.locator('.home-documents');
  await expect(details).not.toHaveAttribute('open');
  const dataTransfer = await files(page);
  const overlay = page.getByRole('status').filter({ hasText: 'ドロップして資料を追加' });
  await page.locator('body').dispatchEvent('dragenter', { dataTransfer });
  await expect(overlay).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('drop-desktop.png') });
  // 子要素をまたいでも案内が消えず、ウィンドウから出ると消えます。
  await title.dispatchEvent('dragenter', { dataTransfer });
  await page.locator('body').dispatchEvent('dragleave', { dataTransfer });
  await expect(overlay).toBeVisible();
  await title.dispatchEvent('dragleave', { dataTransfer });
  await expect(overlay).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('body').dispatchEvent('dragenter', { dataTransfer });
  await expect(overlay).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('drop-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 960 });
  // ドロップ終了後にFileListが空になっても、保存待ちでファイルを失いません。
  await page.locator('.sidebar').evaluate((element, transfer) => {
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    transfer.items.clear();
  }, dataTransfer);
  await expect(overlay).toHaveCount(0);
  await expect(details).toHaveAttribute('open');
  await expect(page.getByRole('button', { name: '参考資料.txtを取り除く' })).toBeVisible();
  await expect(page.getByRole('button', { name: '議題.mdを取り除く' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await expect(title).toHaveValue('ドロップの会議');
  const document = page.getByRole('group', { name: '参考資料.txt', exact: true });
  await expect(document.locator('.document-file')).toHaveText('参考資料.txt1 KB');
  await expect(document.getByRole('checkbox')).toHaveCount(0);
  await expect(document.locator('.document-usage-note')).toHaveCount(0);
  await expect(document.locator('summary')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('uploaded-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.document-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('uploaded-narrow.png') });
  await expect(page).toHaveURL(/id=/);
  await page.reload();
  await page.locator('.home-documents > summary').click();
  await expect(page.getByRole('button', { name: '参考資料.txtを取り除く' })).toBeVisible();
  await expect(page.getByRole('button', { name: '議題.mdを取り除く' })).toBeVisible();
  await expect(document.getByRole('checkbox')).toHaveCount(0);
  await expect(document.locator('.document-usage-note')).toHaveCount(0);
});

test('文字のドラッグを無視し、不正な資料の後もクリックで登録できる', async ({ page }) => {
  const text = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '移動する文字');
    return transfer;
  });
  await page.locator('body').dispatchEvent('dragenter', { dataTransfer: text });
  await expect(page.locator('.document-drop-overlay')).toHaveCount(0);
  const invalid = await files(page, ['未対応.docx']);
  await page
    .getByLabel('タイトル', { exact: true })
    .dispatchEvent('drop', { dataTransfer: invalid });
  await expect(
    page.getByRole('alert').filter({ hasText: 'PDF・PPT・画像・TXT・Markdownに対応しています。' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  const button = page.getByRole('button', { name: /ファイルを選んで登録/ });
  await button.focus();
  await page.keyboard.press('Enter');
  await (
    await chooser
  ).setFiles({
    name: '選択.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('クリックで登録した資料'),
  });
  await expect(page.getByRole('button', { name: '選択.txtを取り除く' })).toBeVisible();
});

test('処理中と設定ダイアログ中のドロップを受け付けない', async ({ page }, testInfo) => {
  let uploads = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/sessions/*/documents', async (route) => {
    uploads++;
    await pending;
    await uploadedDocument(route);
  });
  const first = await files(page, ['一つ目.txt']);
  const second = await files(page, ['二つ目.txt']);
  try {
    await page.locator('body').dispatchEvent('drop', { dataTransfer: first });
    await expect.poll(() => uploads).toBe(1);
    await page.locator('body').dispatchEvent('dragenter', { dataTransfer: second });
    await expect(page.locator('.document-drop-overlay')).toHaveCount(0);
    await page.locator('body').dispatchEvent('drop', { dataTransfer: second });
    release();
    await expect(page.getByRole('button', { name: '一つ目.txtを取り除く' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await page.getByRole('button', { name: 'AI接続設定を開く' }).click();
    await expect(page.locator('.settings-dialog')).toBeVisible();
    await page.locator('.settings-dialog').dispatchEvent('dragenter', { dataTransfer: second });
    await expect(page.locator('.document-drop-overlay')).toHaveCount(0);
    await page.locator('.settings-dialog').dispatchEvent('drop', { dataTransfer: second });
    expect(uploads).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '二つ目.txtを取り除く' })).toHaveCount(0);
    await page.getByRole('button', { name: '会議を始める', exact: true }).click();
    await expect(page.locator('.home-preparation')).toHaveCount(0);
    await page.locator('.app-shell').dispatchEvent('dragenter', { dataTransfer: second });
    await expect(page.locator('.document-drop-overlay')).toBeVisible();
    await page.locator('.app-shell').dispatchEvent('drop', { dataTransfer: second });
    await expect(
      page.getByRole('button', { name: '二つ目.txtを取り除く', includeHidden: true }),
    ).toBeAttached();
    expect(uploads).toBe(2);
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await expect(page.locator('.session-controls')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('meeting-documents.png') });
  } finally {
    release();
  }
});

test('貼り付けた画像は開始時に参照文と用語集を生成する', async ({ page }) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['image-fixture'], '共有画面.png', { type: 'image/png' }));
    document.body.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  const uploaded = page.getByRole('group', { name: '共有画面.png', exact: true });
  await expect(uploaded).toBeVisible();
  await expect(uploaded.locator('.document-usage-note')).toHaveCount(0);
  await page.getByRole('button', { name: '会議を始める', exact: true }).click();
  await page.getByRole('button', { name: '資料', exact: true }).click();
  await expect(
    page.locator('.document-results > .document-reference').getByText('Ledad', { exact: true }),
  ).toBeVisible();
});

test('開始時に全資料をまとめて生成し、失敗・再読込後に再試行する', async ({ page }) => {
  // Upload real files to the local backend; only the paid preparation is mocked.
  await page.unroute('**/api/sessions/*/documents', uploadedDocument);
  const prepared: string[] = [];
  let starts = 0;
  let fail = true;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/sessions/*/commands', async (route) => {
    if (route.request().postDataJSON().command.type === 'start') starts++;
    await route.fallback();
  });
  await page.route('**/api/sessions/*/document-reference', async (route) => {
    prepared.push(route.request().url());
    await gate;
    if (fail) {
      await route.fulfill({ status: 502, json: { error: '資料生成失敗テスト' } });
    } else await preparedDocument(route);
  });
  try {
    await page.locator('.home-documents > summary').click();
    await page.getByLabel('資料ファイル').setInputFiles(
      ['first.txt', 'second.txt'].map((name) => ({
        name,
        mimeType: 'text/plain',
        buffer: Buffer.from('会議資料です。'),
      })),
    );
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await expect(page.locator('.document-item')).toHaveCount(2);
    await expect(page.locator('.document-usage-note')).toHaveCount(0);
    expect(prepared).toHaveLength(0);
    const id = new URL(page.url()).searchParams.get('id');
    const saved = async () =>
      (await page.request.get(`http://127.0.0.1:4320/api/sessions/${id}`)).json();
    expect((await saved()).pricing).toBeNull();
    await page.getByRole('button', { name: '会議を始める', exact: true }).click();
    await expect.poll(() => prepared.length).toBe(1);
    await expect(page.getByRole('dialog', { name: '処理中' })).toBeVisible();
    expect(starts).toBe(0);
    expect((await saved()).status).toBe('preparing');
    release();
    await expect(
      page.getByRole('alert').filter({ hasText: '資料生成失敗テスト' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    expect(starts).toBe(0);
    expect(
      (await saved()).documents.map((d: { preparationPending: boolean }) => d.preparationPending),
    ).toEqual([true, true]);
    await page.reload();
    fail = false;
    await page.getByRole('button', { name: '会議を始める', exact: true }).click();
    await expect(page.locator('.home-preparation')).toHaveCount(0);
    expect(starts).toBe(1);
    expect(prepared).toHaveLength(2);
    expect(prepared[1]).toBe(prepared[0]);
    expect(
      (await saved()).documents.every(
        (d: { preparationPending: boolean }) => !d.preparationPending,
      ),
    ).toBe(true);
    // A failed upload-time preparation during the meeting keeps its original for retry.
    fail = true;
    await page.getByRole('button', { name: '資料', exact: true }).click();
    await page.getByLabel('資料ファイル').setInputFiles({
      name: 'third.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('追加資料です。'),
    });
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await page.getByRole('button', { name: '資料', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '要約・用語集を作成', exact: true }),
    ).toBeVisible();
    const latest = await saved();
    const document = latest.documents.find((d: { name: string }) => d.name === 'third.txt');
    expect(
      (
        await page.request.get(`http://127.0.0.1:4320/api/sessions/${id}/documents/${document.id}`)
      ).ok(),
    ).toBe(true);
    fail = false;
    await page.getByRole('button', { name: '要約・用語集を作成', exact: true }).click();
    await page.getByRole('button', { name: '資料', exact: true }).click();
    await expect(
      page.locator('.document-results > .document-reference').getByText('Ledad', { exact: true }),
    ).toBeVisible();
    expect((await saved()).status).toBe('active');
  } finally {
    release();
  }
});

test('会議中の一括追加・削除で共通結果を更新し、API上限超過から再試行できる', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: '会議を始める', exact: true }).click();
  await page.getByRole('button', { name: '資料', exact: true }).click();
  let preparations = 0;
  let limit = true;
  await page.route('**/api/sessions/*/document-reference', async (route) => {
    preparations++;
    if (limit)
      await route.fulfill({
        status: 413,
        json: {
          error: '資料全体がAPIの入力上限を超えました。資料を減らして再試行してください。',
        },
      });
    else await preparedDocument(route);
  });
  await page.getByLabel('資料ファイル').setInputFiles(
    ['a.txt', 'b.txt'].map((name) => ({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('資料'),
    })),
  );
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await page.getByRole('button', { name: '資料', exact: true }).click();
  await expect(page.locator('.document-item')).toHaveCount(2);
  expect(preparations).toBe(1);
  await expect(
    page.getByRole('alert').filter({ hasText: '入力上限を超えました' }).first(),
  ).toBeVisible();
  await expect(page.locator('.document-results > .document-reference')).toHaveCount(0);
  limit = false;
  await page.getByRole('button', { name: 'a.txtを取り除く' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await page.getByRole('button', { name: '資料', exact: true }).click();
  await expect(page.locator('.document-item')).toHaveCount(1);
  expect(preparations).toBe(2);
  await expect(page.getByRole('alert').filter({ hasText: '入力上限を超えました' })).toHaveCount(0);
  const reference = page.locator('.document-results > .document-reference');
  await expect(reference).toHaveCount(2);
  await expect(page.locator('.document-results details')).toHaveCount(0);
  await expect(reference.getByRole('heading', { name: '要約', exact: true })).toBeVisible();
  await expect(reference.getByText('Ledad', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('shared-documents-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reference.first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('shared-documents-narrow.png') });
  await page.getByRole('button', { name: 'b.txtを取り除く' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
  await page.getByRole('button', { name: '資料', exact: true }).click();
  await expect(page.locator('.document-item')).toHaveCount(0);
  await expect(reference).toHaveCount(0);
  expect(preparations).toBe(3);
});

test('資料の生成待ちでもモーダルを閉じて会話と下書きを保持する', async ({ page }) => {
  await page.locator('.home-documents > summary').click();
  await page.getByLabel('資料ファイル').setInputFiles({
    name: 'first.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('資料'),
  });
  await expect(page.locator('.document-item')).toHaveCount(1);
  await page.getByRole('button', { name: '会議を始める', exact: true }).click();
  const docs = page.getByRole('button', { name: '資料', exact: true });
  const dialog = page.getByRole('dialog', { name: '資料', exact: true });
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('AIへの相談').fill('更新中も残す下書き');
  let release = () => {};
  let preparing = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/sessions/*/document-reference', async (route) => {
    preparing = true;
    await gate;
    await preparedDocument(route);
  });
  await page.route('**/api/sessions/*/translate', (route) =>
    route.fulfill({ status: 502, json: { error: 'test' } }),
  );
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 502, json: { error: 'test' } }),
  );
  const id = new URL(page.url()).searchParams.get('id');
  const saved = async () =>
    (await page.request.get(`http://127.0.0.1:4320/api/sessions/${id}`)).json();
  try {
    await docs.click();
    await page.getByLabel('資料ファイル').setInputFiles({
      name: 'second.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('追加資料'),
    });
    await expect.poll(() => preparing).toBe(true);
    await expect(dialog).not.toBeVisible();
    await expect(docs).toHaveAttribute('aria-busy', 'true');
    await expect(docs).toBeDisabled();
    await expect(docs).toHaveText('2ファイル');
    await expect(page.getByRole('dialog', { name: '処理中' })).not.toBeVisible();
    await expect(page.locator('.audio-state')).toHaveAttribute('data-state', 'listening');
    await page.getByLabel('AIへの相談').fill('更新中でも編集できます');
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('ledad:test-final-transcript', {
          detail: { text: '資料の生成中も会話を保存します。' },
        }),
      ),
    );
    await expect.poll(async () => (await saved()).transcripts.length).toBe(1);
    expect((await saved()).documentReference.documentIds).toHaveLength(1);
    release();
    await expect(docs).toBeEnabled();
    await expect(docs).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByLabel('AIへの相談')).toHaveValue('更新中でも編集できます');
    await expect.poll(async () => (await saved()).documentReference.documentIds.length).toBe(2);
    expect((await saved()).transcripts).toHaveLength(1);
  } finally {
    release();
  }
});
