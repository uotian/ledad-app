// WAVチャンクから生成済み音声の長さを読みます。再生済み時間とは別です。
export function wavDuration(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const text = (start: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(start, start + length));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  let dataSize = 0;
  let foundData = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) return null;
    if (text(offset, 4) === 'fmt ' && size >= 16) byteRate = view.getUint32(offset + 16, true);
    if (text(offset, 4) === 'data') { dataSize += size; foundData = true; }
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 && foundData ? dataSize / byteRate : null;
}
