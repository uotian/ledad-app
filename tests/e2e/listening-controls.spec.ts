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

test('聞き取り停止後も回答生成・チャット・読み上げが完了し、終了で初めて記録へ進む', async ({
  page,
  context,
  request,
}) => {
  const session = await (
    await request.post(`${service}/api/sessions`, { data: { mode: 'audience' } })
  ).json();
  session.status = 'active';
  session.settings.language = 'en';
  session.startedAt = new Date().toISOString();
  session.transcripts = [
    {
      id: crypto.randomUUID(),
      text: '導入日程を確認します。',
      translation: '',
      timestamp: session.startedAt,
      source: 'display',

      analyzed: true,
      disposition: 'open',
    },
  ];
  const candidate = {
    id: crypto.randomUUID(),
    title: '確認する',
    text: '確認します。',
    spokenText: 'Let me confirm that.',

    caution: '',
    targetId: null,
    createdAt: session.startedAt,
    status: 'ready',
  };
  session.candidates = [candidate];
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let consulted = false;
  let generated = false;
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/speech')) {
      expect(route.request().postDataJSON()).toMatchObject({
        text: candidate.spokenText,
        language: 'en',
      });
      await expect(page.locator('.audio-state small')).toHaveCount(0);
      await route.fulfill({ body: silentWav(10), contentType: 'audio/wav' });
    } else if (url.endsWith('/minutes')) {
      await route.fulfill({
        json: { summary: ['会議の要約'], decisions: [], actions: [], questions: [], caveats: [] },
      });
    } else if (url.endsWith('/analyze')) {
      await route.fulfill({ status: 503, json: { error: 'Analyze test unavailable' } });
    } else if (url.endsWith('/consult?stream=true')) {
      consulted = true;
      await gate;
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          JSON.stringify({
            status: 200,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({ reply: '聞き取り停止後も回答を完了しました。' }),
            ).toString('base64'),
          }) + '\n',
      });
    } else if (url.endsWith('/generate')) {
      generated = true;
      await gate;
      await route.fulfill({
        json: {
          note: '',
          candidates: [{ ...candidate, title: '停止後の候補' }],
        },
      });
    } else await route.continue({ url: url.replace(':4319', ':4320') });
  });
  const saved = async () => (await request.get(`${service}/api/sessions/${session.id}`)).json();
  try {
    await page.goto(`/session/?id=${session.id}`);
    await expect(page.getByText('あなただけに表示', { exact: true })).toHaveCount(0);
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '再開', exact: true })
      .click();
    await expect(
      page.locator('.session-controls').getByRole('button', { name: '終了', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.audio-state-icon .input-meter i')).toHaveCount(5);
    await expect(page.locator('.listening-controls .input-meter')).toHaveCount(0);
    await expect(page.locator('.input-meter')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('.session-controls').getByRole('timer')).toHaveCount(0);
    await expect(page.locator('.meeting-header .elapsed')).toBeVisible();
    await expect(page.locator('.session-action-stop')).toHaveCSS(
      'background-color',
      'rgb(164, 61, 56)',
    );
    await expect(page.locator('.meeting-main')).toHaveCSS('padding-left', '12px');
    await expect(page.locator('.meeting-main')).toHaveCSS('padding-right', '12px');
    await page
      .locator('.session-controls')
      .screenshot({ path: 'artifacts/listening-controls.png' });
    await page.getByRole('tab', { name: 'Ask', exact: true }).click();
    const speechArea = page.locator('.candidate-speech');
    await expect(speechArea).toContainText(candidate.spokenText);
    await page.getByRole('button', { name: '候補1を読み上げる', exact: true }).click();
    await expect.poll(async () => (await saved()).utterances[0]?.status).toBe('playing');
    await page.getByRole('button', { name: '候補1の読み上げを停止', exact: true }).click();
    await expect.poll(async () => (await saved()).utterances[0]?.status).toBe('interrupted');
    await page.getByRole('button', { name: '候補1の読み上げを再開', exact: true }).click();
    await expect.poll(async () => (await saved()).utterances[0]?.status).toBe('playing');
    expect((await saved()).utterances).toHaveLength(1);
    await expect(page.locator('.audio-state strong')).toHaveText('Live聞き取り中');
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await page.getByLabel('AIへの相談').fill('会話を整理して');
    await page.getByRole('button', { name: '相談を送信' }).click();
    await expect.poll(() => consulted).toBe(true);
    await page.getByRole('tab', { name: 'Ask', exact: true }).click();
    await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('確認すべき点を聞きたい');
    await page.getByRole('button', { name: '発言案を作る', exact: true }).click();
    await expect.poll(() => generated).toBe(true);
    await expect(
      page.getByRole('button', { name: '候補1の読み上げを停止', exact: true }),
    ).toBeEnabled();
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '停止', exact: true })
      .click();
    await expect(
      page.locator('.session-controls').getByRole('button', { name: '再開', exact: true }),
    ).toBeEnabled();
    expect(await saved()).toMatchObject({ status: 'active', endedAt: null });
    await expect(page.locator('.input-meter')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('.audio-state strong')).toHaveText('Live聞き取り停止中');
    await expect(page.locator('.session-action-resume')).toHaveCSS(
      'background-color',
      'rgb(40, 95, 166)',
    );
    await expect(page.locator('.session-action-finish')).toHaveCSS(
      'background-color',
      'rgb(40, 112, 75)',
    );
    expect((await saved()).utterances[0].status).toBe('playing');
    await expect(
      page.locator('.session-controls').getByRole('button', { name: '終了', exact: true }),
    ).toBeDisabled();
    release();
    await expect(page.getByText('停止後の候補', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.locator('.chat-reply-content')).toHaveText(
      '聞き取り停止後も回答を完了しました。',
    );
    await expect.poll(async () => (await saved()).utterances[0].status).toBe('completed');
    expect((await saved()).chats[0].status).toBe('applied');
    await expect(
      page.locator('.session-controls').getByRole('button', { name: '終了', exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: 'artifacts/listening-stopped-chat.png' });
    await page
      .locator('.session-controls')
      .screenshot({ path: 'artifacts/listening-stopped-dark.png' });
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '再開', exact: true })
      .click();
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '停止', exact: true })
      .click();
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '終了', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: '会議の記録', exact: true })).toBeVisible();
    await expect.poll(async () => (await saved()).status).toBe('ended');
  } finally {
    release();
    await page.close();
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
