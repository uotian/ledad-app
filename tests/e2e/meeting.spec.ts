import { test, expect, type Page } from '@playwright/test';
// 実APIを使うテストです。通常の単体テストとは分け、専用データ保存先で実行します。
const service = 'http://127.0.0.1:4320';
async function saved(page: Page) {
  const id = new URL(page.url()).searchParams.get('id');
  return (await page.request.get(`${service}/api/sessions/${id}`)).json();
}
test.beforeEach(async ({ context }) => {
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    await route.continue({ url: route.request().url().replace(':4319', ':4320') });
  });
});
test('会議: 初回の会議から候補・発話・利用記録・議事録へ進む', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('E2E: Audience');
  await page.getByRole('button', { name: '会議を始める', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E: Audience' })).toBeVisible();
  await page.getByRole('button', { name: '会話を手入力で追加' }).click();
  await page
    .getByLabel('会話を手入力', { exact: true })
    .fill('試験導入は来月に予定しています。導入費用はまだ決まっていません。');
  await page.getByRole('button', { name: '会話を追加', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page
    .getByLabel('AIへの相談')
    .fill('費用はもう決まっていますか？PRIVATE_ONLY_42は私的メモなので発言に入れない。');
  await page.getByRole('button', { name: '相談を送信' }).click();
  await expect(page.locator('.chat-reply-content')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Ask', exact: true }).click();
  await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('確認すべき点を聞きたい');
  await page.getByRole('button', { name: '発言案を作る', exact: true }).click();
  await expect(page.locator('.candidate-card').first()).toBeVisible();
  expect((await saved(page)).utterances).toHaveLength(0);
  await page.getByRole('button', { name: '候補1を読み上げる', exact: true }).click();
  await expect
    .poll(async () =>
      (await saved(page)).utterances.some((u: { status: string }) => u.status === 'completed'),
    )
    .toBe(true);
  const session = await saved(page);
  const usage = await (await page.request.get(`${service}/api/usage`)).json();
  expect(
    usage.some(
      (r: { sessionId: string; operation: string; status: string }) =>
        r.sessionId === session.id && r.operation === 'speech' && r.status === 'completed',
    ),
  ).toBe(true);
  await page
    .locator('.session-controls')
    .getByRole('button', { name: '停止', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '会話の流れ' })).toBeVisible();
  await page
    .locator('.session-controls')
    .getByRole('button', { name: '終了', exact: true })
    .click();
  await page.getByRole('button', { name: '記録を作成する', exact: true }).click();
  await expect(page.getByRole('heading', { name: '会議の要点' })).toBeVisible();
  const ended = await saved(page);
  expect(ended.status).toBe('ended');
  expect(JSON.stringify(ended.minutes)).not.toContain('PRIVATE_ONLY_42');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('group', { name: '画面の表示' })).toHaveCount(0);
  await page.getByRole('button', { name: '設定を閉じる' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/e2e-audience-records.png' });
});
