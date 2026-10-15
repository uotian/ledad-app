import { expect, it } from 'vitest';
import { formatTimeAgo } from '@/components/meeting/for-you/relative-time';

it.each([
  [-1000, '0秒前'],
  [0, '0秒前'],
  [30_000, '30秒前'],
  [59_999, '59秒前'],
  [60_000, '1分前'],
  [3_599_999, '59分前'],
  [3_600_000, '1時間前'],
  [86_400_000, '1日前'],
])('経過時間 %i ms を %s と表示する', (elapsed, expected) => {
  expect(formatTimeAgo(0, elapsed, 'ja-JP')).toBe(expected);
});

it('表示言語に合わせる', () => {
  expect(formatTimeAgo(0, 30_000, 'en-US')).toBe('30s ago');
  expect(formatTimeAgo(0, 30_000, 'zh-CN')).toBe('30秒前');
});
