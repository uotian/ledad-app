import { expect, test } from '@playwright/test';

test('接続先を保存するとApple・OpenAIに限定し、解除で以前の設定を復元する', async ({
  page,
  context,
  request,
}) => {
  const service = 'http://127.0.0.1:4320';
  await context.route('http://127.0.0.1:4319/**', (route) =>
    route.continue({ url: route.request().url().replace(':4319', ':4320') }),
  );
  await request.put(`${service}/api/connection-settings`, { data: { baseUrl: '' } });
  await request.put(`${service}/api/ai-settings`, { data: { mode: 'gemini' } });
  await request.put(`${service}/api/live-settings`, { data: { provider: 'gemini' } });
  await request.put(`${service}/api/config`, { data: { provider: 'gemini' } });
  await page.addInitScript(() => localStorage.setItem('ledad.language', 'ja'));
  const open = async () => {
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
  };
  try {
    await page.goto('/');
    await open();
    const input = page.getByRole('textbox', { name: '接続先URL（base_url）', exact: true });
    const save = page.getByRole('button', { name: '接続先を保存', exact: true });
    const gemini = page.getByRole('checkbox', { name: 'Geminiも使う', exact: true });
    const voice = page.getByRole('combobox', { name: '声の種類', exact: true });
    await voice.selectOption('Aoede');
    await input.fill('https://gateway.example/company/v1/');
    await page.evaluate(() =>
      window.addEventListener('ledad-before-connection-change', (e) => e.preventDefault(), {
        once: true,
      }),
    );
    await save.click();
    await expect(
      page.getByText('聞き取り・読み上げを停止してから接続先を変更してください。'),
    ).toBeVisible();
    expect((await (await request.get(`${service}/api/config`)).json()).baseUrl).toBe('');
    await save.click();
    await expect(input).toHaveValue('https://gateway.example/company/v1');
    await expect(gemini).not.toBeChecked();
    await expect(gemini).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '聞き取り（Live）', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText('Apple SpeechTranscriber', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: '聞き取り（Fixed）', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '音声出力', exact: true })).toHaveCount(0);
    await expect(voice).toHaveValue('marin');
    await page.reload();
    await open();
    await expect(input).toHaveValue('https://gateway.example/company/v1');
    await expect(gemini).toBeDisabled();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 800 });
      expect(
        await page.locator('.settings-dialog').evaluate((e) => e.scrollWidth - e.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `artifacts/connection-settings-${width}.png` });
    }
    await input.fill('https://gateway.example/v1?key=invalid');
    await save.click();
    await expect(
      page.getByText(
        '接続先URLには認証情報・クエリ・フラグメントを含まないHTTP(S) URLを入力してください。',
      ),
    ).toBeVisible();
    expect((await (await request.get(`${service}/api/config`)).json()).baseUrl).toBe(
      'https://gateway.example/company/v1',
    );
    await input.fill('');
    await save.click();
    await expect(gemini).toBeEnabled();
    await expect(gemini).toBeChecked();
    await expect(page.getByRole('combobox', { name: '聞き取り（Live）', exact: true })).toHaveValue(
      'gemini',
    );
    await expect(
      page.getByRole('combobox', { name: '聞き取り（Fixed）', exact: true }),
    ).toHaveValue('gemini');
    await expect(voice).toHaveValue('Aoede');
  } finally {
    await request.put(`${service}/api/connection-settings`, { data: { baseUrl: '' } });
    await request.put(`${service}/api/config`, { data: { provider: 'openai' } });
  }
});
