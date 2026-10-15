import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { pollUsage } from '@/lib/usage/poll';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
});
afterEach(() => vi.useRealTimers());

it('前の応答から5秒待って更新し、遅い応答中は重複送信しない', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onValue = vi.fn();
  const stop = pollUsage('/cost', onValue, vi.fn());
  expect(api).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(api).toHaveBeenCalledTimes(1);
  resolve({ yen: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(onValue).toHaveBeenCalledWith({ yen: 1 });
  await vi.advanceTimersByTimeAsync(4999);
  expect(api).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(api).toHaveBeenCalledTimes(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('失敗後は再試行し、完了した詳細の更新は止める', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValue('completed');
  const onError = vi.fn();
  const onValue = vi.fn(() => false);
  const stop = pollUsage('/detail', onValue, onError);
  await vi.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
  expect(onValue).toHaveBeenCalledWith('completed');
  await vi.advanceTimersByTimeAsync(15000);
  expect(api).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

it.each(['resolve', 'reject'])('閉じた後の遅い%sは表示も再試行もしない', async (outcome) => {
  let finish!: () => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        finish = () => (outcome === 'resolve' ? resolve('late') : reject(new Error('late')));
      }),
  );
  const onValue = vi.fn();
  const onError = vi.fn();
  const stop = pollUsage('/usage', onValue, onError);
  const signal = vi.mocked(api).mock.calls[0][1]?.signal;
  stop();
  expect(signal?.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(15000);
  expect(onValue).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
