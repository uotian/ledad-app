import { expect, test, type Route } from '@playwright/test';

test('途中訳を並行送信し、応答順が逆転しても古い訳に戻らない', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
  session.status = 'active';
  session.settings.translationLanguage = 'en';
  await request.put(`${base}/${session.id}`, { data: session });
  const previews: Route[] = [];
  const unused: string[] = [];
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/unused')) {
      unused.push(url.split('/').at(-2)!);
      return route.fulfill({ json: { saved: true } });
    }
    if (url.endsWith('/translate-transcript')) {
      previews.push(route);
      return;
    }
    await route.continue({ url: url.replace(':4319', ':4320') });
  });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('button', { name: 'Add conversation manually' }).click();
    const input = page.getByLabel('Manual conversation entry', { exact: true });
    const previewButton = page.getByRole('button', { name: 'Preview transcription', exact: true });
    await input.fill('来週');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(1);
    await input.fill('来週は金曜日');
    await previewButton.click();
    await input.fill('来週は金曜日に会議です');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(3);
    expect(previews[2].request().postDataJSON()).toMatchObject({
      text: '来週は金曜日に会議です',
      previous: null,
    });
    await previews[0].fulfill({
      json: { translation: 'Next week', usageId: crypto.randomUUID() },
    });
    await expect(page.locator('.interim-transcript')).toContainText('Next week');
    await previews[2].fulfill({
      json: { translation: 'The meeting is next Friday', usageId: crypto.randomUUID() },
    });
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveText(
      'The meeting is next Friday',
    );
    const oldUsageId = crypto.randomUUID();
    await previews[1].fulfill({ json: { translation: 'Next Friday', usageId: oldUsageId } });
    await expect.poll(() => unused).toContain(oldUsageId);
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveText(
      'The meeting is next Friday',
    );
    await input.fill('来週は金曜日に会議です。正午からです');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(4);
    expect(previews[3].request().postDataJSON().previous).toEqual({
      text: '来週は金曜日に会議です',
      translation: 'The meeting is next Friday',
    });
    await input.fill('The meeting is next Friday at noon');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(5);
    const emptyUsageId = crypto.randomUUID();
    await previews[4].fulfill({ json: { translation: '', usageId: emptyUsageId } });
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveCount(0);
    await expect.poll(() => unused).toContain(emptyUsageId);
    const lateUsageId = crypto.randomUUID();
    await previews[3].fulfill({
      json: { translation: 'The meeting is next Friday at noon', usageId: lateUsageId },
    });
    await expect.poll(() => unused).toContain(lateUsageId);
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveCount(0);
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});

