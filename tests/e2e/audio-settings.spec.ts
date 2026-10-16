import { preparedDocument } from './document-fixture';
import { expect, test } from '@playwright/test';

const service = 'http://127.0.0.1:4320';
test.beforeEach(async ({ context }) => {
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    if (route.request().url().endsWith('/translate')) {
      await route.fulfill({ json: { translation: '' } });
      return;
    }
    await route.continue({ url: route.request().url().replace(':4319', ':4320') });
  });
});

test('PC音声を初期選択し、デバイス選択なしで入力元を保存・切替できる', async ({
  page,
  request,
}) => {
  const session = await (
    await request.post(`${service}/api/sessions`, {
      data: { mode: 'audience', title: '音声設定の確認' },
    })
  ).json();
  await request.put(`${service}/api/sessions/${session.id}`, {
    data: {
      ...session,
      settings: {
        ...session.settings,
        input: 'display',
        listeningLimitMinutes: 30,
        fixIntervalSeconds: 60,
        vadSilenceMs: 100,
      },
    },
  });
  try {
    await page.goto(`/session/?id=${session.id}`);
    const input = page.getByRole('combobox', { name: '聞き取り音声の入力元', exact: true });
    await expect(input.locator('option')).toHaveText([
      'PCの音声＋マイク(Zoom)',
      'PCの音声(YouTube)',
      'マイクの音声(対面会議)',
    ]);
    await expect(input).toHaveValue('display');
    await expect(input).toHaveAccessibleDescription('');
    await expect(page.getByRole('combobox', { name: '音声の出力先' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '入力デバイス' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'デバイスを確認' })).toHaveCount(0);
    const audioSettings = page.locator('section').filter({ has: input });
    await expect(audioSettings.locator('.inline-note')).toHaveCount(0);
    await expect(audioSettings.locator('#audio-input-help')).toHaveCount(0);
    await expect(page.getByLabel('自動停止時間')).toHaveValue('30');
    await expect(page.getByLabel('自動停止時間').locator('option')).toHaveText([
      '10 min',
      '30 min',
      '60 min',
      '90 min',
    ]);
    await expect(page.getByText('詳細設定', { exact: true })).toHaveCount(0);
    await expect(page.locator('#fix-interval, #vad-silence')).toHaveCount(0);
    await expect(page.locator('.audio-settings-grid > .field')).toHaveCount(4);
    expect(
      await page
        .locator('.audio-settings-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    ).toBe(4);
    await page.screenshot({ path: 'output/playwright/fix-settings-desktop.png' });
    await page.setViewportSize({ width: 980, height: 900 });
    expect(
      await page
        .locator('.audio-settings-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    ).toBe(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'output/playwright/fix-settings-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByLabel('自動停止時間').selectOption('60');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${service}/api/sessions/${session.id}`)).json()).settings,
      )
      .toMatchObject({ listeningLimitMinutes: 60, fixIntervalSeconds: 60, vadSilenceMs: 100 });
    await page.reload();
    await expect(page.getByLabel('自動停止時間')).toHaveValue('60');

    await page.screenshot({ path: 'artifacts/audio-settings-pc.png' });
    await input.selectOption('microphone');
    await expect(input).toHaveAccessibleDescription('');
    await expect(audioSettings.locator('#audio-input-help')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '入力デバイス' })).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get(`${service}/api/sessions/${session.id}`)).json()).settings
            .input,
      )
      .toBe('microphone');
    await page.reload();
    await expect(input).toHaveValue('microphone');
    await page.screenshot({ path: 'artifacts/audio-settings-microphone.png' });
    await input.selectOption('mixed');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${service}/api/sessions/${session.id}`)).json()).settings
            .input,
      )
      .toBe('mixed');
    await page.reload();
    await expect(input).toHaveValue('mixed');
    await input.selectOption('display');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${service}/api/sessions/${session.id}`)).json()).settings
            .input,
      )
      .toBe('display');
    await page.reload();
    await expect(input).toHaveValue('display');
    await page.getByRole('button', { name: '会議を始める', exact: true }).click();
    await page.getByRole('button', { name: '会話を手入力で追加' }).click();
    await page.getByLabel('会話を手入力', { exact: true }).fill('聞き取れなかった内容の補足です。');
    await page.getByRole('button', { name: '会話を追加', exact: true }).click();
    await expect(page.getByText('手入力の記録')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get(`${service}/api/sessions/${session.id}`)).json()).transcripts[0]
            ?.source,
      )
      .toBe('manual');
    await page.getByRole('link', { name: 'ledad ホーム' }).click();
    await expect(page).toHaveURL('/');
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});

test('旧手入力・デバイス設定の下書きもホームで開け、音声は自動開始しない', async ({
  page,
  request,
  context,
}) => {
  const session = await (await request.post(`${service}/api/sessions`, { data: {} })).json();
  await request.put(`${service}/api/sessions/${session.id}`, {
    data: {
      ...session,
      settings: {
        ...session.settings,
        input: 'manual',
        microphoneId: 'old-input',
        outputId: 'old-output',
      },
    },
  });
  let audioConnections = 0;
  context.on('request', (request) => {
    if (request.url().includes('/live-token')) audioConnections++;
  });
  try {
    await page.goto(`/session/?id=${session.id}`);
    await expect(
      page.getByRole('combobox', { name: '聞き取り音声の入力元', exact: true }),
    ).toHaveValue('microphone');
    await expect(page.getByRole('combobox', { name: '入力デバイス' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '音声の出力先' })).toHaveCount(0);
    expect(audioConnections).toBe(0);
    await page.getByRole('link', { name: 'ledad ホーム' }).click();
    await expect(page).toHaveURL('/');
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});

test('ホームで準備し、資料と設定を保ったまま一度の操作で開始する', async ({ page, request }) => {
  const list = async () =>
    (await (await request.get(`${service}/api/sessions`)).json()) as { id: string }[];
  const before = new Set((await list()).map((s) => s.id));
  await page.route('**/api/sessions/*/document-reference', preparedDocument);
  let failStart = true;
  await page.route('**/api/sessions/*/commands', async (route) => {
    if (route.request().postDataJSON()?.command?.type === 'start' && failStart) {
      failStart = false;
      await route.fulfill({ status: 400, json: { error: '検証用の開始失敗' } });
    } else await route.fallback();
  });
  try {
    await page.goto('/');
    await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
    expect((await list()).map((s) => s.id).filter((id) => !before.has(id))).toEqual([]);
    await expect(page.getByRole('heading', { name: '会議の準備' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '声の種類' })).not.toBeVisible();
    await page.getByLabel('タイトル', { exact: true }).fill('ホームから直接開始');
    await page.getByRole('combobox', { name: '会議の言語', exact: true }).selectOption('en');
    await page.locator('summary').filter({ hasText: '資料の追加' }).click();
    await page.getByLabel('資料ファイル').setInputFiles({
      name: 'agenda.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('今日の議題は導入日程です。'),
    });
    await expect(page.getByText('agenda.txt', { exact: true })).toBeVisible();
    const start = page.getByRole('button', { name: '会議を始める', exact: true });
    await start.click();
    await expect(
      page.getByRole('alert').filter({ hasText: '検証用の開始失敗' }).first(),
    ).toBeVisible();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('ホームから直接開始');
    await expect(page.getByText('agenda.txt', { exact: true })).toBeVisible();
    await start.click();
    await expect(
      page.getByRole('heading', { name: 'ホームから直接開始', exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/session\/\?id=/);
    const id = new URL(page.url()).searchParams.get('id');
    const saved = await (await request.get(`${service}/api/sessions/${id}`)).json();
    expect(saved.status).toBe('active');
    expect(saved.startedAt).toBeTruthy();
    expect(saved.settings.language).toBe('en');
    expect(saved.documents[0]).toMatchObject({
      name: 'agenda.txt',
    });
    expect(saved.documentReference.summary).toContain('会議共通の参照文');
    expect((await list()).filter((s) => !before.has(s.id))).toHaveLength(1);
    await page.getByRole('link', { name: 'ledad ホーム' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('combobox', { name: '会議の言語', exact: true })).toHaveValue('en');
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('新しい会議');
    await expect(page.getByRole('link', { name: /ホームから直接開始/ }).first()).toBeVisible();
  } finally {
    for (const session of await list())
      if (!before.has(session.id)) await request.delete(`${service}/api/sessions/${session.id}`);
  }
});

test('ホームで保存した下書きを再読込でき、すべて削除後も新しく準備できる', async ({
  page,
  request,
}) => {
  let draftId = '';
  // 削除対象はこのテストの下書きだけに限定します。
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      const response = draftId ? await request.get(`${service}/api/sessions/${draftId}`) : null;
      await route.fulfill({ json: response?.ok() ? [await response.json()] : [] });
    } else await route.fallback();
  });
  try {
    await page.goto('/');
    await page.getByLabel('タイトル', { exact: true }).fill('再読込する下書き');
    await expect(page).toHaveURL(/\/session\/\?id=/);
    draftId = new URL(page.url()).searchParams.get('id')!;
    await expect
      .poll(
        async () => (await (await request.get(`${service}/api/sessions/${draftId}`)).json()).title,
      )
      .toBe('再読込する下書き');
    await page.reload();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('再読込する下書き');
    await expect(page.locator('.session-row')).toHaveCount(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'すべて削除', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('新しい会議');
    expect((await request.get(`${service}/api/sessions/${draftId}`)).status()).toBe(404);
    await expect(page.locator('.session-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'すべて削除', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '会議を始める', exact: true })).toBeEnabled();
  } finally {
    if (draftId) await request.delete(`${service}/api/sessions/${draftId}`);
  }
});

test('声の種類を会議中のAPI設定で変更し、再読込後も保持する', async ({ page, request }) => {
  const session = await (await request.post(`${service}/api/sessions`, { data: {} })).json();
  session.status = 'active';
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    if (!(await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).isChecked())) {
      await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).click();
    }
    await expect(page.getByRole('checkbox', { name: 'Geminiも使う', exact: true })).toBeChecked();
    const voice = page.getByRole('combobox', { name: '声の種類', exact: true });
    await expect(voice).toBeEnabled();
    await voice.selectOption('Puck');
    await expect(voice).toHaveValue('Puck');
    await expect(page.getByText('次の読み上げから反映します。')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/voice-settings.png' });
    await page.getByRole('button', { name: '設定を閉じる', exact: true }).click();
    page.on('dialog', (dialog) => dialog.accept());
    await page.reload();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    if (!(await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).isChecked())) {
      await page.getByRole('checkbox', { name: 'Geminiも使う', exact: true }).click();
    }
    await expect(page.getByRole('checkbox', { name: 'Geminiも使う', exact: true })).toBeChecked();
    await expect(voice).toHaveValue('Puck');
    expect((await (await request.get(`${service}/api/sessions/${session.id}`)).json()).status).toBe(
      'active',
    );
    await page.getByRole('button', { name: '設定を閉じる', exact: true }).click();
    await page.getByRole('link', { name: 'ledad ホーム' }).click();
    await expect(page.getByRole('combobox', { name: '声の種類', exact: true })).toHaveCount(0);
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
