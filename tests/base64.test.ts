import { expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '@/lib/base64';

it('空・バイト境界・録音サイズのデータを標準Base64と同じ形式で往復する', () => {
  for (const size of [0, 1, 2, 256, 8193, 190 * 32000]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 256);
    const encoded = encodeBase64(bytes);
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
    expect(Buffer.from(decodeBase64(encoded)).equals(Buffer.from(bytes))).toBe(true);
  }
});
