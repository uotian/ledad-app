import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('通常E2Eは親プロセスにAPIキーがあっても実キーをBackendへ渡さない', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-parent-openai');
  vi.stubEnv('GEMINI_API_KEY', 'test-parent-gemini');
  vi.stubEnv('LEDAD_E2E_REAL_API', '0');
  const { default: config } = await import('../playwright.config');
  const servers = config.webServer as { env?: Record<string, string> }[];
  expect(servers[1].env).toMatchObject({
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    LEDAD_DATA_DIR: '.data/e2e',
  });
  expect(config.testIgnore).toContain('meeting.spec.ts');
  expect(config.outputDir).toBe('artifacts/e2e');
});

it('実APIの明示実行は専用データ領域で3ファイルだけを選択する', async () => {
  vi.stubEnv('LEDAD_E2E_REAL_API', '1');
  const { default: config } = await import('../playwright.config');
  const servers = config.webServer as { env?: Record<string, string> }[];
  expect(servers[1].env?.LEDAD_DATA_DIR).toBe('.data/e2e-real-api');
  expect(config.outputDir).toBe('artifacts/e2e-real-api');
  expect(servers[1].env).not.toHaveProperty('OPENAI_API_KEY');
  expect(config.testMatch).toEqual([
    'meeting.spec.ts',
    'translations.spec.ts',
    'translation-stability.spec.ts',
  ]);
});
