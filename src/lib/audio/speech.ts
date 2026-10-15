export function splitSpeech(text: string): string[] {
  const pieces = text.match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/gu) || [];
  const result: string[] = [];
  for (const piece of pieces) {
    // 長文は音声開始まで待たせすぎない長さに区切ります。
    for (let i = 0; i < piece.length; i += 280) {
      const part = piece.slice(i, i + 280).trim();
      if (part) result.push(part);
    }
  }
  return result;
}
