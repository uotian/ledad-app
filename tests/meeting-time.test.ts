import { expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { meetingTimes } from '@/lib/session/meeting-time';
import { sessionSchema, type Transcript } from '@/lib/session/schema';

function transcript(timestamp: string): Transcript {
  return {
    id: crypto.randomUUID(),
    text: '会話',
    timestamp,
    translation: '',
    source: 'microphone',

    analyzed: false,
    disposition: 'open',
  };
}

it('開始・終了操作や会議後の編集では、発言の記録範囲を延ばさない', () => {
  const session = createSession();
  session.startedAt = '2026-10-08T00:00:00Z';
  session.endedAt = '2026-10-08T03:00:00Z';
  expect(meetingTimes(session)).toEqual({ meetingStartedAt: null, meetingLastAt: null });
  session.transcripts = [transcript('2026-10-08T01:00:00Z'), transcript('2026-10-08T01:30:00Z')];
  const expected = {
    meetingStartedAt: '2026-10-08T01:00:00.000Z',
    meetingLastAt: '2026-10-08T01:30:00.000Z',
  };
  expect(meetingTimes(session)).toEqual(expected);
  session.updatedAt = '2026-10-09T09:00:00Z';
  session.transcripts[1].translation = 'Later translation';
  session.transcripts[1].correctedAt = session.updatedAt;
  session.chats.push({
    id: crypto.randomUUID(),
    text: '会議後の相談',
    reply: '回答',
    createdAt: session.updatedAt,
    kind: 'consultation',
    status: 'applied',
  });
  expect(meetingTimes(session)).toEqual(expected);
});

it('統合前の発言時刻を保ち、不正な旧時刻と未発話の候補を含めない', () => {
  const session = createSession();
  const first = transcript('2026-10-08T10:00:00+09:00');
  first.liveSegments = [
    {
      id: crypto.randomUUID(),
      text: '最後の発言',
      timestamp: '2026-10-08T01:30:00Z',
      disposition: 'open',
    },
  ];
  session.transcripts = [transcript('invalid'), first];
  session.utterances = [
    {
      id: crypto.randomUUID(),
      kind: 'answer',
      candidateId: null,
      targetId: null,
      page: null,
      plannedText: '未発話',
      completedText: '',
      status: 'playing',
      startedAt: '2026-10-09T00:00:00Z',
      endedAt: null,
      elapsedSeconds: 0,
    },
  ];
  expect(meetingTimes(session)).toEqual({
    meetingStartedAt: '2026-10-08T01:00:00.000Z',
    meetingLastAt: '2026-10-08T01:30:00.000Z',
  });
  session.utterances[0].completedText = '実際に発言';
  expect(meetingTimes(session).meetingLastAt).toBe('2026-10-09T00:00:00.000Z');
  const legacy = { ...session } as Record<string, unknown>;
  delete legacy.meetingStartedAt;
  delete legacy.meetingLastAt;
  expect(sessionSchema.parse(legacy).meetingStartedAt).toBeNull();
});
