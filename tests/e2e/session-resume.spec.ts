import { expect, test } from '@playwright/test';

const service = 'http://127.0.0.1:4320';
for (const mode of ['audience', 'presenter'] as const) {
  test(`${mode}: 停止は再開可能、終了は自動要約し失敗後も再開不可`, async ({
    page,
    context,
    request,
  }) => {
    const session = await (await request.post(`${service}/api/sessions`, { data: {} })).json();
    session.mode = mode; // Legacy Presenter records open as ordinary meetings.
    session.status = 'active';
    session.startedAt = new Date().toISOString();
    session.transcripts = [
      {
        id: crypto.randomUUID(),
        text: '再開前の会話です。',
        translation: '',
        timestamp: session.startedAt,
        source: 'manual',

        analyzed: true,
        disposition: 'open',
      },
    ];
    await request.put(`${service}/api/sessions/${session.id}`, { data: session });
    let speechRequests = 0;
    let minutesRequests = 0;
    await context.route('http://127.0.0.1:4319/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/speech')) speechRequests++;
      if (url.endsWith('/minutes')) {
        minutesRequests++;
        if (minutesRequests === 1) {
          await route.fulfill({ status: 502, json: { error: '要約失敗テスト' } });
          return;
        }
        await route.fulfill({
          json: {
            summary: ['再開前の要約'],
            decisions: [],
            actions: [],
            questions: [],
            caveats: [],
          },
        });
      } else if (url.endsWith('/translate')) {
        await route.fulfill({ json: { translation: '' } });
      } else await route.continue({ url: url.replace(':4319', ':4320') });
    });
    const saved = async () => (await request.get(`${service}/api/sessions/${session.id}`)).json();
    try {
      await page.goto(`/session/?id=${session.id}`);
      await page
        .locator('.session-controls')
        .getByRole('button', { name: '再開', exact: true })
        .click();
      await page
        .locator('.session-controls')
        .getByRole('button', { name: '停止', exact: true })
        .click();
      await expect(page.getByRole('region', { name: '会話の流れ' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '会議の記録', exact: true })).toHaveCount(0);
      await expect(
        page.locator('.session-controls').getByRole('button', { name: '再開', exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole('button', { name: '会話を手入力で追加' })).toBeEnabled();
      await expect.poll(async () => (await saved()).status).toBe('active');
      expect((await saved()).endedAt).toBeNull();
      expect(minutesRequests).toBe(0);
      await page.screenshot({ path: `artifacts/meeting-ended-${mode}.png` });
      await page
        .locator('.session-controls')
        .getByRole('button', { name: '終了', exact: true })
        .click();
      await expect.poll(async () => (await saved()).status).toBe('ended');
      await expect(page.getByRole('button', { name: '記録を作成する', exact: true })).toBeVisible();
      expect(minutesRequests).toBe(1);
      await page.getByRole('button', { name: `「${session.title}」に戻る` }).click();
      await expect(
        page.locator('.session-controls').getByRole('button', { name: '再開', exact: true }),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.locator('.session-controls').getByRole('button', { name: '再開', exact: true }),
      ).toHaveCount(0);
      expect((await saved()).transcripts).toHaveLength(1);
      await page.getByRole('button', { name: '会議の記録を見る' }).click();
      await page.getByRole('button', { name: '記録を作成する', exact: true }).click();
      await expect(page.getByText('再開前の要約', { exact: true })).toBeVisible();
      expect(minutesRequests).toBe(2);
      expect((await saved()).status).toBe('ended');
      expect(speechRequests).toBe(0);
      await page.getByRole('link', { name: 'ledad ホーム' }).click();
      await expect(page).toHaveURL('/');
      await expect(
        page
          .locator(`.session-link[href="/session/?id=${session.id}"]`)
          .getByRole('img', { name: '要約済み' }),
      ).toBeVisible();
    } finally {
      await request.delete(`${service}/api/sessions/${session.id}`);
    }
  });
}
