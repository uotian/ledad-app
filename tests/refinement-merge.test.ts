import { expect, it } from 'vitest';
import { transcriptSchema } from '@/lib/session/schema';
import { matchesTranscript } from '@/lib/session/refinement';
it('Pythonで統合した区間を、統合前のIDから画面で参照できる', () => {
  const oldId = crypto.randomUUID();
  const transcript = transcriptSchema.parse({
    id: crypto.randomUUID(),
    text: '分かりますか？',
    translation: 'Do you understand?',
    timestamp: '2026-10-08T00:00:00Z',
    correctedAt: '2026-10-08T00:01:00Z',
    liveSegments: [
      { id: oldId, text: 'かりますか？', timestamp: '2026-10-08T00:00:01Z', disposition: 'open' },
    ],
    source: 'display',
    analyzed: true,

    disposition: 'open',
  });
  expect(matchesTranscript(transcript, oldId)).toBe(true);
  expect(matchesTranscript(transcript, transcript.id)).toBe(true);
  expect(matchesTranscript(transcript, crypto.randomUUID())).toBe(false);
});
