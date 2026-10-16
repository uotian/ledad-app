import { test, expect } from '@playwright/test';
test('表示言語とS/M/Lは保存され、会議の言語や本文は変更しない', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { mode: 'audience', title: '表示設定の検証' } })
  ).json();
  session.status = 'active';
  session.transcripts = [
    {
      id: crypto.randomUUID(),
      text: '会議の内容はそのまま残ります。',
      translation: '',
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
  try {
    await page.goto(`/session/?id=${session.id}`);
    const text = page.getByText('会議の内容はそのまま残ります。', { exact: true });
    await expect(text).toBeVisible();
    const size = () => text.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const small = await size();
    const chromeMetrics = () =>
      page.evaluate(() => {
        const sidebar = document.querySelector('.sidebar')!;
        const icon = sidebar.querySelector('.sidebar-bottom svg')!;
        return {
          sidebarWidth: sidebar.getBoundingClientRect().width,
          iconWidth: icon.getBoundingClientRect().width,
          iconHeight: icon.getBoundingClientRect().height,
          headerSize: getComputedStyle(document.querySelector('.meeting-header h1')!).fontSize,
          footerSize: getComputedStyle(document.querySelector('.session-controls button')!)
            .fontSize,
          footerHeight: document.querySelector('.session-controls')!.getBoundingClientRect().height,
        };
      });
    const originalChrome = await chromeMetrics();
    expect(originalChrome.sidebarWidth).toBe(72);
    expect(originalChrome.iconWidth).toBe(24);
    await expect(page.locator('.local-badge, .workspace-label, .sidebar-bottom p')).toHaveCount(0);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'S', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'M', exact: true }).check();
    await expect.poll(size).toBeCloseTo(small * 1.15, 1);
    expect(await chromeMetrics()).toEqual(originalChrome);
    await page.getByRole('radio', { name: 'L', exact: true }).check();
    await expect.poll(size).toBeCloseTo(small * 1.3, 1);
    expect(await chromeMetrics()).toEqual(originalChrome);
    await page.getByLabel('アプリの言語').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Text size' })).toBeVisible();
    await page.screenshot({ path: 'artifacts/settings-en-L.png' });
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect.poll(size).toBeCloseTo(small * 1.3, 1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('App language').selectOption('zh');
    await expect(page.getByRole('group', { name: '文字大小' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'L', exact: true })).toBeChecked();
    await page.screenshot({ path: 'artifacts/settings-zh-L.png' });
    await page.getByLabel('应用语言').selectOption('fr');
    await expect(page.getByRole('heading', { name: 'Réglages', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Taille du texte' })).toBeVisible();
    await page.getByRole('button', { name: 'Fermer les réglages' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
    await expect(text).toBeVisible();
    await page.getByRole('button', { name: 'Réglages', exact: true }).click();
    await page.screenshot({ path: 'artifacts/settings-fr-L.png' });
    await page.getByLabel('Langue de l’application').selectOption('ja');
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    await expect(text).toBeVisible();
    for (const width of [1440, 980, 650]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.locator('body').evaluate((e) => e.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/meeting-L-${width}.png` });
    }
    const saved = await (await request.get(`${base}/${session.id}`)).json();
    expect(saved.settings.language).toBe(session.settings.language);
    expect(saved.transcripts[0].text).toBe(session.transcripts[0].text);
  } finally {
    await request.delete(`${base}/${session.id}`);
  }
});

test('フランス語の会議設定と翻訳先を保存して開始できる', async ({ page, context, request }) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (
    await request.post(base, { data: { title: 'Réunion de démonstration' } })
  ).json();
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'fr'));
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page
      .getByRole('combobox', { name: 'Langue de la réunion', exact: true })
      .selectOption('fr');
    await page
      .getByRole('combobox', { name: 'Langue de traduction', exact: true })
      .selectOption('fr');
    await expect
      .poll(async () => {
        const saved = await (await request.get(`${base}/${session.id}`)).json();
        return [saved.settings.language, saved.settings.translationLanguage];
      })
      .toEqual(['fr', 'fr']);
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: 'Langue de la réunion', exact: true }),
    ).toHaveValue('fr');
    await expect(
      page.getByRole('combobox', { name: 'Langue de traduction', exact: true }),
    ).toHaveValue('fr');
    for (const width of [1200, 980, 390]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.locator('body').evaluate((e) => e.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/home-fr-${width}.png` });
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.getByRole('button', { name: 'Démarrer une réunion', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Topics', exact: true })).toBeVisible();
    await expect
      .poll(async () => (await (await request.get(`${base}/${session.id}`)).json()).status)
      .toBe('active');
  } finally {
    await request.delete(`${base}/${session.id}`);
  }
});
