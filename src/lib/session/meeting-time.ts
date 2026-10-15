import type { Session } from './schema';

// 処理完了時刻ではなく、統合前の発言も含めた会話の時刻を使います。
export function meetingTimes(session: Pick<Session, 'transcripts' | 'utterances'>) {
  let first = Infinity;
  let last = -Infinity;
  for (const entry of [
    ...session.transcripts.flatMap((item) => [item, ...(item.liveSegments ?? [])]),
    ...session.utterances
      .filter((item) => item.completedText.trim())
      .map((item) => ({ text: item.completedText, timestamp: item.startedAt })),
  ]) {
    const time = Date.parse(entry.timestamp);
    if (
      !entry.text.trim() ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(entry.timestamp) ||
      !Number.isFinite(time)
    )
      continue;
    first = Math.min(first, time);
    last = Math.max(last, time);
  }
  return {
    meetingStartedAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
    meetingLastAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
  };
}
