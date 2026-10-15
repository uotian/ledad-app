import { expect, test } from '@playwright/test';
import { createSession } from '@/lib/session/defaults';
import { version } from '../../package.json';

test.use({ timezoneId: 'Asia/Tokyo' });

test('全件削除の取消・処理中・途中失敗・再試行と個別削除', async ({ page }) => {
  let sessions = ['ended', 'active', 'ended', 'ended', 'preparing'].map((status, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    title: `削除テスト${index + 1}`,
    mode: 'audience',
    status,
    createdAt: '2026-10-08T06:00:00.000Z',
    updatedAt: '2026-10-08T06:00:00.000Z',
    hasMinutes: index === 0,
    meetingStartedAt: status === 'preparing' || index === 3 ? null : '2026-10-08T08:43:00.000Z',
    meetingLastAt: status === 'ended' ? '2026-10-09T00:05:00.000Z' : '2026-10-08T08:49:00.000Z',
    startedAt: status === 'preparing' ? null : '2026-10-08T08:43:00.000Z',
    endedAt: status === 'ended' ? '2026-10-09T00:05:00.000Z' : null,
  }));
  const requested: string[] = [];
  let failOnce = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 全APIを置き換え、実際の会議データにはアクセスしません。
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meeting-settings') {
      await route.fulfill({ json: createSession().settings });
    } else if (path === '/api/config') {
      await route.fulfill({ json: { openai: true, gemini: true } });
    } else if (path === '/api/sessions' && route.request().method() === 'GET') {
      await route.fulfill({ json: sessions });
    } else if (path.startsWith('/api/sessions/') && route.request().method() === 'DELETE') {
      const id = path.split('/').at(-1)!;
      requested.push(id);
      if (id.endsWith('0')) await gate;
      if (id.endsWith('1') && failOnce) {
        failOnce = false;
        await route.fulfill({ status: 500, json: { error: '検証用の削除失敗' } });
      } else {
        sessions = sessions.filter((session) => session.id !== id);
        await route.fulfill({ json: { deleted: true } });
      }
    } else await route.abort();
  });
  try {
    await page.goto('/');
    await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
    await expect(page.locator('.app-version')).toHaveText(`v${version}`);
    await expect(page.locator('.app-name')).toContainText('ledad');
    const rows = page.locator('.session-row');
    const deleteAll = page.getByRole('button', { name: 'すべて削除', exact: true });
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole('link', { name: /削除テスト5/ })).toHaveCount(0);
    await expect(rows.nth(0).locator('.session-time span')).toHaveText([
      '10月08日',
      '17:43 (922分)',
    ]);
    await expect(rows.nth(1).locator('.session-time span')).toHaveText(['10月08日', '17:43 (6分)']);
    await expect(rows.nth(0).locator('.session-link')).toHaveText('削除テスト1');
    const time = await rows.nth(0).locator('.session-time').boundingBox();
    const shorterTime = await rows.nth(1).locator('.session-time').boundingBox();
    expect(shorterTime!.x).toBeCloseTo(time!.x, 1);
    expect(shorterTime!.width).toBeCloseTo(time!.width, 1);
    const date = await rows.nth(0).locator('.session-time span').nth(0).boundingBox();
    const hours = await rows.nth(0).locator('.session-time span').nth(1).boundingBox();
    expect(hours!.y).toBeCloseTo(date!.y, 1);
    await expect(rows.nth(3).locator('.session-time')).toHaveCount(0);
    const deleteWithTime = await rows.nth(0).getByRole('button').boundingBox();
    const deleteWithoutTime = await rows.nth(3).getByRole('button').boundingBox();
    expect(deleteWithoutTime!.x).toBeCloseTo(deleteWithTime!.x, 1);
    await expect(rows.locator('.pill')).toHaveCount(0);
    await expect(rows.locator('.session-icon')).toHaveCount(0);
    await expect(rows.nth(0).getByRole('img', { name: '要約済み' })).toBeVisible();
    await expect(rows.nth(1).getByRole('img', { name: '要約済み' })).toHaveCount(0);
    await expect(rows.nth(2).getByRole('img', { name: '要約済み' })).toHaveCount(0);
    const check = await rows.nth(0).locator('.session-check').boundingBox();
    const title = await rows.nth(0).locator('strong').boundingBox();
    expect(title!.x + title!.width).toBeLessThan(check!.x);
    expect(check!.x + check!.width).toBeLessThan(time!.x);
    await page
      .locator('.recent-sessions')
      .screenshot({ path: 'output/playwright/delete-all-desktop.png' });
    await page.screenshot({ path: 'output/playwright/home-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTime = await rows.nth(0).locator('.session-time').boundingBox();
    const mobileTitle = await rows.nth(0).locator('strong').boundingBox();
    expect(mobileTitle!.y + mobileTitle!.height).toBeLessThan(mobileTime!.y);
    const mobileDate = await rows.nth(0).locator('.session-time span').nth(0).boundingBox();
    const mobileHours = await rows.nth(0).locator('.session-time span').nth(1).boundingBox();
    expect(mobileHours!.y).toBeCloseTo(mobileDate!.y, 1);
    await expect(rows.nth(0).getByRole('img', { name: '要約済み' })).toBeVisible();
    await expect(deleteAll).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator('.recent-sessions')
      .screenshot({ path: 'output/playwright/delete-all-mobile.png' });
    await page.screenshot({ path: 'output/playwright/home-mobile.png', fullPage: true });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('5件');
      await dialog.dismiss();
    });
    await deleteAll.click();
    await expect(rows).toHaveCount(4);
    expect(requested).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await deleteAll.click();
    await expect(page.getByRole('dialog', { name: '処理中' })).toBeVisible();
    await expect(page.getByRole('button', { name: '削除中…', includeHidden: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '削除テスト1を削除', exact: true, includeHidden: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '会議を始める', includeHidden: true }),
    ).toBeDisabled();
    release();
    await expect(page.getByRole('alert').filter({ hasText: '検証用の削除失敗' })).toBeVisible();
    await expect(rows).toHaveCount(3);
    expect(requested).toHaveLength(2);
    await expect(deleteAll).toBeEnabled();
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('1件');
      await dialog.accept();
    });
    await page.getByRole('button', { name: '削除テスト4を削除', exact: true }).click();
    await expect(rows).toHaveCount(2);
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('3件');
      await dialog.accept();
    });
    await deleteAll.click();
    await expect(rows).toHaveCount(0);
    await expect(deleteAll).toHaveCount(0);
    await expect(page.locator('.recent-sessions .session-count')).toHaveText('0件');
    await expect(page.locator('.recent-sessions .empty-state')).toHaveCount(0);
    expect(sessions).toEqual([]);
    expect(requested).toContain('00000000-0000-4000-8000-000000000004');
    await page.reload();
    await expect(rows).toHaveCount(0);
  } finally {
    release();
  }
});
