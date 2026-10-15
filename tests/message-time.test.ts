import { expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { sessionSchema } from '@/lib/session/schema';
import { formatTranscriptTime } from '@/lib/session/transcript-display';

it('端末の現地日時を秒まで固定形式で表示する', () => {
  const date = new Date(2026, 9, 8, 22, 30, 53);
  expect(formatTranscriptTime(date.toISOString())).toBe('2026-10-08 22:30:53');
  expect(formatTranscriptTime(new Date(2026, 0, 2, 0, 3, 4).toISOString())).toBe(
    '2026-01-02 00:03:04',
  );
});

it('Chatの応答日時を保持し、日時のない旧データも読み込む', () => {
  const session = createSession();
  const chat = {
    id: crypto.randomUUID(),
    text: '相談',
    kind: 'consultation' as const,
    reply: '回答',
    createdAt: '2026-10-08T13:30:53Z',
    status: 'applied' as const,
  };
  const repliedAt = '2026-10-08T13:31:03Z';
  const result = sessionSchema.parse({
    ...session,
    chats: [chat, { ...chat, id: crypto.randomUUID(), repliedAt }],
  });
  expect(result.chats[0].repliedAt).toBeUndefined();
  expect(result.chats[1].repliedAt).toBe(repliedAt);
});
