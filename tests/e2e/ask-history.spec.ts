import { expect, test } from '@playwright/test';

const service = 'http://127.0.0.1:4320';

function silentWav(seconds: number) {
  const bytes = 16000 * seconds * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF');
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

test('発話カードを完了・再生成・再読込後も残し、再発話できる', async ({
  page,
  context,
  request,
}) => {
  const session = await (
    await request.post(`${service}/api/sessions`, { data: { title: '発話履歴' } })
  ).json();
  session.status = 'active';
  session.startedAt = new Date().toISOString();
  session.settings.language = 'en';
  const candidate = {
    id: crypto.randomUUID(),
    title: '履歴に残す発言',
    text: '確認します。',
    spokenText: 'Let me confirm.',
    translationLanguage: 'ja',
    caution: '',
    targetId: null,
    createdAt: session.startedAt,
    status: 'ready',
  };
  session.candidates = [candidate];
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  let fail = false;
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/speech'))
      await route.fulfill(
        fail
          ? { status: 503, json: { error: 'テストの音声エラー' } }
          : { body: silentWav(1), contentType: 'audio/wav' },
      );
    else if (url.endsWith('/generate'))
      await route.fulfill({
        json: {
          note: '',
          candidates: [
            {
              title: '新しい候補',
              text: '次です。',
              spokenText: 'Next.',
              translationLanguage: 'ja',
              caution: '',
            },
          ],
        },
      });
    else await route.continue({ url: url.replace(':4319', ':4320') });
  });
  const saved = async () => (await request.get(`${service}/api/sessions/${session.id}`)).json();
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('tab', { name: 'Ask', exact: true }).click();
    const card = page.locator('.candidate-card').filter({ hasText: '履歴に残す発言' });
    await card.getByRole('button', { name: '候補1を読み上げる', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('発話済み');
    await expect(card).toContainText('Let me confirm.');
    await expect(card).toContainText('確認します。');
    await expect(card.locator('.candidate-edit-toggle')).toHaveCount(0);
    await expect.poll(async () => (await saved()).utterances[0]?.status).toBe('completed');
    await card.getByRole('button', { name: '候補1をもう一度読み上げる' }).click();
    await expect.poll(async () => (await saved()).utterances.length).toBe(2);
    await expect(card.getByRole('status')).toHaveText('発話済み');
    await page.reload();
    await page.getByRole('tab', { name: 'Ask', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('発話済み');
    await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('次の発言');
    await page.getByRole('textbox', { name: 'Askへの依頼' }).press('Enter');
    await expect(page.locator('.candidate-card')).toHaveCount(2);
    await expect(card.getByRole('status')).toHaveText('発話済み');
    fail = true;
    await card.getByRole('button', { name: '候補1をもう一度読み上げる' }).click();
    await expect(card.getByRole('status')).toHaveText('読み上げ失敗');
    await page.reload();
    await page.getByRole('tab', { name: 'Ask', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('読み上げ失敗');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
