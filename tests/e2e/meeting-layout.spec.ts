import { expect, test } from '@playwright/test';

test('表示切り替えで全幅を使い、下書きとタブを保持する', async ({ page, context, request }) => {
  const service = 'http://127.0.0.1:4320';
  const session = await (
    await request.post(`${service}/api/sessions`, {
      data: { title: '表示切り替えの確認' },
    })
  ).json();
  session.status = 'active';
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  try {
    await page.goto(`/session/?id=${session.id}`);
    const split = page.getByRole('button', { name: 'TalkとAnalyze（6:4）', exact: true });
    const chat = page.getByRole('button', { name: 'Talkのみ', exact: true });
    const analyze = page.getByRole('button', { name: 'Analyzeのみ', exact: true });
    const left = page.locator('.meeting-left');
    const right = page.locator('.assistant-panel');
    const grid = page.locator('.meeting-grid');
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    const draft = page.getByLabel('AIへの相談');
    await draft.fill('表示を切り替えても残る下書き');
    for (const width of [1440, 980, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await chat.click();
      await expect(chat).toHaveAttribute('aria-pressed', 'true');
      await expect(right).toBeHidden();
      await expect(left).toBeVisible();
      expect((await left.boundingBox())!.width).toBeCloseTo((await grid.boundingBox())!.width, 0);
      await analyze.focus();
      await page.keyboard.press('Enter');
      await expect(analyze).toHaveAttribute('aria-pressed', 'true');
      await expect(left).toBeHidden();
      await expect(draft).toHaveValue('表示を切り替えても残る下書き');
      expect((await right.boundingBox())!.width).toBeCloseTo((await grid.boundingBox())!.width, 0);
      await split.click();
      await expect(left).toBeVisible();
      await expect(right).toBeVisible();
      await expect(draft).toHaveValue('表示を切り替えても残る下書き');
      if (width === 1440) {
        expect((await left.boundingBox())!.width / (await right.boundingBox())!.width).toBeCloseTo(
          1.5,
          1,
        );
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `artifacts/meeting-layout-${width}.png` });
    }
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
