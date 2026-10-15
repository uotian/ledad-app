import { defineConfig } from '@playwright/test';
const uiPort = Number(process.env.LEDAD_UI_PORT || 3000);
const realApi = process.env.LEDAD_E2E_REAL_API === '1';
const realApiTests = ['meeting.spec.ts', 'translations.spec.ts', 'translation-stability.spec.ts'];
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: realApi ? realApiTests : '**/*.spec.ts',
  testIgnore: realApi ? [] : realApiTests,
  forbidOnly: !!process.env.CI,
  timeout: 240_000,
  expect: { timeout: 90_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: realApi ? 'artifacts/e2e-real-api' : 'artifacts/e2e',
  use: {
    actionTimeout: 15_000,
    // ロック中も生成音声のデコード・再生時間・終了イベントを検証。物理出力は別途実機確認。
    launchOptions: { args: ['--disable-audio-output'] },
    baseURL: `http://127.0.0.1:${uiPort}`,
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `NEXT_PUBLIC_LEDAD_DISABLE_AUDIO_CAPTURE=1 npm run dev:ui -- --port ${uiPort}`,
      url: `http://127.0.0.1:${uiPort}`,
      // 通常起動したサーバーではテスト用の音声取得停止が有効になりません。
      reuseExistingServer: false,
    },
    {
      command: 'npm run service:dev',
      env: {
        LEDAD_UI_PORT: String(uiPort),
        LEDAD_SERVICE_PORT: '4320',
        LEDAD_DATA_DIR: realApi ? '.data/e2e-real-api' : '.data/e2e',
        // dotenv does not overwrite existing variables, including empty strings.
        ...(realApi ? {} : { OPENAI_API_KEY: '', GEMINI_API_KEY: '' }),
      },
      url: 'http://127.0.0.1:4320/api/config',
      reuseExistingServer: false,
    },
  ],
});
