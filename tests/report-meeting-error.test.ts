import { afterEach, expect, it, vi } from 'vitest';
import { reportMeetingError } from '@/lib/report-meeting-error';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  api.mockReset();
});

it('サービス停止時も表示エラーを画面側に100件まで保存し、消去操作は記録しない', async () => {
  let value = JSON.stringify(Array.from({ length: 100 }, () => ({ message: 'old' })));
  const setItem = vi.fn((_key, next) => {
    value = next;
  });
  vi.stubGlobal('localStorage', { getItem: () => value, setItem });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.mockRejectedValue(new Error('service disconnected'));
  await reportMeetingError(crypto.randomUUID(), '再認識失敗 sk-secret', '2026-10-05T10:40:20.000Z');
  expect(JSON.parse(value)).toHaveLength(100);
  expect(JSON.parse(value).at(-1).message).toBe('再認識失敗 [redacted]');
  expect(api).toHaveBeenCalledOnce();
  await reportMeetingError(crypto.randomUUID(), '', '');
  expect(setItem).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledOnce();
});
