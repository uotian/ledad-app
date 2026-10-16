import { afterEach, expect, it, vi } from 'vitest';
import { ReviewBuffer, type AudioReview } from '@/lib/audio/review-buffer';
const epoch = Date.parse('2026-10-05T00:00:00Z');
const stamp = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const reviews: AudioReview[] = [],
    warn = vi.fn();
  const buffer = new ReviewBuffer((r) => reviews.push(r), warn, 0);
  let seconds = 0;
  const append = (length: number, value = 1) => {
    seconds += length;
    vi.setSystemTime(epoch + seconds * 1000);
    buffer.append(new Uint8Array(length * 32000).fill(value));
  };
  return { buffer, reviews, warn, append };
}
it('60秒以降の発話終端で切り、先に届いた次区間のPCMを残す', () => {
  const { buffer, reviews, append } = setup();
  append(30, 1);
  buffer.boundary('29s'); // end arrives before text
  buffer.record('first', stamp(1));
  expect(reviews).toHaveLength(0);
  append(35, 2);
  buffer.record('second', stamp(31)); // text arrives before end
  buffer.boundary('62s');
  expect(reviews).toHaveLength(1);
  expect(reviews[0].transcriptIds).toEqual(['first', 'second']);
  expect(reviews[0].pcm).toHaveLength(62 * 32000);
  expect(reviews[0].pcm[30 * 32000 - 1]).toBe(1);
  expect(reviews[0].pcm[30 * 32000]).toBe(2);
  append(2, 3);
  buffer.record('last-interim', stamp(64));
  buffer.finish();
  expect(reviews[1].transcriptIds).toEqual(['last-interim']);
  expect(reviews[1].pcm).toHaveLength(5 * 32000);
  expect(reviews[1].pcm[0]).toBe(2);
  expect(reviews[1].pcm[3 * 32000]).toBe(3);
  buffer.finish();
  expect(reviews).toHaveLength(2);
});
it('雑音の終端を無視し、除外済みエコーがある区間を再挿入しない', () => {
  const { buffer, reviews, append } = setup();
  append(65);
  buffer.boundary('2s');
  buffer.boundary('5s');
  buffer.record(null, stamp(3));
  buffer.record('speech', stamp(10));
  buffer.boundary('61s');
  expect(reviews).toHaveLength(0);
  append(5);
  buffer.record('after-echo', stamp(65));
  buffer.finish();
  expect(reviews[0].transcriptIds).toEqual(['after-echo']);
  expect(reviews[0].pcm).toHaveLength(9 * 32000);
});
it('180秒を超えた区間は破棄して警告し、その後の区間で復帰する', () => {
  const { buffer, reviews, warn, append } = setup();
  append(181);
  append(1);
  buffer.record('too-long', stamp(0));
  buffer.boundary('181s');
  expect(warn).toHaveBeenCalledOnce();
  expect(reviews).toHaveLength(0);
  append(5);
  buffer.record('recovered', stamp(183));
  buffer.finish();
  expect(reviews[0].transcriptIds).toEqual(['recovered']);
  expect(reviews[0].pcm).toHaveLength(5 * 32000);
});
it('無発話・不正な終端では空のリクエストを送らない', () => {
  const { buffer, reviews, append } = setup();
  buffer.finish();
  append(2);
  buffer.boundary(undefined);
  buffer.boundary('invalid');
  buffer.finish();
  expect(reviews).toHaveLength(0);
});

it('約1分の区間の前後5秒を重ね、後方音声が届くまでは送らない', () => {
  vi.useFakeTimers();
  const reviews: AudioReview[] = [];
  const buffer = new ReviewBuffer((r) => reviews.push(r), vi.fn());
  expect(buffer.progress).toEqual({ state: 'idle' });
  let second = 0;
  const append = (seconds: number, value: number) => {
    second += seconds;
    vi.setSystemTime(epoch + second * 1000);
    buffer.append(new Uint8Array(seconds * 32000).fill(value));
  };
  append(59, 1);
  expect(buffer.progress).toEqual({ state: 'collecting', remainingSeconds: 1 });
  append(1, 1);
  expect(buffer.progress).toEqual({ state: 'boundary' });
  buffer.record('first', stamp(0));
  buffer.boundary('60s');
  expect(buffer.progress).toEqual({ state: 'context', elapsedSeconds: 1 });
  expect(reviews).toHaveLength(0);
  for (let elapsedSeconds = 2; elapsedSeconds <= 5; elapsedSeconds++) {
    append(1, 2);
    expect(buffer.progress).toEqual({ state: 'context', elapsedSeconds });
    expect(reviews).toHaveLength(0);
  }
  expect(reviews).toHaveLength(0);
  append(1, 2);
  expect(buffer.progress).toEqual({ state: 'collecting', remainingSeconds: 55 });
  expect(reviews[0].pcm).toHaveLength(65 * 32000);
  expect(reviews[0].pcm[60 * 32000]).toBe(2);
  expect(reviews[0].transcriptIds).toEqual(['first']);
  append(55, 3);
  buffer.record('second', stamp(61));
  buffer.boundary('120s');
  expect(reviews).toHaveLength(1);
  append(5, 4);
  expect(reviews[1].pcm).toHaveLength(70 * 32000);
  expect(reviews[1].pcm[0]).toBe(1); // 前区間の55〜60秒
  expect(reviews[1].pcm[5 * 32000]).toBe(2);
  expect(reviews[1].pcm[65 * 32000]).toBe(4);
  expect(reviews[1].transcriptIds).toEqual(['second']);
  buffer.record('tail', stamp(121));
  buffer.finish();
  expect(reviews[2].pcm).toHaveLength(10 * 32000);
  expect(reviews[2].pcm[0]).toBe(3);
  expect(reviews[2].pcm[5 * 32000]).toBe(4);
});
it('5秒待ちの途中で停止しても、その時点までの音声を送る', () => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch + 62000);
  const emit = vi.fn();
  const buffer = new ReviewBuffer(emit, vi.fn());
  buffer.append(new Uint8Array(62 * 32000));
  buffer.record('first', stamp(0));
  buffer.boundary('60s');
  expect(emit).not.toHaveBeenCalled();
  buffer.finish();
  expect(emit).toHaveBeenCalledOnce();
  expect(emit.mock.calls[0][0].pcm).toHaveLength(62 * 32000);
});
it('後方の文脈に除外済みエコーが入った未送信区間は残す', () => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch + 62000);
  const emit = vi.fn();
  const buffer = new ReviewBuffer(emit, vi.fn());
  buffer.append(new Uint8Array(62 * 32000));
  buffer.record('speech', stamp(0));
  buffer.boundary('60s');
  buffer.record(null, stamp(61));
  buffer.finish();
  expect(emit).not.toHaveBeenCalled();
});
