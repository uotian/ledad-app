import { afterEach, expect, it, vi } from 'vitest';
import { TranscriptClock } from '@/lib/audio/transcript-clock';
afterEach(() => vi.useRealTimers());
it('実APIの開始位置から日時を求め、途中更新と確定で維持する', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T16:00:00.100Z'));
  const clock = new TranscriptClock();
  clock.audioSent(3200);
  vi.advanceTimersByTime(2000);
  clock.activity({ type: 'ACTIVITY_START', audioOffset: '0.400s' });
  expect(clock.interim()).toBe('2026-10-04T16:00:00.400Z');
  vi.advanceTimersByTime(3000);
  expect(clock.interim()).toBe('2026-10-04T16:00:00.400Z');
  expect(clock.final()).toBe('2026-10-04T16:00:00.400Z');
  clock.audioSent(3200);
  clock.activity({ voiceActivityType: 'ACTIVITY_START', audioOffset: '5.480s' });
  expect(clock.final()).toBe('2026-10-04T16:00:05.480Z');
});
it('開始情報がない場合は最初の結果の日時を使い、再接続で前の開始時刻を残さない', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T16:00:00Z'));
  const clock = new TranscriptClock();
  clock.activity({ type: 'ACTIVITY_START', audioOffset: 'broken' });
  expect(clock.interim()).toBe('2026-10-04T16:00:00.000Z');
  vi.advanceTimersByTime(1000);
  expect(clock.final()).toBe('2026-10-04T16:00:00.000Z');
  clock.reset();
  expect(clock.final()).toBe('2026-10-04T16:00:01.000Z');
});
