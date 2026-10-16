import { expect, test } from '@playwright/test';

test('操作欄の中央に現在の翻訳方向を表示する', async ({ page, context, request }) => {
  const service = 'http://127.0.0.1:4320';
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  const session = await (
    await request.post(`${service}/api/sessions`, { data: { title: '翻訳方向' } })
  ).json();
  await request.put(`${service}/api/sessions/${session.id}`, {
    data: {
      ...session,
      status: 'active',
      settings: { ...session.settings, language: 'ja', translationLanguage: 'en' },
    },
  });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
  try {
    await page.goto(`/session/?id=${session.id}`);
    const direction = page.locator('.session-language-direction');
    await expect(direction).toHaveText('日本語 → 英語');
    for (const width of [1440, 980, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const footer = page.locator('.session-controls');
      expect(await footer.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
      if (width >= 980) {
        const bounds = (await footer.boundingBox())!;
        const text = (await direction.boundingBox())!;
        expect(Math.abs(text.x + text.width / 2 - bounds.x - bounds.width / 2)).toBeLessThanOrEqual(
          1,
        );
      }
      await footer.screenshot({ path: `artifacts/controller-language-${width}.png` });
    }
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
