import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('ヘッダーの用語数と優先出典を表示し、狭い画面・終了済み会議でも閲覧できる', async ({
  page,
  context,
  request,
}) => {
  const service = 'http://127.0.0.1:4320';
  const session = await (
    await request.post(`${service}/api/sessions`, {
      data: { title: '用語集の確認' },
    })
  ).json();
  const documentId = randomUUID();
  const transcriptId = randomUUID();
  session.status = 'active';
  session.documents = [
    {
      id: documentId,
      name: '事前資料.txt',
      kind: 'reference',
      format: 'text',
      pages: [{ number: 1, text: 'Ledad Sakana AI' }],
      size: 20,
      preparationPending: false,
    },
  ];
  session.documentReference = {
    documentIds: [documentId],
    summary: '',
    glossary: ['Ledad', 'Sakana AI'],
  };
  session.transcripts = [
    {
      id: transcriptId,
      text: 'LedadとSakana AIとOpenSearchについて。',
      timestamp: session.createdAt,
      source: 'display',
      translation: '',
      analyzed: true,
      disposition: 'open',
      correctedAt: session.createdAt,
    },
  ];
  session.analyze = {
    topics: [],
    mentions: [],
    suggestedQuestions: [],
    suggestedMeetingQuestions: [],
    glossary: ['Ledad', 'Sakana AI', 'OpenSearch'].map((term) => ({
      term,
      evidenceId: transcriptId,
    })),
    updatedAt: session.createdAt,
    language: 'ja',
    profileKey: '{}',
    inputKey: '',
  };
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  // 資料の追加保存は派生結果を無効化するため、同じ原本の生成済み結果を別途保存します。
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.request().url().endsWith('/analyze')
      ? route.fulfill({ json: session.analyze })
      : route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('ledad.profile.v1', JSON.stringify({ name: '田中 Ledad', aliases: '' }));
    localStorage.setItem('ledad.theme', 'dark');
  });
  try {
    await page.goto(`/session/?id=${session.id}`);
    const glossary = page.getByRole('button', { name: '用語集', exact: true });
    await expect(glossary).toHaveText('4語');
    const buttons = page.locator('.meeting-header > button');
    await expect(buttons.nth(0)).toHaveAccessibleName('用語集');
    await expect(buttons.nth(1)).toHaveAccessibleName('資料');
    const time = page.locator('.transcript-meta > time');
    await expect(time).toHaveCSS('font-weight', '600');
    const muted = await page.locator('.transcript-meta > span').count();
    expect(muted).toBe(0);
    const metadata = await time.evaluate((element) => ({
      color: getComputedStyle(element).color,
      label: getComputedStyle(element.parentElement!.querySelector('strong')!).color,
    }));
    expect(metadata.color).not.toBe(metadata.label);
    for (const width of [1440, 980, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await glossary.click();
      const dialog = page.getByRole('dialog', { name: '用語集', exact: true });
      await expect(dialog.getByRole('row')).toHaveCount(5);
      await expect(dialog.getByRole('row').filter({ hasText: 'Ledad' })).toHaveText(
        'Ledadあなたの名前・呼ばれ方',
      );
      await expect(dialog.getByRole('row').filter({ hasText: 'Sakana AI' })).toHaveText(
        'Sakana AIドキュメント',
      );
      await expect(dialog.getByRole('row').filter({ hasText: 'OpenSearch' })).toHaveText(
        'OpenSearch会話分析',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `artifacts/glossary-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(glossary).toBeFocused();
    }
    session.status = 'ended';
    session.endedAt = new Date().toISOString();
    await request.put(`${service}/api/sessions/${session.id}`, { data: session });
    await page.reload();
    await glossary.click();
    await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
