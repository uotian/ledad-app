import { afterEach, expect, it, vi } from 'vitest';
import { startAnalyzeSchedule } from '@/components/meeting/analyze/schedule';

afterEach(() => vi.useRealTimers());

it('変更通知で即実行し、解析中の通知はまとめて完了直後に実行する', async () => {
  vi.useFakeTimers();
  let finish: () => void = () => {};
  let conversation = '最初の発言';
  const inputs: string[] = [];
  const refresh = vi.fn(() => {
    inputs.push(conversation);
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const schedule = startAnalyzeSchedule(refresh);
  schedule.request();
  expect(inputs).toEqual(['最初の発言']);
  conversation = '追加された発言';
  schedule.request();
  conversation = '訂正された最新の発言';
  schedule.request();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(inputs).toEqual(['最初の発言', '訂正された最新の発言']);
  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  schedule.stop();
});

it('会話がない・入力が同じ場合は空回りせず、次の変更を待つ', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn(async () => {});
  const schedule = startAnalyzeSchedule(refresh);
  expect(refresh).not.toHaveBeenCalled();
  schedule.request();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  schedule.request();
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.stop();
});

it.each(['retry', 'throw'] as const)('失敗時は待たずに一度再試行する: %s', async (failure) => {
  vi.useFakeTimers();
  const refresh = vi.fn<() => Promise<void | 'retry'>>().mockResolvedValue(undefined);
  if (failure === 'retry') refresh.mockResolvedValueOnce('retry');
  else refresh.mockRejectedValueOnce(new Error('通信失敗'));
  const schedule = startAnalyzeSchedule(refresh);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  schedule.stop();
});

it('停止すると解析中に予約された更新も実行しない', async () => {
  vi.useFakeTimers();
  let finish: () => void = () => {};
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const schedule = startAnalyzeSchedule(refresh);
  schedule.request();
  schedule.request();
  schedule.stop();
  finish();
  schedule.request();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('連続失敗は二回で止まり、新しい変更で再開する', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn(async () => 'retry' as const);
  const schedule = startAnalyzeSchedule(refresh);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(4);
  schedule.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

it('停止したら進行中の失敗からも再試行しない', async () => {
  vi.useFakeTimers();
  let fail: () => void = () => {};
  const refresh = vi.fn(
    () =>
      new Promise<'retry'>((resolve) => {
        fail = () => resolve('retry');
      }),
  );
  const schedule = startAnalyzeSchedule(refresh);
  schedule.request();
  schedule.stop();
  fail();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([15, 30, 60, 180])(
  '%i秒間隔では最初を即送信し、その後の変更をまとめる',
  async (seconds) => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => 'sent' as const);
    const schedule = startAnalyzeSchedule(refresh, () => seconds * 1000);
    schedule.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledOnce();
    schedule.request();
    schedule.request();
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    schedule.stop();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('会話が空のときは間隔を開始せず、最初の発言を即送信する', async () => {
  vi.useFakeTimers();
  const refresh = vi
    .fn<() => Promise<void | 'sent'>>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue('sent');
  const schedule = startAnalyzeSchedule(refresh, () => 180_000);
  schedule.request();
  await vi.advanceTimersByTimeAsync(10_000);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.stop();
});

it('再試行は送信間隔も待たず、その後の変更には設定間隔を適用する', async () => {
  vi.useFakeTimers();
  const refresh = vi
    .fn<() => Promise<'sent' | 'retry'>>()
    .mockResolvedValueOnce('retry')
    .mockResolvedValue('sent');
  const schedule = startAnalyzeSchedule(refresh, () => 180_000);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.request();
  await vi.advanceTimersByTimeAsync(179_999);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(3);
  schedule.stop();
});

it('待機中に設定を短くすると、経過済みの間隔をすぐ反映する', async () => {
  vi.useFakeTimers();
  let interval = 180_000;
  const refresh = vi.fn(async () => 'sent' as const);
  const schedule = startAnalyzeSchedule(refresh, () => interval);
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  schedule.request();
  await vi.advanceTimersByTimeAsync(20_000);
  interval = 15_000;
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.stop();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(vi.getTimerCount()).toBe(0);
});

it('変更がある待機中だけ送信予定時刻を通知し、送信・取消で消す', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const waiting = vi.fn();
  const refresh = vi.fn(async () => 'sent' as const);
  const schedule = startAnalyzeSchedule(refresh, () => 30_000, waiting);
  expect(waiting).not.toHaveBeenCalled();
  schedule.request();
  await vi.advanceTimersByTimeAsync(0);
  expect(waiting).toHaveBeenLastCalledWith(null);
  await vi.advanceTimersByTimeAsync(10_000);
  schedule.request();
  expect(waiting).toHaveBeenLastCalledWith(30_000);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(waiting).toHaveBeenLastCalledWith(null);
  schedule.request();
  expect(waiting).toHaveBeenLastCalledWith(60_000);
  schedule.stop();
  expect(waiting).toHaveBeenLastCalledWith(null);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, 15_000])('APIに20秒かかっても完了後に%sミリ秒待って次を送る', async (interval) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let finish: (result: 'sent') => void = () => {};
  const refresh = vi.fn(
    () =>
      new Promise<'sent'>((resolve) => {
        finish = resolve;
      }),
  );
  const waiting = vi.fn();
  const schedule = startAnalyzeSchedule(refresh, () => interval, waiting);
  schedule.request();
  schedule.request();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish('sent');
  await vi.advanceTimersByTimeAsync(0);
  if (interval) {
    expect(waiting).toHaveBeenLastCalledWith(20_000 + interval);
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(refresh).toHaveBeenCalledTimes(2);
  finish('sent');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  schedule.stop();
});
