import { expect, test, type Route } from '@playwright/test';
test('録音の再認識は本文と訳文を同時更新し、時刻・参照・閲覧位置を維持する', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { mode: 'audience', title: '録音の再認識テスト' } })
  ).json();
  session.status = 'active';
  session.settings.translationLanguage = 'en';
  session.transcripts = Array.from({ length: 30 }, (_, i) => ({
    id: crypto.randomUUID(),
    text: `議題${i + 1}の導入費用は十万円です。`,
    translation: `Topic ${i + 1}: ten thousand yen.`,
    translationLanguage: i === 19 ? 'ja' : 'en',
    timestamp: `2026-10-04T16:00:${String(i).padStart(2, '0')}Z`,
    source: 'display',
    analyzed: true,

    disposition: 'open',
  }));
  await request.put(`${base}/${session.id}`, { data: session });
  const rows = session.transcripts.slice(0, 20);
  const fixedText = rows
    .map((t: { text: string }) => t.text.replace('十万円', '10万円'))
    .join('\n');
  const fixedTranslation =
    'The total implementation cost is one hundred thousand yen for each topic.';
  let review: Route | undefined;
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/refine-transcripts')) {
      review = route;
      return;
    }
    await route.continue({ url: url.replace(':4319', ':4320') });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ledad.language', 'en');
    localStorage.setItem('ledad.profile.v1', JSON.stringify({ name: '認識用サンプル', aliases: '' }));
  });
  try {
    await page.goto(`/session/?id=${session.id}`);
    await expect(page.locator('.transcript-item')).toHaveCount(30);
    await expect(page.locator('[data-recognition="live"] time')).toHaveCount(30);
    await expect(
      page.locator('[data-recognition="live"] .transcript-meta strong').first(),
    ).toHaveText('Live');
    await expect(page.locator('[data-recognition="live"] time').first()).toHaveAttribute(
      'datetime',
      rows[0].timestamp,
    );
    await expect(page.getByRole('button', { name: 'Add conversation manually' })).toBeVisible();
    const scroll = page.locator('.transcript-scroll');
    await scroll.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    await page.evaluate(
      (transcriptIds) =>
        window.dispatchEvent(new CustomEvent('ledad:test-review', { detail: { transcriptIds } })),
      rows.map((t: { id: string }) => t.id),
    );
    await expect.poll(() => !!review).toBe(true);
    expect(review!.request().postDataJSON().profile).toEqual({ name: '認識用サンプル', aliases: '' });
    expect(review!.request().postDataJSON().transcriptIds).toEqual(
      rows.map((t: { id: string }) => t.id),
    );
    await expect(page.locator('.transcript-item').first()).toContainText('十万円');
    await expect(page.locator('.transcript-item').first()).toContainText('ten thousand yen');
    await expect(page.locator('[data-recognition="fixed"]')).toHaveCount(0);
    await review!.fulfill({
      json: {
        originals: rows.map(({ id, text }: { id: string; text: string }) => ({ id, text })),
        text: fixedText,
        translation: fixedTranslation,
        translationLanguage: 'en',
      },
    });
    await expect(page.locator('[data-recognition="fixed"]')).toHaveCount(1);
    await expect(page.locator('.transcript-item')).toHaveCount(11);
    await expect(page.locator('.transcript-meta strong').first()).toHaveText('Fixed');
    await expect(page.locator('.transcript-item').first()).toContainText('10万円');
    await expect(page.locator('.transcript-item').first()).toContainText(
      'one hundred thousand yen',
    );
    await expect(page.locator('.transcript-item time').first()).toHaveAttribute(
      'datetime',
      rows[0].timestamp,
    );
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/${session.id}`)).json()).transcripts[0].liveText,
      )
      .toBe(rows.map((t: { text: string }) => t.text).join('\n'));
    const saved = await (await request.get(`${base}/${session.id}`)).json();
    expect(saved.transcripts.map((t: { id: string }) => t.id)).toEqual([
      rows[0].id,
      ...session.transcripts.slice(20).map((t: { id: string }) => t.id),
    ]);
    expect(saved.transcripts[0].text).toBe(fixedText);
    expect(saved.transcripts[0].translation).toBe(fixedTranslation);
    expect(saved.transcripts[0].liveSegments.map((t: { id: string }) => t.id)).toEqual(
      rows.map((t: { id: string }) => t.id),
    );
    expect(saved.candidates).toHaveLength(0);
    expect(saved.utterances).toHaveLength(0);
    await page.screenshot({ path: 'artifacts/refinement-atomic.png' });
    await page.reload();
    await expect(page.locator('[data-recognition="fixed"]')).toHaveCount(1);
  } finally {
    await page.close();
    await request.delete(`${base}/${session.id}`);
  }
});