test('途中訳は発言をまたいで混ざらず、表示言語を変えても翻訳先を維持する', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { mode: 'audience', title: '翻訳の順序確認' } })
  ).json();
  session.status = 'active';
  session.settings.translationLanguage = 'en';
  await request.put(`${base}/${session.id}`, { data: session });
  const previews: Route[] = [],
    finals: Route[] = [];
  const unused: string[] = [];
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/unused')) {
      unused.push(url.split('/').at(-2)!);
      return route.fulfill({ json: { saved: true } });
    }
    if (url.endsWith('/translate-transcript')) {
      previews.push(route);
      return;
    }
    if (url.endsWith('/translate')) {
      finals.push(route);
      return;
    }
    await route.continue({ url: url.replace(':4319', ':4320') });
  });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
  const translate = (route: Route, translation: string) => route.fulfill({ json: { translation } });
  const preview = async (route: Route, translation: string) => {
    const usageId = crypto.randomUUID();
    await route.fulfill({ json: { translation, usageId } });
    return usageId;
  };
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('button', { name: 'Add conversation manually' }).click();
    const input = page.getByLabel('Manual conversation entry', { exact: true });
    const previewButton = page.getByRole('button', { name: 'Preview transcription', exact: true });
    await input.fill('来週');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(1);
    const previewTime = page.locator('.interim-transcript time');
    await expect(previewTime).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    const startedAt = await previewTime.getAttribute('datetime');
    const utteranceId = await page
      .locator('.interim-transcript')
      .getAttribute('data-transcript-id');
    const firstPreviewId = await preview(previews[0], 'Next week');
    await expect(page.locator('.interim-transcript')).toContainText('Next week');
    await expect(page.locator('.interim-transcript .transcript-meta strong')).toHaveText('Live');
    await page.screenshot({ path: 'output/playwright/live-header.png' });
    await input.fill('来週は金曜日');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(2);
    expect(previews[1].request().postDataJSON().previous).toEqual({
      text: '来週',
      translation: 'Next week',
    });
    await expect(previewTime).toHaveAttribute('datetime', startedAt!);
    await page.getByRole('button', { name: 'Add remark', exact: true }).click();
    await expect.poll(() => finals.length).toBe(1);
    await expect(page.locator('.transcript-item .transcript-translation')).toHaveText('Next week');
    await expect(page.locator('.transcript-item')).toHaveAttribute(
      'data-transcript-id',
      utteranceId!,
    );
    const pending = await (await request.get(`${base}/${session.id}`)).json();
    expect(pending.transcripts[0]).toMatchObject({
      id: utteranceId,
      translation: '',
      analyzed: false,
    });
    const time = pending.transcripts[0].timestamp;
    expect(Number.isFinite(Date.parse(time))).toBe(true);
    expect(time).toBe(startedAt);
    await input.fill('予算はまだ');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(3);
    expect(previews[2].request().postDataJSON().previous).toBeNull();
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveCount(0);
    const secondPreviewId = await preview(previews[1], 'OLD SPEECH');
    await expect(page.locator('.transcript-item').nth(0)).toContainText('OLD SPEECH');
    await expect(page.locator('.interim-transcript')).not.toContainText('OLD SPEECH');
    expect(
      (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0].translation,
    ).toBe('');
    await page.getByRole('button', { name: 'Add remark', exact: true }).click();
    await expect.poll(() => finals.length).toBe(2);
    await expect(page.locator('.transcript-item').nth(0)).toContainText('OLD SPEECH');
    await translate(finals[1], 'The budget is still undecided.');
    await expect(page.locator('.transcript-item').nth(1)).toContainText(
      'The budget is still undecided.',
    );
    const latePreviewId = await preview(previews[2], 'The budget is still');
    await expect(
      page.locator('.transcript-item').nth(1).locator('.transcript-translation'),
    ).toHaveText('The budget is still undecided.');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/${session.id}`)).json()).transcripts[1].translation,
      )
      .toBe('The budget is still undecided.');
    await expect.poll(() => unused).toContain(latePreviewId);
    expect(unused).not.toContain(firstPreviewId);
    expect(unused).not.toContain(secondPreviewId);
    await translate(finals[0], 'Next Friday');
    await expect(page.locator('.transcript-item').nth(0)).toContainText('Next Friday');
    await input.fill('三つ目');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(4);
    await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
    await page.getByLabel('App language').selectOption('ja');
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    expect(previews).toHaveLength(4);
    expect(previews[3].request().postDataJSON().translationLanguage).toBe('en');
    await preview(previews[3], 'Third remark');
    await expect(page.locator('.interim-transcript')).toContainText('Third remark');
    await page
      .locator('.session-controls')
      .getByRole('button', { name: '終了', exact: true })
      .click();
    await expect(page.locator('.interim-transcript')).toHaveCount(0);
    const saved = await (await request.get(`${base}/${session.id}`)).json();
    expect(saved.transcripts).toHaveLength(2);
    expect(saved.transcripts[0].timestamp).toBe(time);
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});

test('発言全体の確定原文が変わっても直前のLive訳を残し、確定訳で置き換える', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
  session.status = 'active';
  session.settings.translationLanguage = 'en';
  await request.put(`${base}/${session.id}`, { data: session });
  const previews: Route[] = [],
    finals: Route[] = [];
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/translate-transcript')) {
      previews.push(route);
      return;
    }
    if (url.endsWith('/translate')) {
      finals.push(route);
      return;
    }
    await route.continue({ url: url.replace(':4319', ':4320') });
  });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('button', { name: 'Add conversation manually' }).click();
    const input = page.getByLabel('Manual conversation entry', { exact: true });
    const previewButton = page.getByRole('button', { name: 'Preview transcription', exact: true });
    await input.fill('こんにちは');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(1);
    await previews[0].fulfill({ json: { translation: 'Hello', usageId: crypto.randomUUID() } });
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveText('Hello');
    await input.fill('こんにちは皆さん');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(2);
    const utteranceId = await page
      .locator('.interim-transcript')
      .getAttribute('data-transcript-id');
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('ledad:test-final-transcript', {
          detail: { text: 'こんにちは、皆さん。' },
        }),
      ),
    );
    await expect.poll(() => finals.length).toBe(1);
    await expect(page.locator('.interim-transcript')).toHaveCount(0);
    const row = page.locator('.transcript-item');
    await expect(row).toHaveAttribute('data-transcript-id', utteranceId!);
    await expect(row).toContainText('こんにちは、皆さん。');
    await expect(row.locator('.transcript-translation')).toHaveText('Hello');
    expect(
      (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0],
    ).toMatchObject({
      translation: '',
      analyzed: false,
    });
    await input.fill('次の発言');
    await previewButton.click();
    await expect.poll(() => previews.length).toBe(3);
    await previews[1].fulfill({
      json: { translation: 'Hello everyone', usageId: crypto.randomUUID() },
    });
    await expect(row.locator('.transcript-translation')).toHaveText('Hello everyone');
    await expect(page.locator('.interim-transcript .transcript-translation')).toHaveCount(0);
    await finals[0].fulfill({ json: { translation: 'Hello, everyone.' } });
    await expect(row.locator('.transcript-translation')).toHaveText('Hello, everyone.');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0].translation,
      )
      .toBe('Hello, everyone.');
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});

for (const completed of [false, true]) {
  test(`途中表示の一部だけ確定したとき全体の訳を引き継がない（応答済み=${completed}）`, async ({
    page,
    context,
    request,
  }) => {
    const base = 'http://127.0.0.1:4320/api/sessions';
    const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
    session.status = 'active';
    session.settings.translationLanguage = 'en';
    await request.put(`${base}/${session.id}`, { data: session });
    const previews: Route[] = [],
      finals: Route[] = [];
    const unused: string[] = [];
    await context.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/unused')) {
        unused.push(url.split('/').at(-2)!);
        return route.fulfill({ json: { saved: true } });
      }
      if (url.endsWith('/translate-transcript')) {
        previews.push(route);
        return;
      }
      if (url.endsWith('/translate')) {
        finals.push(route);
        return;
      }
      await route.continue({ url: url.replace(':4319', ':4320') });
    });
    await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
    try {
      await page.goto(`/session/?id=${session.id}`);
      await page.getByRole('button', { name: 'Add conversation manually' }).click();
      const input = page.getByLabel('Manual conversation entry', { exact: true });
      const previewButton = page.getByRole('button', {
        name: 'Preview transcription',
        exact: true,
      });
      await input.fill('最初の発言 続きの発言');
      await previewButton.click();
      await expect.poll(() => previews.length).toBe(1);
      const firstId = await page.locator('.interim-transcript').getAttribute('data-transcript-id');
      const usageId = crypto.randomUUID();
      const response = { translation: 'First remark. Following remark.', usageId };
      if (completed) {
        await previews[0].fulfill({ json: response });
        await expect(page.locator('.interim-transcript')).toContainText(response.translation);
      }
      await input.fill('最初の発言');
      await page.getByRole('button', { name: 'Add remark', exact: true }).click();
      await expect.poll(() => finals.length).toBe(1);
      await expect(page.locator('.transcript-item')).toHaveAttribute(
        'data-transcript-id',
        firstId!,
      );
      await expect(page.locator('.transcript-item .transcript-translation')).toHaveCount(0);
      await input.fill('続きの発言');
      await previewButton.click();
      await expect.poll(() => previews.length).toBe(2);
      const secondId = await page.locator('.interim-transcript').getAttribute('data-transcript-id');
      expect(secondId).not.toBe(firstId);
      await page.getByRole('button', { name: 'Add remark', exact: true }).click();
      await expect.poll(() => finals.length).toBe(2);
      if (!completed) {
        await previews[0].fulfill({ json: response });
        await expect.poll(() => unused).toContain(usageId);
      }
      await finals[1].fulfill({ json: { translation: 'Following remark.' } });
      await finals[0].fulfill({ json: { translation: 'First remark.' } });
      await expect(
        page.locator(`[data-transcript-id="${firstId}"] .transcript-translation`),
      ).toHaveText('First remark.');
      await expect(
        page.locator(`[data-transcript-id="${secondId}"] .transcript-translation`),
      ).toHaveText('Following remark.');
      await previews[1].fulfill({
        json: { translation: 'LATE SECOND', usageId: crypto.randomUUID() },
      });
      await expect(page.getByText('LATE SECOND')).toHaveCount(0);
    } finally {
      await page.close();
      await request.delete(`${base}/${session.id}`);
    }
  });
}

for (const outcome of ['empty', 'failure'] as const) {
  test(`確定訳が${outcome}の場合も暫定訳を適切に扱う`, async ({ page, context, request }) => {
    const base = 'http://127.0.0.1:4320/api/sessions';
    const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
    session.status = 'active';
    session.settings.translationLanguage = 'en';
    await request.put(`${base}/${session.id}`, { data: session });
    let final: Route | undefined;
    await context.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/translate-transcript'))
        return route.fulfill({
          json: { translation: 'Temporary translation', usageId: crypto.randomUUID() },
        });
      if (url.endsWith('/translate')) {
        final = route;
        return;
      }
      await route.continue({ url: url.replace(':4319', ':4320') });
    });
    await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
    try {
      await page.goto(`/session/?id=${session.id}`);
      await page.getByRole('button', { name: 'Add conversation manually' }).click();
      await page.getByLabel('Manual conversation entry', { exact: true }).fill('確認します。');
      await page.getByRole('button', { name: 'Preview transcription', exact: true }).click();
      await expect(page.locator('.interim-transcript')).toContainText('Temporary translation');
      await page.getByRole('button', { name: 'Add remark', exact: true }).click();
      await expect.poll(() => !!final).toBe(true);
      await expect(page.locator('.interim-transcript')).toHaveCount(0);
      await expect(page.locator('.transcript-translation')).toHaveText('Temporary translation');
      // 表示言語を変更しても、翻訳先と暫定訳を維持します。
      await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
      await page.getByLabel('App language').selectOption('ja');
      await page.getByRole('button', { name: '設定を閉じる' }).click();
      await expect(page.locator('.transcript-translation')).toHaveText('Temporary translation');
      await page.getByRole('button', { name: '設定', exact: true }).press('Enter');
      await page.getByLabel('アプリの言語').selectOption('en');
      await page.getByRole('button', { name: 'Close settings' }).click();
      await expect(page.locator('.transcript-translation')).toHaveText('Temporary translation');
      if (outcome === 'empty') {
        await final!.fulfill({ json: { translation: '' } });
        await expect(page.locator('.transcript-translation')).toHaveCount(0);
        await expect
          .poll(
            async () =>
              (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0].analyzed,
          )
          .toBe(true);
      } else {
        await final!.fulfill({ status: 500, json: { error: 'translation unavailable' } });
        await expect(
          page.locator('.error-banner:visible').filter({ hasText: 'translation unavailable' }),
        ).toBeVisible();
        await expect(page.locator('.transcript-translation')).toHaveText('Temporary translation');
        await page.screenshot({ path: 'artifacts/translation-retained-on-final-failure.png' });
      }
      expect(
        (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0].translation,
      ).toBe('');
    } finally {
      await page.close();
      await request.delete(`${base}/${session.id}`);
    }
  });
}

for (const completed of [true, false]) {
  test(`一部確定でも先頭部分の${completed ? '表示済み' : '処理中'}訳を残し、次のLiveへ混ぜない`, async ({
    page,
    context,
    request,
  }) => {
    const base = 'http://127.0.0.1:4320/api/sessions';
    const session = await (await request.post(base, { data: { mode: 'audience' } })).json();
    session.status = 'active';
    session.settings.translationLanguage = 'en';
    await request.put(`${base}/${session.id}`, { data: session });
    const previews: Route[] = [],
      finals: Route[] = [];
    await context.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/translate-transcript')) {
        previews.push(route);
        return;
      }
      if (url.endsWith('/translate')) {
        finals.push(route);
        return;
      }
      await route.continue({ url: url.replace(':4319', ':4320') });
    });
    await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
    try {
      await page.goto(`/session/?id=${session.id}`);
      await page.getByRole('button', { name: 'Add conversation manually' }).click();
      const input = page.getByLabel('Manual conversation entry', { exact: true });
      const preview = page.getByRole('button', { name: 'Preview transcription', exact: true });
      await input.fill('来週');
      await preview.click();
      await expect.poll(() => previews.length).toBe(1);
      if (completed) {
        await previews[0].fulfill({
          json: { translation: 'Next week', usageId: crypto.randomUUID() },
        });
        await expect(page.locator('.interim-transcript')).toContainText('Next week');
      }
      await input.fill('来週は金曜日です 続きの発言');
      await preview.click();
      await expect(page.locator('.interim-transcript')).toContainText('続きの発言');
      const firstId = await page.locator('.interim-transcript').getAttribute('data-transcript-id');
      await input.fill('来週は金曜日です');
      await page.getByRole('button', { name: 'Add remark', exact: true }).click();
      await expect.poll(() => finals.length).toBe(1);
      const first = page.locator(`[data-transcript-id="${firstId}"] .transcript-translation`);
      if (!completed) {
        await previews[0].fulfill({
          json: { translation: 'Next week', usageId: crypto.randomUUID() },
        });
      }
      await expect(first).toHaveText('Next week');
      await input.fill('続きの発言');
      await preview.click();
      await expect(page.locator('.interim-transcript')).toContainText('続きの発言');
      await expect(first).toHaveText('Next week');
      await expect(page.locator('.interim-transcript .transcript-translation')).toHaveCount(0);
      if (completed) {
        await previews[1].fulfill({
          json: { translation: 'FULL OLD PREVIEW', usageId: crypto.randomUUID() },
        });
        await expect(page.getByText('FULL OLD PREVIEW')).toHaveCount(0);
        await expect(first).toHaveText('Next week');
      }
      await finals[0].fulfill({ json: { translation: 'Next Friday.' } });
      await expect(first).toHaveText('Next Friday.');
    } finally {
      await page.close();
      await request.delete(`${base}/${session.id}`);
    }
  });
}
