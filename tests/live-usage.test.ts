import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveServerMessage } from '@google/genai';
import { LiveUsage } from '@/lib/audio/live-usage';
const { api } = vi.hoisted(() => ({
  api: vi.fn<(path: string, options: { body: string }) => Promise<{ saved: boolean }>>(
    async () => ({ saved: true }),
  ),
}));
vi.mock('@/lib/api', () => ({ api }));
beforeEach(() => {
  vi.useFakeTimers();
  api.mockClear();
});
afterEach(() => vi.useRealTimers());
it('送信したPCM秒数を保存し、応答のトークン値は勝手に合算しない', async () => {
  const onError = vi.fn();
  const usage = new LiveUsage(crypto.randomUUID(), crypto.randomUUID(), onError);
  usage.sent(32000);
  usage.sent(16000);
  usage.received({ promptTokenCount: 40, responseTokenCount: 8, totalTokenCount: 48 });
  usage.received({ promptTokenCount: 60, responseTokenCount: 10, totalTokenCount: 70 });
  await vi.advanceTimersByTimeAsync(5000);
  usage.stop('completed');
  await vi.advanceTimersByTimeAsync(1);
  const body = JSON.parse(api.mock.calls.at(-1)![1].body);
  expect(body.audioInputSeconds).toBe(1.5);
  expect(body.liveReports.map((r: { totalTokens: number }) => r.totalTokens)).toEqual([48, 70]);
  expect(body.status).toBe('completed');
  expect(body).not.toHaveProperty('totalTokens');
  expect(onError).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(api).toHaveBeenCalledTimes(2);
});

it('Liveの応答を記録し、バイナリと上限を超える応答は保存しない', async () => {
  const usage = new LiveUsage(crypto.randomUUID(), crypto.randomUUID(), vi.fn());
  usage.message(
    Object.assign(new LiveServerMessage(), {
      serverContent: {
        inputTranscription: { text: 'こんにちは' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'audio-data' } }] },
      },
    }),
  );
  usage.message(
    Object.assign(new LiveServerMessage(), {
      serverContent: { inputTranscription: { text: 'x'.repeat(2_000_001) } },
    }),
  );
  await usage.stop();
  const body = JSON.parse(api.mock.calls.at(-1)![1].body);
  expect(body.liveMessages).toHaveLength(1);
  expect(body.liveMessagesTruncated).toBe(true);
  const message = JSON.parse(body.liveMessages[0]);
  expect(message.serverContent.inputTranscription.text).toBe('こんにちは');
  expect(message.serverContent.modelTurn.parts[0].inlineData.data).toEqual({
    omitted: 'binary',
    encodedCharacters: 10,
  });
  expect(body.liveMessages[0]).not.toContain('audio-data');
});
