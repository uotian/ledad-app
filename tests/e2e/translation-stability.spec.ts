import { expect, test } from '@playwright/test';

// 合成した文章を実APIへ送信し、継続時の表現維持と認識訂正を確認します。
test('途中訳の表現を保って追記し、原文の訂正時は誤りを固定しない', async ({ request }) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { mode: 'audience', title: '途中訳の安定性確認' } })
  ).json();
  session.status = 'active';
  await request.put(`${base}/${session.id}`, { data: session });
  const translate = async (
    text: string,
    previous: { text: string; translation: string } | null,
  ) => {
    const response = await request.post(`${base}/${session.id}/translate-transcript`, {
      data: { text, translationLanguage: 'en', previous },
      // 実APIの60秒の期限を待つ。画面操作用の15秒で通信を取り消さない。
      timeout: 65_000,
    });
    expect(response.ok()).toBe(true);
    return { text, translation: (await response.json()).translation as string };
  };
  try {
    const first = await translate('次回の会議は金曜日です。', null);
    expect(first.translation).toMatch(/Friday/);
    const continued = await translate('次回の会議は金曜日です。午後3時に始まります。', first);
    expect(continued.translation.startsWith(first.translation)).toBe(true);
    expect(continued.translation).toMatch(/3\s*(p\.?m\.?|in the afternoon)|15:00/i);
    const corrected = await translate('次回の会議は月曜日です。午後3時に始まります。', continued);
    expect(corrected.translation).toContain('Monday');
    expect(corrected.translation).not.toContain('Friday');
    expect((await (await request.get(`${base}/${session.id}`)).json()).transcripts).toEqual([]);
    await test.info().attach('translation-stability', {
      body: JSON.stringify({ first, continued, corrected }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await request.delete(`${base}/${session.id}`);
  }
});
