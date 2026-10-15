import { expect, it } from 'vitest';
import { splitSpeech } from '@/lib/audio/speech';
it('長い発言の音声区間で本文を落とさない', () => {
  const text = 'あ'.repeat(650) + '。次の文です。';
  expect(splitSpeech(text).join('')).toBe(text);
  expect(splitSpeech(text).every((part) => part.length <= 280)).toBe(true);
});
