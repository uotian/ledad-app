import { expect, test } from '@playwright/test';
// 合成した会話だけを使い、実APIで翻訳・保存・表示を検証します。
test('指定言語へ会話を翻訳し、アプリ言語を変えても翻訳先を維持する', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { mode: 'audience', title: '翻訳の検証' } })
  ).json();
  session.status = 'active';
  session.settings.translationLanguage = 'en';
  session.transcripts = [
    {
      id: crypto.randomUUID(),
      text: '次回の会議は金曜日です。',
      translation: 'The next meeting is on Friday.',
      translationLanguage: 'en',
      timestamp: session.createdAt,
      source: 'display',

      analyzed: true,
      disposition: 'open',
    },
  ];
  await request.put(`${base}/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'en'));
  try {
    await page.goto(`/session/?id=${session.id}`);
    await expect(page.locator('.transcript-translation')).toContainText(/Friday/i);
    await expect(page.getByText('次回の会議は金曜日です。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add conversation manually' }).click();
    await page
      .getByLabel('Manual conversation entry', { exact: true })
      .fill('予算はまだ決まっていません。');
    const beforePreview = await page.evaluate(() => Date.now());
    await page.getByRole('button', { name: 'Preview transcription', exact: true }).click();
    const afterPreview = await page.evaluate(() => Date.now());
    const preview = page.locator('.interim-transcript');
    await expect(preview.locator('.transcript-translation')).toContainText(/budget/i);
    await expect(preview.locator('.transcript-meta strong')).toHaveText('Live');
    await expect(preview.locator('time')).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect((await (await request.get(`${base}/${session.id}`)).json()).transcripts).toHaveLength(1);
    await page.screenshot({ path: 'artifacts/interim-translation.png' });
    await page.getByRole('button', { name: 'Add remark', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.transcript-translation').last()).toContainText(/budget/i);
    await expect
      .poll(async () =>
        (await (await request.get(`${base}/${session.id}`)).json()).transcripts.every(
          (t: { translationLanguage: string }) => t.translationLanguage === 'en',
        ),
      )
      .toBe(true);
    const recorded = (await (await request.get(`${base}/${session.id}`)).json()).transcripts.at(-1);
    expect(Date.parse(recorded.timestamp)).toBeGreaterThanOrEqual(beforePreview);
    expect(Date.parse(recorded.timestamp)).toBeLessThanOrEqual(afterPreview);
    await expect(page.locator('.transcript-item').last().locator('time')).toHaveAttribute(
      'datetime',
      recorded.timestamp,
    );
    for (const width of [1440, 980]) {
      await page.setViewportSize({ width, height: 960 });
      for (const scale of [1, 1.15, 1.3]) {
        await page
          .locator('html')
          .evaluate(
            (element, scale) => element.style.setProperty('--text-scale', String(scale)),
            scale,
          );
        const row = page.locator('.transcript-item.has-translation').first();
        const original = (await row.locator(':scope > p').first().boundingBox())!;
        const translated = (await row.locator('.transcript-translation').boundingBox())!;
        expect(translated.y).toBe(original.y);
        expect(translated.x).toBeGreaterThanOrEqual(original.x + original.width);
        expect(translated.x + translated.width).toBeLessThanOrEqual(width);
        expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      await page.screenshot({ path: `artifacts/translations-columns-${width}-L.png` });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page
      .locator('html')
      .evaluate((element) => element.style.setProperty('--text-scale', '1'));
    await page.screenshot({ path: 'artifacts/translations-en.png' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('App language').selectOption('zh');
    await page.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.locator('.transcript-translation').first()).toContainText(/Friday/i);
    await expect(page.locator('.transcript-translation').last()).toContainText(/budget/i);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('应用语言').selectOption('ja');
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    await expect
      .poll(async () =>
        (await (await request.get(`${base}/${session.id}`)).json()).transcripts.every(
          (t: { translationLanguage: string }) => t.translationLanguage === 'en',
        ),
      )
      .toBe(true);
    await expect(page.locator('.transcript-translation')).toHaveCount(2);
    const saved = await (await request.get(`${base}/${session.id}`)).json();
    expect(saved.settings.language).toBe('ja');
    expect(saved.status).toBe('active');
    expect(saved.transcripts[0].text).toBe('次回の会議は金曜日です。');
    const resume = page
      .locator('.session-controls')
      .getByRole('button', { name: '再開', exact: true });
    const records = page
      .locator('.session-controls')
      .getByRole('button', { name: '終了', exact: true });
    await expect(resume).toBeVisible();
    expect((await resume.boundingBox())?.height).toBe((await records.boundingBox())?.height);
    await expect(resume.locator('svg')).toHaveAttribute('width', '15');
    await page.screenshot({ path: 'artifacts/meeting-resume-size.png' });
  } finally {
    await request.delete(`${base}/${session.id}`);
  }
});
