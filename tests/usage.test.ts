import { expect, it } from 'vitest';
import { wavDuration } from '@/lib/audio/wav';
it('WAVの追加チャンクを含む生成音声の実時間を読む', () => {
  const bytes = Buffer.alloc(12 + 24 + 12 + 8 + 32000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt32LE(32000, 28);
  bytes.write('JUNK', 36);
  bytes.writeUInt32LE(3, 40);
  bytes.write('data', 48);
  bytes.writeUInt32LE(32000, 52);
  expect(wavDuration(bytes)).toBe(1);
  expect(wavDuration(bytes.subarray(0, 50))).toBeNull();
});
